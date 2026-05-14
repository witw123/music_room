import { describe, expect, it } from "vitest";
import {
  resolveAudibleClockSample,
  resolveAudibleClockContinuitySample,
  resolveDisplayClockProgress
} from "./use-room-playback";

describe("resolveAudibleClockSample", () => {
  it("prefers the local playback position when available", () => {
    expect(
      resolveAudibleClockSample({
        activePlaybackSource: "full-local",
        shouldUseLocalAudio: true,
        localPlaybackPositionMs: 18_420,
        localAudioCurrentTimeSeconds: 15,
        localAudioPaused: false
      })
    ).toEqual({
      sample: {
        progressMs: 18_420,
        source: "local-audible"
      },
      nextAnchor: null
    });
  });

  it("uses the local audio element clock when no explicit local position exists", () => {
    expect(
      resolveAudibleClockSample({
        activePlaybackSource: "progressive-local",
        shouldUseLocalAudio: true,
        localAudioCurrentTimeSeconds: 42.25,
        localAudioPaused: false
      }).sample
    ).toEqual({
      progressMs: 42_250,
      source: "local-audible"
    });
  });
});

describe("resolveDisplayClockProgress", () => {
  it("keeps local audible playback glued to the audible clock", () => {
    const result = resolveDisplayClockProgress({
      audibleClockSample: {
        progressMs: 20_000,
        source: "local-audible"
      },
      roomClockMs: 20_240,
      durationMs: 240_000,
      previousDisplayMs: 20_000,
      previousSource: "local-audible",
      transitionState: {
        source: "local-audible",
        anchorDisplayMs: 20_000,
        anchorAudibleMs: 20_000,
        anchorAtMs: 1_000,
        hardDriftSamples: 0
      },
      now: 1_120
    });

    expect(result.progressMs).toBe(20_000);
    expect(result.source).toBe("local-audible");
  });

  it("keeps source switches continuous before converging to the new local audible clock", () => {
    const firstFrame = resolveDisplayClockProgress({
      audibleClockSample: {
        progressMs: 15_600,
        source: "local-audible"
      },
      roomClockMs: 15_620,
      durationMs: 240_000,
      previousDisplayMs: 15_000,
      previousSource: "room-fallback",
      transitionState: {
        source: "room-fallback",
        anchorDisplayMs: 15_000,
        anchorAudibleMs: 15_000,
        anchorAtMs: 2_000,
        hardDriftSamples: 0
      },
      now: 2_000
    });

    const settledFrame = resolveDisplayClockProgress({
      audibleClockSample: {
        progressMs: 15_600,
        source: "local-audible"
      },
      roomClockMs: 15_620,
      durationMs: 240_000,
      previousDisplayMs: firstFrame.progressMs,
      previousSource: firstFrame.source,
      transitionState: firstFrame.transitionState,
      now: 2_400
    });

    expect(firstFrame.progressMs).toBe(15_000);
    expect(settledFrame.progressMs).toBe(15_600);
    expect(settledFrame.source).toBe("local-audible");
  });

  it("falls back to the room clock when no audible clock is available", () => {
    const result = resolveDisplayClockProgress({
      audibleClockSample: null,
      roomClockMs: 33_000,
      durationMs: 240_000,
      previousDisplayMs: 32_500,
      previousSource: "local-audible",
      transitionState: {
        source: "local-audible",
        anchorDisplayMs: 32_500,
        anchorAudibleMs: 32_500,
        anchorAtMs: 3_000,
        hardDriftSamples: 0
      },
      now: 3_100
    });

    expect(result.progressMs).toBe(32_500);
    expect(result.source).toBe("room-fallback");
    expect(result.displayDriftMs).toBe(500);
  });
});

describe("resolveAudibleClockContinuitySample", () => {
  it("retains the last local audible anchor while playback is still active", () => {
    const previousContinuity = {
      sample: {
        progressMs: 42_000,
        source: "local-audible" as const
      },
      observedAtMs: 1_000,
      sessionKey: "track-a|1|1|started|playing"
    };

    const result = resolveAudibleClockContinuitySample({
      audibleClockSample: null,
      previousContinuity,
      playbackSessionKey: "track-a|1|1|started|playing",
      playbackStatus: "playing",
      now: 4_500
    });

    expect(result.sample).toBeNull();
    expect(result.continuityState).toBe(previousContinuity);
  });
});
