import { describe, expect, it } from "vitest";
import {
  cachePolicy,
  enableCacheOnlyPlayback,
  enableManualTrackCaching,
  enableTrackCaching
} from "./cache-policy";

describe("cachePolicy", () => {
  it("keeps manual original caching enabled and playback caching disabled", () => {
    expect(cachePolicy).toEqual({
      manualTrackCaching: true,
      automaticLocalPlaybackTakeover: false,
      cacheOnlyPlayback: false
    });
    expect(enableManualTrackCaching).toBe(true);
    expect(enableTrackCaching).toBe(false);
    expect(enableCacheOnlyPlayback).toBe(false);
  });
});
