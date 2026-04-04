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

  it("disables rate correction when requested and snaps to the expected position", () => {
    const audio = {
      currentTime: 10,
      playbackRate: 1
    } as HTMLAudioElement;

    syncLocalPlaybackWindow(audio, 10.28, true, {
      softDriftMs: 180,
      hardDriftMs: 1_200,
      allowRateCorrection: false
    });

    expect(audio.currentTime).toBe(10.28);
    expect(audio.playbackRate).toBe(1);
  });
});
