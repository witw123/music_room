import { z } from "zod";
import { playbackSnapshotSchema } from "../playback/models";
import { playlistSchema, queueItemSchema, trackMetaSchema } from "../playlist/models";

export const roomPresenceStateSchema = z.enum(["online", "reconnecting", "offline"]);

export const roomMemberPermissionsSchema = z.object({
  library: z.boolean(),
  queue: z.boolean(),
  player: z.boolean()
}).strict();

export type RoomMemberPermissions = z.infer<typeof roomMemberPermissionsSchema>;

export const defaultRoomMemberPermissions: RoomMemberPermissions = {
  library: true,
  queue: true,
  player: true
};

export const roomMemberSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  role: z.enum(["host", "member"]),
  joinedAt: z.string().datetime(),
  peerId: z.string().nullable(),
  presenceState: roomPresenceStateSchema.default("offline"),
  // Optional for snapshots persisted before member permissions were added.
  permissions: roomMemberPermissionsSchema.partial().optional()
});

export const roomSchema = z.object({
  id: z.string(),
  hostId: z.string(),
  joinCode: z.string(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  hasPassword: z.boolean().optional(),
  visibility: z.enum(["private", "public"]),
  members: z.array(roomMemberSchema),
  playback: playbackSnapshotSchema,
  presenceRevision: z.number().int().nonnegative().default(0),
  roomRevision: z.number().int().nonnegative().default(0).optional()
});

export const roomSnapshotSchema = z.object({
  room: roomSchema,
  tracks: z.array(trackMetaSchema),
  queue: z.array(queueItemSchema),
  playlists: z.array(playlistSchema)
});

export const roomTrackDeletionSchema = z.object({
  roomId: z.string(),
  trackId: z.string(),
  fileHash: z.string().nullable().optional(),
  originalAssetId: z.string().nullable().optional(),
  playbackAssetId: z.string().nullable().optional(),
  roomRevision: z.number().int().nonnegative(),
  deletedAt: z.string().datetime()
});

export const roomSyncResponseSchema = z.object({
  roomId: z.string(),
  roomDeleted: z.boolean(),
  roomRevision: z.number().int().nonnegative(),
  snapshot: roomSnapshotSchema.nullable(),
  deletedTracks: z.array(roomTrackDeletionSchema)
});

export type RoomMember = z.infer<typeof roomMemberSchema>;
export type Room = z.infer<typeof roomSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export type RoomTrackDeletion = z.infer<typeof roomTrackDeletionSchema>;
export type RoomSyncResponse = z.infer<typeof roomSyncResponseSchema>;

export function getRoomMemberPermissions(
  member: Pick<RoomMember, "role" | "permissions">
): RoomMemberPermissions {
  if (member.role === "host") {
    return { ...defaultRoomMemberPermissions };
  }

  return {
    ...defaultRoomMemberPermissions,
    ...member.permissions
  };
}
