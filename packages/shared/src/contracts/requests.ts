import { z } from "zod";
import { trackPieceManifestSchema } from "../playlist/models";

const trimmedString = (max: number) => z.string().trim().min(1).max(max);
const optionalNullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional();

const stringId = trimmedString(160);
const trackIdListSchema = z.array(stringId).max(500);

export const registerRequestSchema = z
  .object({
    username: trimmedString(64).regex(/^[a-zA-Z0-9_.-]+$/),
    password: z.string().min(6).max(256),
    nickname: trimmedString(80)
  })
  .strict();

export const loginRequestSchema = z
  .object({
    username: trimmedString(64),
    password: z.string().min(1).max(256)
  })
  .strict();

export const createRoomRequestSchema = z
  .object({
    visibility: z.enum(["private", "public"]).optional()
  })
  .strict();

export const joinRoomByCodeRequestSchema = z
  .object({
    joinCode: trimmedString(16).transform((value) => value.toUpperCase())
  })
  .strict();

export const registerTrackRequestSchema = z
  .object({
    id: stringId.optional(),
    title: trimmedString(240),
    artist: trimmedString(240),
    album: z.string().trim().max(240).nullable(),
    durationMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000),
    bitrate: z.number().int().positive().max(10_000_000).nullable(),
    sizeBytes: z.number().int().nonnegative().max(200 * 1024 * 1024).nullable().optional(),
    codec: z.string().trim().max(80).nullable().optional(),
    mimeType: z.string().trim().max(120).nullable().optional(),
    fileHash: trimmedString(256),
    artworkUrl: z.string().trim().max(4096).nullable(),
    ownerSessionId: stringId.optional(),
    ownerNickname: z.string().trim().max(80).optional(),
    sourceType: z.literal("local_upload"),
    pieceManifest: trackPieceManifestSchema.strict().nullable().optional(),
    relayManifest: trackPieceManifestSchema.strict().nullable().optional()
  })
  .strict();

export const addQueueItemRequestSchema = z
  .object({
    trackId: stringId
  })
  .strict();

export const reorderQueueRequestSchema = z
  .object({
    queueItemIds: z.array(stringId).max(500)
  })
  .strict();

export const updatePlaybackRequestSchema = z
  .object({
    action: z.enum(["play", "pause", "seek", "next", "prev"]),
    trackId: stringId.optional(),
    queueItemId: stringId.optional(),
    positionMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000).optional(),
    expectedVersion: z.number().int().positive()
  })
  .strict();

export const createPlaylistRequestSchema = z
  .object({
    title: trimmedString(160),
    description: optionalNullableText(1000),
    trackIds: trackIdListSchema.optional(),
    tags: z.array(trimmedString(40)).max(20).optional(),
    coverUrl: z.string().trim().max(4096).nullable().optional(),
    isCollaborative: z.boolean().optional()
  })
  .strict();

export const updatePlaylistRequestSchema = z
  .object({
    title: trimmedString(160).optional(),
    description: optionalNullableText(1000),
    tags: z.array(trimmedString(40)).max(20).optional(),
    coverUrl: z.string().trim().max(4096).nullable().optional(),
    trackIds: trackIdListSchema.optional()
  })
  .strict();

export const importPlaylistToRoomRequestSchema = z
  .object({
    roomId: stringId
  })
  .strict();

export const createPlaylistFromRoomRequestSchema = z
  .object({
    roomId: stringId,
    title: trimmedString(160),
    description: optionalNullableText(1000)
  })
  .strict();

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type JoinRoomByCodeRequest = z.infer<typeof joinRoomByCodeRequestSchema>;
export type RegisterTrackRequest = z.infer<typeof registerTrackRequestSchema>;
export type AddQueueItemRequest = z.infer<typeof addQueueItemRequestSchema>;
export type ReorderQueueRequest = z.infer<typeof reorderQueueRequestSchema>;
export type UpdatePlaybackRequest = z.infer<typeof updatePlaybackRequestSchema>;
export type CreatePlaylistRequest = z.infer<typeof createPlaylistRequestSchema>;
export type UpdatePlaylistRequest = z.infer<typeof updatePlaylistRequestSchema>;
export type ImportPlaylistToRoomRequest = z.infer<typeof importPlaylistToRoomRequestSchema>;
export type CreatePlaylistFromRoomRequest = z.infer<typeof createPlaylistFromRoomRequestSchema>;
