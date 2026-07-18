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

export type RoomMember = z.infer<typeof roomMemberSchema>;
export type Room = z.infer<typeof roomSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
