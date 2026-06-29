import { describe, expect, it } from "vitest";
import {
  chunkIndexForPlaybackPosition,
  getRequiredDecodablePrefixChunkCount,
  resolveSlidingWindowChunkOrder
} from "./playback-window-scheduler";

const manifest = {
  durationMs: 120_000,
  totalChunks: 120,
  chunkSize: 128 * 1024
};

describe("sliding window scheduler", () => {
  it("maps playback time to the chunk covering that time", () => {
    expect(chunkIndexForPlaybackPosition(manifest, 0)).toBe(0);
    expect(chunkIndexForPlaybackPosition(manifest, 59_999)).toBe(59);
    expect(chunkIndexForPlaybackPosition(manifest, 120_000)).toBe(119);
  });

  it("calculates the decode prefix needed to play through a startup window", () => {
    expect(
      getRequiredDecodablePrefixChunkCount({
        manifest,
        playbackPositionMs: 60_000,
        lookAheadMs: 8_000
      })
    ).toBe(69);
  });

  it("requests the current playback window before background chunks", () => {
    const order = resolveSlidingWindowChunkOrder({
      manifest,
      playbackPositionMs: 60_000,
      availableChunks: [60, 61, 90],
      pendingChunks: [62],
      lookBehindMs: 2_000,
      startupLookAheadMs: 8_000,
      steadyLookAheadMs: 30_000,
      limit: 12
    });

    expect(order.slice(0, 8)).toEqual([58, 59, 63, 64, 65, 66, 67, 68]);
    expect(order).not.toContain(60);
    expect(order).not.toContain(61);
    expect(order).not.toContain(62);
    expect(order).not.toContain(90);
  });

  it("can reserve leading header chunks before the active playback window", () => {
    const order = resolveSlidingWindowChunkOrder({
      manifest,
      playbackPositionMs: 60_000,
      availableChunks: [],
      pendingChunks: [],
      requiredLeadingChunkCount: 1,
      lookBehindMs: 2_000,
      startupLookAheadMs: 8_000,
      steadyLookAheadMs: 30_000,
      limit: 6
    });

    expect(order).toEqual([0, 58, 59, 60, 61, 62]);
  });
});
