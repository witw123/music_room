import type {
  RecommendationEvent,
  RecommendationFeedbackType,
  RecommendationProfile
} from "./recommendation-types";

const profileRetentionDays = 180;
const profileHalfLifeDays = 60;
const recentPlaybackLimit = 20;

const feedbackWeights: Record<Exclude<RecommendationFeedbackType, "unavailable">, number> = {
  favorite: 6,
  "manual-selection": 4,
  completion: 2,
  "quick-skip": -5,
  dismissed: -6
};

export function buildRecommendationProfile(
  userId: string,
  events: RecommendationEvent[],
  now = Date.now()
): RecommendationProfile {
  const trackAffinity = new Map<string, number>();
  const artistAffinity = new Map<string, number>();
  const reliabilityFailures = new Map<string, number>();
  const recentCandidateKeys: string[] = [];
  const recentArtistKeys: string[] = [];
  const minimumOccurredAt = now - profileRetentionDays * 24 * 60 * 60 * 1_000;

  for (const event of events
    .filter((item) => item.userId === userId && item.occurredAt >= minimumOccurredAt)
    .slice()
    .sort((left, right) => right.occurredAt - left.occurredAt)) {
    const ageDays = Math.max(0, now - event.occurredAt) / (24 * 60 * 60 * 1_000);
    const decay = Math.pow(0.5, ageDays / profileHalfLifeDays);

    if (event.eventType === "unavailable") {
      reliabilityFailures.set(
        event.candidate.key,
        (reliabilityFailures.get(event.candidate.key) ?? 0) + decay
      );
      continue;
    }

    const weight = feedbackWeights[event.eventType] * decay;
    trackAffinity.set(event.candidate.key, (trackAffinity.get(event.candidate.key) ?? 0) + weight);
    artistAffinity.set(event.artistKey, (artistAffinity.get(event.artistKey) ?? 0) + weight * 0.55);

    if (event.eventType === "completion" || event.eventType === "quick-skip") {
      addRecent(recentCandidateKeys, event.candidate.key, recentPlaybackLimit);
      addRecent(recentArtistKeys, event.artistKey, recentPlaybackLimit);
    }
  }

  const reliability = new Map<string, number>();
  for (const [candidateKey, failures] of reliabilityFailures) {
    reliability.set(candidateKey, 1 / (1 + failures * 0.75));
  }

  return {
    userId,
    trackAffinity,
    artistAffinity,
    reliability,
    recentCandidateKeys,
    recentArtistKeys
  };
}

function addRecent(values: string[], value: string, limit: number) {
  if (!value || values.includes(value) || values.length >= limit) return;
  values.push(value);
}
