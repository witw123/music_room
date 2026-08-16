import { z } from "zod";

export const listeningProfileProviderSchema = z.enum([
  "local_upload",
  "netease",
  "qqmusic"
]);

export const listeningTrackSchema = z.object({
  key: z.string().trim().min(1).max(512),
  provider: listeningProfileProviderSchema,
  providerTrackId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(240),
  artist: z.string().trim().min(1).max(240),
  album: z.string().trim().max(240).nullable(),
  durationMs: z.number().int().min(0).max(86_400_000),
  artworkUrl: z.string().max(2_048).nullable().optional()
}).strict();

export const listeningPlaybackEventSchema = z.object({
  id: z.string().trim().min(1).max(160),
  type: z.literal("playback"),
  track: listeningTrackSchema,
  listenedMs: z.number().int().min(0).max(86_400_000),
  completed: z.boolean(),
  quickSkipped: z.boolean(),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840),
  occurredAt: z.string().datetime()
}).strict();

export const listeningFavoriteEventSchema = z.object({
  id: z.string().trim().min(1).max(160),
  type: z.enum(["favorite", "unfavorite"]),
  track: listeningTrackSchema,
  occurredAt: z.string().datetime()
}).strict();

export const recordListeningProfileEventSchema = z.union([
  listeningPlaybackEventSchema,
  listeningFavoriteEventSchema
]);

export const audioFeatureValuesSchema = z.object({
  danceability: z.number().min(0).max(1).nullable(),
  energy: z.number().min(0).max(1).nullable(),
  valence: z.number().min(0).max(1).nullable(),
  acousticness: z.number().min(0).max(1).nullable(),
  instrumentalness: z.number().min(0).max(1).nullable(),
  speechiness: z.number().min(0).max(1).nullable(),
  liveness: z.number().min(0).max(1).nullable(),
  tempo: z.number().min(0).max(400).nullable()
}).strict();

export const saveListeningAudioFeaturesSchema = z.object({
  trackKey: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(240),
  artist: z.string().trim().min(1).max(240),
  album: z.string().trim().max(240).nullable(),
  durationMs: z.number().int().min(0).max(86_400_000),
  providerTrackId: z.string().trim().min(1).max(512).nullable(),
  reccoBeatsTrackId: z.string().trim().min(1).max(256).nullable(),
  status: z.enum(["resolved", "unmatched", "deferred"]),
  features: audioFeatureValuesSchema.nullable()
}).strict();

export type ListeningProfileProvider = z.infer<typeof listeningProfileProviderSchema>;
export type ListeningTrack = z.infer<typeof listeningTrackSchema>;
export type RecordListeningProfileEvent = z.infer<typeof recordListeningProfileEventSchema>;
export type AudioFeatureValues = z.infer<typeof audioFeatureValuesSchema>;
export type SaveListeningAudioFeatures = z.infer<typeof saveListeningAudioFeaturesSchema>;

export type ListeningAudioFeatureRecord = SaveListeningAudioFeatures & {
  createdAt: string;
  updatedAt: string;
};

export type ListeningProfileTrack = ListeningTrack & {
  playCount: number;
  listenedMs: number;
  completionCount: number;
  quickSkipCount: number;
  isFavorite: boolean;
  lastPlayedAt: string | null;
};

export type ListeningProfileArtist = {
  name: string;
  listenedMs: number;
  playCount: number;
  favoriteTrackCount: number;
};

export type ListeningProfileRecentItem = ListeningTrack & {
  listenedMs: number;
  occurredAt: string;
};

export type ListeningProfileResponse = {
  startedAt: string | null;
  totalListenedMs: number;
  totalPlayCount: number;
  trackCount: number;
  artistCount: number;
  topPlayedTracks: ListeningProfileTrack[];
  favoriteTracks: ListeningProfileTrack[];
  topArtists: ListeningProfileArtist[];
  timeBands: Array<{ id: "morning" | "afternoon" | "evening" | "late-night"; listenedMs: number }>;
  sourceDistribution: Array<{ source: ListeningProfileProvider; listenedMs: number }>;
  recent: ListeningProfileRecentItem[];
  tasteTags: string[];
};
