import { describe, expect, it } from "vitest";
import {
  resolvePureCacheBufferHealth,
  resolvePureCacheMediaConnectionState
} from "./use-progressive-runtime";

describe("pure cache progressive runtime policy", () => {
  it("marks progressive local playback as buffering while startup chunks are missing", () => {
    expect(
      resolvePureCacheBufferHealth({
        activePlaybackSource: "progressive-local",
        startupReady: false,
        aheadBufferedMs: 0,
        fallbackReason: "startup-buffering"
      })
    ).toBe("critical");
    expect(
      resolvePureCacheMediaConnectionState({
        hasTrack: true,
        activePlaybackSource: "progressive-local",
        startupReady: false,
        fallbackReason: "startup-buffering"
      })
    ).toBe("buffering");
  });

  it("treats full local playback as live and healthy", () => {
    expect(
      resolvePureCacheBufferHealth({
        activePlaybackSource: "full-local",
        startupReady: false,
        aheadBufferedMs: 0,
        fallbackReason: "startup-buffering"
      })
    ).toBe("healthy");
    expect(
      resolvePureCacheMediaConnectionState({
        hasTrack: true,
        activePlaybackSource: "full-local",
        startupReady: false,
        fallbackReason: "startup-buffering"
      })
    ).toBe("live");
  });
});
