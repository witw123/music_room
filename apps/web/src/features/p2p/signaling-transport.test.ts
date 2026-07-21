import { describe, expect, it, vi } from "vitest";
import {
  SignalingTransport,
  buildDataPeerSignal,
  shouldIgnoreStaleAnswerError,
  toIceCandidateInit,
  toSessionDescriptionPayload,
  toSessionDescriptionInit
} from "./signaling-transport";

function buildSignal(
  input: Partial<Parameters<SignalingTransport["handleIncomingSignal"]>[0]> = {}
) {
  return {
    protocolVersion: 4 as const,
    capability: "webrtc-opus-v1" as const,
    roomId: "room_1",
    fromPeerId: "peer_b",
    toPeerId: "peer_a",
    channelKind: "data" as const,
    type: "offer" as const,
    payload: {
      type: "offer",
      sdp: "fake-offer"
    },
    ...input
  };
}

function buildSignalEntry(
  input: Partial<{
    signalingState: RTCSignalingState;
    remoteDescription: RTCSessionDescriptionInit | null;
    addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
  }> = {}
) {
  return {
    lastSignalProgressAtMs: 0,
    pendingCandidates: [] as RTCIceCandidateInit[],
    connection: {
      signalingState: input.signalingState ?? "stable",
      remoteDescription: input.remoteDescription ?? null,
      createAnswer: vi.fn(async () => ({ type: "answer" as const, sdp: "fake-answer" })),
      setLocalDescription: vi.fn(async () => undefined),
      addIceCandidate: vi.fn(input.addIceCandidate ?? (async () => undefined))
    }
  };
}

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
      protocolVersion: 4,
      capability: "webrtc-opus-v1",
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "data",
      linkKind: "data",
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
      type: "candidate",
      linkKind: "data"
    });
    expect(onSignal).toHaveBeenNthCalledWith(2, {
      peerId: "peer_b",
      direction: "sent",
      type: "answer",
      linkKind: "data"
    });
    expect(sendSignal).toHaveBeenCalledWith({
      protocolVersion: 4,
      capability: "webrtc-opus-v1",
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "data",
      linkKind: "data",
      type: "answer",
      payload: { type: "answer", sdp: "fake-answer" }
    });
  });

  it("creates local offers, applies them, and sends them to the remote data peer", async () => {
    const sendSignal = vi.fn();
    const transport = new SignalingTransport({
      roomId: "room_1",
      localPeerId: "peer_a",
      sendSignal
    });
    const connection = {
      createOffer: vi.fn(async () => ({ type: "offer" as const, sdp: "fake-offer" })),
      setLocalDescription: vi.fn(async () => undefined)
    };

    const offer = await transport.createAndSendOffer("peer_b", connection, {
      iceRestart: true
    });

    expect(connection.createOffer).toHaveBeenCalledWith({ iceRestart: true });
    expect(connection.setLocalDescription).toHaveBeenCalledWith({
      type: "offer",
      sdp: "fake-offer"
    });
    expect(sendSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "offer",
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        payload: {
          type: "offer",
          sdp: "fake-offer"
        }
      })
    );
    expect(offer).toEqual({
      type: "offer",
      sdp: "fake-offer"
    });
  });

  it("parses SDP descriptions and ICE candidates from peer signal payload records", () => {
    expect(toSessionDescriptionPayload({ type: "offer", sdp: "fake-offer" })).toEqual({
      type: "offer",
      sdp: "fake-offer"
    });
    expect(toSessionDescriptionPayload({ type: "answer" })).toEqual({
      type: "answer"
    });

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

  it("accepts data offers, flushes queued candidates, and sends answers", async () => {
    const sendSignal = vi.fn();
    const onSignal = vi.fn();
    const transport = new SignalingTransport({
      roomId: "room_1",
      localPeerId: "peer_a",
      sendSignal,
      onSignal
    });
    const entry = buildSignalEntry();
    const applyRemoteDescription = vi.fn(async () => undefined);
    const flushPendingCandidates = vi.fn(async () => undefined);

    await transport.handleIncomingSignal(buildSignal(), {
      getOrCreatePeerEntry: vi.fn(async () => entry),
      runPeerOperation: async (_entry, task) => task(),
      applyRemoteDescription,
      flushPendingCandidates,
      nowMs: () => 1234
    });

    expect(onSignal).toHaveBeenCalledWith({
      peerId: "peer_b",
      direction: "received",
      type: "offer",
      linkKind: "data"
    });
    expect(applyRemoteDescription).toHaveBeenCalledWith(entry, {
      type: "offer",
      sdp: "fake-offer"
    });
    expect(flushPendingCandidates).toHaveBeenCalledWith(entry);
    expect(entry.connection.createAnswer).toHaveBeenCalled();
    expect(entry.connection.setLocalDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "fake-answer"
    });
    expect(entry.lastSignalProgressAtMs).toBe(1234);
    expect(sendSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "answer",
        fromPeerId: "peer_a",
        toPeerId: "peer_b",
        payload: {
          type: "answer",
          sdp: "fake-answer"
        }
      })
    );
  });

  it("applies valid answers only while a local offer is pending", async () => {
    const transport = new SignalingTransport({
      roomId: "room_1",
      localPeerId: "peer_a",
      sendSignal: vi.fn()
    });
    const entry = buildSignalEntry({ signalingState: "have-local-offer" });
    const applyRemoteDescription = vi.fn(async () => undefined);
    const flushPendingCandidates = vi.fn(async () => undefined);

    await transport.handleIncomingSignal(
      buildSignal({
        type: "answer",
        payload: {
          type: "answer",
          sdp: "fake-answer"
        }
      }),
      {
        getOrCreatePeerEntry: vi.fn(async () => entry),
        runPeerOperation: async (_entry, task) => task(),
        applyRemoteDescription,
        flushPendingCandidates,
        nowMs: () => 2345
      }
    );

    expect(applyRemoteDescription).toHaveBeenCalledWith(entry, {
      type: "answer",
      sdp: "fake-answer"
    });
    expect(flushPendingCandidates).toHaveBeenCalledWith(entry);
    expect(entry.lastSignalProgressAtMs).toBe(2345);

    entry.connection.signalingState = "stable";
    await transport.handleIncomingSignal(
      buildSignal({
        type: "answer",
        payload: {
          type: "answer",
          sdp: "late-answer"
        }
      }),
      {
        getOrCreatePeerEntry: vi.fn(async () => entry),
        runPeerOperation: async (_entry, task) => task(),
        applyRemoteDescription,
        flushPendingCandidates
      }
    );

    expect(applyRemoteDescription).toHaveBeenCalledTimes(1);
  });

  it("queues candidates until a remote description exists and tolerates add races", async () => {
    const transport = new SignalingTransport({
      roomId: "room_1",
      localPeerId: "peer_a",
      sendSignal: vi.fn()
    });
    const entry = buildSignalEntry();

    await transport.handleIncomingSignal(
      buildSignal({
        type: "candidate",
        payload: {
          candidate: "candidate-1"
        }
      }),
      {
        getOrCreatePeerEntry: vi.fn(async () => entry),
        runPeerOperation: async (_entry, task) => task(),
        applyRemoteDescription: vi.fn(),
        flushPendingCandidates: vi.fn()
      }
    );

    expect(entry.pendingCandidates).toEqual([{ candidate: "candidate-1" }]);

    entry.pendingCandidates = [];
    entry.connection.remoteDescription = {
      type: "offer",
      sdp: "fake-offer"
    };
    entry.connection.addIceCandidate = vi.fn(async () => {
      throw new Error("candidate-race");
    });
    await transport.handleIncomingSignal(
      buildSignal({
        type: "candidate",
        payload: {
          candidate: "candidate-2"
        }
      }),
      {
        getOrCreatePeerEntry: vi.fn(async () => entry),
        runPeerOperation: async (_entry, task) => task(),
        applyRemoteDescription: vi.fn(),
        flushPendingCandidates: vi.fn()
      }
    );

    expect(entry.connection.addIceCandidate).toHaveBeenCalledWith({
      candidate: "candidate-2"
    });
    expect(entry.pendingCandidates).toEqual([]);

    entry.connection.remoteDescription = null;
    await transport.handleIncomingSignal(
      buildSignal({
        type: "candidate",
        payload: {
          candidate: "candidate-3"
        }
      }),
      {
        getOrCreatePeerEntry: vi.fn(async () => entry),
        runPeerOperation: async (_entry, task) => task(),
        applyRemoteDescription: vi.fn(),
        flushPendingCandidates: vi.fn()
      }
    );

    expect(entry.pendingCandidates).toEqual([{ candidate: "candidate-3" }]);
  });

  it("ignores signals that are not addressed to the local data peer", async () => {
    const transport = new SignalingTransport({
      roomId: "room_1",
      localPeerId: "peer_a",
      sendSignal: vi.fn()
    });
    const getOrCreatePeerEntry = vi.fn(async () => buildSignalEntry());

    await transport.handleIncomingSignal(
      buildSignal({
        channelKind: "data",
        toPeerId: "peer_c"
      }),
      {
        getOrCreatePeerEntry,
        runPeerOperation: async (_entry, task) => task(),
        applyRemoteDescription: vi.fn(),
        flushPendingCandidates: vi.fn()
      }
    );

    expect(getOrCreatePeerEntry).not.toHaveBeenCalled();
  });

  it("drops reordered signals from an older connection generation", async () => {
    const transport = new SignalingTransport({
      roomId: "room_1",
      localPeerId: "peer_a",
      sendSignal: vi.fn()
    });
    const getOrCreatePeerEntry = vi.fn(async () => buildSignalEntry());
    const handlers = {
      getOrCreatePeerEntry,
      runPeerOperation: async <T>(
        _entry: ReturnType<typeof buildSignalEntry>,
        task: () => Promise<T>
      ) => task(),
      applyRemoteDescription: vi.fn(),
      flushPendingCandidates: vi.fn()
    };

    await transport.handleIncomingSignal(
      buildSignal({
        connectionGeneration: 3,
        sequence: 20
      }),
      handlers
    );
    await transport.handleIncomingSignal(
      buildSignal({
        connectionGeneration: 2,
        sequence: 99
      }),
      handlers
    );
    await transport.handleIncomingSignal(
      buildSignal({
        connectionGeneration: 3,
        sequence: 20
      }),
      handlers
    );

    expect(getOrCreatePeerEntry).toHaveBeenCalledTimes(1);
  });
});
