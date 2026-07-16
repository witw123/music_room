import { z } from "zod";

export const spotifyTrackIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z]{22}$/, "Invalid Spotify track id.");

export const spotifySearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    keywords: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().positive().max(50).default(20),
    offset: z.coerce.number().int().nonnegative().max(1000).default(0)
  })
  .transform((value) => {
    const query = (value.q ?? value.keywords ?? "").trim();
    return {
      q: query,
      limit: value.limit,
      offset: value.offset
    };
  })
  .refine((value) => value.q.length > 0, {
    message: "Search query is required.",
    path: ["q"]
  });

export const spotifyQualitySchema = z.enum(["normal", "high", "very_high"]);

export type SpotifySearchQuery = z.infer<typeof spotifySearchQuerySchema>;
export type SpotifyQuality = z.infer<typeof spotifyQualitySchema>;
