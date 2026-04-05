import type { PlaybackSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import type { RoomRecord } from "../room.types";
import { RoomPresenceService } from "./room-presence.service";
import type { SignalingGateway } from "../../signaling/signaling.gateway";

export class RoomPlaybackService {
  constructor(
    private readonly roomPresenceService: RoomPresenceService,
    private readonly signalingGateway?: Pick<SignalingGateway, "getTrackAvailabilityAnnouncements">
  ) {}

  async updatePlayback(
    record: RoomRecord,
    input: {
      action: "play" | "pause" | "seek" | "next" | "prev";
      trackId?: string;
      queueItemId?: string;
      positionMs?: number;
    }
  ): Promise<PlaybackSnapshot> {
    const playback = record.room.playback;

    if (input.action === "next") {
      const currentIndex = this.getCurrentQueueIndex(record);
      const nextItem = (currentIndex >= 0 ? record.queue[currentIndex + 1] : null) ?? record.queue[0];
      if (nextItem) {
        await this.applyTrackPlayback(record, nextItem.trackId, input.positionMs ?? 0, nextItem.id);
      } else {
        this.clearPlayback(playback);
      }
    }

    if (input.action === "prev") {
      const currentIndex = this.getCurrentQueueIndex(record);
      const previousItem =
        currentIndex > 0
          ? record.queue[currentIndex - 1]
          : currentIndex === -1
            ? record.queue[0]
            : record.queue[currentIndex] ?? record.queue[0];
      if (previousItem) {
        await this.applyTrackPlayback(
          record,
          previousItem.trackId,
          input.positionMs ?? 0,
          previousItem.id
        );
      }
    }

    if (input.action === "play") {
      let nextTrackId = input.trackId ?? playback.currentTrackId ?? record.queue[0]?.trackId ?? null;

      if (input.queueItemId) {
        const queueItem = record.queue.find((item) => item.id === input.queueItemId);
        if (!queueItem) {
          throw new Error("Queue item not found in this room.");
        }
        nextTrackId = queueItem.trackId;
      }
      if (!nextTrackId) {
        this.clearPlayback(playback);
      } else {
        const isTrackSwitch = nextTrackId !== playback.currentTrackId;
        const startPositionMs = input.positionMs ?? (isTrackSwitch ? 0 : playback.positionMs);
        await this.applyTrackPlayback(
          record,
          nextTrackId,
          startPositionMs,
          input.queueItemId ?? this.findQueueItemIdForTrack(record, nextTrackId)
        );
      }
    }

    if (input.action === "pause") {
      const sourceCandidate = playback.currentTrackId
        ? await this.resolveTrackSourceCandidate(record, playback.currentTrackId, {
            preferredSessionId: playback.sourceSessionId
          })
        : null;
      playback.status = "paused";
      playback.positionMs = this.clampPositionMs(record, playback.currentTrackId, input.positionMs ?? playback.positionMs);
      playback.startedAt = null;
      playback.sourceSessionId = sourceCandidate?.sessionId ?? playback.sourceSessionId;
      playback.sourcePeerId = sourceCandidate?.peerId ?? null;
    }

    if (input.action === "seek") {
      const sourceCandidate = playback.currentTrackId
        ? await this.resolveTrackSourceCandidate(record, playback.currentTrackId, {
            preferredSessionId: playback.sourceSessionId
          })
        : null;
      if (playback.status === "playing" && playback.currentTrackId && !sourceCandidate) {
        throw new Error("Track owner is not online, so this song cannot be played right now.");
      }

      if (
        sourceCandidate &&
        (playback.sourceSessionId !== sourceCandidate.sessionId ||
          playback.sourcePeerId !== sourceCandidate.peerId)
      ) {
        playback.sourceSessionId = sourceCandidate.sessionId;
        playback.sourcePeerId = sourceCandidate.peerId;
        playback.mediaEpoch += 1;
      }

      playback.positionMs = this.clampPositionMs(record, playback.currentTrackId, input.positionMs ?? 0);
      if (playback.status === "playing") {
        playback.startedAt = new Date().toISOString();
      } else {
        playback.startedAt = null;
      }
    }

    this.bumpPlaybackVersion(playback);
    return this.buildPlaybackForSnapshot(record);
  }

  async buildPlaybackForSnapshot(record: RoomRecord, activePresence?: Map<string, string>) {
    const resolvedPresence =
      activePresence ??
      (await this.roomPresenceService.getActivePresence(record.room.id, record.room.members));
    const storedSourcePeerId = record.room.playback.sourcePeerId;

    return {
      ...record.room.playback,
      sourcePeerId:
        record.room.playback.sourceSessionId && storedSourcePeerId
          ? resolvedPresence.get(record.room.playback.sourceSessionId) ?? null
          : storedSourcePeerId
    };
  }

  async applyTrackPlayback(
    record: RoomRecord,
    trackId: string,
    positionMs: number,
    queueItemId: string | null
  ) {
    const playback = record.room.playback;
    const track = record.tracks.find((item) => item.id === trackId);
    if (!track) {
      throw new Error(`Track not found in room: ${trackId}`);
    }

    const sourceCandidate = await this.resolveTrackSourceCandidate(record, trackId);
    if (!sourceCandidate) {
      throw new Error("Track owner is not online, so this song cannot be played right now.");
    }

    const isTrackSwitch = playback.currentTrackId !== trackId;
    const isSwitchingSource =
      playback.sourceSessionId !== sourceCandidate.sessionId ||
      playback.sourcePeerId !== sourceCandidate.peerId;

    playback.status = "playing";
    playback.currentTrackId = trackId;
    playback.currentQueueItemId = queueItemId;
    playback.sourceSessionId = sourceCandidate.sessionId;
    playback.sourcePeerId = sourceCandidate.peerId;
    playback.sourceTrackId = trackId;
    playback.positionMs = this.clampPositionMs(record, trackId, positionMs);
    playback.startedAt = new Date().toISOString();
    if (isTrackSwitch || isSwitchingSource) {
      playback.mediaEpoch += 1;
    }
  }

  clearPlayback(playback: PlaybackSnapshot) {
    playback.status = "paused";
    playback.currentTrackId = null;
    playback.currentQueueItemId = null;
    playback.sourceSessionId = null;
    playback.sourcePeerId = null;
    playback.sourceTrackId = null;
    playback.positionMs = 0;
    playback.startedAt = null;
    playback.mediaEpoch += 1;
    this.bumpPlaybackVersion(playback);
  }

  async handleSourceDeparture(record: RoomRecord, sessionId: string) {
    const playback = record.room.playback;
    if (!playback.currentTrackId || playback.sourceSessionId !== sessionId) {
      return;
    }

    const currentTrack = record.tracks.find((track) => track.id === playback.currentTrackId);
    const nextSourceCandidate = currentTrack
      ? await this.resolveTrackSourceCandidate(record, currentTrack.id, {
          excludedSessionIds: new Set([sessionId])
        })
      : null;

    playback.status = nextSourceCandidate ? "playing" : "paused";
    playback.positionMs = this.getEffectivePlaybackPositionMs(record, playback);
    playback.startedAt = nextSourceCandidate ? new Date().toISOString() : null;
    playback.sourceSessionId = nextSourceCandidate?.sessionId ?? null;
    playback.sourcePeerId = nextSourceCandidate?.peerId ?? null;
    playback.sourceTrackId = nextSourceCandidate ? playback.currentTrackId : null;
    playback.mediaEpoch += 1;
    this.bumpPlaybackVersion(playback);
  }

  async handleSourceAvailabilityLoss(record: RoomRecord, sessionId: string) {
    const playback = record.room.playback;
    if (
      playback.status !== "playing" ||
      !playback.currentTrackId ||
      playback.sourceSessionId !== sessionId
    ) {
      return false;
    }

    const nextSourceCandidate = await this.resolveTrackSourceCandidate(
      record,
      playback.currentTrackId,
      {
        excludedSessionIds: new Set([sessionId])
      }
    );

    playback.positionMs = this.getEffectivePlaybackPositionMs(record, playback);
    playback.startedAt = nextSourceCandidate ? new Date().toISOString() : null;
    playback.status = nextSourceCandidate ? "playing" : "paused";
    playback.sourceSessionId = nextSourceCandidate?.sessionId ?? playback.sourceSessionId;
    playback.sourcePeerId = nextSourceCandidate?.peerId ?? null;
    playback.sourceTrackId = nextSourceCandidate ? playback.currentTrackId : null;
    playback.mediaEpoch += 1;
    this.bumpPlaybackVersion(playback);
    return true;
  }

  pausePlaybackForSessionReplacement(record: RoomRecord, sessionId: string) {
    const playback = record.room.playback;
    if (!playback.currentTrackId || playback.sourceSessionId !== sessionId) {
      return false;
    }

    playback.status = "paused";
    playback.positionMs = this.getEffectivePlaybackPositionMs(record, playback);
    playback.startedAt = null;
    playback.sourcePeerId = null;
    playback.mediaEpoch += 1;
    this.bumpPlaybackVersion(playback);
    return true;
  }

  pausePlaybackForSourceDisconnect(record: RoomRecord, sessionId: string) {
    const playback = record.room.playback;
    if (
      playback.status !== "playing" ||
      !playback.currentTrackId ||
      playback.sourceSessionId !== sessionId
    ) {
      return false;
    }

    playback.status = "paused";
    playback.positionMs = this.getEffectivePlaybackPositionMs(record, playback);
    playback.startedAt = null;
    playback.sourcePeerId = null;
    playback.mediaEpoch += 1;
    this.bumpPlaybackVersion(playback);
    return true;
  }

  private async resolveSourcePeerId(record: RoomRecord, sourceSessionId: string | null) {
    if (!sourceSessionId) {
      return null;
    }

    const activePresence = await this.roomPresenceService.getActivePresence(
      record.room.id,
      record.room.members
    );
    return activePresence.get(sourceSessionId) ?? null;
  }

  private getCurrentQueueIndex(record: RoomRecord) {
    const currentQueueItemId = record.room.playback.currentQueueItemId;
    if (currentQueueItemId) {
      const byQueueItemId = record.queue.findIndex((item) => item.id === currentQueueItemId);
      if (byQueueItemId >= 0) {
        return byQueueItemId;
      }
    }

    const currentTrackId = record.room.playback.currentTrackId;
    if (!currentTrackId) {
      return -1;
    }

    return record.queue.findIndex((item) => item.trackId === currentTrackId);
  }

  private findQueueItemIdForTrack(record: RoomRecord, trackId: string) {
    return record.queue.find((item) => item.trackId === trackId)?.id ?? null;
  }

  private bumpPlaybackVersion(playback: PlaybackSnapshot) {
    playback.queueVersion += 1;
    playback.playbackRevision += 1;
  }

  private async resolveTrackSourceCandidate(
    record: RoomRecord,
    trackId: string,
    options?: {
      preferredSessionId?: string | null;
      excludedSessionIds?: Set<string>;
    }
  ) {
    const track = record.tracks.find((item) => item.id === trackId);
    if (!track) {
      return null;
    }

    const activePresence = await this.roomPresenceService.getActivePresence(
      record.room.id,
      record.room.members
    );
    return this.pickTrackSourceCandidate(record.room.id, track, activePresence, options);
  }

  private pickTrackSourceCandidate(
    roomId: string,
    track: TrackMeta,
    activePresence: Map<string, string>,
    options?: {
      preferredSessionId?: string | null;
      excludedSessionIds?: Set<string>;
    }
  ) {
    const excludedSessionIds = options?.excludedSessionIds ?? new Set<string>();
    const preferredSessionId = options?.preferredSessionId ?? null;
    const sessionByPeerId = new Map<string, string>();
    for (const [sessionId, peerId] of activePresence.entries()) {
      sessionByPeerId.set(peerId, sessionId);
    }

    const isSessionAvailable = (sessionId: string | null | undefined) =>
      !!sessionId && !excludedSessionIds.has(sessionId) && activePresence.has(sessionId);

    if (isSessionAvailable(preferredSessionId)) {
      return {
        sessionId: preferredSessionId as string,
        peerId: activePresence.get(preferredSessionId as string) as string
      };
    }

    if (isSessionAvailable(track.ownerSessionId)) {
      return {
        sessionId: track.ownerSessionId,
        peerId: activePresence.get(track.ownerSessionId) as string
      };
    }

    const bestAnnouncementsBySessionId = new Map<
      string,
      TrackAvailabilityAnnouncement & { availableChunkCount: number; fullyCached: boolean }
    >();
    for (const announcement of this.signalingGateway?.getTrackAvailabilityAnnouncements(
      roomId,
      track.id
    ) ?? []) {
      const sessionId = sessionByPeerId.get(announcement.ownerPeerId);
      if (!sessionId || !isSessionAvailable(sessionId)) {
        continue;
      }

      const candidate = {
        ...announcement,
        availableChunkCount: announcement.availableChunks.length,
        fullyCached: announcement.availableChunks.length >= announcement.totalChunks
      };
      const existing = bestAnnouncementsBySessionId.get(sessionId);
      if (
        !existing ||
        Number(candidate.fullyCached) > Number(existing.fullyCached) ||
        candidate.availableChunkCount > existing.availableChunkCount
      ) {
        bestAnnouncementsBySessionId.set(sessionId, candidate);
      }
    }

    const fallbackCandidate = [...bestAnnouncementsBySessionId.entries()]
      .sort((left, right) => {
        const [, leftAnnouncement] = left;
        const [, rightAnnouncement] = right;
        if (leftAnnouncement.fullyCached !== rightAnnouncement.fullyCached) {
          return Number(rightAnnouncement.fullyCached) - Number(leftAnnouncement.fullyCached);
        }
        if (leftAnnouncement.availableChunkCount !== rightAnnouncement.availableChunkCount) {
          return rightAnnouncement.availableChunkCount - leftAnnouncement.availableChunkCount;
        }
        if (leftAnnouncement.source !== rightAnnouncement.source) {
          return leftAnnouncement.source === "local_cache" ? -1 : 1;
        }
        return left[0].localeCompare(right[0]);
      })
      .at(0);

    if (!fallbackCandidate) {
      return null;
    }

    return {
      sessionId: fallbackCandidate[0],
      peerId: fallbackCandidate[1].ownerPeerId
    };
  }

  private clampPositionMs(record: RoomRecord, trackId: string | null, positionMs: number) {
    const normalized = Math.max(0, Math.floor(positionMs));
    if (!trackId) {
      return normalized;
    }

    const track = record.tracks.find((item) => item.id === trackId);
    if (!track?.durationMs || track.durationMs <= 0) {
      return normalized;
    }

    return Math.min(normalized, track.durationMs);
  }

  private getEffectivePlaybackPositionMs(record: RoomRecord, playback: PlaybackSnapshot) {
    if (
      playback.status !== "playing" ||
      !playback.currentTrackId ||
      !playback.startedAt
    ) {
      return this.clampPositionMs(record, playback.currentTrackId, playback.positionMs);
    }

    const startedAtMs = new Date(playback.startedAt).getTime();
    if (!Number.isFinite(startedAtMs)) {
      return this.clampPositionMs(record, playback.currentTrackId, playback.positionMs);
    }

    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    return this.clampPositionMs(record, playback.currentTrackId, playback.positionMs + elapsedMs);
  }
}
