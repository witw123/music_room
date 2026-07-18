import { z } from "zod";

export const qqMusicSearchQuerySchema = z.object({
  keywords: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(30).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
}).strict();
export const qqMusicTrackIdSchema = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const qqMusicQualitySchema = z.enum(["standard", "high", "exhigh"]);
export type QqMusicSearchQuery = z.infer<typeof qqMusicSearchQuerySchema>;
export type QqMusicQuality = z.infer<typeof qqMusicQualitySchema>;
