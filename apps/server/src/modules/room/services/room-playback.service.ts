import type { PlaybackMode, PlaybackSnapshot, QueueItem, TrackMeta } from "@music-room/shared";
import type { RoomRecord } from "../room.types";
import { RoomPresenceService } from "./room-presence.service";

type SourceCandidate = {
  sessionId: string;
  peerId: string;
};

export class RoomPlaybackService {
  constructor(private readonly roomPresenceService: RoomPresenceService) {}

  async updatePlayback(
    record: RoomRecord,
    input: {
      action: "play" | "pause" | "seek" | "next" | "prev" | "set-mode";
      trackId?: string;
      queueItemId?: string;
      playbackAssetId?: string;
      positionMs?: number;
      playbackMode?: PlaybackMode;
    }
  ): Promise<PlaybackSnapshot> {
    const playback = record.room.playback;

    if (input.action === "set-mode") {
      if (!input.playbackMode) {
        throw new Error("Playback mode is required when changing playback order.");
      }
      playback.playbackMode = input.playbackMode;
    }

    if (input.action === "next") {
      await this.advanceByPlaybackMode(record, "next", input.positionMs ?? 0);
    }

    if (input.action === "prev") {
      await this.advanceByPlaybackMode(record, "prev", input.positionMs ?? 0);
    }

    if (input.action === "play") {
      let nextTrackId = input.trackId ?? playback.currentTrackId ?? record.queue[0]?.trackId ?? null;
      let nextQueueItemId: string | null =
        input.queueItemId ?? (input.trackId === undefined ? playback.currentQueueItemId : null);

      if (input.queueItemId) {
        const queueItem = record.queue.find((item) => item.id === input.queueItemId);
        if (!queueItem) {
          throw new Error("Queue item not found in this room.");
        }
        nextTrackId = queueItem.trackId;
        nextQueueItemId = queueItem.id;
      }
      if (!nextQueueItemId && nextTrackId) {
        nextQueueItemId = record.queue.find((item) => item.trackId === nextTrackId)?.id ?? null;
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
        // Prefer client-supplied position; only derive from wall clock when omitted.
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
      const sourceCandidate = playback.currentTrackId
        ? await this.resolveTrackSourceCandidate(record, playback.currentTrackId, {
            preferredSessionId: playback.sourceSessionId
          })
        : null;
      const pausePositionMs =
        input.positionMs ?? this.getEffectivePlaybackPositionMs(record, playback);
      this.pausePlaybackAt(record, pausePositionMs, {
        sourceCandidate,
        bumpMediaEpoch: false
      });
    }

    if (input.action === "seek") {
      const currentTrack = record.tracks.find((track) => track.id === playback.currentTrackId);
      this.assertRequestedPlaybackAsset(currentTrack, input.playbackAssetId);
      const sourceCandidate = playback.currentTrackId
        ? await this.resolveTrackSourceCandidate(record, playback.currentTrackId, {
            preferredSessionId: playback.sourceSessionId
          })
        : null;
      if (
        playback.status === "playing" &&
        playback.currentTrackId &&
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

      // Seek position is always client-authoritative when provided.
      playback.positionMs = this.clampPositionMs(
        record,
        playback.currentTrackId,
        input.positionMs ?? 0
      );
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

    this.assertRequestedPlaybackAsset(track, requestedPlaybackAssetId);
    const sourceCandidate = await this.resolveTrackSourceCandidate(record, trackId);
    if (!sourceCandidate) {
      throw new Error("Track owner is not online, so this song cannot be played right now.");
    }

    const isTrackSwitch = playback.currentTrackId !== trackId;
    const isQueueItemSwitch =
      queueItemId !== null && playback.currentQueueItemId !== queueItemId;
    const isSwitchingSource =
      !!sourceCandidate &&
      (playback.sourceSessionId !== sourceCandidate.sessionId ||
        playback.sourcePeerId !== sourceCandidate.peerId);

    playback.status = "playing";
    playback.currentTrackId = trackId;
    playback.currentQueueItemId = queueItemId;
    playback.playbackAssetId = track.playbackAsset?.assetId ?? null;
    playback.sourceSessionId = sourceCandidate.sessionId;
    playback.sourcePeerId = sourceCandidate.peerId;
    playback.sourceTrackId = trackId;
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

  /**
   * Advance to the next playable queue item after the current one.
   * Does not wrap to the start of the queue. Skips tracks whose owners are offline.
   * When nothing playable remains, pauses at the end of the current track.
   */
  async advanceToNextPlayable(
    record: RoomRecord,
    options?: {
      positionMs?: number;
      wrap?: boolean;
    }
  ): Promise<"advanced" | "paused-at-end" | "cleared"> {
    const playback = record.room.playback;
    const currentIndex = this.getCurrentQueueIndex(record);
    const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    const candidate = await this.findPlayableQueueItem(record, startIndex, 1, {
      wrap: options?.wrap === true
    });

    if (candidate) {
      await this.applyTrackPlayback(
        record,
        candidate.trackId,
        options?.positionMs ?? 0,
        candidate.id
      );
      return "advanced";
    }

    if (playback.currentTrackId) {
      const endPositionMs = this.getTrackDurationMs(record, playback.currentTrackId);
      this.pausePlaybackAt(record, endPositionMs, {
        sourceCandidate: null,
        bumpMediaEpoch: true,
        clearSourcePeer: true
      });
      return "paused-at-end";
    }

    this.clearPlayback(playback, { bumpVersion: false });
    return "cleared";
  }

  private async advanceByPlaybackMode(
    record: RoomRecord,
    direction: "next" | "prev",
    positionMs: number
  ) {
    const mode = record.room.playback.playbackMode ?? "sequence";

    if (mode === "single") {
      const playback = record.room.playback;
      const currentTrackId = playback.currentTrackId;
      if (currentTrackId) {
        const currentQueueItemId = playback.currentQueueItemId;
        const sourceCandidate = await this.resolveTrackSourceCandidate(record, currentTrackId);
        if (sourceCandidate) {
          await this.applyTrackPlayback(
            record,
            currentTrackId,
            positionMs,
            currentQueueItemId
          );
          return "advanced" as const;
        }

        this.pausePlaybackAt(record, this.getTrackDurationMs(record, currentTrackId), {
          sourceCandidate: null,
          bumpMediaEpoch: true,
          clearSourcePeer: true
        });
        return "paused-at-end" as const;
      }
      return this.advanceToNextPlayable(record, { positionMs, wrap: false });
    }

    if (mode === "shuffle") {
      const randomized = await this.advanceToRandomPlayable(record, positionMs);
      if (randomized) {
        return "advanced" as const;
      }
    }

    return direction === "next"
      ? this.advanceToNextPlayable(record, { positionMs, wrap: false })
      : this.advanceToPreviousPlayable(record, { positionMs });
  }

  private async advanceToRandomPlayable(record: RoomRecord, positionMs: number) {
    const currentIndex = this.getCurrentQueueIndex(record);
    const candidates: QueueItem[] = [];

    for (let index = 0; index < record.queue.length; index += 1) {
      if (index === currentIndex) {
        continue;
      }
      const item = record.queue[index]!;
      if (await this.resolveTrackSourceCandidate(record, item.trackId)) {
        candidates.push(item);
      }
    }

    // A one-track queue still loops in shuffle mode rather than stopping.
    if (candidates.length === 0 && currentIndex >= 0) {
      const current = record.queue[currentIndex];
      if (current && (await this.resolveTrackSourceCandidate(record, current.trackId))) {
        candidates.push(current);
      }
    }

    if (candidates.length === 0) {
      return false;
    }

    const candidate = candidates[Math.floor(Math.random() * candidates.length)]!;
    await this.applyTrackPlayback(record, candidate.trackId, positionMs, candidate.id);
    return true;
  }

  async advanceToPreviousPlayable(
    record: RoomRecord,
    options?: {
      positionMs?: number;
    }
  ): Promise<"advanced" | "restarted" | "cleared"> {
    const playback = record.room.playback;
    const currentIndex = this.getCurrentQueueIndex(record);

    if (currentIndex > 0) {
      const candidate = await this.findPlayableQueueItem(record, currentIndex - 1, -1, {
        wrap: false
      });
      if (candidate) {
        await this.applyTrackPlayback(
          record,
          candidate.trackId,
          options?.positionMs ?? 0,
          candidate.id
        );
        return "advanced";
      }
    }

    if (playback.currentTrackId) {
      // Stay on the first / current track and restart from the requested position.
      await this.applyTrackPlayback(
        record,
        playback.currentTrackId,
        options?.positionMs ?? 0,
        playback.currentQueueItemId
      );
      return "restarted";
    }

    if (record.queue[0]) {
      const candidate = await this.findPlayableQueueItem(record, 0, 1, { wrap: false });
      if (candidate) {
        await this.applyTrackPlayback(
          record,
          candidate.trackId,
          options?.positionMs ?? 0,
          candidate.id
        );
        return "advanced";
      }
    }

    this.clearPlayback(playback, { bumpVersion: false });
    return "cleared";
  }

  /**
   * Server-side guard for tracks that finished without a client next call.
   * Returns true when playback state was mutated.
   */
  async advanceIfTrackEnded(record: RoomRecord): Promise<boolean> {
    const playback = record.room.playback;
    if (playback.status !== "playing" || !playback.currentTrackId) {
      return false;
    }

    const durationMs = this.getTrackDurationMs(record, playback.currentTrackId);
    if (durationMs <= 0) {
      return false;
    }

    const positionMs = this.getEffectivePlaybackPositionMs(record, playback);
    if (positionMs < durationMs) {
      return false;
    }

    await this.advanceByPlaybackMode(record, "next", 0);
    this.bumpPlaybackVersion(playback);
    return true;
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

  /**
   * Source owner went offline. Pause in place; do not hand media off to other members
   * because only the owner holds the local playback asset.
   */
  handleSourceDeparture(record: RoomRecord, sessionId: string) {
    const playback = record.room.playback;
    if (!playback.currentTrackId || playback.sourceSessionId !== sessionId) {
      return false;
    }

    const positionMs = this.getEffectivePlaybackPositionMs(record, playback);
    this.pausePlaybackAt(record, positionMs, {
      sourceCandidate: null,
      bumpMediaEpoch: true,
      clearSourcePeer: true,
      keepSourceSessionId: true
    });
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

    const positionMs = this.getEffectivePlaybackPositionMs(record, playback);
    this.pausePlaybackAt(record, positionMs, {
      sourceCandidate: null,
      bumpMediaEpoch: true,
      clearSourcePeer: true,
      keepSourceSessionId: true
    });
    this.bumpPlaybackVersion(playback);
    return true;
  }

  private pausePlaybackAt(
    record: RoomRecord,
    positionMs: number,
    options: {
      sourceCandidate?: SourceCandidate | null;
      bumpMediaEpoch: boolean;
      clearSourcePeer?: boolean;
      keepSourceSessionId?: boolean;
    }
  ) {
    const playback = record.room.playback;
    playback.status = "paused";
    playback.positionMs = this.clampPositionMs(record, playback.currentTrackId, positionMs);
    playback.startedAt = null;
    playback.startAt = null;

    if (options.sourceCandidate) {
      playback.sourceSessionId = options.sourceCandidate.sessionId;
      playback.sourcePeerId = options.sourceCandidate.peerId;
    } else if (options.clearSourcePeer) {
      playback.sourcePeerId = null;
      if (!options.keepSourceSessionId) {
        playback.sourceSessionId = null;
      }
    }

    if (options.bumpMediaEpoch) {
      playback.mediaEpoch += 1;
    }
  }

  private async findPlayableQueueItem(
    record: RoomRecord,
    startIndex: number,
    direction: 1 | -1,
    options: { wrap: boolean }
  ) {
    if (record.queue.length === 0) {
      return null;
    }

    const visited = new Set<number>();
    let index = startIndex;

    while (index >= 0 && index < record.queue.length && !visited.has(index)) {
      visited.add(index);
      const item = record.queue[index]!;
      const sourceCandidate = await this.resolveTrackSourceCandidate(record, item.trackId);
      if (sourceCandidate) {
        return item;
      }
      index += direction;
    }

    if (!options.wrap) {
      return null;
    }

    // Wrap is intentionally unused by public next; kept for potential loop mode later.
    if (direction > 0) {
      for (let i = 0; i < startIndex && i < record.queue.length; i += 1) {
        const item = record.queue[i]!;
        const sourceCandidate = await this.resolveTrackSourceCandidate(record, item.trackId);
        if (sourceCandidate) {
          return item;
        }
      }
    }

    return null;
  }

  private getTrackDurationMs(record: RoomRecord, trackId: string | null) {
    if (!trackId) {
      return 0;
    }
    const track = record.tracks.find((item) => item.id === trackId);
    return track?.durationMs && track.durationMs > 0 ? track.durationMs : 0;
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
    return this.pickTrackSourceCandidate(track, activePresence, options);
  }

  private pickTrackSourceCandidate(
    track: TrackMeta,
    activePresence: Map<string, string>,
    options?: {
      preferredSessionId?: string | null;
      excludedSessionIds?: Set<string>;
    }
  ): SourceCandidate | null {
    const excludedSessionIds = options?.excludedSessionIds ?? new Set<string>();
    const preferredSessionId = options?.preferredSessionId ?? null;
    const isSessionAvailable = (sessionId: string | null | undefined) =>
      !!sessionId && !excludedSessionIds.has(sessionId) && activePresence.has(sessionId);

    // Preferred session is only accepted when it is the track owner. Other members
    // never hold the local playback asset, so they cannot become the media source.
    if (
      isSessionAvailable(preferredSessionId) &&
      preferredSessionId === track.ownerSessionId
    ) {
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
    return null;
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

  getEffectivePlaybackPositionMs(record: RoomRecord, playback: PlaybackSnapshot) {
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
