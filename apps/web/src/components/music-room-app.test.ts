import { describe, expect, it, vi } from "vitest";
import {
  runPlaybackMutationAfterLocalPrime,
  selectFullLocalPlaybackTracks,
  startBestEffortPlaybackAudioUnlock
} from "./music-room-app";

describe("selectFullLocalPlaybackTracks", () => {
  it("keeps only uploaded tracks plus the single cached track loaded for playback", () => {
    const uploadedFile = new File(["uploaded"], "uploaded.flac", { type: "audio/flac" });
    const cachedFile = new File(["cached"], "cached.flac", { type: "audio/flac" });

    const tracks = selectFullLocalPlaybackTracks({
      uploadedTracks: {
        track_uploaded: {
          file: uploadedFile,
          objectUrl: "blob:uploaded"
        }
      },
      cachedPlaybackTrack: {
        trackId: "track_cached",
        fileHash: "hash_cached",
        file: cachedFile,
        objectUrl: "blob:cached"
      }
    });

    expect(Object.keys(tracks).sort()).toEqual(["track_cached", "track_uploaded"]);
    expect(tracks.track_cached).toMatchObject({
      file: cachedFile,
      objectUrl: "blob:cached"
    });
  });
});

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
