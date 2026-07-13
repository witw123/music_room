import { describe, expect, it } from "vitest";
import { shouldPauseOriginalAutoCache, shouldStartOriginalAutoCache } from "./original-auto-cache-policy";

const healthy = {
  playbackBufferedMs: 12_000,
  completePlaybackProviderCount: 1,
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
    expect(shouldStartOriginalAutoCache({ ...healthy, playbackBufferedMs: 11_999 })).toBe(false);
    expect(shouldStartOriginalAutoCache({ ...healthy, completePlaybackProviderCount: 0 })).toBe(false);
    expect(shouldStartOriginalAutoCache({ ...healthy, throughputKbps: 511 })).toBe(false);
    expect(shouldStartOriginalAutoCache({ ...healthy, throughputKbps: null, rttP95Ms: null })).toBe(true);
  });

  it("pauses before bulk traffic can consume the protected playback window", () => {
    expect(shouldPauseOriginalAutoCache(healthy)).toBe(false);
    expect(shouldPauseOriginalAutoCache({ ...healthy, playbackBufferedMs: 7_999 })).toBe(true);
    expect(shouldPauseOriginalAutoCache({ ...healthy, deadlineMissesLast30s: 2 })).toBe(true);
    expect(shouldPauseOriginalAutoCache({ ...healthy, throughputKbps: null })).toBe(false);
  });
});
