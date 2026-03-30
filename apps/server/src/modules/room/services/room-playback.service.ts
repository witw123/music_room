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
      const currentIndex = record.queue.findIndex(
        (item) => item.trackId === playback.currentTrackId
      );
      const nextItem = record.queue[currentIndex + 1] ?? record.queue[0];
      if (nextItem) {
        await this.applyTrackPlayback(record, nextItem.trackId, input.positionMs ?? 0);
      } else {
        this.clearPlayback(playback);
      }
    }

    if (input.action === "prev") {
      const currentIndex = record.queue.findIndex(
        (item) => item.trackId === playback.currentTrackId
      );
      const previousItem = currentIndex > 0 ? record.queue[currentIndex - 1] : record.queue[0];
      if (previousItem) {
        await this.applyTrackPlayback(record, previousItem.trackId, input.positionMs ?? 0);
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
        await this.applyTrackPlayback(record, nextTrackId, input.positionMs ?? playback.positionMs);
      }
    }

    if (input.action === "pause") {
      playback.status = "paused";
      playback.positionMs = input.positionMs ?? playback.positionMs;
    }

    if (input.action === "seek") {
      playback.positionMs = input.positionMs ?? 0;
      if (playback.status === "playing") {
        playback.startedAt = new Date().toISOString();
      }
    }

    playback.queueVersion += 1;
    return playback;
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

  async applyTrackPlayback(record: RoomRecord, trackId: string, positionMs: number) {
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
      playback.currentTrackId !== trackId || playback.sourceSessionId !== track.ownerSessionId;

    playback.status = "playing";
    playback.currentTrackId = trackId;
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
    playback.sourceSessionId = null;
    playback.sourcePeerId = null;
    playback.sourceTrackId = null;
    playback.positionMs = 0;
    playback.startedAt = null;
    playback.mediaEpoch += 1;
  }
}
