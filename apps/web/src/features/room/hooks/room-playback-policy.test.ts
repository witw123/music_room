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
});
