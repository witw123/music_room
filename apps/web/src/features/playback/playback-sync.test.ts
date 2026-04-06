import { describe, expect, it } from "vitest";
import { resolveContinuousPlaybackRate, syncLocalPlaybackWindow } from "./playback-sync";

describe("syncLocalPlaybackWindow", () => {
  it("uses playbackRate correction by default for moderate drift", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1
    } as HTMLAudioElement;

    syncLocalPlaybackWindow(audio, 10.28, true, {
      softDriftMs: 180,
      hardDriftMs: 1_200
    });

    expect(audio.currentTime).toBe(10);
    expect(audio.playbackRate).toBeCloseTo(1.018, 3);
  });

  it("disables rate correction when requested and leaves moderate drift untouched", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1
    } as HTMLAudioElement;

    syncLocalPlaybackWindow(audio, 10.28, true, {
      softDriftMs: 180,
      hardDriftMs: 1_200,
      allowRateCorrection: false
    });

    expect(audio.currentTime).toBe(10);
    expect(audio.playbackRate).toBe(1);
  });

  it("keeps the audible playback rate unchanged in seek-only mode for moderate drift", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1
    } as HTMLAudioElement;

    syncLocalPlaybackWindow(audio, 10.28, true, {
      softDriftMs: 180,
      hardDriftMs: 1_200,
      correctionMode: "seek-only"
    });

    expect(audio.currentTime).toBe(10);
    expect(audio.playbackRate).toBe(1);
  });

  it("snaps in seek-only mode once drift exceeds the hard threshold", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1
    } as HTMLAudioElement;

    syncLocalPlaybackWindow(audio, 11.5, true, {
      softDriftMs: 180,
      hardDriftMs: 1_200,
      correctionMode: "seek-only"
    });

    expect(audio.currentTime).toBe(11.5);
    expect(audio.playbackRate).toBe(1);
  });

  it("uses muted warmup mode to snap without time-stretching", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1
    } as HTMLAudioElement;

    syncLocalPlaybackWindow(audio, 10.28, true, {
      softDriftMs: 180,
      hardDriftMs: 1_200,
      correctionMode: "muted-warmup"
    });

    expect(audio.currentTime).toBe(10.28);
    expect(audio.playbackRate).toBe(1);
  });

  it("keeps audible remote follow at fixed pitch and rate for moderate drift", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1,
      preservesPitch: false
    } as HTMLAudioElement;

    syncLocalPlaybackWindow(audio, 10.28, true, {
      softDriftMs: 120,
      hardDriftMs: 1_200,
      correctionMode: "audible-remote-follow"
    });

    expect(audio.currentTime).toBe(10);
    expect(audio.playbackRate).toBe(1);
    expect((audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch).toBe(true);
  });

  it("snaps audible follow modes once drift exceeds the hard threshold", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1
    } as HTMLAudioElement;

    const result = syncLocalPlaybackWindow(audio, 11.6, true, {
      softDriftMs: 120,
      hardDriftMs: 900,
      correctionMode: "audible-local-follow"
    });

    expect(audio.currentTime).toBe(11.6);
    expect(audio.playbackRate).toBe(1);
    expect(result.didSeek).toBe(true);
  });

  it("uses a narrow playbackRate window for audible local follow before hard drift", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1
    } as HTMLAudioElement;

    const result = syncLocalPlaybackWindow(audio, 10.2, true, {
      softDriftMs: 120,
      hardDriftMs: 900,
      correctionMode: "audible-local-follow"
    });

    expect(audio.currentTime).toBe(10);
    expect(audio.playbackRate).toBeGreaterThan(1);
    expect(audio.playbackRate).toBeLessThanOrEqual(1.006);
    expect(result.didSeek).toBe(false);
  });

  it("derives small continuous playback-rate deltas from drift", () => {
    expect(resolveContinuousPlaybackRate({ driftMs: 20, maxRateDelta: 0.015 })).toBeCloseTo(
      1,
      3
    );
    expect(resolveContinuousPlaybackRate({ driftMs: -60, maxRateDelta: 0.015 })).toBeCloseTo(
      0.996,
      3
    );
  });

  it("still computes continuous rate deltas for non-audible correction modes", () => {
    expect(resolveContinuousPlaybackRate({ driftMs: 180, maxRateDelta: 0.008 })).toBeCloseTo(1.008, 3);
    expect(resolveContinuousPlaybackRate({ driftMs: -180, maxRateDelta: 0.006 })).toBeCloseTo(0.994, 3);
  });

  it("keeps audible local follow at fixed rate for tiny drift", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1
    } as HTMLAudioElement;

    const result = syncLocalPlaybackWindow(audio, 10.03, true, {
      softDriftMs: 120,
      hardDriftMs: 900,
      correctionMode: "audible-local-follow"
    });

    expect(audio.currentTime).toBe(10);
    expect(audio.playbackRate).toBe(1);
    expect(result.didSeek).toBe(false);
  });
});
