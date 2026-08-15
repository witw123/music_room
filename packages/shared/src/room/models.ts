import { z } from "zod";
import { playbackSnapshotSchema } from "../playback/models";
import { playlistSchema, queueItemSchema, trackMetaSchema } from "../playlist/models";

export const roomPresenceStateSchema = z.enum(["online", "reconnecting", "offline"]);
export const roomTypeSchema = z.enum(["interactive", "request", "radio"]);
export type RoomType = z.infer<typeof roomTypeSchema>;

export const radioAutopilotSchema = z
  .object({
    enabled: z.boolean(),
    seedTrackId: z.string().nullable(),
    seedProvider: z.enum(["netease", "qqmusic"]).nullable(),
    seedProviderTrackId: z.string().nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.enabled &&
      (!value.seedTrackId || !value.seedProvider || !value.seedProviderTrackId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Autopilot requires a provider-backed seed track."
      });
    }
  });

export type RadioAutopilot = z.infer<typeof radioAutopilotSchema>;

export const inactiveRadioAutopilot: RadioAutopilot = {
  enabled: false,
  seedTrackId: null,
  seedProvider: null,
  seedProviderTrackId: null
};

export const roomDirectoryNowPlayingSchema = z.object({
  title: z.string().min(1).max(240),
  artist: z.string().min(1).max(240),
  artworkUrl: z.string().nullable()
});

export const roomRequestStatusSchema = z.enum(["pending", "approved", "rejected"]);
export const roomRequestSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  requesterId: z.string(),
  requesterName: z.string(),
  provider: z.enum(["netease", "qqmusic", "local"]),
  providerTrackId: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  artworkUrl: z.string().nullable(),
  status: roomRequestStatusSchema,
  createdAt: z.string().datetime()
});
export type RoomRequest = z.infer<typeof roomRequestSchema>;

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
  roomType: roomTypeSchema,
  radioAutopilot: radioAutopilotSchema,
  requests: z.array(roomRequestSchema).optional(),
  // Optional so snapshots persisted before room-level defaults remain valid.
  newMemberPermissions: roomMemberPermissionsSchema.optional(),
  members: z.array(roomMemberSchema),
  // Directory responses intentionally omit member details and carry only
  // aggregate values needed by the lobby UI.
  directoryHostNickname: z.string().max(80).optional(),
  directoryMemberCount: z.number().int().nonnegative().optional(),
  directoryOnlineMemberCount: z.number().int().nonnegative().optional(),
  directoryIsMember: z.boolean().optional(),
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

export const roomDirectoryItemSchema = z.object({
  room: z.object({
    id: z.string(),
    joinCode: z.string(),
    name: z.string().min(1).max(120),
    description: z.string().nullable(),
    hasPassword: z.boolean(),
    visibility: z.enum(["private", "public"]),
    roomType: roomTypeSchema,
    directoryHostNickname: z.string().max(80),
    directoryMemberCount: z.number().int().nonnegative(),
    directoryOnlineMemberCount: z.number().int().nonnegative(),
    directoryIsMember: z.boolean(),
    directoryQueueDepth: z.number().int().nonnegative(),
    directoryPendingRequestCount: z.number().int().nonnegative(),
    directoryBroadcastState: z.enum(["on_air", "off_air"]).nullable(),
    directoryNowPlaying: roomDirectoryNowPlayingSchema.nullable(),
    playbackStatus: playbackSnapshotSchema.shape.status
  })
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

// Joining only needs the room metadata and route id. Tracks, queue and
// presence are loaded by the room runtime after navigation so large rooms do
// not block the join request.
export const roomJoinResponseSchema = z.object({
  roomId: z.string().min(1),
  roomRevision: z.number().int().nonnegative(),
  room: roomSchema
}).strict();

export type RoomMember = z.infer<typeof roomMemberSchema>;
export type Room = z.infer<typeof roomSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export type RoomDirectoryItem = z.infer<typeof roomDirectoryItemSchema>;
export type RoomTrackDeletion = z.infer<typeof roomTrackDeletionSchema>;
export type RoomSyncResponse = z.infer<typeof roomSyncResponseSchema>;
export type RoomJoinResponse = z.infer<typeof roomJoinResponseSchema>;

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

export function getNewMemberPermissions(
  room: Pick<Room, "newMemberPermissions">
): RoomMemberPermissions {
  return {
    ...defaultRoomMemberPermissions,
    ...room.newMemberPermissions
  };
}
