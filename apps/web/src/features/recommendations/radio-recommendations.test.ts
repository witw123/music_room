import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderTrackCandidate, RoomSnapshot } from "@music-room/shared";
import { getRadioRecommendationCandidates } from "./radio-recommendations";

const api = vi.hoisted(() => ({
  getLastFmSimilarTracks: vi.fn(),
  listNeteaseRelatedPlaylists: vi.fn(),
  listQqMusicRelatedPlaylists: vi.fn(),
  getNeteasePlaylist: vi.fn(),
  getQqMusicPlaylist: vi.fn(),
  searchNeteaseTracks: vi.fn(),
  searchQqMusicTracks: vi.fn()
}));

vi.mock("@/lib/network/music-room-api", () => ({
  musicRoomApi: api
}));

describe("radio recommendation candidates", () => {
  beforeEach(() => {
    api.listNeteaseRelatedPlaylists.mockResolvedValue({ items: [] });
    api.listQqMusicRelatedPlaylists.mockResolvedValue({ items: [] });
    api.getNeteasePlaylist.mockResolvedValue({ tracks: [] });
    api.getQqMusicPlaylist.mockResolvedValue({ tracks: [] });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("falls back to provider search when Last.fm has no result", async () => {
    api.getLastFmSimilarTracks.mockRejectedValue(new Error("recommendation unavailable"));
    api.searchNeteaseTracks.mockImplementation(async (keywords: string) => ({
      items: keywords.includes("Seed Artist")
        ? [track("netease", "n-fallback", "Another Song", "Seed Artist")]
        : []
    }));
    api.searchQqMusicTracks.mockResolvedValue({ items: [] });

    await expect(getRadioRecommendationCandidates({
      userId: "user_1",
      snapshot: snapshot(),
      provider: "netease",
      seed: { title: "Seed", artist: "Seed Artist" }
    })).resolves.toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({ providerTrackId: "n-fallback" })
      })
    ]);
  });

  it("uses an unqueued provider track already in the room as the final fallback", async () => {
    api.getLastFmSimilarTracks.mockResolvedValue(recall([]));
    api.searchNeteaseTracks.mockResolvedValue({ items: [] });
    api.searchQqMusicTracks.mockResolvedValue({ items: [] });

    await expect(getRadioRecommendationCandidates({
      userId: "user_1",
      snapshot: snapshot({
        tracks: [{
          id: "room_track",
          sourceType: "netease",
          sourceRef: { provider: "netease", trackId: "room-provider-track" },
          title: "Another Song",
          artist: "Seed Artist",
          album: "Album",
          durationMs: 180_000,
          artworkUrl: null
        }]
      }),
      provider: "netease",
      seed: { title: "Seed", artist: "Seed Artist" }
    })).resolves.toEqual([
      expect.objectContaining({
        existingRoomTrackId: "room_track",
        candidate: expect.objectContaining({ providerTrackId: "room-provider-track" })
      })
    ]);
  });

  it("keeps a safe candidate when the recent-artist rule filters the ranked list", async () => {
    api.getLastFmSimilarTracks.mockResolvedValue(recall([
      { title: "Next Song", artist: "Same Artist", match: 0.9 }
    ]));
    api.searchNeteaseTracks.mockResolvedValue({
      items: [track("netease", "next", "Next Song", "Same Artist")]
    });
    api.searchQqMusicTracks.mockResolvedValue({ items: [] });

    await expect(getRadioRecommendationCandidates({
      userId: "user_1",
      snapshot: snapshot({
        room: {
          playback: {
            currentTrackId: "current",
            currentQueueItemId: "queue_current"
          }
        },
        tracks: [
          { id: "previous", sourceType: "netease", sourceRef: { provider: "netease", trackId: "previous-provider" }, artist: "Same Artist", title: "Previous" },
          { id: "current", sourceType: "netease", sourceRef: { provider: "netease", trackId: "current-provider" }, artist: "Same Artist", title: "Current" }
        ],
        queue: [
          { id: "queue_previous", trackId: "previous" },
          { id: "queue_current", trackId: "current" }
        ]
      }),
      provider: "netease",
      seed: { title: "Current", artist: "Same Artist" }
    })).resolves.toEqual([
      expect.objectContaining({ candidate: expect.objectContaining({ providerTrackId: "next" }) })
    ]);
  });

  it("prefers a matching candidate from the seed provider", async () => {
    api.getLastFmSimilarTracks.mockResolvedValue(recall([
      { title: "Similar One", artist: "Artist One", match: 0.9 }
    ]));
    api.searchNeteaseTracks.mockResolvedValue({
      items: [track("netease", "n1", "Similar One", "Artist One")]
    });
    api.searchQqMusicTracks.mockResolvedValue({
      items: [track("qqmusic", "q1", "Similar One", "Artist One")]
    });

    await expect(getRadioRecommendationCandidates({
      userId: "user_1",
      snapshot: snapshot(),
      provider: "netease",
      seed: { title: "Seed", artist: "Seed Artist" }
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate: expect.objectContaining({ provider: "netease", providerTrackId: "n1" }),
        lastFmMatch: 0.9,
        providerMatchScore: 1
      })
    ]));
    expect(api.searchQqMusicTracks).toHaveBeenCalled();
  });

  it("prefers a free alternate-provider match over a paid seed-provider match", async () => {
    api.getLastFmSimilarTracks.mockResolvedValue(recall([
      { title: "Similar One", artist: "Artist One", match: 0.9 }
    ]));
    api.searchNeteaseTracks.mockResolvedValue({
      items: [{ ...track("netease", "n1", "Similar One", "Artist One"), access: "paid" }]
    });
    api.searchQqMusicTracks.mockResolvedValue({
      items: [track("qqmusic", "q1", "Similar One", "Artist One")]
    });

    await expect(getRadioRecommendationCandidates({
      userId: "user_1",
      snapshot: snapshot(),
      provider: "netease",
      seed: { title: "Seed", artist: "Seed Artist" }
    })).resolves.toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({ provider: "qqmusic", providerTrackId: "q1", access: "free" })
      }),
      expect.objectContaining({
        candidate: expect.objectContaining({ provider: "netease", providerTrackId: "n1", access: "paid" })
      })
    ]);
  });

  it("uses the alternate provider when the seed provider has no playable match", async () => {
    api.getLastFmSimilarTracks.mockResolvedValue(recall([
      { title: "Similar One", artist: "Artist One", match: 0.9 }
    ]));
    api.searchNeteaseTracks.mockResolvedValue({ items: [] });
    api.searchQqMusicTracks.mockResolvedValue({
      items: [track("qqmusic", "q1", "Similar One", "Artist One")]
    });

    await expect(getRadioRecommendationCandidates({
      userId: "user_1",
      snapshot: snapshot(),
      provider: "netease",
      seed: { title: "Seed", artist: "Seed Artist" }
    })).resolves.toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({ provider: "qqmusic", providerTrackId: "q1" })
      })
    ]);
  });

  it("rejects weak title or artist matches and tracks already queued", async () => {
    api.getLastFmSimilarTracks.mockResolvedValue(recall([
      { title: "Queued", artist: "Artist", match: 0.99 },
      { title: "Different", artist: "Artist", match: 0.95 },
      { title: "Valid", artist: "Artist", match: 0.9 }
    ]));
    api.searchNeteaseTracks.mockImplementation(async (keywords: string) => ({
      items: keywords.startsWith("Queued")
        ? [track("netease", "queued", "Queued", "Artist")]
        : keywords.startsWith("Different")
          ? [track("netease", "different", "Other Name", "Artist")]
          : [track("netease", "valid", "Valid", "Artist")]
    }));
    api.searchQqMusicTracks.mockResolvedValue({ items: [] });

    await expect(getRadioRecommendationCandidates({
      userId: "user_1",
      snapshot: snapshot({
        tracks: [{ id: "track_queued", sourceRef: { provider: "netease", trackId: "queued" } }],
        queue: [{ id: "queue_queued", trackId: "track_queued" }]
      }),
      provider: "netease",
      seed: { title: "Seed", artist: "Seed Artist" }
    })).resolves.toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({ providerTrackId: "valid" })
      })
    ]);
  });
});

function recall(items: Array<{ title: string; artist: string; match: number }>) {
  return {
    seed: { title: "Seed", artist: "Seed Artist" },
    tags: [],
    items
  };
}

function track(
  provider: "netease" | "qqmusic",
  providerTrackId: string,
  title: string,
  artist: string
): ProviderTrackCandidate {
  return {
    provider,
    providerTrackId,
    access: "free",
    quality: "exhigh",
    title,
    artist,
    album: "Album",
    durationMs: 180_000,
    artworkUrl: null
  } as ProviderTrackCandidate;
}

function snapshot(overrides?: Record<string, unknown>) {
  return {
    room: { playback: { currentTrackId: null } },
    tracks: [],
    queue: [],
    ...overrides
  } as unknown as RoomSnapshot;
}
