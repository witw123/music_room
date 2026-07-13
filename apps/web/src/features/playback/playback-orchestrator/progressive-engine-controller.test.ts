import { describe, expect, it } from "vitest";
import { shouldRecoverMissingProgressiveEngine } from "./progressive-engine-controller";

describe("shouldRecoverMissingProgressiveEngine", () => {
  const readyInput = {
    canPrepareProgressiveLocal: true,
    hasManifest: true,
    hasAudio: true,
    hasMseEngine: false,
    mseEngineFailed: false,
    hasPcmEngine: false
  };

  it("recovers when progressive playback is ready but both engine references are missing", () => {
    expect(shouldRecoverMissingProgressiveEngine(readyInput)).toBe(true);
  });

  it("recovers when the retained MSE engine has failed asynchronously", () => {
    expect(
      shouldRecoverMissingProgressiveEngine({
        ...readyInput,
        hasMseEngine: true,
        mseEngineFailed: true
      })
    ).toBe(true);
  });

  it("does not recover while either progressive engine exists", () => {
    expect(
      shouldRecoverMissingProgressiveEngine({
        ...readyInput,
        hasPcmEngine: true
      })
    ).toBe(false);
    expect(
      shouldRecoverMissingProgressiveEngine({
        ...readyInput,
        hasMseEngine: true
      })
    ).toBe(false);
  });

  it("waits until progressive playback, the manifest, and the audio element are ready", () => {
    expect(
      shouldRecoverMissingProgressiveEngine({
        ...readyInput,
        canPrepareProgressiveLocal: false
      })
    ).toBe(false);
    expect(
      shouldRecoverMissingProgressiveEngine({
        ...readyInput,
        hasManifest: false
      })
    ).toBe(false);
    expect(
      shouldRecoverMissingProgressiveEngine({
        ...readyInput,
        hasAudio: false
      })
    ).toBe(false);
  });
});
