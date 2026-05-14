import { describe, expect, it } from "vitest";
import { peerSignalMessageSchema } from "./models";

describe("pure cache p2p contracts", () => {
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

  it("rejects media peer signals", () => {
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
