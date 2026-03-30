import type { PlaybackSnapshot, QueueItem, Room, RoomMember, TrackMeta } from "@music-room/shared";

export type RoomRecord = {
  room: Room;
  tracks: TrackMeta[];
  queue: QueueItem[];
};

export type PersistedRoomRecord = {
  id: string;
  hostId: string;
  joinCode: string;
  visibility: string;
  playback: unknown;
  members: unknown;
  tracks: unknown;
  queue: unknown;
};

export function deserializeRoomRecord(persisted: PersistedRoomRecord): RoomRecord {
  const persistedPlayback = persisted.playback as Partial<PlaybackSnapshot>;
  return {
    room: {
      id: persisted.id,
      hostId: persisted.hostId,
      joinCode: persisted.joinCode,
      visibility: persisted.visibility as Room["visibility"],
      members: persisted.members as RoomMember[],
      playback: {
        status: persistedPlayback.status ?? "paused",
        currentTrackId: persistedPlayback.currentTrackId ?? null,
        sourceSessionId: persistedPlayback.sourceSessionId ?? persisted.hostId,
        sourcePeerId: persistedPlayback.sourcePeerId ?? null,
        sourceTrackId: persistedPlayback.sourceTrackId ?? persistedPlayback.currentTrackId ?? null,
        positionMs: persistedPlayback.positionMs ?? 0,
        startedAt: persistedPlayback.startedAt ?? null,
        queueVersion: persistedPlayback.queueVersion ?? 1,
        mediaEpoch: persistedPlayback.mediaEpoch ?? 0
      }
    },
    tracks: persisted.tracks as TrackMeta[],
    queue: persisted.queue as QueueItem[]
  };
}
