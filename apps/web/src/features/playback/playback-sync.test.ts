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

  it("uses a narrow audible correction band for remote follow mode", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1
    } as HTMLAudioElement;

    syncLocalPlaybackWindow(audio, 10.28, true, {
      softDriftMs: 120,
      hardDriftMs: 1_200,
      correctionMode: "audible-remote-follow"
    });

    expect(audio.currentTime).toBe(10);
    expect(audio.playbackRate).toBeCloseTo(1.012, 3);
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

  it("uses smaller continuous rate deltas for medium drift in audible follow modes", () => {
    expect(resolveContinuousPlaybackRate({ driftMs: 180, maxRateDelta: 0.015 })).toBeCloseTo(
      1.015,
      3
    );
    expect(resolveContinuousPlaybackRate({ driftMs: -180, maxRateDelta: 0.012 })).toBeCloseTo(
      0.988,
      3
    );
  });
});
