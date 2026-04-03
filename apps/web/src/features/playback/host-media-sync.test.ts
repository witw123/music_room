import { describe, expect, it } from "vitest";
import { hasHostMediaStreamTrack } from "./host-media-sync";

describe("hasHostMediaStreamTrack", () => {
  it("returns false when the captured host stream has no audio track yet", () => {
    const stream = {
      getAudioTracks: () => []
    } as unknown as MediaStream;

    expect(hasHostMediaStreamTrack(stream)).toBe(false);
  });

  it("returns true once the captured host stream exposes an audio track", () => {
    const stream = {
      getAudioTracks: () => [{ id: "track_1" }]
    } as unknown as MediaStream;

    expect(hasHostMediaStreamTrack(stream)).toBe(true);
  });
});
