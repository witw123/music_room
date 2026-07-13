import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssetAvailabilityAnnouncement,
  AssetStreamMessage,
  AssetUnitDescriptor
} from "@music-room/shared";
import { encodeAssetUnitFrames } from "./asset-frame-codec";
import { AssetTransferManager } from "./asset-transfer-manager";

const assetId = "a".repeat(64);

function announcement(peerId: string): AssetAvailabilityAnnouncement {
  return {
    protocolVersion: 4,
    roomId: "room_1",
    assetId,
    assetKind: "playback",
    ownerPeerId: peerId,
    nickname: peerId,
    totalUnits: 1,
    availableRanges: [{ start: 0, end: 0 }],
    complete: true,
    source: "local_cache",
    announcedAt: "2026-07-13T00:00:00.000Z"
  };
}

function descriptor(payload: ArrayBuffer): AssetUnitDescriptor {
  return {
    assetId,
    kind: "playback",
    unitIndex: 0,
    payloadBytes: payload.byteLength,
    contentHash: "b".repeat(64),
    proof: [],
    startMs: 0,
    durationMs: 2_000,
    trimStartSamples: 0,
    trimEndSamples: 0
  };
}

function createReceiver(options?: {
  persistInboundUnit?: () => Promise<void>;
  onStreamReset?: (input: { peerId: string; assetId: string; unitIndexes: number[]; reason: string }) => void;
}) {
  const controls: Array<{ peerId: string; message: AssetStreamMessage }> = [];
  const persistInboundUnit = vi.fn(options?.persistInboundUnit ?? (async () => undefined));
  const manager = new AssetTransferManager({
    sendControl: (peerId, message) => controls.push({ peerId, message }),
    sendBinary: vi.fn(),
    resolveLocalUnit: async () => null,
    persistInboundUnit: async () => persistInboundUnit(),
    onStreamReset: options?.onStreamReset
  });
  return { manager, controls, persistInboundUnit };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AssetTransferManager", () => {
  it("requests critical units redundantly and cancels the slower copy after persistence", async () => {
    const { manager, controls, persistInboundUnit } = createReceiver();
    manager.setProvider(announcement("peer_a"));
    manager.setProvider(announcement("peer_b"));

    expect(manager.request({
      assetId,
      assetKind: "playback",
      unitIndexes: [0],
      totalUnits: 1,
      priority: "critical",
      maxReplicas: 2
    })).toBe(true);

    const opens = controls.filter(({ message }) => message.kind === "asset-stream-open");
    expect(opens).toHaveLength(2);
    const first = opens.find(({ peerId }) => peerId === "peer_a")!;
    const payload = new Uint8Array([1, 2, 3]).buffer;
    for (const frame of encodeAssetUnitFrames({
      streamId: first.message.streamId,
      generation: first.message.generation,
      descriptor: descriptor(payload),
      payload
    })) {
      await manager.handleChannelMessage("peer_a", frame);
    }

    expect(persistInboundUnit).toHaveBeenCalledTimes(1);
    expect(controls).toContainEqual({
      peerId: "peer_b",
      message: expect.objectContaining({
        kind: "asset-stream-reset",
        reason: "superseded"
      })
    });
  });

  it("resets stalled requests after five seconds and reassigns them to another provider", async () => {
    vi.useFakeTimers();
    const onStreamReset = vi.fn();
    const { manager, controls } = createReceiver({ onStreamReset });
    manager.setProvider(announcement("peer_a"));
    manager.setProvider(announcement("peer_b"));
    manager.request({
      assetId,
      assetKind: "playback",
      unitIndexes: [0],
      totalUnits: 1,
      priority: "playback-fill"
    });

    vi.advanceTimersByTime(5_001);
    await Promise.resolve();

    expect(onStreamReset).toHaveBeenCalledWith(expect.objectContaining({
      peerId: "peer_a",
      unitIndexes: [0],
      reason: "timeout"
    }));
    expect(controls).toContainEqual({
      peerId: "peer_b",
      message: expect.objectContaining({ kind: "asset-stream-open" })
    });
  });

  it("retries a sole provider after a temporary timeout cooldown", async () => {
    vi.useFakeTimers();
    const { manager, controls } = createReceiver();
    manager.setProvider(announcement("peer_a"));
    manager.request({
      assetId,
      assetKind: "playback",
      unitIndexes: [0],
      totalUnits: 1,
      priority: "playback-fill"
    });

    vi.advanceTimersByTime(5_001);
    await Promise.resolve();
    expect(controls.filter(({ message }) => message.kind === "asset-stream-open")).toHaveLength(1);

    vi.advanceTimersByTime(2_001);
    expect(manager.request({
      assetId,
      assetKind: "playback",
      unitIndexes: [0],
      totalUnits: 1,
      priority: "playback-fill"
    })).toBe(true);
    expect(controls.filter(({ message }) => message.kind === "asset-stream-open")).toHaveLength(2);
  });

  it("removes a provider after two consecutive integrity failures", async () => {
    const { manager, controls } = createReceiver({
      persistInboundUnit: async () => {
        throw new Error("Asset unit failed Merkle verification.");
      }
    });
    manager.setProvider(announcement("peer_a"));
    manager.request({
      assetId,
      assetKind: "playback",
      unitIndexes: [0],
      totalUnits: 1,
      priority: "critical"
    });
    const open = controls.find(({ message }) => message.kind === "asset-stream-open")!;
    const payload = new Uint8Array([9]).buffer;
    const frames = encodeAssetUnitFrames({
      streamId: open.message.streamId,
      generation: open.message.generation,
      descriptor: descriptor(payload),
      payload
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      for (const frame of frames) {
        await manager.handleChannelMessage("peer_a", frame);
      }
    }

    expect(manager.request({
      assetId,
      assetKind: "playback",
      unitIndexes: [0],
      totalUnits: 1,
      priority: "critical"
    })).toBe(false);
    expect(controls).toContainEqual({
      peerId: "peer_a",
      message: expect.objectContaining({
        kind: "asset-stream-reset",
        reason: "protocol-error"
      })
    });
  });

  it("waits for receiver credit before sending a unit larger than the initial window", async () => {
    const binary = vi.fn();
    const payload = new Uint8Array(600 * 1024).buffer;
    const manager = new AssetTransferManager({
      sendControl: vi.fn(),
      sendBinary: binary,
      resolveLocalUnit: async () => ({ descriptor: descriptor(payload), payload }),
      persistInboundUnit: async () => undefined
    });
    const open: AssetStreamMessage = {
      kind: "asset-stream-open",
      protocolVersion: 4,
      streamId: "stream_1",
      assetId,
      assetKind: "playback",
      generation: 0,
      priority: "critical",
      ranges: [{ start: 0, end: 0 }],
      initialCreditBytes: 512 * 1024
    };
    await manager.handleChannelMessage("peer_a", JSON.stringify(open));
    expect(binary).not.toHaveBeenCalled();

    await manager.handleChannelMessage("peer_a", JSON.stringify({
      kind: "asset-stream-credit",
      protocolVersion: 4,
      streamId: "stream_1",
      generation: 0,
      unitIndex: 0,
      creditBytes: 128 * 1024
    }));

    expect(binary).toHaveBeenCalled();
  });

  it("drops malformed control and binary frames without throwing", async () => {
    const { manager } = createReceiver();

    await expect(manager.handleChannelMessage("peer_a", "{not-json")).resolves.toBe(false);
    await expect(
      manager.handleChannelMessage("peer_a", new Uint8Array([0x4d, 0x52, 0x55, 0x34, 0x00]).buffer)
    ).resolves.toBe(false);
  });
});
