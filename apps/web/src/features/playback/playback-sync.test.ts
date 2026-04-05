import { describe, expect, it } from "vitest";
import { syncLocalPlaybackWindow } from "./playback-sync";

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
    expect(audio.playbackRate).toBe(1.04);
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
});
