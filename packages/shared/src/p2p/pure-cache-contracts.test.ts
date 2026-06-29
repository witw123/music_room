import { describe, expect, it } from "vitest";
import { peerSignalMessageSchema } from "./models";

describe("p2p signaling contracts", () => {
  it("accepts data peer signals", () => {
    expect(
      peerSignalMessageSchema.safeParse({
        roomId: "room_1",
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        channelKind: "data",
        type: "offer",
        payload: {}
      }).success
    ).toBe(true);
  });

  it("accepts media peer signals for live audio bootstrap", () => {
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
