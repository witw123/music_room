import { describe, expect, it } from "vitest";
import { shouldInitiateRoomMediaPeer } from "./media-mesh";

describe("room media mesh", () => {
  it("lets the audio publisher initiate media negotiation even when its peer id sorts later", () => {
    expect(
      shouldInitiateRoomMediaPeer({
        localPeerId: "peer_z_source",
        remotePeerId: "peer_a_listener",
        publishesLocalAudio: true
      })
    ).toBe(true);
  });

  it("keeps listeners passive so the source can renegotiate tracks after audio capture becomes ready", () => {
    expect(
      shouldInitiateRoomMediaPeer({
        localPeerId: "peer_a_listener",
        remotePeerId: "peer_z_source",
        publishesLocalAudio: false
      })
    ).toBe(false);
  });
});
