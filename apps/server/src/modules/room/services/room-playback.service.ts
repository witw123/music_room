import {
  resolveAnnouncementChunkIndexes,
  type PlaybackSnapshot,
  type TrackAvailabilityAnnouncement,
  type TrackMeta
} from "@music-room/shared";
import type { RoomRecord } from "../room.types";
import { RoomPresenceService } from "./room-presence.service";

type TrackAvailabilityReader = {
  getTrackAvailabilityAnnouncements: (
    roomId: string,
    trackId: string
  ) => TrackAvailabilityAnnouncement[];
  hasPlaybackProvider?: (
    roomId: string,
    assetId: string,
    onlinePeerIds?: ReadonlySet<string>
  ) => boolean | Promise<boolean>;
};

export class RoomPlaybackService {
  constructor(
    private readonly roomPresenceService: RoomPresenceService,
    private readonly trackAvailabilityReader?: TrackAvailabilityReader
  ) {}

  async updatePlayback(
    record: RoomRecord,
    input: {
      action: "play" | "pause" | "seek" | "next" | "prev";
      trackId?: string;
      queueItemId?: string;
      playbackAssetId?: string;
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
        this.clearPlayback(playback, { bumpVersion: false });
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
      let nextQueueItemId: string | null = input.queueItemId ?? null;

      if (input.queueItemId) {
        const queueItem = record.queue.find((item) => item.id === input.queueItemId);
        if (!queueItem) {
          throw new Error("Queue item not found in this room.");
        }
        nextTrackId = queueItem.trackId;
        nextQueueItemId = queueItem.id;
      }
      if (!nextTrackId) {
        this.clearPlayback(playback, { bumpVersion: false });
      } else {
        // Same track can appear multiple times in the queue. Switching queue
        // items must restart playback even when trackId is unchanged.
        const isQueueItemSwitch =
          nextQueueItemId !== null && nextQueueItemId !== playback.currentQueueItemId;
        const isTrackSwitch = nextTrackId !== playback.currentTrackId;
        const shouldRestart = isTrackSwitch || isQueueItemSwitch;
        const startPositionMs =
          input.positionMs ??
          (shouldRestart ? 0 : this.getEffectivePlaybackPositionMs(record, playback));
        await this.applyTrackPlayback(
          record,
          nextTrackId,
          startPositionMs,
          nextQueueItemId,
          input.playbackAssetId
        );
      }
    }

    if (input.action === "pause") {
      const currentTrack = record.tracks.find((track) => track.id === playback.currentTrackId);
      this.assertRequestedPlaybackAsset(currentTrack, input.playbackAssetId);
      const sourceCandidate = playback.currentTrackId && !currentTrack?.playbackAsset
        ? await this.resolveTrackSourceCandidate(record, playback.currentTrackId, {
            preferredSessionId: playback.sourceSessionId
          })
        : null;
      const pausePositionMs = input.positionMs ?? this.getEffectivePlaybackPositionMs(record, playback);
      playback.status = "paused";
      playback.positionMs = this.clampPositionMs(
        record,
        playback.currentTrackId,
        pausePositionMs
      );
      playback.startedAt = null;
      playback.startAt = null;
      playback.sourceSessionId = sourceCandidate?.sessionId ?? playback.sourceSessionId;
      playback.sourcePeerId = sourceCandidate?.peerId ?? null;
    }

    if (input.action === "seek") {
      const currentTrack = record.tracks.find((track) => track.id === playback.currentTrackId);
      this.assertRequestedPlaybackAsset(currentTrack, input.playbackAssetId);
      const sourceCandidate = playback.currentTrackId && !currentTrack?.playbackAsset
        ? await this.resolveTrackSourceCandidate(record, playback.currentTrackId, {
            preferredSessionId: playback.sourceSessionId
          })
        : null;
      if (
        playback.status === "playing" &&
        playback.currentTrackId &&
        !currentTrack?.playbackAsset &&
        !sourceCandidate
      ) {
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
        const startAt = new Date().toISOString();
        playback.startAt = startAt;
        playback.startedAt = startAt;
      } else {
        playback.startAt = null;
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
          : null
    };
  }

  async applyTrackPlayback(
    record: RoomRecord,
    trackId: string,
    positionMs: number,
    queueItemId: string | null,
    requestedPlaybackAssetId?: string
  ) {
    const playback = record.room.playback;
    const track = record.tracks.find((item) => item.id === trackId);
    if (!track) {
      throw new Error(`Track not found in room: ${trackId}`);
    }

    const isAssetPlayback = !!track.playbackAsset;
    this.assertRequestedPlaybackAsset(track, requestedPlaybackAssetId);
    const sourceCandidate = isAssetPlayback
      ? null
      : await this.resolveTrackSourceCandidate(record, trackId);
    if (
      isAssetPlayback &&
      this.trackAvailabilityReader?.hasPlaybackProvider &&
      !(await this.trackAvailabilityReader.hasPlaybackProvider(
        record.room.id,
        track.playbackAsset!.assetId,
        new Set(
          (
            await this.roomPresenceService.getActivePresence(
              record.room.id,
              record.room.members
            )
          ).values()
        )
      ))
    ) {
      throw new Error("No room member currently provides this playback asset.");
    }
    if (!isAssetPlayback && !sourceCandidate) {
      throw new Error("Track owner is not online, so this song cannot be played right now.");
    }

    const isTrackSwitch = playback.currentTrackId !== trackId;
    const isQueueItemSwitch =
      queueItemId !== null && playback.currentQueueItemId !== queueItemId;
    const isSwitchingSource =
      !isAssetPlayback && !!sourceCandidate && (
        playback.sourceSessionId !== sourceCandidate.sessionId ||
        playback.sourcePeerId !== sourceCandidate.peerId
      );

    playback.status = "playing";
    playback.currentTrackId = trackId;
    playback.currentQueueItemId = queueItemId;
    playback.playbackAssetId = track.playbackAsset?.assetId ?? null;
    playback.sourceSessionId = sourceCandidate?.sessionId ?? null;
    playback.sourcePeerId = sourceCandidate?.peerId ?? null;
    playback.sourceTrackId = isAssetPlayback ? null : trackId;
    playback.positionMs = this.clampPositionMs(record, trackId, positionMs);
    const startAt = new Date().toISOString();
    playback.startAt = startAt;
    playback.startedAt = startAt;
    // Queue-item switches need a media epoch bump so clients remount local
    // playback even when the underlying track asset is unchanged.
    if (isTrackSwitch || isQueueItemSwitch || isSwitchingSource) {
      playback.mediaEpoch += 1;
    }
  }

  clearPlayback(playback: PlaybackSnapshot, options?: { bumpVersion?: boolean }) {
    playback.status = "paused";
    playback.currentTrackId = null;
    playback.currentQueueItemId = null;
    playback.playbackAssetId = null;
    playback.startAt = null;
    playback.sourceSessionId = null;
    playback.sourcePeerId = null;
    playback.sourceTrackId = null;
    playback.positionMs = 0;
    playback.startedAt = null;
    playback.mediaEpoch += 1;
    if (options?.bumpVersion !== false) {
      this.bumpPlaybackVersion(playback);
    }
  }

  async handleSourceDeparture(record: RoomRecord, sessionId: string) {
    const playback = record.room.playback;
    const currentTrack = record.tracks.find((track) => track.id === playback.currentTrackId);
    if (currentTrack?.playbackAsset) {
      return;
    }
    if (!playback.currentTrackId || playback.sourceSessionId !== sessionId) {
      return;
    }

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

  handleSourcePeerOnline(record: RoomRecord, sessionId: string, peerId: string) {
    const playback = record.room.playback;
    if (
      !playback.currentTrackId ||
      playback.sourceSessionId !== sessionId ||
      playback.sourcePeerId === peerId
    ) {
      return false;
    }

    playback.sourcePeerId = peerId;
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

  private bumpPlaybackVersion(playback: PlaybackSnapshot) {
    playback.playbackRevision += 1;
  }

  private assertRequestedPlaybackAsset(
    track: TrackMeta | undefined,
    requestedPlaybackAssetId?: string
  ) {
    if (
      requestedPlaybackAssetId !== undefined &&
      requestedPlaybackAssetId !== (track?.playbackAsset?.assetId ?? null)
    ) {
      throw new Error("Playback asset does not belong to the selected track.");
    }
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

    const ownerAnnouncement = this.trackAvailabilityReader
      ?.getTrackAvailabilityAnnouncements(roomId, track.id)
      .find(
        (announcement) =>
          announcement.ownerPeerId === activePresence.get(track.ownerSessionId) &&
          this.isUsableFullTrackAvailability(roomId, track, announcement)
      );
    if (
      isSessionAvailable(track.ownerSessionId) &&
      (track.sourceType === "local_upload" ||
        !this.trackAvailabilityReader ||
        ownerAnnouncement)
    ) {
      return {
        sessionId: track.ownerSessionId,
        peerId: activePresence.get(track.ownerSessionId) as string
      };
    }

    const bestAnnouncementsBySessionId = new Map<
      string,
      TrackAvailabilityAnnouncement & { availableChunkCount: number; fullyCached: boolean }
    >();
    for (const announcement of this.trackAvailabilityReader?.getTrackAvailabilityAnnouncements(
      roomId,
      track.id
    ) ?? []) {
      if (!this.isUsableFullTrackAvailability(roomId, track, announcement)) {
        continue;
      }

      const sessionId = sessionByPeerId.get(announcement.ownerPeerId);
      if (!sessionId || !isSessionAvailable(sessionId)) {
        continue;
      }

      const candidate = {
        ...announcement,
        availableChunkCount: this.countValidAvailableChunks(announcement),
        fullyCached: true
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

  private isUsableFullTrackAvailability(
    roomId: string,
    track: TrackMeta,
    announcement: TrackAvailabilityAnnouncement
  ) {
    if (
      announcement.roomId !== roomId ||
      announcement.trackId !== track.id ||
      announcement.totalChunks <= 0 ||
      announcement.chunkSize <= 0 ||
      (announcement.assetHash && announcement.assetHash !== track.fileHash)
    ) {
      return false;
    }

    const expectedManifest = track.relayManifest ?? track.pieceManifest ?? null;
    if (
      expectedManifest &&
      (announcement.totalChunks !== expectedManifest.totalChunks ||
        announcement.chunkSize !== expectedManifest.chunkSize)
    ) {
      return false;
    }

    return this.countValidAvailableChunks(announcement) >= announcement.totalChunks;
  }

  private countValidAvailableChunks(announcement: TrackAvailabilityAnnouncement) {
    return resolveAnnouncementChunkIndexes(announcement).length;
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
