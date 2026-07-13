import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSegmentedPlaybackFailureSnapshot } from "./use-segmented-opus-playback";

const current = {
  state: "live" as const,
  bufferedMs: 8_000,
  ownedUnitCount: 5,
  totalUnitCount: 80,
  audioContextState: "running" as const,
  lastError: null
};

describe("segmented playback recovery", () => {
  it("keeps a decode failure recoverable while AudioContext is running", () => {
    expect(buildSegmentedPlaybackFailureSnapshot({
      current,
      totalUnitCount: 160,
      audioContextState: "running",
      error: new Error("decode failed")
    })).toMatchObject({
      state: "buffering",
      totalUnitCount: 160,
      audioContextState: "running",
      lastError: "decode failed"
    });
  });

  it("re-enters unlock flow when the context was suspended", () => {
    expect(buildSegmentedPlaybackFailureSnapshot({
      current,
      totalUnitCount: 160,
      audioContextState: "suspended",
      error: "failure"
    })).toMatchObject({
      state: "awaiting-unlock",
      lastError: "分段音频读取或解码失败"
    });
  });

  it("drops the failed engine so the next tick creates a fresh instance", () => {
    const source = readFileSync(new URL("./use-segmented-opus-playback.ts", import.meta.url), "utf8");

    expect(source).toContain("engineRef.current = null");
    expect(source).toContain("failedEngine?.destroy()");
    expect(source).toContain("engineRef.current ??= new SegmentedOpusEngine()");
    expect(source).toContain("storedManifestAssetIdRef.current = null");
  });
});
