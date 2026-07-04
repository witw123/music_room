import { describe, expect, it, vi } from "vitest";
import {
  createBoundedCachedLibraryTrackCache,
  createDataMeshBridge
} from "./use-room-data-mesh";

describe("createBoundedCachedLibraryTrackCache", () => {
  it("reuses recent cached-library records and evicts older full-file entries", () => {
    const cache = createBoundedCachedLibraryTrackCache<{ fileHash: string; title: string }>(2);
    const first = { fileHash: "hash_1", title: "First" };
    const second = { fileHash: "hash_2", title: "Second" };
    const third = { fileHash: "hash_3", title: "Third" };

    cache.set(first);
    cache.set(second);
    expect(cache.get("hash_1")).toBe(first);

    cache.set(third);

    expect(cache.get("hash_1")).toBe(first);
    expect(cache.get("hash_2")).toBeNull();
    expect(cache.get("hash_3")).toBe(third);
  });
});

describe("createDataMeshBridge", () => {
  it("reports syncPeers as not started before the mesh runtime exists", async () => {
    const bridge = createDataMeshBridge({ current: null });

    await expect(bridge.syncPeers(["peer_source"])).resolves.toBe(false);
    expect(bridge.isReady()).toBe(false);
  });

  it("returns true when syncPeers reaches the mesh runtime", async () => {
    const syncPeers = vi.fn().mockResolvedValue(undefined);
    const bridge = createDataMeshBridge({
      current: {
        syncPeers,
        restartPeer: vi.fn(),
        requestPieces: vi.fn(),
        getConnectedPeerIds: vi.fn(() => [])
      }
    });

    await expect(bridge.syncPeers(["peer_source"])).resolves.toBe(true);
    expect(syncPeers).toHaveBeenCalledWith(["peer_source"], undefined);
    expect(bridge.isReady()).toBe(true);
  });
});
