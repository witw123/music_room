import { describe, expect, it } from "vitest";
import { p2pDataMessageSchema, peerSignalMessageSchema } from "./models";

describe("p2p signaling contracts", () => {
  it("accepts data peer signals", () => {
    expect(
      peerSignalMessageSchema.safeParse({
        protocolVersion: 4,
        capability: "webrtc-opus-v1",
        roomId: "room_1",
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        channelKind: "data",
        type: "offer",
        payload: { type: "offer", sdp: "v=0" }
      }).success
    ).toBe(true);
  });

  it("rejects legacy media peer signals because playback uses original-piece data cache", () => {
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

  it("rejects pre-v4 data peer signals", () => {
    expect(peerSignalMessageSchema.safeParse({
      protocolVersion: 3,
      capability: "webrtc-opus-v1",
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "data",
      type: "offer",
      payload: { type: "offer", sdp: "v=0" }
    }).success).toBe(false);
  });

  it("rejects non-signaling payload fields from the application websocket", () => {
    expect(peerSignalMessageSchema.safeParse({
      protocolVersion: 4,
      capability: "webrtc-opus-v1",
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "data",
      type: "offer",
      payload: { type: "offer", sdp: "v=0", audioPayload: "base64" }
    }).success).toBe(false);
  });

  it("rejects removed piece request notifications", () => {
    expect(
      p2pDataMessageSchema.safeParse({
        kind: "piece-unavailable",
        trackId: "track_1",
        chunkIndex: 0,
        reason: "piece-missing"
      }).success
    ).toBe(false);
  });

  it("accepts versioned cache stream control messages", () => {
    expect(
      p2pDataMessageSchema.safeParse({
        kind: "cache-stream-open",
        protocolVersion: 3,
        streamId: "stream-1",
        trackId: "track_1",
        generation: 3,
        priority: "critical",
        ranges: [{ start: 0, end: 4 }],
        initialCreditBytes: 2 * 1024 * 1024
      }).success
    ).toBe(true);
  });

  it("rejects cache stream control messages from another protocol version", () => {
    expect(
      p2pDataMessageSchema.safeParse({
        kind: "cache-stream-open",
        protocolVersion: 1,
        streamId: "stream-1",
        trackId: "track_1",
        generation: 0,
        priority: "bulk",
        ranges: [{ start: 0, end: 0 }],
        initialCreditBytes: 2 * 1024 * 1024
      }).success
    ).toBe(false);
  });
});
