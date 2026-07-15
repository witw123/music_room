import { z } from "zod";
import { originalAssetManifestSchema, playbackAssetManifestSchema } from "../assets/models";

export const neteaseTrackSourceRefSchema = z
  .object({
    provider: z.literal("netease"),
    trackId: z.string().trim().regex(/^\d+$/)
  })
  .strict();

export const trackMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  bitrate: z.number().int().positive().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  codec: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  fileHash: z.string(),
  artworkUrl: z.string().nullable(),
  ownerSessionId: z.string(),
  ownerNickname: z.string(),
  sourceType: z.enum(["local_upload", "netease"]),
  sourceRef: neteaseTrackSourceRefSchema.nullable().optional(),
  originalAsset: originalAssetManifestSchema.optional(),
  playbackAsset: playbackAssetManifestSchema.optional()
}).superRefine((track, context) => {
  if (track.sourceType === "netease" && !track.sourceRef) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceRef"],
      message: "NetEase tracks require a source reference."
    });
  }

  if (track.sourceType === "local_upload" && track.sourceRef !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceRef"],
      message: "Local uploads cannot include a provider source reference."
    });
  }
});

export const queueItemSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  requestedBy: z.string(),
  requestedById: z.string(),
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime()
});

export const playlistSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  tags: z.array(z.string()),
  isCollaborative: z.boolean(),
  trackIds: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type TrackMeta = z.infer<typeof trackMetaSchema>;
export type QueueItem = z.infer<typeof queueItemSchema>;
export type Playlist = z.infer<typeof playlistSchema>;

export type NeteaseTrackSourceRef = z.infer<typeof neteaseTrackSourceRefSchema>;
