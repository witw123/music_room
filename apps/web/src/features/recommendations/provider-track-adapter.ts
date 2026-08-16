import type { ProviderTrackCandidate, TrackMeta } from "@music-room/shared";
import type { RecommendationCandidate } from "./recommendation-types";

export function providerTrackToRecommendationCandidate(
  track: ProviderTrackCandidate,
  scores?: { baseScore?: number; availabilityScore?: number }
): RecommendationCandidate {
  return {
    key: `${track.provider}:${track.providerTrackId}`,
    title: track.title,
    artist: track.artist,
    source: track.provider,
    baseScore: scores?.baseScore ?? 0,
    availabilityScore: scores?.availabilityScore ?? providerAccessScore(track.access)
  };
}

export function roomTrackToRecommendationCandidate(
  track: TrackMeta,
  scores?: { baseScore?: number; availabilityScore?: number }
): RecommendationCandidate | null {
  if (!track.sourceRef || (track.sourceType !== "netease" && track.sourceType !== "qqmusic")) {
    return null;
  }
  return {
    key: `${track.sourceRef.provider}:${track.sourceRef.trackId}`,
    title: track.title,
    artist: track.artist,
    source: track.sourceRef.provider,
    baseScore: scores?.baseScore ?? 0,
    availabilityScore: scores?.availabilityScore ?? 1
  };
}

export function providerAccessScore(access: ProviderTrackCandidate["access"]) {
  switch (access) {
    case "free":
      return 1;
    case "vip":
      return 0.75;
    case "unknown":
      return 0.5;
    case "paid":
      return 0.25;
  }
}
