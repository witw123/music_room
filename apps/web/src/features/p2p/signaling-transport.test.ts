import { describe, expect, it, vi } from "vitest";
import {
  SignalingTransport,
  buildDataPeerSignal,
  shouldIgnoreStaleAnswerError,
  toIceCandidateInit,
  toSessionDescriptionInit
} from "./signaling-transport";

describe("SignalingTransport", () => {
  it("builds data-channel peer signal payloads from stable room and peer identities", () => {
    expect(
      buildDataPeerSignal({
        roomId: "room_1",
        localPeerId: "peer_a",
        remotePeerId: "peer_b",
        type: "offer",
        payload: { type: "offer", sdp: "fake-offer" }
      })
    ).toEqual({
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "data",
      type: "offer",
      payload: { type: "offer", sdp: "fake-offer" }
    });
  });

  it("records sent and received signal diagnostics around the send boundary", () => {
    const sendSignal = vi.fn();
    const onSignal = vi.fn();
    const transport = new SignalingTransport({
      roomId: "room_1",
      localPeerId: "peer_a",
      sendSignal,
      onSignal
    });

    transport.markReceived("peer_b", "candidate");
    transport.send("peer_b", "answer", { type: "answer", sdp: "fake-answer" });

    expect(onSignal).toHaveBeenNthCalledWith(1, {
      peerId: "peer_b",
      direction: "received",
      type: "candidate"
    });
    expect(onSignal).toHaveBeenNthCalledWith(2, {
      peerId: "peer_b",
      direction: "sent",
      type: "answer"
    });
    expect(sendSignal).toHaveBeenCalledWith({
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "data",
      type: "answer",
      payload: { type: "answer", sdp: "fake-answer" }
    });
  });

  it("parses SDP descriptions and ICE candidates from peer signal payload records", () => {
    expect(toSessionDescriptionInit({ type: "answer", sdp: "fake-answer" })).toEqual({
      type: "answer",
      sdp: "fake-answer"
    });
    expect(toSessionDescriptionInit({ sdp: "missing-type" })).toBeNull();

    expect(
      toIceCandidateInit({
        candidate: "candidate-1",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "ufrag"
      })
    ).toEqual({
      candidate: "candidate-1",
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: "ufrag"
    });
    expect(toIceCandidateInit({ sdpMid: "0" })).toBeNull();
  });

  it("only ignores stale answer errors after the connection leaves have-local-offer", () => {
    const staleError = new Error("Failed to set remote answer sdp: Called in wrong state: stable");

    expect(shouldIgnoreStaleAnswerError("stable", staleError)).toBe(true);
    expect(shouldIgnoreStaleAnswerError("have-local-offer", staleError)).toBe(false);
    expect(shouldIgnoreStaleAnswerError("stable", new Error("permission denied"))).toBe(false);
  });
});
