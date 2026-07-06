import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheTrackPieces,
  getCachedPiece,
  getCachedPieceIndexes,
  getTrackPieceManifest
} from "@/lib/indexeddb";
import { P2PMesh } from "./mesh";
import type { BinaryPieceFragmentMessage, BinaryPieceMessage } from "./piece-frame-codec";
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
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onbufferedamountlow: (() => void) | null = null;
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
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
  static nextRemoteDescriptionError: Error | null = null;
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
    if (description?.type === "answer" && FakeRTCPeerConnection.nextRemoteDescriptionError) {
      const error = FakeRTCPeerConnection.nextRemoteDescriptionError;
      FakeRTCPeerConnection.nextRemoteDescriptionError = null;
      throw error;
    }
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

type MeshTestAccess = {
  inboundPieces: {
    enqueue(item: { peerId: string; message: BinaryPieceMessage }): void;
    flush(): Promise<void>;
    awaitPersistence(): Promise<void>;
    pendingCount(): number;
  };
  handleIncomingPieceFragment(peerId: string, message: BinaryPieceFragmentMessage): void;
};

function getMeshTestAccess(mesh: P2PMesh): MeshTestAccess {
  return mesh as unknown as MeshTestAccess;
}

vi.mock("@/lib/indexeddb", () => ({
  cacheTrackPieces: vi.fn(),
  getCachedPiece: vi.fn(),
  getCachedPieceIndexes: vi.fn(async () => []),
  getTrackPieceManifest: vi.fn(async () => null),
  localCacheOwnerKey: "__local__"
}));

describe("P2PMesh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("RTCPeerConnection", FakeRTCPeerConnection);
    FakeRTCPeerConnection.instances = [];
    FakeRTCPeerConnection.nextRemoteDescriptionError = null;
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

  it("continues requesting new pieces when a batch overlaps an existing pending piece", async () => {
    const onPieceRequestSent = vi.fn();
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived: vi.fn(),
      onPieceRequestSent
    });

    await mesh.syncPeers(["peer_b"]);
    expect(mesh.requestPiece("peer_b", "track_1", 1, 4, 1_000)).toBe(true);
    expect(mesh.requestPieces("peer_b", "track_1", [1, 2], 4, 1_000)).toBe(true);

    expect(onPieceRequestSent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        peerId: "peer_b",
        trackId: "track_1",
        chunkIndexes: [2]
      })
    );
    const channel = FakeRTCPeerConnection.instances[0]?.channel;
    const pieceRequests = channel?.sentMessages
      .filter((message): message is string => typeof message === "string")
      .map((message) => JSON.parse(message))
      .filter((message) => message.kind === "request-piece" || message.kind === "request-pieces");
    expect(pieceRequests?.at(-1)).toMatchObject({
      kind: "request-piece",
      trackId: "track_1",
      chunkIndex: 2
    });
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

  it("does not create duplicate peers when syncPeers runs twice before the first offer settles", async () => {
    const sendSignal = vi.fn();
    const mesh = new P2PMesh("room_1", "peer_a", sendSignal, {
      onPieceReceived: vi.fn()
    });

    await Promise.all([mesh.syncPeers(["peer_b"]), mesh.syncPeers(["peer_b"])]);

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    expect(
      sendSignal.mock.calls.filter(
        ([payload]) => payload && typeof payload === "object" && (payload as { type?: string }).type === "offer"
      )
    ).toHaveLength(1);
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

  it("ignores a stale data answer once the peer has already returned to stable", async () => {
    const sendSignal = vi.fn();
    const mesh = new P2PMesh("room_1", "peer_a", sendSignal, {
      onPieceReceived: vi.fn()
    });

    await mesh.syncPeers(["peer_b"]);
    const peer = FakeRTCPeerConnection.instances[0]!;
    expect(peer.signalingState).toBe("have-local-offer");

    peer.signalingState = "stable";
    FakeRTCPeerConnection.nextRemoteDescriptionError = new Error(
      "Failed to set remote answer sdp: Called in wrong state: stable"
    );

    await expect(
      mesh.handleSignal({
        roomId: "room_1",
        fromPeerId: "peer_b",
        toPeerId: "peer_a",
        channelKind: "data",
        type: "answer",
        payload: {
          type: "answer",
          sdp: "stale-answer"
        }
      })
    ).resolves.toBeUndefined();
  });

  it("rebuilds a peer when the data channel never becomes ready", async () => {
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived: vi.fn()
    });

    await mesh.syncPeers(["peer_b"]);
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);

    const firstPeer = FakeRTCPeerConnection.instances[0]!;
    firstPeer.channel.readyState = "connecting";

    await vi.advanceTimersByTimeAsync(10_500);

    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
  });

  it("does not auto-recreate stalled peers when autoReconnect is disabled", async () => {
    const onPeerStalled = vi.fn();
    const mesh = new P2PMesh(
      "room_1",
      "peer_a",
      vi.fn(),
      {
        onPieceReceived: vi.fn(),
        onPeerStalled
      },
      [],
      {
        autoReconnect: false
      }
    );

    await mesh.syncPeers(["peer_b"]);
    const firstPeer = FakeRTCPeerConnection.instances[0]!;
    firstPeer.channel.readyState = "connecting";

    await vi.advanceTimersByTimeAsync(10_500);

    expect(onPeerStalled).toHaveBeenCalledWith({
      peerId: "peer_b",
      reason: "watchdog-timeout"
    });
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
  });

  it("can proactively restart ICE without recreating the peer", async () => {
    const sendSignal = vi.fn();
    const mesh = new P2PMesh("room_1", "peer_a", sendSignal, {
      onPieceReceived: vi.fn()
    });

    await mesh.syncPeers(["peer_b"]);
    const firstPeer = FakeRTCPeerConnection.instances[0]!;

    await mesh.restartIce("peer_b");

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    expect(sendSignal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "offer",
        toPeerId: "peer_b",
        channelKind: "data"
      })
    );
    expect(firstPeer.localDescription).toMatchObject({
      type: "offer",
      sdp: "fake-offer"
    });
  });

  it("batches received piece validation and IndexedDB writes", async () => {
    const onPieceReceived = vi.fn(() => true);
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived
    });

    const firstPayload = new TextEncoder().encode("piece-1").buffer;
    const secondPayload = new TextEncoder().encode("piece-2").buffer;
    const firstHash = await sha256Hex(firstPayload);
    const secondHash = await sha256Hex(secondPayload);
    const meshAccess = getMeshTestAccess(mesh);

    meshAccess.inboundPieces.enqueue(
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
      }
    );
    meshAccess.inboundPieces.enqueue(
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

    await meshAccess.inboundPieces.flush();
    await meshAccess.inboundPieces.awaitPersistence();

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

  it("calls persisted piece callbacks only after IndexedDB writes finish", async () => {
    let resolvePersist: () => void = () => undefined;
    const persistPromise = new Promise<void>((resolve) => {
      resolvePersist = resolve;
    });
    vi.mocked(cacheTrackPieces).mockImplementationOnce(() => persistPromise);
    const onPieceReceived = vi.fn(() => true);
    const onPiecePersisted = vi.fn();
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived,
      onPiecePersisted
    });
    const payload = new TextEncoder().encode("piece-1").buffer;
    const hash = await sha256Hex(payload);
    const meshAccess = getMeshTestAccess(mesh);

    meshAccess.inboundPieces.enqueue({
      peerId: "peer_b",
      message: buildIncomingPieceMessage({
        trackId: "track_1",
        chunkIndex: 0,
        totalChunks: 1,
        mimeType: "audio/flac",
        pieceHash: hash,
        payload
      })
    });

    await meshAccess.inboundPieces.flush();
    await Promise.resolve();

    expect(onPieceReceived).toHaveBeenCalledTimes(1);
    expect(cacheTrackPieces).toHaveBeenCalledTimes(1);
    expect(onPiecePersisted).not.toHaveBeenCalled();

    resolvePersist();
    await meshAccess.inboundPieces.awaitPersistence();

    expect(onPiecePersisted).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "peer_b",
        trackId: "track_1",
        chunkIndex: 0,
        totalChunks: 1,
        chunkSize: payload.byteLength,
        mimeType: "audio/flac",
        payloadBytes: payload.byteLength
      })
    );
  });

  it("skips IndexedDB writes when the runtime declines a received piece", async () => {
    const onPieceReceived = vi.fn(() => false);
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived
    });
    const payload = new TextEncoder().encode("piece-1").buffer;
    const hash = await sha256Hex(payload);
    const meshAccess = getMeshTestAccess(mesh);

    meshAccess.inboundPieces.enqueue({
      peerId: "peer_b",
      message: buildIncomingPieceMessage({
        trackId: "track_1",
        chunkIndex: 0,
        totalChunks: 1,
        mimeType: "audio/flac",
        pieceHash: hash,
        payload
      })
    });

    await meshAccess.inboundPieces.flush();
    await meshAccess.inboundPieces.awaitPersistence();

    expect(onPieceReceived).toHaveBeenCalledTimes(1);
    expect(cacheTrackPieces).not.toHaveBeenCalled();
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

  it("serves every chunk in a batched piece request", async () => {
    const payloads = await Promise.all(
      [0, 1, 2].map(async (chunkIndex) => {
        const payload = new TextEncoder().encode(`piece-${chunkIndex}`).buffer;
        return {
          chunkIndex,
          payload,
          hash: await sha256Hex(payload)
        };
      })
    );
    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      const piece = payloads.find((entry) => entry.chunkIndex === chunkIndex);
      if (!piece) {
        return null;
      }
      return {
        pieceId: `track_1:peer_a:${chunkIndex}`,
        trackId: "track_1",
        peerId: "peer_a",
        chunkIndex,
        chunkSize: piece.payload.byteLength,
        hash: piece.hash,
        createdAt: "2026-04-03T16:30:00.000Z",
        payload: piece.payload
      };
    });
    vi.mocked(getTrackPieceManifest).mockResolvedValue({
      trackId: "track_1",
      fileHash: "hash-track-1",
      mimeType: "audio/flac",
      codec: "flac",
      sizeBytes: payloads.reduce((sum, piece) => sum + piece.payload.byteLength, 0),
      durationMs: 1000,
      totalChunks: 3,
      chunkSize: payloads[0]!.payload.byteLength,
      updatedAt: "2026-04-03T16:30:00.000Z"
    });
    const onPieceServed = vi.fn();
    const onPieceRequestReceived = vi.fn();
    const onPieceServeMiss = vi.fn();
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived: vi.fn(),
      onPieceServed,
      onPieceRequestReceived,
      onPieceServeMiss
    });

    await mesh.syncPeers(["peer_b"]);
    const channel = FakeRTCPeerConnection.instances[0]?.channel;
    expect(channel).toBeDefined();
    expect(channel?.onmessage).toBeTypeOf("function");
    await channel?.onmessage?.({
      data: JSON.stringify({
        kind: "request-pieces",
        requestId: "request-1",
        trackId: "track_1",
        chunkIndexes: [0, 1, 2]
      })
    } as MessageEvent<string>);

    expect(onPieceRequestReceived).toHaveBeenCalledTimes(3);
    expect(onPieceServeMiss).not.toHaveBeenCalled();
    expect(onPieceServed).toHaveBeenCalledTimes(3);
    expect(onPieceServed.mock.calls.map(([payload]) => payload.chunkIndex)).toEqual([0, 1, 2]);
    const binaryFrames =
      channel?.sentMessages.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer) ??
      [];
    expect(binaryFrames).toHaveLength(3);
  });

  it("fragments oversized piece frames before sending over the data channel", async () => {
    const piecePayload = new Uint8Array(128 * 1024).fill(7).buffer;
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
      totalChunks: 1,
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

    const binaryFrames = channel?.sentMessages.filter(
      (message): message is ArrayBuffer => message instanceof ArrayBuffer
    ) ?? [];
    expect(binaryFrames.length).toBeGreaterThan(1);
    expect(binaryFrames.every((frame) => frame.byteLength <= 48 * 1024)).toBe(true);
  });

  it("reassembles fragmented piece frames before persisting the received piece", async () => {
    const onPieceReceived = vi.fn(() => true);
    const mesh = new P2PMesh("room_1", "peer_a", vi.fn(), {
      onPieceReceived
    });
    const piecePayload = new Uint8Array(128 * 1024).fill(9).buffer;
    const pieceHash = await sha256Hex(piecePayload);

    await mesh.syncPeers(["peer_b"]);
    expect(mesh.requestPiece("peer_b", "track_1", 0, 1, 1_000)).toBe(true);

    const fragmentMessages = buildIncomingPieceFragmentMessages({
      trackId: "track_1",
      chunkIndex: 0,
      totalChunks: 1,
      chunkSize: piecePayload.byteLength,
      mimeType: "audio/flac",
      pieceHash,
      payload: piecePayload
    });
    const meshAccess = getMeshTestAccess(mesh);

    for (const fragmentMessage of fragmentMessages) {
      meshAccess.handleIncomingPieceFragment("peer_b", fragmentMessage);
    }

    expect(meshAccess.inboundPieces.pendingCount()).toBe(1);
    await meshAccess.inboundPieces.flush();
    await meshAccess.inboundPieces.awaitPersistence();

    expect(onPieceReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: "track_1",
        chunkIndex: 0,
        payloadBytes: piecePayload.byteLength
      })
    );
    expect(cacheTrackPieces).toHaveBeenCalledWith([
      expect.objectContaining({
        trackId: "track_1",
        chunkIndex: 0,
        hash: pieceHash,
        payload: expect.any(ArrayBuffer)
      })
    ]);
  });
});

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

function buildIncomingPieceFragmentMessages(input: {
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize?: number;
  mimeType: string;
  pieceHash: string;
  payload: ArrayBuffer;
}) {
  const maxPayloadBytes = 48 * 1024;
  const fragmentPayloadSize = Math.max(8 * 1024, maxPayloadBytes - 1024);
  const payloadBytes = new Uint8Array(input.payload);
  const fragmentCount = Math.ceil(payloadBytes.byteLength / fragmentPayloadSize);
  const messages: Array<{
    kind: "send-piece-fragment";
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
    pieceHash: string;
    fragmentIndex: number;
    fragmentCount: number;
    header: {
      kind: "send-piece-fragment";
      trackId: string;
      chunkIndex: number;
      totalChunks: number;
      chunkSize: number;
      mimeType: string;
      pieceHash: string;
      fragmentIndex: number;
      fragmentCount: number;
    };
    payload: ArrayBuffer;
  }> = [];

  for (let fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
    const fragmentStart = fragmentIndex * fragmentPayloadSize;
    const fragmentEnd = Math.min(payloadBytes.byteLength, fragmentStart + fragmentPayloadSize);
    const fragmentPayload = payloadBytes.slice(fragmentStart, fragmentEnd).buffer;
    const header = {
      kind: "send-piece-fragment" as const,
      trackId: input.trackId,
      chunkIndex: input.chunkIndex,
      totalChunks: input.totalChunks,
      chunkSize: input.chunkSize ?? input.payload.byteLength,
      mimeType: input.mimeType,
      pieceHash: input.pieceHash,
      fragmentIndex,
      fragmentCount
    };

    messages.push({
      ...header,
      header,
      payload: fragmentPayload
    });
  }

  return messages;
}
