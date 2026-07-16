import { z } from "zod";
import { metingProviderSchema } from "../playlist/models";

export const metingTrackCandidateSchema = z
  .object({
    provider: metingProviderSchema,
    providerTrackId: z.string().trim().min(1).max(128),
    access: z.enum(["free", "vip", "paid", "unknown"]),
    quality: z.enum(["standard", "high", "exhigh", "lossless", "hires"]).nullable(),
    title: z.string().trim().min(1),
    artist: z.string().trim().min(1),
    album: z.string().trim().nullable(),
    durationMs: z.number().int().nonnegative(),
    artworkUrl: z.string().url().nullable()
  })
  .strict();

export const metingSearchResponseSchema = z
  .object({
    items: z.array(metingTrackCandidateSchema),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative()
  })
  .strict();

export type MetingTrackCandidate = z.infer<typeof metingTrackCandidateSchema>;
export type MetingSearchResponse = z.infer<typeof metingSearchResponseSchema>;
