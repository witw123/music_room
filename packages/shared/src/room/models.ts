import { z } from "zod";
import { playbackSnapshotSchema } from "../playback/models";

export const roomMemberSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  role: z.enum(["host", "member"]),
  joinedAt: z.string().datetime(),
  peerId: z.string().nullable()
});

export const roomSchema = z.object({
  id: z.string(),
  hostId: z.string(),
  joinCode: z.string(),
  visibility: z.enum(["private", "public"]),
  members: z.array(roomMemberSchema),
  playback: playbackSnapshotSchema
});

export type RoomMember = z.infer<typeof roomMemberSchema>;
export type Room = z.infer<typeof roomSchema>;

