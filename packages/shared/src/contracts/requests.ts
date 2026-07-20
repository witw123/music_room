import { z } from "zod";
import {
  maxOriginalAssetSizeBytes,
  originalAssetManifestSchema,
  playbackAssetManifestSchema
} from "../assets/models";
import {
  remoteTrackSourceRefSchema,
  trackSourceTypeSchema
} from "../playlist/models";
import { playbackModeSchema } from "../playback/models";

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
    visibility: z.enum(["private", "public"]).optional(),
    name: trimmedString(120).optional(),
    description: optionalNullableText(500),
    password: z.string().trim().min(4).max(128).optional()
  })
  .strict();

export const updateRoomRequestSchema = z
  .object({
    visibility: z.enum(["private", "public"]),
    name: trimmedString(120),
    description: optionalNullableText(500),
    password: z
      .string()
      .trim()
      .max(128)
      .refine((value) => value.length === 0 || value.length >= 4, "密码至少 4 位。")
      .optional()
  })
  .strict();

export const joinRoomByCodeRequestSchema = z
  .object({
    joinCode: trimmedString(16).transform((value) => value.toUpperCase()),
    password: z.string().trim().max(128).optional()
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
    sizeBytes: z.number().int().nonnegative().max(maxOriginalAssetSizeBytes).nullable().optional(),
    codec: z.string().trim().max(80).nullable().optional(),
    mimeType: z.string().trim().max(120).nullable().optional(),
    fileHash: trimmedString(256),
    artworkUrl: z.string().trim().max(4096).nullable(),
    ownerSessionId: stringId.optional(),
    ownerNickname: z.string().trim().max(80).optional(),
    sourceType: trackSourceTypeSchema,
    sourceRef: remoteTrackSourceRefSchema.nullable().optional(),
    originalAsset: originalAssetManifestSchema.optional(),
    playbackAsset: playbackAssetManifestSchema.optional()
  })
  .strict()
  .superRefine((track, context) => {
    if (track.sourceType !== "local_upload" && !track.sourceRef) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceRef"],
        message: "Provider tracks require a source reference."
      });
    }

    if (track.sourceType === "local_upload" && track.sourceRef !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceRef"],
        message: "Local uploads cannot include a provider source reference."
      });
    }

    if (
      track.sourceType !== "local_upload" &&
      track.sourceRef &&
      track.sourceRef.provider !== track.sourceType
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceRef", "provider"],
        message: "Track source type and provider must match."
      });
    }
  });

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
    action: z.enum(["play", "pause", "seek", "next", "prev", "set-mode"]),
    trackId: stringId.optional(),
    queueItemId: stringId.optional(),
    playbackAssetId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    positionMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000).optional(),
    playbackMode: playbackModeSchema.optional(),
    actorPeerId: stringId.optional(),
    expectedVersion: z.number().int().positive()
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.action === "set-mode" && !payload.playbackMode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["playbackMode"],
        message: "Playback mode is required when changing playback order."
      });
    }
  });

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
export type UpdateRoomRequest = z.infer<typeof updateRoomRequestSchema>;
export type JoinRoomByCodeRequest = z.infer<typeof joinRoomByCodeRequestSchema>;
export type RegisterTrackRequest = z.infer<typeof registerTrackRequestSchema>;
export type AddQueueItemRequest = z.infer<typeof addQueueItemRequestSchema>;
export type ReorderQueueRequest = z.infer<typeof reorderQueueRequestSchema>;
export type UpdatePlaybackRequest = z.infer<typeof updatePlaybackRequestSchema>;
export type CreatePlaylistRequest = z.infer<typeof createPlaylistRequestSchema>;
export type UpdatePlaylistRequest = z.infer<typeof updatePlaylistRequestSchema>;
export type ImportPlaylistToRoomRequest = z.infer<typeof importPlaylistToRoomRequestSchema>;
export type CreatePlaylistFromRoomRequest = z.infer<typeof createPlaylistFromRoomRequestSchema>;
