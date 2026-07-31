import { Injectable } from "@nestjs/common";
import type {
  RoomPlaybackReadinessInputPayload,
  RoomPlaybackReadinessPayload,
  RoomSnapshot
} from "@music-room/shared";
import type { Server } from "socket.io";
import { RoomRealtimeBroadcaster } from "../realtime/room-realtime.broadcaster";
import { RoomService } from "../room/room.service";

/**
 * Room-wide cache playback barrier. The barrier keeps every online cache
 * participant on the same media clock while a provider track is downloaded
 * locally; the shared hold/resume anchor is then broadcast room-wide so
 * streaming members do not run their progress through silence.
 */
@Injectable()
export class RoomPlaybackReadinessService {
  private readonly playbackReadinessByRoom = new Map<string, Map<string, RoomPlaybackReadinessPayload>>();
  private readonly playbackBarrierByRoom = new Map<string, {
    key: string;
    state: "waiting" | "open";
    resumeAt: string | null;
    holdPositionMs: number | null;
    updatedAt: string;
  }>();
  private server: Server | null = null;

  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimeBroadcaster: RoomRealtimeBroadcaster
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  async handleReadiness(message: RoomPlaybackReadinessInputPayload) {
    const snapshot = await this.roomService.getAccessibleRoomSnapshot(
      message.roomId,
      [],
      message.sessionId
    );
    const playback = snapshot.room.playback;
    const trackId = playback.currentTrackId;
    const mediaEpoch = playback.mediaEpoch;
    const key = `${trackId ?? "none"}:${mediaEpoch}`;
    const readinessBySession = this.playbackReadinessByRoom.get(message.roomId) ?? new Map();
    this.playbackReadinessByRoom.set(message.roomId, readinessBySession);
    const normalizedState = message.cacheEnabled && message.state === "waiting"
      ? "waiting"
      : "ready";
    const activeMembers = snapshot.room.members.filter(
      (member) => member.presenceState === "online" && !!member.peerId
    );
    const previousBarrier = this.playbackBarrierByRoom.get(message.roomId);
    const canonicalBase: RoomPlaybackReadinessPayload = {
      roomId: message.roomId,
      sessionId: message.sessionId,
      peerId: message.peerId,
      trackId,
      mediaEpoch,
      cacheEnabled: message.cacheEnabled,
      state: normalizedState,
      barrier: "waiting",
      resumeAt: null,
      holdPositionMs: null,
      updatedAt: new Date().toISOString()
    };
    readinessBySession.set(message.sessionId, canonicalBase);

    // Only online members that explicitly enabled fully-cached playback decide
    // when this barrier opens. The resulting hold/resume clock is broadcast
    // room-wide so streaming members do not run their progress through silence.
    const cacheParticipants = activeMembers
      .map((member) => readinessBySession.get(member.id))
      .filter((entry): entry is RoomPlaybackReadinessPayload =>
        !!entry &&
        entry.trackId === trackId &&
        entry.mediaEpoch === mediaEpoch &&
        entry.cacheEnabled
      );
    const allReady = playback.status !== "playing" ||
      cacheParticipants.every((entry) => entry.state !== "waiting");
    const barrierState: "waiting" | "open" = allReady ? "open" : "waiting";
    const holdPositionMs = this.resolvePlaybackBarrierHoldPosition({
      key,
      previousBarrier,
      barrierState
    });
    // Ready caches follow the normal path immediately. A shared start time
    // is only needed when this exact track was actually held for at least one
    // member to finish caching.
    const resumeAt = barrierState === "open"
      ? previousBarrier?.key === key && previousBarrier.state === "waiting"
        ? new Date(Date.now() + 650).toISOString()
        : previousBarrier?.key === key && previousBarrier.state === "open"
          ? previousBarrier.resumeAt
          : null
      : null;
    const canonical: RoomPlaybackReadinessPayload = {
      ...canonicalBase,
      barrier: barrierState,
      resumeAt,
      holdPositionMs,
      updatedAt: new Date().toISOString()
    };
    this.playbackBarrierByRoom.set(message.roomId, {
      key,
      state: barrierState,
      resumeAt,
      holdPositionMs,
      updatedAt: canonical.updatedAt
    });
    readinessBySession.set(message.sessionId, canonical);
    this.ensureServer();
    // A barrier transition is room-wide. Refresh every matching readiness
    // entry so clients do not wait for an unrelated heartbeat before they can
    // observe the shared hold/resume anchor.
    for (const entry of readinessBySession.values()) {
      if (entry.trackId !== trackId || entry.mediaEpoch !== mediaEpoch) continue;
      const nextEntry = entry.sessionId === message.sessionId
        ? canonical
        : {
            ...entry,
            barrier: barrierState,
            resumeAt,
            holdPositionMs,
            updatedAt: new Date().toISOString()
          } satisfies RoomPlaybackReadinessPayload;
      readinessBySession.set(entry.sessionId, nextEntry);
      this.roomRealtimeBroadcaster.emitPlaybackReadiness(message.roomId, nextEntry);
    }
    return canonical;
  }

  handleRedisReadiness(roomId: string, data: RoomPlaybackReadinessPayload) {
    // Keep a local copy as well. Readiness is a room-wide barrier, so a
    // reconnect or cleanup on this instance must include reports received
    // through Redis from other signaling instances.
    const readinessBySession = this.playbackReadinessByRoom.get(roomId) ?? new Map();
    readinessBySession.set(data.sessionId, data);
    this.playbackReadinessByRoom.set(roomId, readinessBySession);
    const currentBarrier = this.playbackBarrierByRoom.get(roomId);
    if (!currentBarrier || data.updatedAt >= currentBarrier.updatedAt) {
      this.playbackBarrierByRoom.set(roomId, {
        key: `${data.trackId ?? "none"}:${data.mediaEpoch}`,
        state: data.barrier,
        resumeAt: data.resumeAt,
        holdPositionMs: data.holdPositionMs,
        updatedAt: data.updatedAt
      });
    }
    this.server!.to(roomId).emit("room.playback.readiness", data);
  }

  clearForSession(roomId?: string, sessionId?: string) {
    if (!roomId) return;
    const readiness = this.playbackReadinessByRoom.get(roomId);
    if (readiness && sessionId) readiness.delete(sessionId);
    if (readiness?.size === 0) this.playbackReadinessByRoom.delete(roomId);
    // A departed member may have been the last blocker. Re-evaluate promptly
    // instead of waiting for another member's heartbeat.
    void this.recomputePlaybackBarrier(roomId);
  }

  clearRoomState(roomId: string) {
    this.playbackReadinessByRoom.delete(roomId);
    this.playbackBarrierByRoom.delete(roomId);
  }

  dispose() {
    this.playbackReadinessByRoom.clear();
    this.playbackBarrierByRoom.clear();
  }

  getReadinessForTimeline(roomId: string, key: string) {
    const readiness = this.playbackReadinessByRoom.get(roomId);
    const result: RoomPlaybackReadinessPayload[] = [];
    for (const item of readiness?.values() ?? []) {
      if (`${item.trackId ?? "none"}:${item.mediaEpoch}` === key) {
        result.push(item);
      }
    }
    return result;
  }

  async recomputePlaybackBarrier(roomId: string) {
    let snapshot: RoomSnapshot;
    try {
      snapshot = await this.roomService.getRoomSnapshot(roomId, []);
    } catch {
      return;
    }

    const playback = snapshot.room.playback;
    const trackId = playback.currentTrackId;
    const mediaEpoch = playback.mediaEpoch;
    const key = `${trackId ?? "none"}:${mediaEpoch}`;
    const readinessBySession = this.playbackReadinessByRoom.get(roomId);
    if (!readinessBySession || !trackId || playback.status !== "playing") {
      this.playbackBarrierByRoom.delete(roomId);
      return;
    }

    const activeMembers = snapshot.room.members.filter(
      (member) => member.presenceState === "online" && !!member.peerId
    );
    const cacheParticipants = activeMembers
      .map((member) => readinessBySession.get(member.id))
      .filter((entry): entry is RoomPlaybackReadinessPayload =>
        !!entry &&
        entry.trackId === trackId &&
        entry.mediaEpoch === mediaEpoch &&
        entry.cacheEnabled
      );
    const allReady = cacheParticipants.every((entry) => entry.state !== "waiting");
    const barrierState: "waiting" | "open" = allReady ? "open" : "waiting";
    const previous = this.playbackBarrierByRoom.get(roomId);
    const holdPositionMs = this.resolvePlaybackBarrierHoldPosition({
      key,
      previousBarrier: previous,
      barrierState
    });
    const resumeAt = barrierState === "open"
      ? previous?.key === key && previous.state === "waiting"
        ? new Date(Date.now() + 650).toISOString()
        : previous?.key === key && previous.state === "open"
          ? previous.resumeAt
          : null
      : null;
    this.playbackBarrierByRoom.set(roomId, {
      key,
      state: barrierState,
      resumeAt,
      holdPositionMs,
      updatedAt: new Date().toISOString()
    });

    this.ensureServer();
    for (const entry of readinessBySession.values()) {
      if (entry.trackId !== trackId || entry.mediaEpoch !== mediaEpoch) continue;
      const nextEntry: RoomPlaybackReadinessPayload = {
        ...entry,
        barrier: barrierState,
        resumeAt,
        holdPositionMs,
        updatedAt: new Date().toISOString()
      };
      readinessBySession.set(entry.sessionId, nextEntry);
      this.roomRealtimeBroadcaster.emitPlaybackReadiness(roomId, nextEntry);
    }
  }

  private resolvePlaybackBarrierHoldPosition(input: {
    key: string;
    previousBarrier: {
      key: string;
      state: "waiting" | "open";
      resumeAt: string | null;
      holdPositionMs: number | null;
    } | undefined;
    barrierState: "waiting" | "open";
  }) {
    const previous = input.previousBarrier;
    if (input.barrierState === "waiting") {
      // Cache playback is a prepare barrier, not a seek-and-continue point.
      // Every waiting cycle restarts the track from its beginning once all
      // participating clients are ready.
      return 0;
    }

    if (
      previous?.key === input.key &&
      (previous.state === "waiting" || previous.state === "open")
    ) {
      return previous.holdPositionMs;
    }
    return null;
  }

  private ensureServer() {
    if (this.server) {
      this.roomRealtimeBroadcaster.setServer(this.server);
    }
  }
}
