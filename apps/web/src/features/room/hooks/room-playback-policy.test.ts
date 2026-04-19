import { describe, expect, it } from "vitest";
import { shouldMaintainRemotePlaybackSurface } from "./room-playback-policy";

describe("shouldMaintainRemotePlaybackSurface", () => {
  it("keeps the remote playback surface alive while the room is paused", () => {
    expect(
      shouldMaintainRemotePlaybackSurface({
        isCurrentSourceOwner: false,
        activePlaybackSource: "remote-stream",
        playbackStatus: "paused",
        currentTrackId: "track_1",
        sourcePeerId: "peer_source",
        localPeerId: "peer_listener"
      })
    ).toBe(true);
  });

  it("keeps the remote playback surface alive while the room is buffering", () => {
    expect(
      shouldMaintainRemotePlaybackSurface({
        isCurrentSourceOwner: false,
        activePlaybackSource: "remote-stream",
        playbackStatus: "buffering",
        currentTrackId: "track_1",
        sourcePeerId: "peer_source",
        localPeerId: "peer_listener"
      })
    ).toBe(true);
  });

  it("tears the surface down when remote playback is no longer the active listener path", () => {
    expect(
      shouldMaintainRemotePlaybackSurface({
        isCurrentSourceOwner: false,
        activePlaybackSource: "progressive-local",
        playbackStatus: "paused",
        currentTrackId: "track_1",
        sourcePeerId: "peer_source",
        localPeerId: "peer_listener"
      })
    ).toBe(false);
  });

  it("keeps a bound remote surface alive during temporary local fallback while room playback remains active", () => {
    expect(
      shouldMaintainRemotePlaybackSurface({
        isCurrentSourceOwner: false,
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        currentTrackId: "track_1",
        sourcePeerId: "peer_source",
        localPeerId: "peer_listener",
        hasRemoteSrcObject: true
      })
    ).toBe(true);
  });

  it("keeps a bound remote surface alive during source-lost grace even before a new source peer is known", () => {
    expect(
      shouldMaintainRemotePlaybackSurface({
        isCurrentSourceOwner: false,
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        currentTrackId: "track_1",
        sourcePeerId: null,
        localPeerId: "peer_listener",
        hasRemoteSrcObject: true
      })
    ).toBe(true);
  });
});
