import { describe, expect, it, vi } from "vitest";
import { createPeerEntry } from "./peer-connection-registry";
import {
  bindPeerConnectionEvents,
  buildPeerConnectionConfig,
  releasePeerConnectionEntry,
  resolveExistingPeerConnectionAction,
  shouldInitiatePeerConnection,
  toIceCandidatePayload
} from "./peer-connection-lifecycle";

class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  close = vi.fn(() => {
    this.readyState = "closed";
  });
}

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "connecting";
  iceConnectionState: RTCIceConnectionState = "checking";
  signalingState: RTCSignalingState = "stable";
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  close = vi.fn(() => {
    this.connectionState = "closed";
  });
}

function buildEntry(input: {
  connection?: FakePeerConnection;
  initiatorPeerId?: string | null;
  channel?: FakeDataChannel | null;
} = {}) {
  const entry = createPeerEntry({
    connection: (input.connection ?? new FakePeerConnection()) as unknown as RTCPeerConnection,
    initiatorPeerId: input.initiatorPeerId ?? null,
    nowMs: 100
  });
  entry.channel = (input.channel ?? null) as unknown as RTCDataChannel | null;
  return entry;
}

describe("peer connection lifecycle helpers", () => {
  it("serializes ICE candidate init fields for data peer signals", () => {
    expect(
      toIceCandidatePayload({
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
  });

  it("derives stable initiator and connection config decisions", () => {
    expect(shouldInitiatePeerConnection("peer_a", "peer_b")).toBe(true);
    expect(shouldInitiatePeerConnection("peer_b", "peer_a")).toBe(false);

    expect(
      buildPeerConnectionConfig({
        peerId: "peer_b",
        iceServers: [],
        resolveConnectionConfig: () => ({ bundlePolicy: "max-bundle" })
      })
    ).toEqual({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      bundlePolicy: "max-bundle"
    });

    expect(
      buildPeerConnectionConfig({
        peerId: "peer_b",
        iceServers: [{ urls: "turn:example.test" }]
      })
    ).toEqual({
      iceServers: [{ urls: "turn:example.test" }]
    });
  });

  it("releases failed existing peers and reuses active entries", () => {
    const failedEntry = buildEntry();
    Object.defineProperty(failedEntry.connection, "connectionState", {
      value: "failed",
      configurable: true
    });
    expect(
      resolveExistingPeerConnectionAction({
        entry: failedEntry
      })
    ).toBe("release");

    const activeEntry = buildEntry({ initiatorPeerId: "peer_a" });
    expect(
      resolveExistingPeerConnectionAction({
        entry: activeEntry
      })
    ).toBe("reuse");
  });

  it("releases peer entries through the registry and dependent cleanup hooks", () => {
    const channel = new FakeDataChannel();
    const connection = new FakePeerConnection();
    const entry = buildEntry({ connection, channel });
    entry.sendQueue = [{ data: "queued" }];
    entry.watchdogTimerId = setTimeout(() => undefined, 1_000);
    entry.reconnectTimerId = setTimeout(() => undefined, 1_000);
    const deleteIfCurrent = vi.fn(() => true);
    const clearPendingRequestsForPeer = vi.fn();
    const stopStatsSampling = vi.fn();
    const onDataBufferedAmountChange = vi.fn();

    releasePeerConnectionEntry({
      peerId: "peer_b",
      entry,
      deleteIfCurrent,
      clearPendingRequestsForPeer,
      stopStatsSampling,
      onDataBufferedAmountChange
    });

    expect(entry.releasing).toBe(true);
    expect(entry.sendQueue).toEqual([]);
    expect(entry.watchdogTimerId).toBeNull();
    expect(entry.reconnectTimerId).toBeNull();
    expect(deleteIfCurrent).toHaveBeenCalledWith("peer_b", entry);
    expect(clearPendingRequestsForPeer).toHaveBeenCalledWith("peer_b");
    expect(stopStatsSampling).toHaveBeenCalledWith(entry);
    expect(channel.close).toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalled();
    expect(onDataBufferedAmountChange).toHaveBeenCalledWith({
      peerId: "peer_b",
      bufferedAmountBytes: 0
    });
  });

  it("binds connection, ICE, data-channel, and candidate lifecycle callbacks", () => {
    const connection = new FakePeerConnection();
    const entry = buildEntry({ connection, channel: new FakeDataChannel() });
    entry.reconnectAttempts = 3;
    const sendCandidate = vi.fn();
    const onPeerConnectionChange = vi.fn();
    const onIceConnectionStateChange = vi.fn();
    const onPeerStalled = vi.fn();
    const schedulePeerReconnect = vi.fn();
    const schedulePeerWatchdog = vi.fn();
    const releasePeer = vi.fn();
    const bindChannel = vi.fn();

    bindPeerConnectionEvents({
      peerId: "peer_b",
      entry,
      localPeerId: "peer_a",
      connection: connection as unknown as RTCPeerConnection,
      autoReconnect: true,
      isCurrentEntry: () => true,
      isExpectedPeer: () => true,
      sendCandidate,
      onPeerConnectionChange,
      onIceConnectionStateChange,
      onPeerStalled,
      schedulePeerReconnect,
      schedulePeerWatchdog,
      releasePeer,
      bindChannel
    });

    connection.onicecandidate?.({
      candidate: { toJSON: () => ({ candidate: "candidate-1" }) }
    } as RTCPeerConnectionIceEvent);
    expect(sendCandidate).toHaveBeenCalledWith("peer_b", { candidate: "candidate-1" });

    connection.connectionState = "connected";
    entry.channel = { readyState: "open" } as RTCDataChannel;
    connection.onconnectionstatechange?.();
    expect(entry.reconnectAttempts).toBe(0);
    expect(onPeerConnectionChange).toHaveBeenCalledWith({
      peerId: "peer_b",
      state: "connected"
    });
    expect(schedulePeerWatchdog).toHaveBeenCalledWith("peer_b", entry);

    connection.iceConnectionState = "connected";
    connection.oniceconnectionstatechange?.();
    expect(onIceConnectionStateChange).toHaveBeenCalledWith({
      peerId: "peer_b",
      state: "connected"
    });

    const remoteChannel = new FakeDataChannel();
    connection.ondatachannel?.({
      channel: remoteChannel
    } as unknown as RTCDataChannelEvent);
    expect(entry.channel).toBe(remoteChannel);
    expect(bindChannel).toHaveBeenCalledWith(
      "peer_b",
      entry,
      remoteChannel as unknown as RTCDataChannel
    );

    connection.connectionState = "failed";
    connection.onconnectionstatechange?.();
    expect(onPeerStalled).toHaveBeenCalledWith({
      peerId: "peer_b",
      reason: "connection-failed"
    });
    expect(schedulePeerReconnect).toHaveBeenCalledWith("peer_b", entry);
    expect(releasePeer).not.toHaveBeenCalled();
  });
});
