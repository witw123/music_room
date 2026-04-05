import { describe, expect, it } from "vitest";
import {
  hasHostMediaStreamTrack,
  shouldDeferHostMediaStreamSync
} from "./host-media-sync";

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

  it("defers host relay sync while the next captured stream has no audio track yet", () => {
    const stream = {
      getAudioTracks: () => []
    } as unknown as MediaStream;

    expect(
      shouldDeferHostMediaStreamSync({
        stream,
        listenerPeerCount: 1,
        playbackStatus: "playing"
      })
    ).toBe(true);
  });

  it("does not defer host relay sync when there are no listeners or playback is idle", () => {
    const stream = {
      getAudioTracks: () => []
    } as unknown as MediaStream;

    expect(
      shouldDeferHostMediaStreamSync({
        stream,
        listenerPeerCount: 0,
        playbackStatus: "playing"
      })
    ).toBe(false);
    expect(
      shouldDeferHostMediaStreamSync({
        stream,
        listenerPeerCount: 1,
        playbackStatus: "idle"
      })
    ).toBe(false);
  });
});
