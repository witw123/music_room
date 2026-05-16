import { describe, expect, it, vi } from "vitest";
import {
  runPlaybackMutationAfterLocalPrime,
  startBestEffortPlaybackAudioUnlock
} from "./music-room-app";

describe("runPlaybackMutationAfterLocalPrime", () => {
  it("does not wait for local audio priming before mutating room playback", async () => {
    const primeLocalPlayback = vi.fn(() => new Promise(() => undefined));
    const mutatePlayback = vi.fn(async () => "mutated");

    const result = await runPlaybackMutationAfterLocalPrime({
      primeLocalPlayback,
      mutatePlayback
    });

    expect(result).toBe("mutated");
    expect(primeLocalPlayback).toHaveBeenCalledTimes(1);
    expect(mutatePlayback).toHaveBeenCalledTimes(1);
  });

  it("does not wait for audio unlock before allowing playback flow to continue", () => {
    const unlockAudio = vi.fn(() => new Promise(() => undefined));

    startBestEffortPlaybackAudioUnlock({ unlockAudio });

    expect(unlockAudio).toHaveBeenCalledTimes(1);
  });
});
