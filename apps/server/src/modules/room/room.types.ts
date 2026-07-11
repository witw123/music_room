import { queueItemSchema, roomSchema, trackMetaSchema } from "@music-room/shared";
import type { PlaybackSnapshot, QueueItem, Room, RoomMember, TrackMeta } from "@music-room/shared";
import { z } from "zod";

export type RoomRecord = {
  room: Room;
  tracks: TrackMeta[];
  queue: QueueItem[];
};

export const roomRecordSchema = z.object({
  room: roomSchema,
  tracks: z.array(trackMetaSchema),
  queue: z.array(queueItemSchema)
});

export type PersistedRoomRecord = {
  id: string;
  hostId: string;
  joinCode: string;
  visibility: string;
  lastActiveAt?: Date;
  archivedAt?: Date | null;
  presenceRevision?: number;
  roomRevision?: number;
  playback: unknown;
  members: unknown;
  tracks: unknown;
  queue: unknown;
};

type PersistedPlayback = Partial<PlaybackSnapshot> & {
  presenceRevision?: number;
  roomRevision?: number;
};

export function serializePlaybackForPersistence(
  room: Pick<Room, "playback" | "presenceRevision" | "roomRevision">
) {
  return {
    ...room.playback,
    presenceRevision: room.presenceRevision,
    roomRevision: room.roomRevision ?? 0
  };
}

export function deserializeRoomRecord(persisted: PersistedRoomRecord): RoomRecord {
  const persistedPlayback = persisted.playback as PersistedPlayback;
  const persistedMembers = Array.isArray(persisted.members)
    ? (persisted.members as Partial<RoomMember>[])
    : [];
  return {
    room: {
      id: persisted.id,
      hostId: persisted.hostId,
      joinCode: persisted.joinCode,
      visibility: persisted.visibility as Room["visibility"],
      lastActiveAt: (persisted.lastActiveAt ?? new Date()).toISOString(),
      archivedAt: persisted.archivedAt?.toISOString() ?? null,
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
        playbackRevision: persistedPlayback.playbackRevision ?? 1,
        mediaEpoch: persistedPlayback.mediaEpoch ?? 0
      },
      presenceRevision: resolvePresenceRevision(persisted, persistedPlayback),
      roomRevision: resolveRoomRevision(persisted, persistedPlayback)
    },
    tracks: persisted.tracks as TrackMeta[],
    queue: persisted.queue as QueueItem[]
  };
}

function resolvePresenceRevision(
  persisted: PersistedRoomRecord,
  persistedPlayback: PersistedPlayback
) {
  const rawPresenceRevision =
    typeof persisted.presenceRevision === "number"
      ? persisted.presenceRevision
      : persistedPlayback.presenceRevision;

  return typeof rawPresenceRevision === "number"
    ? Math.max(0, Math.floor(rawPresenceRevision))
    : 0;
}

function resolveRoomRevision(
  persisted: PersistedRoomRecord,
  persistedPlayback: PersistedPlayback
) {
  const rawRoomRevision =
    typeof persisted.roomRevision === "number"
      ? persisted.roomRevision
      : persistedPlayback.roomRevision;

  return typeof rawRoomRevision === "number"
    ? Math.max(0, Math.floor(rawRoomRevision))
    : 0;
}
