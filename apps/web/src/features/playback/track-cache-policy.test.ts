import { describe, expect, it } from "vitest";
import {
  canUseUploadedTrackForPlayback,
  enableTrackCaching,
  getPlayableUploadedTrack,
  isCacheBackedUploadedTrack
} from "./track-cache-policy";

describe("track-cache-policy", () => {
  it("keeps cache-backed assets disabled while caching is paused", () => {
    expect(enableTrackCaching).toBe(false);
    expect(
      canUseUploadedTrackForPlayback({
        file: new File(["cache"], "cache.mp3", { type: "audio/mpeg" }),
        objectUrl: "blob:cache",
        origin: "restored-cache"
      })
    ).toBe(false);
    expect(
      canUseUploadedTrackForPlayback({
        file: new File(["cache"], "cache.mp3", { type: "audio/mpeg" }),
        objectUrl: "blob:cache",
        origin: "hydrated-cache"
      })
    ).toBe(false);
  });

  it("still allows the current live upload source to play locally", () => {
    const liveUpload = {
      file: new File(["live"], "live.mp3", { type: "audio/mpeg" }),
      objectUrl: "blob:live",
      origin: "live-upload" as const
    };

    expect(canUseUploadedTrackForPlayback(liveUpload)).toBe(true);
    expect(getPlayableUploadedTrack(liveUpload)).toBe(liveUpload);
  });

  it("identifies cache-backed local assets by origin", () => {
    expect(
      isCacheBackedUploadedTrack({
        file: new File(["cache"], "cache.mp3", { type: "audio/mpeg" }),
        objectUrl: "blob:cache",
        origin: "hydrated-cache"
      })
    ).toBe(true);
    expect(
      isCacheBackedUploadedTrack({
        file: new File(["live"], "live.mp3", { type: "audio/mpeg" }),
        objectUrl: "blob:live",
        origin: "live-upload"
      })
    ).toBe(false);
  });
});
