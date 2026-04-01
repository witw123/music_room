import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { P2PMesh } from "./mesh";
import { getMissingChunkIndexes, summarizeTrackAvailability } from "./index";

describe("p2p feature helpers", () => {
  it("returns only missing chunk indexes up to the requested limit", () => {
    expect(getMissingChunkIndexes(10, [0, 1, 4, 8], 3)).toEqual([2, 3, 5]);
  });

  it("summarizes local and peer chunk availability for a track", () => {
    const summary = summarizeTrackAvailability(
      "track_42",
      [
        {
          roomId: "room_1",
          trackId: "track_42",
          ownerPeerId: "peer_local",
          nickname: "Host",
          totalChunks: 6,
          availableChunks: [0, 1, 2],
          source: "live_upload",
          announcedAt: new Date().toISOString()
        },
        {
          roomId: "room_1",
          trackId: "track_42",
          ownerPeerId: "peer_remote",
          nickname: "Guest",
          totalChunks: 6,
          availableChunks: [0, 1, 2, 3, 4, 5],
          source: "local_cache",
          announcedAt: new Date().toISOString()
        }
      ],
      "peer_local"
    );

    expect(summary.peerCount).toBe(2);
    expect(summary.localChunkCount).toBe(3);
    expect(summary.totalChunks).toBe(6);
    expect(summary.completionRatio).toBe(0.5);
    expect(summary.sources).toEqual([
      "Host (live_upload)",
      "Guest (local_cache)"
    ]);
  });
});

class FakeDataChannel {
  readyState: RTCDataChannelState = "open";
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: (() => void) | null = null;
  sentMessages: string[] = [];

  send(payload: string) {
    this.sentMessages.push(payload);
  }

  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
}

class FakeRTCPeerConnection {
  connectionState: RTCPeerConnectionState = "connected";
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  channel = new FakeDataChannel();

  createDataChannel() {
    return this.channel as unknown as RTCDataChannel;
  }

  async createOffer() {
    return { type: "offer" as const, sdp: "fake-offer" };
  }

  async setLocalDescription() {
    return undefined;
  }

  async createAnswer() {
    return { type: "answer" as const, sdp: "fake-answer" };
  }

  async setRemoteDescription() {
    return undefined;
  }

  async addIceCandidate() {
    return undefined;
  }

  close() {
    this.connectionState = "closed";
  }
}

vi.mock("@/lib/indexeddb", () => ({
  cacheTrackPieces: vi.fn(),
  getCachedPiece: vi.fn(),
  getCachedPieceIndexes: vi.fn(async () => [])
}));

describe("P2PMesh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("RTCPeerConnection", FakeRTCPeerConnection);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("clears pending piece timeouts when the mesh is destroyed", async () => {
    const onPieceRequestTimeout = vi.fn();
    const sendSignal = vi.fn();
    const mesh = new P2PMesh("room_1", "peer_a", sendSignal, {
      onPieceReceived: vi.fn(),
      onPieceRequestTimeout
    });

    await mesh.syncPeers(["peer_b"]);
    expect(mesh.requestPiece("peer_b", "track_1", 0, undefined, 1000)).toBe(true);

    mesh.destroy();
    await vi.advanceTimersByTimeAsync(1200);

    expect(onPieceRequestTimeout).not.toHaveBeenCalled();
  });

  it("clears pending piece timeouts when a peer is removed", async () => {
    const onPieceRequestTimeout = vi.fn();
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived: vi.fn(),
      onPieceRequestTimeout
    });

    await mesh.syncPeers(["peer_b"]);
    expect(mesh.requestPiece("peer_b", "track_1", 0, undefined, 1000)).toBe(true);

    await mesh.syncPeers([]);
    await vi.advanceTimersByTimeAsync(1200);

    expect(onPieceRequestTimeout).not.toHaveBeenCalled();
  });

  it("only lets one side initiate the data channel offer", async () => {
    const sendSignalA = vi.fn();
    const sendSignalB = vi.fn();
    const meshA = new P2PMesh("room_1", "peer_a", sendSignalA, {
      onPieceReceived: vi.fn()
    });
    const meshB = new P2PMesh("room_1", "peer_b", sendSignalB, {
      onPieceReceived: vi.fn()
    });

    await meshA.syncPeers(["peer_b"]);
    await meshB.syncPeers(["peer_a"]);

    expect(sendSignalA).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "offer",
        toPeerId: "peer_b"
      })
    );
    expect(sendSignalB).not.toHaveBeenCalled();
  });
});
