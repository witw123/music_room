import { describe, expect, it, vi } from "vitest";
import { createDataMeshBridge } from "./use-room-data-mesh";

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
