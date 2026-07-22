import { describe, expect, it } from "vitest";
import { isLocalPlaybackAudible } from "./use-room-derived-state";

describe("local playback audible state", () => {
  it("keeps a quiet but source-ready segment audible", () => {
    expect(isLocalPlaybackAudible({
      state: "live",
      sourceHealth: "source-ready",
      sourceEnergy: 0,
      bufferedMs: 2_000,
      ownedUnitCount: 1,
      totalUnitCount: 10,
      audioContextState: "running",
      lastError: null
    })).toBe(true);
  });

  it("does not report an unavailable source as audible", () => {
    expect(isLocalPlaybackAudible({
      state: "live",
      sourceHealth: "source-silent",
      sourceEnergy: 0.4,
      bufferedMs: 0,
      ownedUnitCount: 0,
      totalUnitCount: 10,
      audioContextState: "running",
      lastError: null
    })).toBe(false);
  });

  it("treats native local audio snapshots without source health as audible when live", () => {
    expect(isLocalPlaybackAudible({
      state: "live",
      bufferedMs: 0,
      ownedUnitCount: 0,
      totalUnitCount: 0,
      audioContextState: "running",
      lastError: null
    })).toBe(true);
  });
});
