import { z } from "zod";
import { metingProviderSchema } from "@music-room/shared";

export const metingSearchQuerySchema = z
  .object({
    keywords: z.string().trim().min(1).max(100),
    limit: z.coerce.number().int().min(1).max(30).default(20),
    offset: z.coerce.number().int().min(0).max(10_000).default(0)
  })
  .strict();

export const metingProviderParamSchema = metingProviderSchema;
export const metingQualitySchema = z.enum(["standard", "high", "exhigh"]);

export const metingTrackIdSchema = z.string().trim().min(1).max(128).refine(
  (value) => /^[a-zA-Z0-9_-]+$/.test(value),
  "Invalid provider track id."
);

export type MetingSearchQuery = z.infer<typeof metingSearchQuerySchema>;
export type MetingQuality = z.infer<typeof metingQualitySchema>;
