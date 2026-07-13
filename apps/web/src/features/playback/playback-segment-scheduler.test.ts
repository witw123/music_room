import { describe, expect, it } from "vitest";
import {
  contiguousPlaybackBufferMs,
  resolvePlaybackUnitOrder,
  resolveStartupUnitIndexes
} from "./playback-segment-scheduler";

const manifest = { segmentDurationMs: 2_000 as const, unitCount: 100, durationMs: 200_000 };

describe("playback segment scheduler", () => {
  it("starts at the current room position instead of requesting a prefix", () => {
    expect(resolvePlaybackUnitOrder({
      manifest,
      positionMs: 60_000,
      ownedUnitIndexes: [],
      requestLimit: 4
    })).toEqual([30, 31, 32, 33]);
  });

  it("measures only contiguous playable time", () => {
    expect(contiguousPlaybackBufferMs({
      manifest,
      positionMs: 61_000,
      ownedUnitIndexes: [30, 31, 33]
    })).toBe(3_000);
  });

  it("requires at least six contiguous seconds before anchoring playback", () => {
    expect(resolveStartupUnitIndexes({ manifest, positionMs: 60_000 })).toEqual([30, 31, 32]);
    expect(resolveStartupUnitIndexes({ manifest, positionMs: 61_000 })).toEqual([30, 31, 32, 33]);
  });
});
