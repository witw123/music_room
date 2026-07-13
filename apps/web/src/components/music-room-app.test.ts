import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { startBestEffortPlaybackAudioUnlock } from "./music-room-app";

describe("MusicRoomApp v4 playback wiring", () => {
  it("mounts segmented playback without the removed progressive/full-local runtimes", () => {
    const source = readFileSync(new URL("./music-room-app.tsx", import.meta.url), "utf8");

    expect(source).toContain("useRoomSegmentedPlaybackRuntime");
    expect(source).not.toContain("useProgressiveRuntime");
    expect(source).not.toContain("useRoomCachedFullLocalPlayback");
    expect(source).not.toContain("primeFullLocalTrackPlayback");
  });

  it("starts audio-context unlock without blocking the playback command", () => {
    const unlockAudio = vi.fn(() => new Promise(() => undefined));

    startBestEffortPlaybackAudioUnlock({ unlockAudio });

    expect(unlockAudio).toHaveBeenCalledTimes(1);
  });
});
