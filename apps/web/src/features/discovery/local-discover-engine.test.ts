import { beforeEach, describe, expect, it, vi } from "vitest";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { generateLocalDiscoveryRecommendations } from "./local-discover-engine";

vi.mock("@/features/favorites/use-favorite-tracks", () => ({
  favoriteTrackToCandidate: vi.fn()
}));
vi.mock("@/features/playlist/local-playlist", () => ({
  listMergedLocalPlaylistTracks: vi.fn().mockResolvedValue([])
}));
vi.mock("@/lib/network/music-room-api", () => ({
  musicRoomApi: {
    listFavoriteTracks: vi.fn(),
    listMyPlaylists: vi.fn(),
    getBilibiliRanking: vi.fn()
  }
}));

describe("discovery background cancellation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not start requests for an already hidden page", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(generateLocalDiscoveryRecommendations({ signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(musicRoomApi.listFavoriteTracks).not.toHaveBeenCalled();
    expect(musicRoomApi.listMyPlaylists).not.toHaveBeenCalled();
    expect(musicRoomApi.getBilibiliRanking).not.toHaveBeenCalled();
  });

  it("aborts all network inputs without publishing partial recommendations", async () => {
    const controller = new AbortController();
    const aborted = vi.fn();
    const pending = (signal?: AbortSignal) => new Promise<never>((_, reject) => {
      signal?.addEventListener("abort", () => {
        aborted();
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
    vi.mocked(musicRoomApi.listFavoriteTracks).mockImplementation(pending);
    vi.mocked(musicRoomApi.listMyPlaylists).mockImplementation(pending);
    vi.mocked(musicRoomApi.getBilibiliRanking).mockImplementation((_, signal) => pending(signal));

    const result = generateLocalDiscoveryRecommendations({ signal: controller.signal });
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(aborted).toHaveBeenCalledTimes(3);
  });
});
