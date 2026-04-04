import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheTrackPieces,
  getCachedPiece,
  getCachedPieceIndexes,
  getTrackPieceManifest
} from "@/lib/indexeddb";
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
          chunkSize: 128 * 1024,
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
          chunkSize: 128 * 1024,
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
  sentMessages: unknown[] = [];

  send(payload: unknown) {
    this.sentMessages.push(payload);
  }

  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];
  connectionState: RTCPeerConnectionState = "connected";
  signalingState: RTCSignalingState = "stable";
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  channel = new FakeDataChannel();

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }

  createDataChannel() {
    return this.channel as unknown as RTCDataChannel;
  }

  async createOffer() {
    this.signalingState = "have-local-offer";
    return { type: "offer" as const, sdp: "fake-offer" };
  }

  async setLocalDescription(description?: RTCSessionDescriptionInit | null) {
    this.localDescription = description ?? null;
    if (description?.type === "offer") {
      this.signalingState = "have-local-offer";
    }
    if (description?.type === "answer") {
      this.signalingState = "stable";
    }
    return undefined;
  }

  async createAnswer() {
    return { type: "answer" as const, sdp: "fake-answer" };
  }

  async setRemoteDescription(description?: RTCSessionDescriptionInit | null) {
    this.remoteDescription = description ?? null;
    if (description?.type === "offer") {
      this.signalingState = "have-remote-offer";
    }
    if (description?.type === "answer") {
      this.signalingState = "stable";
    }
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
  getCachedPieceIndexes: vi.fn(async () => []),
  getTrackPieceManifest: vi.fn(async () => null)
}));

describe("P2PMesh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("RTCPeerConnection", FakeRTCPeerConnection);
    FakeRTCPeerConnection.instances = [];
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

  it("does not reject when queued ICE candidates fail during offer handling", async () => {
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived: vi.fn()
    });

    await expect(
      mesh.handleSignal({
        roomId: "room_1",
        fromPeerId: "peer_b",
        toPeerId: "peer_a",
        channelKind: "data",
        type: "candidate",
        payload: {
          candidate: "candidate-1"
        }
      })
    ).resolves.toBeUndefined();

    const peer = FakeRTCPeerConnection.instances[0];
    expect(peer).toBeDefined();

    vi.spyOn(peer!, "addIceCandidate").mockRejectedValueOnce(new Error("candidate-race"));

    await expect(
      mesh.handleSignal({
        roomId: "room_1",
        fromPeerId: "peer_b",
        toPeerId: "peer_a",
        channelKind: "data",
        type: "offer",
        payload: {
          type: "offer",
          sdp: "fake-offer"
        }
      })
    ).resolves.toBeUndefined();
  });

  it("does not reject when applying a live ICE candidate fails", async () => {
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived: vi.fn()
    });

    await expect(
      mesh.handleSignal({
        roomId: "room_1",
        fromPeerId: "peer_b",
        toPeerId: "peer_a",
        channelKind: "data",
        type: "offer",
        payload: {
          type: "offer",
          sdp: "fake-offer"
        }
      })
    ).resolves.toBeUndefined();

    const peer = FakeRTCPeerConnection.instances[0];
    expect(peer?.remoteDescription).toEqual({
      type: "offer",
      sdp: "fake-offer"
    });

    vi.spyOn(peer!, "addIceCandidate").mockRejectedValueOnce(new Error("candidate-race"));

    await expect(
      mesh.handleSignal({
        roomId: "room_1",
        fromPeerId: "peer_b",
        toPeerId: "peer_a",
        channelKind: "data",
        type: "candidate",
        payload: {
          candidate: "candidate-2"
        }
      })
    ).resolves.toBeUndefined();
  });

  it("recreates a failed peer connection on the next sync", async () => {
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived: vi.fn()
    });

    await mesh.syncPeers(["peer_b"]);
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);

    const firstPeer = FakeRTCPeerConnection.instances[0]!;
    firstPeer.connectionState = "failed";
    firstPeer.onconnectionstatechange?.();

    await mesh.syncPeers(["peer_b"]);

    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
  });

  it("rebuilds a peer when the data channel never becomes ready", async () => {
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived: vi.fn()
    });

    await mesh.syncPeers(["peer_b"]);
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);

    const firstPeer = FakeRTCPeerConnection.instances[0]!;
    firstPeer.channel.readyState = "connecting";

    await vi.advanceTimersByTimeAsync(5_500);

    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
  });

  it("batches received piece validation and IndexedDB writes", async () => {
    const onPieceReceived = vi.fn();
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived
    });

    const firstPayload = new TextEncoder().encode("piece-1").buffer;
    const secondPayload = new TextEncoder().encode("piece-2").buffer;
    const firstHash = await sha256Hex(firstPayload);
    const secondHash = await sha256Hex(secondPayload);

    (mesh as any).pendingIncomingPieces.push(
      {
        peerId: "peer_b",
        message: buildIncomingPieceMessage({
          trackId: "track_1",
          chunkIndex: 0,
          totalChunks: 2,
          mimeType: "audio/flac",
          pieceHash: firstHash,
          payload: firstPayload
        })
      },
      {
        peerId: "peer_b",
        message: buildIncomingPieceMessage({
          trackId: "track_1",
          chunkIndex: 1,
          totalChunks: 2,
          mimeType: "audio/flac",
          pieceHash: secondHash,
          payload: secondPayload
        })
      }
    );

    await (mesh as any).flushIncomingPieces();

    expect(cacheTrackPieces).toHaveBeenCalledWith([
      expect.objectContaining({
        trackId: "track_1",
        chunkIndex: 0,
        hash: firstHash,
        payload: firstPayload
      }),
      expect.objectContaining({
        trackId: "track_1",
        chunkIndex: 1,
        hash: secondHash,
        payload: secondPayload
      })
    ]);
    expect(onPieceReceived).toHaveBeenCalledTimes(2);
  });

  it("uses cached manifest metadata when serving a requested piece", async () => {
    const piecePayload = new TextEncoder().encode("piece-1").buffer;
    vi.mocked(getCachedPiece).mockResolvedValueOnce({
      pieceId: "track_1:peer_a:0",
      trackId: "track_1",
      peerId: "peer_a",
      chunkIndex: 0,
      chunkSize: piecePayload.byteLength,
      hash: await sha256Hex(piecePayload),
      createdAt: "2026-04-03T16:30:00.000Z",
      payload: piecePayload
    });
    vi.mocked(getTrackPieceManifest).mockResolvedValueOnce({
      trackId: "track_1",
      fileHash: "hash-track-1",
      mimeType: "audio/flac",
      codec: "flac",
      sizeBytes: piecePayload.byteLength,
      durationMs: 1000,
      totalChunks: 4,
      chunkSize: piecePayload.byteLength,
      updatedAt: "2026-04-03T16:30:00.000Z"
    });

    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived: vi.fn()
    });

    await mesh.syncPeers(["peer_b"]);
    const channel = FakeRTCPeerConnection.instances[0]?.channel;
    await channel?.onmessage?.({
      data: JSON.stringify({
        kind: "request-piece",
        trackId: "track_1",
        chunkIndex: 0
      })
    } as MessageEvent<string>);

    expect(getCachedPieceIndexes).not.toHaveBeenCalled();
    expect(channel?.sentMessages[1] ?? channel?.sentMessages[0]).toBeInstanceOf(ArrayBuffer);
  });
});

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildBinaryPieceMessage(input: {
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize?: number;
  mimeType: string;
  pieceHash: string;
  payload: ArrayBuffer;
}) {
  const header = {
    kind: "send-piece" as const,
    trackId: input.trackId,
    chunkIndex: input.chunkIndex,
    totalChunks: input.totalChunks,
    chunkSize: input.chunkSize ?? input.payload.byteLength,
    mimeType: input.mimeType,
    pieceHash: input.pieceHash
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const payloadBytes = new Uint8Array(input.payload);
  const frame = new Uint8Array(4 + headerBytes.byteLength + payloadBytes.byteLength);

  new DataView(frame.buffer).setUint32(0, headerBytes.byteLength, false);
  frame.set(headerBytes, 4);
  frame.set(payloadBytes, 4 + headerBytes.byteLength);

  return frame.buffer;
}

function buildIncomingPieceMessage(input: {
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize?: number;
  mimeType: string;
  pieceHash: string;
  payload: ArrayBuffer;
}) {
  return {
    kind: "send-piece" as const,
    trackId: input.trackId,
    chunkIndex: input.chunkIndex,
    totalChunks: input.totalChunks,
    chunkSize: input.chunkSize ?? input.payload.byteLength,
    mimeType: input.mimeType,
    pieceHash: input.pieceHash,
    header: {
      kind: "send-piece" as const,
      trackId: input.trackId,
      chunkIndex: input.chunkIndex,
      totalChunks: input.totalChunks,
      chunkSize: input.chunkSize ?? input.payload.byteLength,
      mimeType: input.mimeType,
      pieceHash: input.pieceHash
    },
    payload: input.payload
  };
}
