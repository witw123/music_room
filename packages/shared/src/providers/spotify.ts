import { z } from "zod";

export const spotifyAccountStatusSchema = z
  .object({
    connected: z.boolean(),
    mode: z.literal("user_credentials"),
    hasWebApiCredentials: z.boolean(),
    hasDownloadCredentials: z.boolean(),
    hasZotifyBinary: z.boolean(),
    lastValidatedAt: z.string().datetime().nullable(),
    message: z.string().nullable()
  })
  .strict();

export const spotifyTrackCandidateSchema = z
  .object({
    provider: z.literal("spotify"),
    providerTrackId: z.string().regex(/^[0-9A-Za-z]{22}$/),
    title: z.string(),
    artist: z.string(),
    album: z.string().nullable(),
    durationMs: z.number().int().nonnegative(),
    artworkUrl: z.string().url().nullable(),
    explicit: z.boolean(),
    previewUrl: z.string().url().nullable(),
    quality: z.enum(["normal", "high", "very_high"]).nullable()
  })
  .strict();

export const spotifySearchResponseSchema = z
  .object({
    items: z.array(spotifyTrackCandidateSchema),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative()
  })
  .strict();

export type SpotifyAccountStatus = z.infer<typeof spotifyAccountStatusSchema>;
export type SpotifyTrackCandidate = z.infer<typeof spotifyTrackCandidateSchema>;
export type SpotifySearchResponse = z.infer<typeof spotifySearchResponseSchema>;
