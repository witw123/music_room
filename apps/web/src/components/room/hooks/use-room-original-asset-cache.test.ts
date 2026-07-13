import { describe, expect, it } from "vitest";
import { createSHA256 } from "hash-wasm";
import type { TrackMeta } from "@music-room/shared";
import type { AudioAssetUnitRecord } from "@/lib/indexeddb";
import { assembleOriginalAsset } from "./use-room-original-asset-cache";

async function sha256(bytes: Uint8Array) {
  const hasher = await createSHA256();
  hasher.init();
  hasher.update(bytes);
  return hasher.digest("hex");
}

async function fixture() {
  const first = new TextEncoder().encode("hello ");
  const second = new TextEncoder().encode("world");
  const whole = new Uint8Array(first.length + second.length);
  whole.set(first);
  whole.set(second, first.length);
  const assetId = "a".repeat(64);
  const track = {
    id: "track_1",
    title: "Track",
    artist: "Artist",
    mimeType: "audio/flac",
    durationMs: 1_000,
    originalAsset: {
      assetId,
      kind: "original",
      fileHash: await sha256(whole),
      mimeType: "audio/flac",
      sizeBytes: whole.byteLength,
      unitSize: 1_048_576,
      unitCount: 2,
      merkleRoot: "b".repeat(64)
    }
  } as TrackMeta;
  const units = [first, second].map((bytes, unitIndex) => ({
    unitId: `${assetId}:${unitIndex}`,
    assetId,
    kind: "original" as const,
    unitIndex,
    payloadBytes: bytes.byteLength,
    contentHash: "c".repeat(64),
    proof: [],
    payload: bytes.buffer,
    lastAccessedAt: new Date(0).toISOString(),
    protectedUntil: null
  })) satisfies AudioAssetUnitRecord[];
  return { track, units };
}

describe("assembleOriginalAsset", () => {
  it("assembles ordered units and verifies the complete file hash", async () => {
    const { track, units } = await fixture();
    const blob = await assembleOriginalAsset({ track, units: [...units].reverse() });

    expect(blob.type).toBe("audio/flac");
    expect(await blob.text()).toBe("hello world");
  });

  it("rejects a complete-looking asset with a mismatched whole-file hash", async () => {
    const { track, units } = await fixture();
    const corrupted = [
      units[0]!,
      { ...units[1]!, payload: new TextEncoder().encode("WORLD").buffer }
    ];

    await expect(assembleOriginalAsset({ track, units: corrupted }))
      .rejects.toThrow(/whole-file verification/);
  });
});
