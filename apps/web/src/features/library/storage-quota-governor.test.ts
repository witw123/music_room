import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStorageQuotaEstimate,
  purgeStaleCachedTracks
} from "./storage-quota-governor";
import * as indexeddb from "./indexeddb";

vi.mock("./indexeddb", () => ({
  deleteCachedLibraryTrack: vi.fn(),
  listCachedLibraryTrackSummaries: vi.fn()
}));

describe("storage-quota-governor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getStorageQuotaEstimate", () => {
    it("aggregates storage estimates and cached track sizes", async () => {
      vi.stubGlobal("navigator", {
        storage: {
          estimate: vi.fn().mockResolvedValue({
            usage: 50 * 1024 * 1024,
            quota: 500 * 1024 * 1024
          })
        }
      });

      vi.mocked(indexeddb.listCachedLibraryTrackSummaries).mockResolvedValue([
        { fileHash: "hash-1", sizeBytes: 10 * 1024 * 1024 } as any,
        { fileHash: "hash-2", sizeBytes: 20 * 1024 * 1024 } as any
      ]);

      const result = await getStorageQuotaEstimate();
      expect(result.usageBytes).toBe(50 * 1024 * 1024);
      expect(result.quotaBytes).toBe(500 * 1024 * 1024);
      expect(result.usagePercentage).toBe(10);
      expect(result.cachedTrackCount).toBe(2);
      expect(result.cachedTrackBytes).toBe(30 * 1024 * 1024);

      vi.unstubAllGlobals();
    });
  });

  describe("purgeStaleCachedTracks", () => {
    it("purges tracks in LRU order (oldest cachedAt first)", async () => {
      vi.mocked(indexeddb.listCachedLibraryTrackSummaries).mockResolvedValue([
        {
          fileHash: "hash-new",
          sizeBytes: 1000,
          cachedAt: "2026-10-10T12:00:00Z"
        } as any,
        {
          fileHash: "hash-old",
          sizeBytes: 2000,
          cachedAt: "2026-10-01T12:00:00Z"
        } as any
      ]);

      const result = await purgeStaleCachedTracks({ targetFreeBytes: 1500 });
      expect(result.purgedCount).toBe(1);
      expect(result.freedBytes).toBe(2000);
      expect(indexeddb.deleteCachedLibraryTrack).toHaveBeenCalledWith("hash-old");
      expect(indexeddb.deleteCachedLibraryTrack).not.toHaveBeenCalledWith("hash-new");
    });

    it("respects preserveFavoriteKeys and excludedFileHashes", async () => {
      vi.mocked(indexeddb.listCachedLibraryTrackSummaries).mockResolvedValue([
        {
          fileHash: "hash-favorite",
          provider: "netease",
          providerTrackId: "fav-1",
          sizeBytes: 1000,
          cachedAt: "2026-09-01T12:00:00Z"
        } as any,
        {
          fileHash: "hash-excluded",
          provider: "qqmusic",
          providerTrackId: "ex-1",
          sizeBytes: 1000,
          cachedAt: "2026-09-02T12:00:00Z"
        } as any,
        {
          fileHash: "hash-purgeable",
          provider: "bilibili",
          providerTrackId: "bv-1",
          sizeBytes: 3000,
          cachedAt: "2026-09-03T12:00:00Z"
        } as any
      ]);

      const result = await purgeStaleCachedTracks({
        preserveFavoriteKeys: new Set(["netease:fav-1"]),
        excludedFileHashes: new Set(["hash-excluded"])
      });

      expect(result.purgedCount).toBe(1);
      expect(result.freedBytes).toBe(3000);
      expect(indexeddb.deleteCachedLibraryTrack).toHaveBeenCalledWith("hash-purgeable");
      expect(indexeddb.deleteCachedLibraryTrack).not.toHaveBeenCalledWith("hash-favorite");
      expect(indexeddb.deleteCachedLibraryTrack).not.toHaveBeenCalledWith("hash-excluded");
    });
  });
});
