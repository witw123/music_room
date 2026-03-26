import { z } from "zod";

export const trackMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  bitrate: z.number().int().positive().nullable(),
  fileHash: z.string(),
  artworkUrl: z.string().nullable(),
  sourceType: z.literal("local_upload")
});

export const queueItemSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  requestedBy: z.string(),
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

