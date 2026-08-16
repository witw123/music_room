import {
  recommendationArtistKey,
  type RankedRecommendationCandidate,
  type RecommendationCandidate,
  type RecommendationProfile,
  type RecommendationRankContext
} from "./recommendation-types";

export function rankRecommendationCandidates(
  candidates: RecommendationCandidate[],
  profile: RecommendationProfile,
  context: RecommendationRankContext = {}
): RankedRecommendationCandidate[] {
  const excludedCandidateKeys = new Set([
    ...(context.excludedCandidateKeys ?? []),
    ...profile.recentCandidateKeys,
    ...(context.recentCandidateKeys ?? [])
  ]);
  const recentArtistKeys = [
    ...(context.recentArtistKeys ?? []),
    ...profile.recentArtistKeys
  ].slice(0, 20);

  return candidates
    .flatMap((candidate) => {
      if (excludedCandidateKeys.has(candidate.key)) return [];
      const artistKey = recommendationArtistKey(candidate.artist);
      const artistOccurrences = recentArtistKeys.filter((value) => value === artistKey).length;
      if (artistOccurrences >= 2) return [];

      const trackAffinity = profile.trackAffinity.get(candidate.key) ?? 0;
      const artistAffinity = profile.artistAffinity.get(artistKey) ?? 0;
      const preferenceScore = normalizeAffinity(trackAffinity * 0.7 + artistAffinity * 0.3);
      const reliability = profile.reliability.get(candidate.key) ?? 1;
      const preferredSourceBonus = candidate.source === context.preferredSource ? 0.03 : 0;
      const repeatPenalty = artistOccurrences === 1 ? 0.08 : 0;
      const score =
        clampUnit(candidate.baseScore) * 0.42 +
        preferenceScore * 0.4 +
        clampUnit(reliability) * 0.15 +
        clampUnit(candidate.availabilityScore) * 0.03 +
        preferredSourceBonus -
        repeatPenalty;
      const reasons: RankedRecommendationCandidate["reasons"] = ["base"];
      if (Math.abs(preferenceScore - 0.5) >= 0.04) reasons.push("preference");
      if (reliability < 0.99) reasons.push("reliable");
      if (preferredSourceBonus > 0) reasons.push("preferred-source");
      if (repeatPenalty > 0) reasons.push("artist-repeat");
      return [{ candidate, score, reasons }];
    })
    .sort((left, right) =>
      right.score - left.score ||
      right.candidate.availabilityScore - left.candidate.availabilityScore ||
      left.candidate.key.localeCompare(right.candidate.key)
    );
}

function normalizeAffinity(value: number) {
  return 0.5 + Math.tanh(value / 6) * 0.5;
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
