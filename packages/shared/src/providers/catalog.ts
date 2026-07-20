import { z } from "zod";
import { neteaseTrackCandidateSchema } from "./netease";
import { qqMusicTrackCandidateSchema } from "./qqmusic";

export const providerSchema = z.enum(["netease", "qqmusic"]);

export const providerAudioResolveResponseSchema = z
  .object({
    provider: providerSchema,
    providerTrackId: z.string().trim().min(1),
    url: z.string().url(),
    mimeType: z.enum(["audio/mpeg", "audio/flac"]).nullable(),
    fileType: z.enum(["mp3", "flac"])
  })
  .strict();

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

export const providerAlbumSummarySchema = z
  .object({
    provider: providerSchema,
    providerAlbumId: z.string().trim().min(1),
    title: z.string(),
    artist: z.string(),
    description: z.string().nullable(),
    artworkUrl: z.string().url().nullable(),
    releaseTime: z.string().nullable(),
    trackCount: z.number().int().nonnegative(),
  })
  .strict();

export const providerAlbumDetailSchema = providerAlbumSummarySchema
  .extend({
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

export const providerAlbumListResponseSchema = z
  .object({
    items: z.array(providerAlbumSummarySchema),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative()
  })
  .strict();

export const providerAlbumFavoriteSchema = providerAlbumSummarySchema
  .extend({
    id: z.string().trim().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();

export type ProviderLyrics = z.infer<typeof providerLyricsSchema>;
export type ProviderAudioResolveResponse = z.infer<typeof providerAudioResolveResponseSchema>;
export type ProviderPlaylistSummary = z.infer<typeof providerPlaylistSummarySchema>;
export type ProviderPlaylistDetail = z.infer<typeof providerPlaylistDetailSchema>;
export type ProviderAlbumSummary = z.infer<typeof providerAlbumSummarySchema>;
export type ProviderAlbumDetail = z.infer<typeof providerAlbumDetailSchema>;
export type ProviderPlaylistListResponse = z.infer<typeof providerPlaylistListResponseSchema>;
export type ProviderAlbumListResponse = z.infer<typeof providerAlbumListResponseSchema>;
export type ProviderAlbumFavorite = z.infer<typeof providerAlbumFavoriteSchema>;
