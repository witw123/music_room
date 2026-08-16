export const recommendationFeedbackTypes = [
  "favorite",
  "manual-selection",
  "completion",
  "quick-skip",
  "dismissed",
  "unavailable"
] as const;

export type RecommendationFeedbackType = (typeof recommendationFeedbackTypes)[number];

export type RecommendationCandidate = {
  key: string;
  title: string;
  artist: string;
  source: string;
  baseScore: number;
  availabilityScore: number;
};

export type RecommendationFeedback = {
  userId: string;
  candidate: RecommendationCandidate;
  eventType: RecommendationFeedbackType;
  contextKey?: string;
  occurredAt?: number;
  dedupeKey?: string;
};

export type RecommendationEvent = RecommendationFeedback & {
  id: string;
  occurredAt: number;
  artistKey: string;
};

export type RecommendationProfile = {
  userId: string;
  trackAffinity: Map<string, number>;
  artistAffinity: Map<string, number>;
  reliability: Map<string, number>;
  recentCandidateKeys: string[];
  recentArtistKeys: string[];
};

export type RecommendationRankContext = {
  excludedCandidateKeys?: ReadonlySet<string>;
  recentCandidateKeys?: readonly string[];
  recentArtistKeys?: readonly string[];
  preferredSource?: string | null;
};

export type RecommendationReason =
  | "base"
  | "preference"
  | "reliable"
  | "preferred-source"
  | "artist-repeat";

export type RankedRecommendationCandidate = {
  candidate: RecommendationCandidate;
  score: number;
  reasons: RecommendationReason[];
};

export function normalizeRecommendationText(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

export function recommendationArtistKey(artist: string) {
  return normalizeRecommendationText(artist);
}
