import { z } from "zod";

const recommendationTextSchema = z.string().trim().min(1).max(240);

export const lastFmSimilarTracksQuerySchema = z
  .object({
    artist: recommendationTextSchema,
    track: recommendationTextSchema,
    limit: z.coerce.number().int().min(1).max(100).default(100)
  })
  .strict();

export const lastFmSeedSchema = z
  .object({
    title: recommendationTextSchema,
    artist: recommendationTextSchema
  })
  .strict();

export const lastFmTrackTagSchema = z
  .object({
    name: recommendationTextSchema,
    weight: z.number().finite().nonnegative()
  })
  .strict();

export const lastFmSimilarTrackSchema = z
  .object({
    title: recommendationTextSchema,
    artist: recommendationTextSchema,
    match: z.number().finite().min(0).max(1)
  })
  .strict();

export const lastFmSimilarTracksResponseSchema = z
  .object({
    seed: lastFmSeedSchema,
    tags: z.array(lastFmTrackTagSchema).max(10),
    items: z.array(lastFmSimilarTrackSchema).max(100)
  })
  .strict();

export type LastFmSimilarTracksQuery = z.infer<typeof lastFmSimilarTracksQuerySchema>;
export type LastFmSeed = z.infer<typeof lastFmSeedSchema>;
export type LastFmTrackTag = z.infer<typeof lastFmTrackTagSchema>;
export type LastFmSimilarTrack = z.infer<typeof lastFmSimilarTrackSchema>;
export type LastFmSimilarTracksResponse = z.infer<typeof lastFmSimilarTracksResponseSchema>;
