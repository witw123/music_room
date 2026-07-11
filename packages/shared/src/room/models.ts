import { z } from "zod";
import { playbackSnapshotSchema } from "../playback/models";
import { playlistSchema, queueItemSchema, trackMetaSchema } from "../playlist/models";

export const roomPresenceStateSchema = z.enum(["online", "reconnecting", "offline"]);

export const roomMemberSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  role: z.enum(["host", "member"]),
  joinedAt: z.string().datetime(),
  peerId: z.string().nullable(),
  presenceState: roomPresenceStateSchema.default("offline")
});

export const roomSchema = z.object({
  id: z.string(),
  hostId: z.string(),
  joinCode: z.string(),
  visibility: z.enum(["private", "public"]),
  lastActiveAt: z.string().datetime().optional(),
  archivedAt: z.string().datetime().nullable().optional(),
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

export const roomSummarySchema = z.object({
  id: z.string(),
  joinCode: z.string(),
  visibility: z.enum(["private", "public"]),
  hostNickname: z.string(),
  memberCount: z.number().int().nonnegative(),
  onlineMemberCount: z.number().int().nonnegative(),
  lastActiveAt: z.string().datetime()
});

export const roomListResponseSchema = z.object({
  items: z.array(roomSummarySchema),
  nextCursor: z.string().nullable()
});

export type RoomMember = z.infer<typeof roomMemberSchema>;
export type Room = z.infer<typeof roomSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export type RoomSummary = z.infer<typeof roomSummarySchema>;
export type RoomListResponse = z.infer<typeof roomListResponseSchema>;
