import { describe, expect, it } from "vitest";
import {
  shouldBindRemoteRoomMediaStream,
  shouldRefreshPublishedRoomMediaStream
} from "./use-room-media-mesh";

describe("room media mesh hook helpers", () => {
  it("binds the remote stream from the latest playback source peer", () => {
    expect(
      shouldBindRemoteRoomMediaStream({
        remotePeerId: "peer_source",
        sourcePeerId: "peer_source",
        isCurrentSourceDevice: false
      })
    ).toBe(true);
  });

  it("does not bind stale remote streams from non-source peers", () => {
    expect(
      shouldBindRemoteRoomMediaStream({
        remotePeerId: "peer_old_source",
        sourcePeerId: "peer_source",
        isCurrentSourceDevice: false
      })
    ).toBe(false);
  });

  it("refreshes the published capture stream when the playback media epoch changes", () => {
    expect(
      shouldRefreshPublishedRoomMediaStream({
        previousPublishKey: "track_1:4",
        nextPublishKey: "track_1:5"
      })
    ).toBe(true);

    expect(
      shouldRefreshPublishedRoomMediaStream({
        previousPublishKey: "track_1:5",
        nextPublishKey: "track_1:5"
      })
    ).toBe(false);
  });
});
