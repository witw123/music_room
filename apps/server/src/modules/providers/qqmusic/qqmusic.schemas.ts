import { z } from "zod";

export const qqMusicSearchQuerySchema = z.object({
  keywords: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(30).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
}).strict();
export const qqMusicTrackIdSchema = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const qqMusicQualitySchema = z.enum(["standard", "high", "exhigh"]);
export const qqMusicCatalogPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
}).strict();
export const qqMusicDiscoverPlaylistQuerySchema = z.object({
  categoryId: z.coerce.number().int().min(0).max(99_999_999).default(10_000_000),
  sortId: z.coerce.number().int().min(0).max(999).default(5),
  limit: z.coerce.number().int().min(1).max(50).default(30),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
}).strict();
export const qqMusicDiscoverPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
}).strict();
export const qqMusicPlaylistIdSchema = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const qqMusicAlbumIdSchema = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export type QqMusicSearchQuery = z.infer<typeof qqMusicSearchQuerySchema>;
export type QqMusicQuality = z.infer<typeof qqMusicQualitySchema>;
export type QqMusicCatalogPageQuery = z.infer<typeof qqMusicCatalogPageQuerySchema>;
export type QqMusicDiscoverPlaylistQuery = z.infer<typeof qqMusicDiscoverPlaylistQuerySchema>;
export type QqMusicDiscoverPageQuery = z.infer<typeof qqMusicDiscoverPageQuerySchema>;
