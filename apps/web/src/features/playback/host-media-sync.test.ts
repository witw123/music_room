import { describe, expect, it } from "vitest";
import {
  buildHostCaptureRefreshKey,
  hasHostMediaStreamTrack,
  resolveHostCaptureRefresh,
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

  it("builds a capture refresh key from track, media epoch, and active source", () => {
    expect(
      buildHostCaptureRefreshKey({
        currentTrackId: "track_1",
        mediaEpoch: 3,
        activePlaybackSource: "remote-stream"
      })
    ).toBe("track_1|3|remote-stream");
  });

  it("forces a host capture refresh when the track or media epoch changes", () => {
    expect(
      resolveHostCaptureRefresh({
        currentTrackId: "track_2",
        mediaEpoch: 4,
        activePlaybackSource: "remote-stream",
        lastCaptureRefreshKey: "track_1|4|remote-stream"
      })
    ).toEqual({
      captureRefreshKey: "track_2|4|remote-stream",
      forceRefresh: true
    });

    expect(
      resolveHostCaptureRefresh({
        currentTrackId: "track_2",
        mediaEpoch: 5,
        activePlaybackSource: "remote-stream",
        lastCaptureRefreshKey: "track_2|4|remote-stream"
      })
    ).toEqual({
      captureRefreshKey: "track_2|5|remote-stream",
      forceRefresh: true
    });
  });

  it("does not force a host capture refresh when the capture key is unchanged", () => {
    expect(
      resolveHostCaptureRefresh({
        currentTrackId: "track_2",
        mediaEpoch: 5,
        activePlaybackSource: "full-local",
        lastCaptureRefreshKey: "track_2|5|full-local"
      })
    ).toEqual({
      captureRefreshKey: "track_2|5|full-local",
      forceRefresh: false
    });
  });
});
