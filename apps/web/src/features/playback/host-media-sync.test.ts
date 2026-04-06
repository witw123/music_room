import { describe, expect, it } from "vitest";
import {
  buildHostCaptureRefreshKey,
  getHostMediaStreamTrackState,
  hasHostMediaStreamTrack,
  hasUsableHostMediaStreamTrack,
  isAudioElementEffectivelyPlaying,
  isHostRelayAudioReadyForCapture,
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

  it("describes the primary captured host track state", () => {
    const stream = {
      getAudioTracks: () => [
        {
          id: "track_1",
          muted: false,
          enabled: true,
          readyState: "live"
        }
      ]
    } as unknown as MediaStream;

    expect(getHostMediaStreamTrackState(stream)).toEqual({
      trackCount: 1,
      trackId: "track_1",
      trackMuted: false,
      trackEnabled: true,
      trackReadyState: "live"
    });
  });

  it("treats muted or ended captured host tracks as unusable", () => {
    const mutedStream = {
      getAudioTracks: () => [
        {
          id: "track_1",
          muted: true,
          enabled: true,
          readyState: "live"
        }
      ]
    } as unknown as MediaStream;
    const endedStream = {
      getAudioTracks: () => [
        {
          id: "track_2",
          muted: false,
          enabled: true,
          readyState: "ended"
        }
      ]
    } as unknown as MediaStream;

    expect(hasUsableHostMediaStreamTrack(mutedStream)).toBe(false);
    expect(hasUsableHostMediaStreamTrack(endedStream)).toBe(false);
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
      getAudioTracks: () => [
        {
          id: "track_1",
          muted: false,
          enabled: true,
          readyState: "live"
        }
      ]
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

  it("waits for the full-local audio element to switch to the current track before capture", () => {
    expect(
      isHostRelayAudioReadyForCapture({
        activePlaybackSource: "full-local",
        relayAudio: {
          currentSrc: "blob:track-a",
          src: "blob:track-a"
        } as Pick<HTMLAudioElement, "currentSrc" | "src">,
        currentTrackObjectUrl: "blob:track-b"
      })
    ).toBe(false);

    expect(
      isHostRelayAudioReadyForCapture({
        activePlaybackSource: "full-local",
        relayAudio: {
          currentSrc: "blob:track-b",
          src: "blob:track-b"
        } as Pick<HTMLAudioElement, "currentSrc" | "src">,
        currentTrackObjectUrl: "blob:track-b"
      })
    ).toBe(true);
  });

  it("does not block capture binding checks for remote-stream playback", () => {
    expect(
      isHostRelayAudioReadyForCapture({
        activePlaybackSource: "remote-stream",
        relayAudio: {
          currentSrc: "",
          src: ""
        } as Pick<HTMLAudioElement, "currentSrc" | "src">,
        currentTrackObjectUrl: "blob:track-b"
      })
    ).toBe(true);
  });

  it("treats srcObject-backed audio as effectively playing even when readyState is low", () => {
    expect(
      isAudioElementEffectivelyPlaying({
        paused: false,
        readyState: 0,
        srcObject: {} as MediaStream
      })
    ).toBe(true);
    expect(
      isAudioElementEffectivelyPlaying({
        paused: true,
        readyState: 4,
        srcObject: {} as MediaStream
      })
    ).toBe(false);
  });
});
