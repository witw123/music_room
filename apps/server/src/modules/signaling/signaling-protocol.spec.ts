import { peerSignalMessageSchema } from "@music-room/shared";

describe("room data signaling", () => {
  it("rejects media signaling on the control channel boundary", () => {
    expect(
      peerSignalMessageSchema.safeParse({
        protocolVersion: 4,
        capability: "webrtc-opus-v1",
        roomId: "room_1",
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        channelKind: "media",
        type: "offer",
        payload: { type: "offer", sdp: "v=0" }
      }).success
    ).toBe(false);
  });
});
