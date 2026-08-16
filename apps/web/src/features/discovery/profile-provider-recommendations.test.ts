import { describe, expect, it } from "vitest";
import type { RecommendationProfile } from "@/features/recommendations/recommendation-types";
import { rankDiscoverTrackCandidates, type DiscoverRecallTrack } from "./profile-provider-recommendations";

const neutralProfile: RecommendationProfile = {
  userId: "user_1",
  trackAffinity: new Map(),
  artistAffinity: new Map(),
  reliability: new Map(),
  recentCandidateKeys: [],
  recentArtistKeys: []
};

describe("profile provider recommendations", () => {
  it("keeps the more available result when platforms return the same song", () => {
    const ranked = rankDiscoverTrackCandidates([
      track("netease", "paid", "paid", 0.86, "related"),
      track("qqmusic", "free", "free", 0.64, "artist")
    ], neutralProfile, new Set());

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.candidate.provider).toBe("qqmusic");
  });

  it("does not return recently heard profile tracks", () => {
    const ranked = rankDiscoverTrackCandidates([
      track("netease", "recent", "free", 0.86, "related"),
      track("qqmusic", "new", "free", 0.64, "artist")
    ], neutralProfile, new Set(["netease:recent"]));

    expect(ranked.map((item) => item.candidate.providerTrackId)).toEqual(["new"]);
  });
});

function track(
  provider: "netease" | "qqmusic",
  providerTrackId: string,
  access: "free" | "paid",
  baseScore: number,
  source: DiscoverRecallTrack["source"]
): DiscoverRecallTrack {
  return {
    candidate: {
      provider,
      providerTrackId,
      access,
      quality: null,
      title: "同一首歌",
      artist: "同一位歌手",
      album: null,
      durationMs: 180_000,
      artworkUrl: null
    } as DiscoverRecallTrack["candidate"],
    source,
    baseScore
  };
}
