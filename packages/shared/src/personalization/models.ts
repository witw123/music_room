import { z } from "zod";
import { providerPlaylistSummarySchema, providerTrackCandidateSchema } from "../providers/catalog";

export const personalizationSurfaceSchema = z.enum(["discover", "radio", "search"]);
export const tasteEntityKindSchema = z.enum(["track", "artist", "album", "playlist", "tag", "source"]);
export const tasteEventTypeSchema = z.enum([
  "playback",
  "favorite",
  "unfavorite",
  "manual-selection",
  "completion",
  "quick-skip",
  "dismissed",
  "unavailable",
  "provider-sync"
]);
export const recommendationFeedbackActionSchema = z.enum(["not-interested", "exclude-from-profile"]);

export const personalizationTrackSchema = z.object({
  provider: z.enum(["local_upload", "netease", "qqmusic"]),
  providerTrackId: z.string().trim().min(1).max(512),
  access: z.enum(["free", "vip", "paid", "unknown"]),
  quality: z.enum(["standard", "high", "exhigh", "lossless", "hires"]).nullable(),
  title: z.string().trim().min(1).max(240),
  artist: z.string().trim().min(1).max(240),
  album: z.string().trim().max(240).nullable(),
  providerAlbumId: z.string().trim().min(1).max(512).nullable().optional(),
  durationMs: z.number().int().min(0).max(86_400_000),
  artworkUrl: z.string().url().nullable()
}).strict();

export const recordPersonalizationEventSchema = z.object({
  id: z.string().trim().min(1).max(160),
  type: tasteEventTypeSchema,
  track: personalizationTrackSchema,
  surface: personalizationSurfaceSchema.optional(),
  listenedMs: z.number().int().min(0).max(86_400_000).optional(),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  occurredAt: z.string().datetime()
}).strict();

export const personalizationFeedbackSchema = z.object({
  action: recommendationFeedbackActionSchema,
  target: z.object({
    kind: z.enum(["track", "artist"]),
    key: z.string().trim().min(1).max(512),
    label: z.string().trim().min(1).max(480).optional()
  }).strict()
}).strict();

export const personalizationRecommendationsQuerySchema = z.object({
  surface: personalizationSurfaceSchema,
  provider: z.enum(["netease", "qqmusic"]).optional(),
  currentTrackKey: z.string().trim().min(1).max(512).optional(),
  excludedTrackKeys: z.preprocess(
    (value) => typeof value === "string" ? value.split(",").filter(Boolean) : value,
    z.array(z.string().trim().min(1).max(512)).max(100).optional()
  ),
  query: z.string().trim().min(1).max(240).optional()
}).strict();

export type PersonalizationSurface = z.infer<typeof personalizationSurfaceSchema>;
export type TasteEntityKind = z.infer<typeof tasteEntityKindSchema>;
export type TasteEventType = z.infer<typeof tasteEventTypeSchema>;
export type RecordPersonalizationEvent = z.infer<typeof recordPersonalizationEventSchema>;
export type PersonalizationTrackInput = z.infer<typeof personalizationTrackSchema>;
export type PersonalizationFeedback = z.infer<typeof personalizationFeedbackSchema>;
export type PersonalizationRecommendationsQuery = z.infer<typeof personalizationRecommendationsQuerySchema>;

export type PersonalizationTasteTag = { label: string; confidence: number };
export type PersonalizationTrack = z.infer<typeof providerTrackCandidateSchema> & {
  score: number;
  reasons: string[];
};
export type PersonalizationPlaylist = z.infer<typeof providerPlaylistSummarySchema> & {
  score: number;
  reasons: string[];
};

export type PersonalizationProfileResponse = {
  version: string;
  startedAt: string | null;
  totalListenedMs: number;
  totalPlayCount: number;
  trackCount: number;
  artistCount: number;
  tasteTags: PersonalizationTasteTag[];
  topTracks: Array<PersonalizationTrack & { listenedMs: number; playCount: number }>;
  topArtists: Array<{ name: string; score: number; listenedMs: number; playCount: number }>;
  sourceDistribution: Array<{ source: string; listenedMs: number }>;
  syncs: Array<{ provider: "netease" | "qqmusic"; lastSyncedAt: string }>;
};

export type PersonalizationRecommendationsResponse = {
  profileVersion: string;
  providers: Array<"netease" | "qqmusic">;
  forYou: PersonalizationTrack[];
  familiarArtists: PersonalizationTrack[];
  playlists: PersonalizationPlaylist[];
};

export type PersonalizationExclusion = {
  kind: "track" | "artist";
  key: string;
  label: string | null;
  action: "not-interested" | "exclude-from-profile";
  createdAt: string;
};
