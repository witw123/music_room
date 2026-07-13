import { describe, expect, it } from "vitest";
import { decodeAssetUnitFrame, encodeAssetUnitFrames } from "./asset-frame-codec";

describe("P2P v4 asset frames", () => {
  it("keeps every data channel message below 64 KiB and preserves descriptors", () => {
    const payload = new Uint8Array(1024 * 1024).fill(7).buffer;
    const frames = encodeAssetUnitFrames({
      streamId: "stream",
      generation: 0,
      descriptor: {
        assetId: "a".repeat(64),
        kind: "original",
        unitIndex: 0,
        payloadBytes: payload.byteLength,
        contentHash: "b".repeat(64),
        proof: [{ position: "right", hash: "c".repeat(64) }]
      },
      payload
    });
    expect(frames.length).toBeGreaterThan(1);
    expect(Math.max(...frames.map((frame) => frame.byteLength))).toBeLessThanOrEqual(64 * 1024);
    expect(decodeAssetUnitFrame(frames[0]!).header.descriptor).toMatchObject({
      assetId: "a".repeat(64),
      unitIndex: 0
    });
  });
});
