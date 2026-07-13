import { peerSignalMessageSchema } from "@music-room/shared";

describe("room data signaling", () => {
  it("rejects legacy media peer signals at the shared boundary", () => {
    expect(
      peerSignalMessageSchema.safeParse({
        protocolVersion: 4,
        capability: "segmented-opus-v1",
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
