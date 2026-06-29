import { peerSignalMessageSchema } from "@music-room/shared";

describe("room media signaling", () => {
  it("accepts media peer signals at the shared boundary", () => {
    expect(
      peerSignalMessageSchema.safeParse({
        roomId: "room_1",
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        channelKind: "media",
        type: "offer",
        payload: {}
      }).success
    ).toBe(true);
  });
});
