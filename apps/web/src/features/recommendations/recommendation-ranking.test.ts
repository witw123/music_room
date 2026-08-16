import { describe, expect, it } from "vitest";
import { buildRecommendationProfile } from "./recommendation-profile";
import { rankRecommendationCandidates } from "./recommendation-ranking";
import type { RecommendationCandidate, RecommendationEvent } from "./recommendation-types";

const now = Date.UTC(2026, 7, 16, 12, 0, 0);

describe("recommendation profile and ranking", () => {
  it("keeps profiles isolated and boosts explicit positive feedback", () => {
    const profile = buildRecommendationProfile("host_1", [
      event("host_1", "favorite", "netease:liked", "Liked Artist"),
      event("other_user", "favorite", "netease:other", "Other Artist")
    ], now);

    const ranked = rankRecommendationCandidates([
      candidate("netease:liked", "Liked Artist", 0.6),
      candidate("netease:neutral", "Neutral Artist", 0.9)
    ], profile);

    expect(ranked.map((item) => item.candidate.key)).toEqual([
      "netease:liked",
      "netease:neutral"
    ]);
    expect(profile.trackAffinity.has("netease:other")).toBe(false);
  });

  it("uses negative feedback for ranking and import reliability", () => {
    const profile = buildRecommendationProfile("host_1", [
      event("host_1", "dismissed", "netease:skip", "Skip Artist"),
      event("host_1", "unavailable", "netease:unavailable", "Unavailable Artist")
    ], now);

    const ranked = rankRecommendationCandidates([
      candidate("netease:skip", "Skip Artist", 0.9),
      candidate("netease:unavailable", "Unavailable Artist", 0.9),
      candidate("netease:neutral", "Neutral Artist", 0.75)
    ], profile);

    expect(ranked.at(-1)?.candidate.key).toBe("netease:skip");
    expect(profile.reliability.get("netease:unavailable")).toBeLessThan(1);
  });

  it("excludes recent tracks and a third consecutive artist", () => {
    const profile = buildRecommendationProfile("host_1", [
      event("host_1", "completion", "netease:recent", "Recent Artist"),
      event("host_1", "completion", "netease:older", "Older Artist")
    ], now);

    const ranked = rankRecommendationCandidates([
      candidate("netease:recent", "Recent Artist", 0.99),
      candidate("netease:third", "Same Artist", 0.99),
      candidate("netease:allowed", "Different Artist", 0.8)
    ], profile, {
      recentArtistKeys: ["sameartist", "sameartist"]
    });

    expect(ranked.map((item) => item.candidate.key)).toEqual(["netease:allowed"]);
  });
});

function event(
  userId: string,
  eventType: RecommendationEvent["eventType"],
  key: string,
  artist: string
): RecommendationEvent {
  return {
    id: `${userId}:${eventType}:${key}`,
    userId,
    candidate: candidate(key, artist, 0),
    eventType,
    occurredAt: now,
    artistKey: artist.toLocaleLowerCase().replace(/\s/g, "")
  };
}

function candidate(key: string, artist: string, baseScore: number): RecommendationCandidate {
  return {
    key,
    title: key,
    artist,
    source: "netease",
    baseScore,
    availabilityScore: 1
  };
}
