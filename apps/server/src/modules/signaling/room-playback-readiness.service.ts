import { Injectable, Logger, Optional } from "@nestjs/common";
import type {
  RoomPlaybackReadinessInputPayload,
  RoomPlaybackReadinessPayload,
  RoomSnapshot
} from "@music-room/shared";
import type { Server } from "socket.io";
import { RedisService } from "../../infra/redis/redis.service";
import { RoomRealtimeBroadcaster } from "../realtime/room-realtime.broadcaster";
import { RoomService } from "../room/room.service";

type PlaybackBarrier = {
  key: string;
  state: "waiting" | "open";
  resumeAt: string | null;
  holdPositionMs: number | null;
  updatedAt: string;
};

type PersistedReadinessState = {
  key: string;
  entries: RoomPlaybackReadinessPayload[];
  waitingSinceBySession: Record<string, string>;
  barrier: PlaybackBarrier;
  updatedAt: string;
};

const readinessStateTtlSeconds = 120;
const waitingTimeoutMs = 30_000;

/**
 * Room-wide cache playback barrier. Redis stores the reports and the computed
 * barrier so every signaling instance evaluates the same participant set. The
 * process-local maps remain only as a fast delivery cache for newly subscribed
 * sockets.
 */
@Injectable()
export class RoomPlaybackReadinessService {
  private readonly logger = new Logger(RoomPlaybackReadinessService.name);
  private readonly playbackReadinessByRoom = new Map<string, Map<string, RoomPlaybackReadinessPayload>>();
  private readonly playbackBarrierByRoom = new Map<string, PlaybackBarrier>();
  private readonly readinessUpdateChains = new Map<string, Promise<void>>();
  private server: Server | null = null;

  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimeBroadcaster: RoomRealtimeBroadcaster,
    @Optional() private readonly redis?: RedisService
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  async handleReadiness(message: RoomPlaybackReadinessInputPayload) {
    return this.enqueueRoomOperation(message.roomId, async () => {
      const snapshot = await this.roomService.getAccessibleRoomSnapshot(
        message.roomId,
        [],
        message.sessionId
      );
      if (
        message.trackId !== snapshot.room.playback.currentTrackId ||
        message.mediaEpoch !== snapshot.room.playback.mediaEpoch
      ) {
        return undefined;
      }
      const key = this.timelineKey(snapshot.room.playback.currentTrackId, snapshot.room.playback.mediaEpoch);
      const state = await this.loadState(message.roomId, key);
      const now = new Date();
      const normalizedState: RoomPlaybackReadinessPayload["state"] = message.cacheEnabled
        ? message.state
        : "ready";
      const previous = state.entries.find((entry) => entry.sessionId === message.sessionId);
      const entry: RoomPlaybackReadinessPayload = {
        roomId: message.roomId,
        sessionId: message.sessionId,
        peerId: message.peerId,
        trackId: snapshot.room.playback.currentTrackId,
        mediaEpoch: snapshot.room.playback.mediaEpoch,
        cacheEnabled: message.cacheEnabled,
        state: normalizedState,
        barrier: "waiting",
        resumeAt: null,
        holdPositionMs: null,
        updatedAt: now.toISOString()
      };
      const entries = [
        ...state.entries.filter((current) => current.sessionId !== message.sessionId),
        entry
      ];
      const waitingSinceBySession = { ...state.waitingSinceBySession };
      if (normalizedState === "waiting" && message.cacheEnabled) {
        waitingSinceBySession[message.sessionId] = previous?.state === "waiting"
          ? state.waitingSinceBySession[message.sessionId] ?? now.toISOString()
          : now.toISOString();
      } else {
        delete waitingSinceBySession[message.sessionId];
      }

      const nextState = this.computeState({
        roomId: message.roomId,
        key,
        snapshot,
        entries,
        waitingSinceBySession,
        previousBarrier: state.barrier,
        now
      });
      await this.saveState(message.roomId, nextState);
      this.applyLocalState(message.roomId, nextState);
      this.broadcastState(message.roomId, nextState);
      return nextState.entries.find((current) => current.sessionId === message.sessionId) ?? entry;
    });
  }

  /**
   * Redis readiness events are notifications, not authority. Apply the payload
   * immediately for low-latency delivery, then hydrate the complete persisted
   * state so an out-of-order event cannot overwrite a newer barrier locally.
   */
  handleRedisReadiness(roomId: string, data: RoomPlaybackReadinessPayload) {
    if (!this.upsertLocalEntry(roomId, data)) {
      return;
    }
    this.server?.to(roomId).emit("room.playback.readiness", data);
    void this.hydrateFromRedis(roomId, data);
  }

  clearForSession(roomId?: string, sessionId?: string, peerId?: string) {
    if (!roomId || !sessionId) return;
    const readiness = this.playbackReadinessByRoom.get(roomId);
    const localEntry = readiness?.get(sessionId);
    const localBarrier = this.playbackBarrierByRoom.get(roomId);
    const clearBefore = [
      new Date().toISOString(),
      localEntry?.updatedAt,
      localBarrier?.updatedAt
    ].filter((value): value is string => !!value).sort().at(-1)!;
    const shouldRemove = (entry: RoomPlaybackReadinessPayload) =>
      entry.sessionId === sessionId &&
      (!peerId || entry.peerId === peerId) &&
      compareReadinessUpdates(entry.updatedAt, clearBefore) <= 0;
    if (localEntry && shouldRemove(localEntry)) {
      readiness?.delete(sessionId);
    }
    if (readiness?.size === 0) this.playbackReadinessByRoom.delete(roomId);
    void this.enqueueRoomOperation(roomId, async () => {
      const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
      const key = this.timelineKey(
        snapshot.room.playback.currentTrackId,
        snapshot.room.playback.mediaEpoch
      );
      const state = await this.loadState(roomId, key);
      const entries = state.entries.filter((entry) => !shouldRemove(entry));
      const waitingSinceBySession = { ...state.waitingSinceBySession };
      if (!entries.some((entry) => entry.sessionId === sessionId)) {
        delete waitingSinceBySession[sessionId];
      }
      const nextState = this.computeState({
        roomId,
        key,
        snapshot,
        entries,
        waitingSinceBySession,
        previousBarrier: state.barrier,
        now: new Date()
      });
      await this.saveState(roomId, nextState);
      this.applyLocalState(roomId, nextState);
      this.broadcastState(roomId, nextState);
    }).catch((error) => {
      this.logger.warn(`Unable to clear playback readiness for ${roomId}/${sessionId}: ${String(error)}`);
    });
  }

  clearRoomState(roomId: string) {
    this.playbackReadinessByRoom.delete(roomId);
    this.playbackBarrierByRoom.delete(roomId);
    if (this.isRedisAvailable()) {
      void this.redis!.delete(this.stateKey(roomId)).catch(() => undefined);
    }
  }

  dispose() {
    this.playbackReadinessByRoom.clear();
    this.playbackBarrierByRoom.clear();
    this.readinessUpdateChains.clear();
  }

  getReadinessForTimeline(roomId: string, key: string) {
    const readiness = this.playbackReadinessByRoom.get(roomId);
    const result: RoomPlaybackReadinessPayload[] = [];
    for (const item of readiness?.values() ?? []) {
      if (this.timelineKey(item.trackId, item.mediaEpoch) === key) {
        result.push(item);
      }
    }
    return result;
  }

  async recomputePlaybackBarrier(roomId: string) {
    return this.enqueueRoomOperation(roomId, async () => {
      const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
      const key = this.timelineKey(
        snapshot.room.playback.currentTrackId,
        snapshot.room.playback.mediaEpoch
      );
      const state = await this.loadState(roomId, key);
      if (!state || !snapshot.room.playback.currentTrackId || snapshot.room.playback.status !== "playing") {
        this.playbackBarrierByRoom.delete(roomId);
        return;
      }
      const nextState = this.computeState({
        roomId,
        key,
        snapshot,
        entries: state.entries,
        waitingSinceBySession: state.waitingSinceBySession,
        previousBarrier: state.barrier,
        now: new Date()
      });
      await this.saveState(roomId, nextState);
      this.applyLocalState(roomId, nextState);
      this.broadcastState(roomId, nextState);
    });
  }

  private async hydrateFromRedis(roomId: string, fallback: RoomPlaybackReadinessPayload) {
    try {
      const state = await this.loadState(roomId);
      this.applyLocalState(roomId, state);
      const current = state.entries.find((entry) => entry.sessionId === fallback.sessionId);
      if (current && compareReadinessUpdates(current.updatedAt, fallback.updatedAt) > 0) {
        this.server?.to(roomId).emit("room.playback.readiness", current);
      }
    } catch (error) {
      this.logger.warn(`Unable to hydrate playback readiness for ${roomId}: ${String(error)}`);
    }
  }

  private enqueueRoomOperation<T>(roomId: string, operation: () => Promise<T>) {
    const previous = this.readinessUpdateChains.get(roomId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(() => this.withRoomLock(roomId, operation));
    const settled = result.then(() => undefined, () => undefined);
    this.readinessUpdateChains.set(roomId, settled);
    void settled.finally(() => {
      if (this.readinessUpdateChains.get(roomId) === settled) {
        this.readinessUpdateChains.delete(roomId);
      }
    });
    return result;
  }

  private async withRoomLock<T>(roomId: string, operation: () => Promise<T>) {
    const redis = this.redis as (RedisService & {
      acquireLock?: (key: string, ttlMs: number) => Promise<string | null>;
      releaseLock?: (key: string, token: string) => Promise<boolean>;
      isAvailable?: () => boolean;
    }) | undefined;
    if (!redis || typeof redis.acquireLock !== "function" || typeof redis.releaseLock !== "function" || typeof redis.isAvailable !== "function") {
      if (isStrictRealtimeCoordination()) {
        throw new Error("Realtime coordination is unavailable.");
      }
      return operation();
    }
    if (!redis.isAvailable()) {
      if (isStrictRealtimeCoordination()) {
        throw new Error("Realtime coordination is unavailable.");
      }
      return operation();
    }

    const deadline = Date.now() + 3_000;
    let token: string | null = null;
    while (!token && Date.now() < deadline) {
      token = await redis.acquireLock(`music-room:lock:room:${roomId}`, 30_000);
      if (!token) await delay(20);
    }
    if (!token) throw new Error("Room playback readiness is busy.");
    try {
      return await operation();
    } finally {
      await redis.releaseLock(`music-room:lock:room:${roomId}`, token).catch((error) => {
        this.logger.warn(`Unable to release playback readiness lock ${roomId}: ${String(error)}`);
      });
    }
  }

  private async loadState(roomId: string, expectedKey?: string): Promise<PersistedReadinessState> {
    if (!this.isRedisAvailable()) {
      if (isStrictRealtimeCoordination()) {
        throw new Error("Realtime coordination is unavailable.");
      }
    } else {
      let persisted: PersistedReadinessState | null = null;
      try {
        persisted = await this.redis!.getJson<PersistedReadinessState>(this.stateKey(roomId));
      } catch (error) {
        if (isStrictRealtimeCoordination()) {
          throw error;
        }
        this.logger.warn(`Unable to read playback readiness for ${roomId}: ${String(error)}`);
      }
      if (persisted && (!expectedKey || persisted.key === expectedKey)) {
        return this.normalizeState(persisted);
      }
    }
    const localEntries = [...(this.playbackReadinessByRoom.get(roomId)?.values() ?? [])];
    const localBarrier = this.playbackBarrierByRoom.get(roomId);
    const key = expectedKey ?? localBarrier?.key ?? (localEntries[0] ? this.timelineKey(localEntries[0].trackId, localEntries[0].mediaEpoch) : "none:0");
    const compatibleLocalBarrier = localBarrier?.key === key ? localBarrier : undefined;
    return {
      key,
      entries: localEntries.filter((entry) => this.timelineKey(entry.trackId, entry.mediaEpoch) === key),
      waitingSinceBySession: {},
      barrier: compatibleLocalBarrier ?? { key, state: "open", resumeAt: null, holdPositionMs: null, updatedAt: new Date(0).toISOString() },
      updatedAt: new Date(0).toISOString()
    };
  }

  private async saveState(roomId: string, state: PersistedReadinessState) {
    if (!this.isRedisAvailable()) {
      if (isStrictRealtimeCoordination()) {
        throw new Error("Realtime coordination is unavailable.");
      }
      return;
    }
    try {
      await this.redis!.setJson(this.stateKey(roomId), state, readinessStateTtlSeconds);
    } catch (error) {
      if (isStrictRealtimeCoordination()) {
        throw error;
      }
      this.logger.warn(`Unable to persist playback readiness for ${roomId}: ${String(error)}`);
    }
  }

  private computeState(input: {
    roomId: string;
    key: string;
    snapshot: RoomSnapshot;
    entries: RoomPlaybackReadinessPayload[];
    waitingSinceBySession: Record<string, string>;
    previousBarrier: PlaybackBarrier;
    now: Date;
  }): PersistedReadinessState {
    const previousUpdatedAt = Date.parse(input.previousBarrier.updatedAt);
    const nowMs = Number.isFinite(previousUpdatedAt)
      ? Math.max(input.now.getTime(), previousUpdatedAt + 1)
      : input.now.getTime();
    const nowIso = new Date(nowMs).toISOString();
    const activeMemberIds = new Set(
      input.snapshot.room.members
        .filter((member) => member.presenceState === "online" && !!member.peerId)
        .map((member) => member.id)
    );
    const waitingSinceBySession = { ...input.waitingSinceBySession };
    const entries = input.entries
      .filter((entry) =>
        activeMemberIds.has(entry.sessionId) &&
        this.timelineKey(entry.trackId, entry.mediaEpoch) === input.key
      )
      .map((entry) => {
        const waitingSince = waitingSinceBySession[entry.sessionId];
        if (
          entry.state === "waiting" &&
          waitingSince &&
          input.now.getTime() - Date.parse(waitingSince) >= waitingTimeoutMs
        ) {
          delete waitingSinceBySession[entry.sessionId];
          return { ...entry, state: "failed" as const };
        }
        return entry;
      });
    const cacheParticipants = entries.filter((entry) => entry.cacheEnabled);
    const allReady = input.snapshot.room.playback.status !== "playing" ||
      cacheParticipants.every((entry) => entry.state !== "waiting");
    const barrierState: PlaybackBarrier["state"] = allReady ? "open" : "waiting";
    const playbackStartedAtMs = Date.parse(
      input.snapshot.room.playback.startedAt ?? input.snapshot.room.playback.startAt ?? ""
    );
    const previousBarrierUpdatedAtMs = Date.parse(input.previousBarrier.updatedAt);
    const previousBarrierMatchesTimeline = input.previousBarrier.key === input.key && (
      !Number.isFinite(playbackStartedAtMs) ||
      (Number.isFinite(previousBarrierUpdatedAtMs) && previousBarrierUpdatedAtMs >= playbackStartedAtMs)
    );
    const holdPositionMs = barrierState === "waiting"
      ? previousBarrierMatchesTimeline && input.previousBarrier.state === "waiting"
        ? input.previousBarrier.holdPositionMs
        : this.resolvePlaybackPositionMs(input.snapshot, input.now.getTime())
      : previousBarrierMatchesTimeline
        ? input.previousBarrier.holdPositionMs
        : null;
    const resumeAt = barrierState === "open"
      ? previousBarrierMatchesTimeline && input.previousBarrier.state === "waiting"
        ? new Date(nowMs + 650).toISOString()
        : previousBarrierMatchesTimeline && input.previousBarrier.state === "open"
          ? input.previousBarrier.resumeAt
          : null
      : null;
    const barrier: PlaybackBarrier = {
      key: input.key,
      state: barrierState,
      resumeAt,
      holdPositionMs,
      updatedAt: nowIso
    };
    return {
      key: input.key,
      entries: entries.map((entry) => ({
        ...entry,
        barrier: barrierState,
        resumeAt,
        holdPositionMs,
        updatedAt: nowIso
      })),
      waitingSinceBySession,
      barrier,
      updatedAt: nowIso
    };
  }

  private normalizeState(state: PersistedReadinessState): PersistedReadinessState {
    const key = typeof state.key === "string" ? state.key : "none:0";
    return {
      key,
      entries: Array.isArray(state.entries) ? state.entries : [],
      waitingSinceBySession: state.waitingSinceBySession ?? {},
      barrier: state.barrier ?? {
        key,
        state: "open",
        resumeAt: null,
        holdPositionMs: null,
        updatedAt: new Date(0).toISOString()
      },
      updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date(0).toISOString()
    };
  }

  private resolvePlaybackPositionMs(snapshot: RoomSnapshot, nowMs: number) {
    const playback = snapshot.room.playback;
    if (playback.status !== "playing") {
      return playback.positionMs;
    }
    const anchorAt = playback.startedAt ?? playback.startAt ?? null;
    const anchorMs = anchorAt ? Date.parse(anchorAt) : Number.NaN;
    const elapsedMs = Number.isFinite(anchorMs) ? Math.max(0, nowMs - anchorMs) : 0;
    const durationMs = snapshot.tracks.find((track) => track.id === playback.currentTrackId)?.durationMs ?? 0;
    const positionMs = playback.positionMs + elapsedMs;
    return durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs;
  }

  private isRedisAvailable() {
    const redis = this.redis as (RedisService & { isAvailable?: () => boolean }) | undefined;
    return typeof redis?.isAvailable === "function" && redis.isAvailable();
  }

  private applyLocalState(roomId: string, state: PersistedReadinessState) {
    const currentBarrier = this.playbackBarrierByRoom.get(roomId);
    if (
      currentBarrier &&
      currentBarrier.key === state.key &&
      compareReadinessUpdates(state.updatedAt, currentBarrier.updatedAt) < 0
    ) {
      return;
    }
    const readiness = new Map(state.entries.map((entry) => [entry.sessionId, entry]));
    this.playbackReadinessByRoom.set(roomId, readiness);
    this.playbackBarrierByRoom.set(roomId, state.barrier);
  }

  private upsertLocalEntry(roomId: string, data: RoomPlaybackReadinessPayload) {
    const readiness = this.playbackReadinessByRoom.get(roomId) ?? new Map();
    const current = readiness.get(data.sessionId);
    if (current && compareReadinessUpdates(data.updatedAt, current.updatedAt) <= 0) {
      return false;
    }
    readiness.set(data.sessionId, data);
    this.playbackReadinessByRoom.set(roomId, readiness);
    const currentBarrier = this.playbackBarrierByRoom.get(roomId);
    if (!currentBarrier || compareReadinessUpdates(data.updatedAt, currentBarrier.updatedAt) >= 0) {
      this.playbackBarrierByRoom.set(roomId, {
        key: this.timelineKey(data.trackId, data.mediaEpoch),
        state: data.barrier,
        resumeAt: data.resumeAt,
        holdPositionMs: data.holdPositionMs,
        updatedAt: data.updatedAt
      });
    }
    return true;
  }

  private broadcastState(roomId: string, state: PersistedReadinessState) {
    for (const entry of state.entries) {
      this.roomRealtimeBroadcaster.emitPlaybackReadiness(roomId, entry);
    }
  }

  private timelineKey(trackId: string | null, mediaEpoch: number) {
    return `${trackId ?? "none"}:${mediaEpoch}`;
  }

  private stateKey(roomId: string) {
    return `music-room:playback-readiness:${roomId}`;
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function compareReadinessUpdates(left: string, right: string) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
    return leftMs - rightMs;
  }
  return left.localeCompare(right);
}

function isStrictRealtimeCoordination() {
  return process.env.NODE_ENV === "production";
}
