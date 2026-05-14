import { describe, expect, it } from "vitest";
import { shouldMaintainCachedPlaybackSurface } from "./room-playback-policy";

describe("room playback policy", () => {
  it("maintains playback only for local cached sources", () => {
    expect(
      shouldMaintainCachedPlaybackSurface({
        currentTrackId: "track_1",
        hasLocalSource: true
      })
    ).toBe(true);
    expect(
      shouldMaintainCachedPlaybackSurface({
        currentTrackId: "track_1",
        hasLocalSource: false
      })
    ).toBe(false);
  });
});
