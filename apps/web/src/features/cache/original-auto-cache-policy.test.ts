import { describe, expect, it } from "vitest";
import { shouldPauseOriginalAutoCache, shouldStartOriginalAutoCache } from "./original-auto-cache-policy";

const healthy = {
  playbackBufferedMs: 30_000,
  completePlaybackProviderCount: 2,
  throughputKbps: 900,
  rttP95Ms: 200,
  playbackChannelBufferedBytes: 0,
  deadlineMissesLast30s: 0,
  availableStorageBytes: 1024 * 1024 * 1024,
  originalSizeBytes: 100 * 1024 * 1024
};

describe("original auto-cache policy", () => {
  it("starts only when playback and storage have explicit headroom", () => {
    expect(shouldStartOriginalAutoCache(healthy)).toBe(true);
    expect(shouldStartOriginalAutoCache({ ...healthy, playbackBufferedMs: 29_999 })).toBe(false);
    expect(shouldStartOriginalAutoCache({ ...healthy, completePlaybackProviderCount: 1 })).toBe(false);
    expect(shouldStartOriginalAutoCache({ ...healthy, throughputKbps: 767 })).toBe(false);
  });

  it("pauses before bulk traffic can consume the protected playback window", () => {
    expect(shouldPauseOriginalAutoCache(healthy)).toBe(false);
    expect(shouldPauseOriginalAutoCache({ ...healthy, playbackBufferedMs: 19_999 })).toBe(true);
    expect(shouldPauseOriginalAutoCache({ ...healthy, deadlineMissesLast30s: 1 })).toBe(true);
  });
});
