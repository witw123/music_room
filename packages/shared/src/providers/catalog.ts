import { z } from "zod";
import { neteaseTrackCandidateSchema } from "./netease";
import { qqMusicTrackCandidateSchema } from "./qqmusic";

export const providerSchema = z.enum(["netease", "qqmusic"]);

export const providerLyricsSchema = z
  .object({
    provider: providerSchema,
    providerTrackId: z.string().trim().min(1),
    plainLyric: z.string().nullable(),
    translatedLyric: z.string().nullable(),
    romanizedLyric: z.string().nullable()
  })
  .strict();

export const providerPlaylistSummarySchema = z
  .object({
    provider: providerSchema,
    providerPlaylistId: z.string().trim().min(1),
    title: z.string(),
    description: z.string().nullable(),
    artworkUrl: z.string().url().nullable(),
    creatorName: z.string().nullable(),
    trackCount: z.number().int().nonnegative()
  })
  .strict();

export const providerPlaylistDetailSchema = providerPlaylistSummarySchema.extend({
  tracks: z.array(z.union([neteaseTrackCandidateSchema, qqMusicTrackCandidateSchema]))
});

export const providerAlbumDetailSchema = z
  .object({
    provider: providerSchema,
    providerAlbumId: z.string().trim().min(1),
    title: z.string(),
    artist: z.string(),
    description: z.string().nullable(),
    artworkUrl: z.string().url().nullable(),
    releaseTime: z.string().nullable(),
    trackCount: z.number().int().nonnegative(),
    tracks: z.array(z.union([neteaseTrackCandidateSchema, qqMusicTrackCandidateSchema]))
  })
  .strict();

export const providerPlaylistListResponseSchema = z
  .object({
    items: z.array(providerPlaylistSummarySchema),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative()
  })
  .strict();

export type ProviderLyrics = z.infer<typeof providerLyricsSchema>;
export type ProviderPlaylistSummary = z.infer<typeof providerPlaylistSummarySchema>;
export type ProviderPlaylistDetail = z.infer<typeof providerPlaylistDetailSchema>;
export type ProviderAlbumDetail = z.infer<typeof providerAlbumDetailSchema>;
export type ProviderPlaylistListResponse = z.infer<typeof providerPlaylistListResponseSchema>;
