import { describe, expect, it } from "vitest";
import {
  cachePolicy,
  enableCacheOnlyPlayback,
  enableManualTrackCaching,
  enableTrackCaching
} from "./cache-policy";

describe("cachePolicy", () => {
  it("exposes the enabled cache playback feature flags", () => {
    expect(cachePolicy).toEqual({
      manualTrackCaching: true,
      automaticLocalPlaybackTakeover: true,
      cacheOnlyPlayback: true
    });
    expect(enableManualTrackCaching).toBe(true);
    expect(enableTrackCaching).toBe(true);
    expect(enableCacheOnlyPlayback).toBe(true);
  });
});
