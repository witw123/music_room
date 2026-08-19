import type { ProviderPlaylistSummary, ProviderTrackCandidate } from "@music-room/shared";
import { rankRecommendationCandidates, isRecommendationCandidateExcluded, partitionDiscoveryRecommendations, rerankRecommendationCandidates, selectPersonalizedPlaylists, trackIdentity } from "./recommendation-engine";
import { buildTopArtists } from "./personalization.service";

describe("personalization helpers", () => {
  it("counts one artist play for one persisted playback session", () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const artists = buildTopArtists([
      { eventType: "playback", entityKind: "track", entityKey: "netease:1", provider: "netease", title: "Song A", artist: "Artist A", album: null, weight: 1, listenedMs: BigInt(180_000), occurredAt: now, updatedAt: now },
      { eventType: "playback", entityKind: "track", entityKey: "netease:2", provider: "netease", title: "Song B", artist: "Artist A", album: null, weight: 1, listenedMs: BigInt(120_000), occurredAt: now, updatedAt: now },
      { eventType: "playback", entityKind: "track", entityKey: "qqmusic:3", provider: "qqmusic", title: "Song C", artist: "Artist B", album: null, weight: 1, listenedMs: BigInt(60_000), occurredAt: now, updatedAt: now }
    ], []);

    expect(artists.find((artist) => artist.name === "Artist A")).toEqual(expect.objectContaining({ playCount: 2, listenedMs: 300_000 }));
    expect(artists.find((artist) => artist.name === "Artist B")).toEqual(expect.objectContaining({ playCount: 1, listenedMs: 60_000 }));
  });

  it("excludes a listened song even when another provider returns it", () => {
    const candidate = track({ provider: "qqmusic", providerTrackId: "qq-2", title: "Same Song", artist: "Same Artist" });
    const listenedIdentity = trackIdentity({ title: "Same Song", artist: "Same Artist" });

    expect(isRecommendationCandidateExcluded(candidate, new Set(), new Set([listenedIdentity]), new Set())).toBe(true);
  });

  it("keeps playlist recommendations from being dominated by one creator", () => {
    const playlists = [
      playlist("1", "Creator A"),
      playlist("2", "Creator A"),
      playlist("3", "Creator A"),
      playlist("4", "Creator B")
    ];

    expect(selectPersonalizedPlaylists({ playlists, entities: [], limit: 4, scoreEntity: () => 0 }).map((item) => item.providerPlaylistId)).toEqual(["1", "2", "4"]);
  });

  it("reranks multiple interests instead of filling the rail with one artist", () => {
    const candidates = [
      recommendation("A1", "Artist A", "genre:pop", "artist", 0.95),
      recommendation("A2", "Artist A", "genre:pop", "artist", 0.94),
      recommendation("A3", "Artist A", "genre:pop", "artist", 0.93),
      recommendation("B1", "Artist B", "genre:rnb", "explore", 0.81),
      recommendation("C1", "Artist C", "genre:rock", "related", 0.8),
      recommendation("D1", "Artist D", "genre:electronic", "explore", 0.79),
      recommendation("E1", "Artist E", "genre:folk", "playlist", 0.77)
    ];
    const ranked = rankRecommendationCandidates({
      candidates,
      entities: [],
      events: [],
      excludedTracks: new Set(),
      excludedIdentities: new Set(),
      excludedArtists: new Set(),
      surface: "discover",
      scoreEntity: () => 0
    });
    const selected = rerankRecommendationCandidates({ items: ranked, limit: 5, explorationRatio: 0.2 });
    const artists = selected.map((item) => item.artist);

    expect(new Set(artists).size).toBeGreaterThanOrEqual(4);
    expect(artists.slice(0, 2)).not.toEqual(["Artist A", "Artist A"]);
    expect(selected.filter((item) => item.reasons.includes("发现新艺人")).length).toBeGreaterThanOrEqual(1);
  });

  it("partitions the discovery pool into distinct Spotify-style surfaces", () => {
    const candidates = [
      ...Array.from({ length: 16 }, (_, index) => recommendation(`General ${index}`, `General Artist ${index}`, `related:${index}`, "related", 0.9 - index / 100)),
      ...Array.from({ length: 8 }, (_, index) => recommendation(`Artist ${index}`, `Known Artist ${index % 3}`, `artist:${index % 3}`, "artist", 0.82 - index / 100)),
      ...Array.from({ length: 8 }, (_, index) => recommendation(`Explore ${index}`, `Explore Artist ${index}`, `explore:${index}`, "explore", 0.78 - index / 100))
    ];
    const ranked = rankRecommendationCandidates({
      candidates,
      entities: [],
      events: [],
      excludedTracks: new Set(),
      excludedIdentities: new Set(),
      excludedArtists: new Set(),
      surface: "discover",
      scoreEntity: () => 0
    });
    const sections = partitionDiscoveryRecommendations(ranked, 5);
    const keys = [
      ...sections.forYou,
      ...sections.familiarArtists,
      ...sections.moodDiscovery,
      ...sections.deepCuts
    ].map((item) => `${item.provider}:${item.providerTrackId}`);

    expect(sections.forYou.length).toBeGreaterThan(0);
    expect(sections.familiarArtists.length).toBeGreaterThan(0);
    expect(sections.moodDiscovery.length).toBeGreaterThan(0);
    expect(sections.deepCuts.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("caps each artist at two tracks while other artists are available", () => {
    const candidates = [
      ...Array.from({ length: 8 }, (_, index) => recommendation(`A${index}`, "Artist A", `a:${index}`, "artist", 1 - index / 100)),
      ...Array.from({ length: 4 }, (_, index) => recommendation(`B${index}`, "Artist B", `b:${index}`, "related", 0.8 - index / 100)),
      ...Array.from({ length: 4 }, (_, index) => recommendation(`C${index}`, "Artist C", `c:${index}`, "explore", 0.75 - index / 100))
    ];
    const ranked = rankRecommendationCandidates({
      candidates,
      entities: [],
      events: [],
      excludedTracks: new Set(),
      excludedIdentities: new Set(),
      excludedArtists: new Set(),
      surface: "discover",
      scoreEntity: () => 0
    });
    const selected = rerankRecommendationCandidates({ items: ranked, limit: 6, explorationRatio: 0, maxPerArtist: 2 });
    const counts = selected.reduce((result, item) => result.set(item.artist, (result.get(item.artist) ?? 0) + 1), new Map<string, number>());

    expect(counts.get("Artist A")).toBeLessThanOrEqual(2);
    expect(new Set(selected.map((item) => item.artist)).size).toBeGreaterThanOrEqual(3);
  });
});

function track(input: Pick<ProviderTrackCandidate, "provider" | "providerTrackId" | "title" | "artist">): ProviderTrackCandidate {
  return {
    ...input,
    access: "free",
    quality: null,
    album: null,
    durationMs: 180_000,
    artworkUrl: null
  } as ProviderTrackCandidate;
}

function playlist(providerPlaylistId: string, creatorName: string): ProviderPlaylistSummary & { score: number; reasons: string[] } {
  return {
    provider: "netease",
    providerPlaylistId,
    title: `Playlist ${providerPlaylistId}`,
    description: null,
    tags: [],
    artworkUrl: null,
    creatorName,
    trackCount: 20,
    score: 1,
    reasons: ["为你挑选"]
  };
}

function recommendation(title: string, artist: string, interestKey: string, source: "artist" | "explore" | "related" | "playlist", baseScore: number) {
  return {
    candidate: track({ provider: "netease", providerTrackId: title, title, artist }),
    source,
    baseScore,
    interestKey,
    interestLabel: interestKey.split(":")[1] ?? null
  };
}
