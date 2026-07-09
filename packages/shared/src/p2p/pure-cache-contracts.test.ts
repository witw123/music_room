import { describe, expect, it } from "vitest";
import { p2pDataMessageSchema, peerSignalMessageSchema } from "./models";

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

  it("rejects legacy media peer signals because playback uses original-piece data cache", () => {
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

  it("accepts piece unavailable notifications for immediate cache retry", () => {
    expect(
      p2pDataMessageSchema.safeParse({
        kind: "piece-unavailable",
        requestId: "request-1",
        trackId: "track_1",
        chunkIndex: 0,
        reason: "piece-missing"
      }).success
    ).toBe(true);
  });
});
