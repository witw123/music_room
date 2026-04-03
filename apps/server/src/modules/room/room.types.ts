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
  presenceRevision?: number;
  playback: unknown;
  members: unknown;
  tracks: unknown;
  queue: unknown;
};

export function deserializeRoomRecord(persisted: PersistedRoomRecord): RoomRecord {
  const persistedPlayback = persisted.playback as Partial<PlaybackSnapshot>;
  const persistedMembers = Array.isArray(persisted.members)
    ? (persisted.members as Partial<RoomMember>[])
    : [];
  return {
    room: {
      id: persisted.id,
      hostId: persisted.hostId,
      joinCode: persisted.joinCode,
      visibility: persisted.visibility as Room["visibility"],
      members: persistedMembers.map((member) => ({
        id: member.id ?? "",
        nickname: member.nickname ?? "",
        role: member.role === "host" ? "host" : "member",
        joinedAt: member.joinedAt ?? new Date(0).toISOString(),
        peerId: null,
        presenceState: member.presenceState ?? "offline"
      })),
      playback: {
        status: persistedPlayback.status ?? "paused",
        currentTrackId: persistedPlayback.currentTrackId ?? null,
        currentQueueItemId: persistedPlayback.currentQueueItemId ?? null,
        sourceSessionId: persistedPlayback.sourceSessionId ?? persisted.hostId,
        sourcePeerId: persistedPlayback.sourcePeerId ?? null,
        sourceTrackId: persistedPlayback.sourceTrackId ?? persistedPlayback.currentTrackId ?? null,
        positionMs: persistedPlayback.positionMs ?? 0,
        startedAt: persistedPlayback.startedAt ?? null,
        queueVersion: persistedPlayback.queueVersion ?? 1,
        mediaEpoch: persistedPlayback.mediaEpoch ?? 0
      },
      presenceRevision:
        typeof (persisted as { presenceRevision?: number }).presenceRevision === "number"
          ? Math.max(0, Math.floor((persisted as { presenceRevision?: number }).presenceRevision ?? 0))
          : 0
    },
    tracks: persisted.tracks as TrackMeta[],
    queue: persisted.queue as QueueItem[]
  };
}
