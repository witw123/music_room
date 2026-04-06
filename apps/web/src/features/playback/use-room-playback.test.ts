import { describe, expect, it } from "vitest";
import {
  resolveAudibleClockSample,
  resolveDisplayClockProgress,
  type DisplayClockSource
} from "./use-room-playback";

describe("resolveAudibleClockSample", () => {
  it("uses the remote audio clock while remote-stream is audible", () => {
    expect(
      resolveAudibleClockSample({
        activePlaybackSource: "remote-stream",
        shouldUseLocalAudio: false,
        playbackSessionKey: "track-a|3|9|started|playing",
        roomClockMs: 42_250,
        remoteAudioCurrentTimeSeconds: 42.25,
        remoteAudioPaused: false,
        previousAnchor: null
      })
    ).toEqual({
      sample: {
        progressMs: 42_250,
        source: "remote-audible"
      },
      nextAnchor: {
        source: "remote-audible",
        sessionKey: "track-a|3|9|started|playing",
        anchorRoomClockMs: 42_250,
        anchorMediaTimeSeconds: 42.25
      }
    });
  });

  it("prefers the local playback position once local playback is audible", () => {
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

  it("maps a newly joined remote stream onto the current room timeline", () => {
    const joined = resolveAudibleClockSample({
      activePlaybackSource: "remote-stream",
      shouldUseLocalAudio: false,
      playbackSessionKey: "track-b|7|11|started|playing",
      roomClockMs: 96_000,
      remoteAudioCurrentTimeSeconds: 0.2,
      remoteAudioPaused: false,
      previousAnchor: null
    });

    const advanced = resolveAudibleClockSample({
      activePlaybackSource: "remote-stream",
      shouldUseLocalAudio: false,
      playbackSessionKey: "track-b|7|11|started|playing",
      roomClockMs: 97_450,
      remoteAudioCurrentTimeSeconds: 1.65,
      remoteAudioPaused: false,
      previousAnchor: joined.nextAnchor
    });

    expect(joined.sample).toEqual({
      progressMs: 96_000,
      source: "remote-audible"
    });
    expect(advanced.sample).toEqual({
      progressMs: 97_450,
      source: "remote-audible"
    });
  });

  it("re-anchors the remote stream after a rejoin resets the media element clock", () => {
    const previousAnchor = {
      source: "remote-audible" as const,
      sessionKey: "track-c|9|14|started|playing",
      anchorRoomClockMs: 120_000,
      anchorMediaTimeSeconds: 8.4
    };

    const result = resolveAudibleClockSample({
      activePlaybackSource: "remote-stream",
      shouldUseLocalAudio: false,
      playbackSessionKey: "track-c|9|14|started|playing",
      roomClockMs: 131_500,
      remoteAudioCurrentTimeSeconds: 0.1,
      remoteAudioPaused: false,
      previousAnchor
    });

    expect(result.sample).toEqual({
      progressMs: 131_500,
      source: "remote-audible"
    });
    expect(result.nextAnchor).toEqual({
      source: "remote-audible",
      sessionKey: "track-c|9|14|started|playing",
      anchorRoomClockMs: 131_500,
      anchorMediaTimeSeconds: 0.1
    });
  });
});

describe("resolveDisplayClockProgress", () => {
  const remoteSource: DisplayClockSource = "remote-audible";

  it("keeps the display clock glued to the audible clock for small drift", () => {
    const result = resolveDisplayClockProgress({
      audibleClockSample: {
        progressMs: 20_120,
        source: remoteSource
      },
      roomClockMs: 20_180,
      durationMs: 240_000,
      previousDisplayMs: 20_000,
      previousSource: remoteSource,
      transitionState: {
        source: remoteSource,
        anchorDisplayMs: 20_000,
        anchorAudibleMs: 20_000,
        anchorAtMs: 1_000,
        hardDriftSamples: 0
      },
      now: 1_120
    });

    expect(result.progressMs).toBe(20_120);
    expect(result.source).toBe("remote-audible");
    expect(result.displayDriftMs).toBe(60);
  });

  it("smooths the UI toward the room clock for moderate drift without hard jumping", () => {
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

    expect(result.progressMs).toBeGreaterThan(20_000);
    expect(result.progressMs).toBeLessThan(20_240);
    expect(result.source).toBe("local-audible");
  });

  it("keeps remote audible playback monotonic under moderate room drift", () => {
    const result = resolveDisplayClockProgress({
      audibleClockSample: {
        progressMs: 20_000,
        source: remoteSource
      },
      roomClockMs: 20_240,
      durationMs: 240_000,
      previousDisplayMs: 20_000,
      previousSource: remoteSource,
      transitionState: {
        source: remoteSource,
        anchorDisplayMs: 20_000,
        anchorAudibleMs: 20_000,
        anchorAtMs: 1_000,
        hardDriftSamples: 0
      },
      now: 1_120
    });

    expect(result.progressMs).toBe(20_000);
    expect(result.source).toBe("remote-audible");
  });

  it("keeps source switches continuous before converging to the new audible clock", () => {
    const firstFrame = resolveDisplayClockProgress({
      audibleClockSample: {
        progressMs: 15_600,
        source: "local-audible"
      },
      roomClockMs: 15_620,
      durationMs: 240_000,
      previousDisplayMs: 15_000,
      previousSource: "remote-audible",
      transitionState: {
        source: "remote-audible",
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

    expect(result.progressMs).toBe(33_000);
    expect(result.source).toBe("room-fallback");
    expect(result.displayDriftMs).toBe(0);
  });
});
