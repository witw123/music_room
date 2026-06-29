import { peerSignalMessageSchema } from "@music-room/shared";

describe("room data signaling", () => {
  it("rejects legacy media peer signals at the shared boundary", () => {
    expect(
      peerSignalMessageSchema.safeParse({
        roomId: "room_1",
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        channelKind: "media",
        type: "offer",
        payload: {}
      }).success
    ).toBe(false);
  });
});
