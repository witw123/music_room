import type { PlaybackSnapshot } from "@music-room/shared";
import type { RoomRecord } from "../room.types";
import { RoomPresenceService } from "./room-presence.service";

export class RoomPlaybackService {
  constructor(private readonly roomPresenceService: RoomPresenceService) {}

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
      const sourcePeerId = await this.resolveSourcePeerId(record, playback.sourceSessionId);
      playback.status = "paused";
      playback.positionMs = input.positionMs ?? playback.positionMs;
      playback.startedAt = null;
      playback.sourcePeerId = sourcePeerId;
    }

    if (input.action === "seek") {
      const sourcePeerId = await this.resolveSourcePeerId(record, playback.sourceSessionId);
      if (playback.status === "playing" && playback.currentTrackId && !sourcePeerId) {
        throw new Error("Track owner is not online, so this song cannot be played right now.");
      }

      if (sourcePeerId && playback.sourcePeerId !== sourcePeerId) {
        playback.sourcePeerId = sourcePeerId;
        playback.mediaEpoch += 1;
      }

      playback.positionMs = input.positionMs ?? 0;
      if (playback.status === "playing") {
        playback.startedAt = new Date().toISOString();
      } else {
        playback.startedAt = null;
      }
    }

    playback.queueVersion += 1;
    return this.buildPlaybackForSnapshot(record);
  }

  async buildPlaybackForSnapshot(record: RoomRecord) {
    const activePresence = await this.roomPresenceService.getActivePresence(
      record.room.id,
      record.room.members
    );

    return {
      ...record.room.playback,
      sourcePeerId: record.room.playback.sourceSessionId
        ? activePresence.get(record.room.playback.sourceSessionId) ?? null
        : null
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

    const activePresence = await this.roomPresenceService.getActivePresence(
      record.room.id,
      record.room.members
    );
    const ownerPeerId = activePresence.get(track.ownerSessionId);
    if (!ownerPeerId) {
      throw new Error("Track owner is not online, so this song cannot be played right now.");
    }

    const isSwitchingSource =
      playback.sourceSessionId !== track.ownerSessionId || playback.sourcePeerId !== ownerPeerId;

    playback.status = "playing";
    playback.currentTrackId = trackId;
    playback.currentQueueItemId = queueItemId;
    playback.sourceSessionId = track.ownerSessionId;
    playback.sourcePeerId = ownerPeerId;
    playback.sourceTrackId = trackId;
    playback.positionMs = positionMs;
    playback.startedAt = new Date().toISOString();
    if (isSwitchingSource) {
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
}
