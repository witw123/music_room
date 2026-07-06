import { cacheTrackPieces } from "@/lib/indexeddb";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PieceInboundProcessor } from "./piece-inbound-processor";
import type { PendingPieceRequest } from "./piece-request-tracker";
import type { BinaryPieceMessage } from "./piece-frame-codec";

vi.mock("@/lib/indexeddb", () => ({
  cacheTrackPieces: vi.fn(),
  localCacheOwnerKey: "__local__"
}));

describe("PieceInboundProcessor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("validates a batch, reports received pieces, and persists accepted payloads", async () => {
    const firstPayload = new TextEncoder().encode("piece-1").buffer;
    const secondPayload = new TextEncoder().encode("piece-2").buffer;
    const firstHash = await sha256Hex(firstPayload);
    const secondHash = await sha256Hex(secondPayload);
    const onPieceReceived = vi.fn(() => true);
    const processor = new PieceInboundProcessor({
      batchSize: 8,
      localPeerId: "peer_a",
      resolveManifestHeader: vi.fn(async (trackId) => ({
        totalChunks: 2,
        chunkSize: 7,
        mimeType: "audio/flac",
        pieceHashes: trackId === "track_1" ? [firstHash, secondHash] : undefined
      })),
      rememberManifestHeader: vi.fn(),
      resolveTrackCacheIdentity: () => ({
        fileHash: "hash-track-1"
      }),
      onPieceReceived
    });

    processor.enqueue({
      peerId: "peer_b",
      message: buildIncomingPieceMessage({
        trackId: "track_1",
        chunkIndex: 0,
        totalChunks: 2,
        mimeType: "audio/flac",
        pieceHash: firstHash,
        payload: firstPayload
      })
    });
    processor.enqueue({
      peerId: "peer_b",
      message: buildIncomingPieceMessage({
        trackId: "track_1",
        chunkIndex: 1,
        totalChunks: 2,
        mimeType: "audio/flac",
        pieceHash: secondHash,
        payload: secondPayload
      })
    });

    await processor.flush();
    await processor.awaitPersistence();

    expect(onPieceReceived).toHaveBeenCalledTimes(2);
    expect(cacheTrackPieces).toHaveBeenCalledWith([
      expect.objectContaining({
        pieceId: "hash-track-1:7:__local__:0",
        trackId: "track_1",
        fileHash: "hash-track-1",
        peerId: "peer_a",
        ownerKey: "__local__",
        chunkIndex: 0,
        chunkSize: firstPayload.byteLength,
        hash: firstHash,
        payload: firstPayload
      }),
      expect.objectContaining({
        pieceId: "hash-track-1:7:__local__:1",
        trackId: "track_1",
        fileHash: "hash-track-1",
        peerId: "peer_a",
        ownerKey: "__local__",
        chunkIndex: 1,
        chunkSize: secondPayload.byteLength,
        hash: secondHash,
        payload: secondPayload
      })
    ]);
  });

  it("calls persisted callbacks only after the IndexedDB write finishes", async () => {
    let resolvePersist: () => void = () => undefined;
    const persistPromise = new Promise<void>((resolve) => {
      resolvePersist = resolve;
    });
    vi.mocked(cacheTrackPieces).mockImplementationOnce(() => persistPromise);
    const payload = new TextEncoder().encode("piece-1").buffer;
    const hash = await sha256Hex(payload);
    const onPieceReceived = vi.fn(() => true);
    const onPiecePersisted = vi.fn();
    const processor = new PieceInboundProcessor({
      batchSize: 8,
      localPeerId: "peer_a",
      resolveManifestHeader: vi.fn(async () => ({
        totalChunks: 1,
        chunkSize: payload.byteLength,
        mimeType: "audio/flac",
        pieceHashes: [hash]
      })),
      rememberManifestHeader: vi.fn(),
      onPieceReceived,
      onPiecePersisted
    });

    processor.enqueue({
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

    await processor.flush();
    await Promise.resolve();

    expect(onPieceReceived).toHaveBeenCalledTimes(1);
    expect(cacheTrackPieces).toHaveBeenCalledTimes(1);
    expect(onPiecePersisted).not.toHaveBeenCalled();

    resolvePersist();
    await processor.awaitPersistence();

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

  it("reports validation failures through the request-timeout callback", async () => {
    const payload = new TextEncoder().encode("piece-1").buffer;
    const onPieceRequestTimeout = vi.fn();
    const onPieceReceived = vi.fn(() => true);
    const processor = new PieceInboundProcessor({
      batchSize: 8,
      localPeerId: "peer_a",
      resolveManifestHeader: vi.fn(async () => ({
        totalChunks: 1,
        chunkSize: payload.byteLength,
        mimeType: "audio/flac",
        pieceHashes: ["not-the-payload-hash"]
      })),
      rememberManifestHeader: vi.fn(),
      onPieceReceived,
      onPieceRequestTimeout
    });

    processor.enqueue({
      peerId: "peer_b",
      message: buildIncomingPieceMessage({
        trackId: "track_1",
        chunkIndex: 0,
        totalChunks: 1,
        mimeType: "audio/flac",
        pieceHash: "not-the-payload-hash",
        payload
      }),
      pendingRequest: {
        peerId: "peer_b",
        requestId: "request-1",
        expectedTotalChunks: 1,
        requestedAtMs: Date.now() - 25,
        timeoutMs: 1_000,
        timeoutId: setTimeout(() => undefined, 1_000)
      } satisfies PendingPieceRequest
    });

    await processor.flush();
    await processor.awaitPersistence();

    expect(onPieceReceived).not.toHaveBeenCalled();
    expect(cacheTrackPieces).not.toHaveBeenCalled();
    expect(onPieceRequestTimeout).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "peer_b",
        trackId: "track_1",
        chunkIndex: 0,
        requestId: "request-1",
        requestDurationMs: 25
      })
    );
  });
});

function buildIncomingPieceMessage(input: {
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize?: number;
  mimeType: string;
  pieceHash: string;
  payload: ArrayBuffer;
}): BinaryPieceMessage {
  return {
    kind: "send-piece",
    trackId: input.trackId,
    chunkIndex: input.chunkIndex,
    totalChunks: input.totalChunks,
    chunkSize: input.chunkSize ?? input.payload.byteLength,
    mimeType: input.mimeType,
    pieceHash: input.pieceHash,
    header: {
      kind: "send-piece",
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

async function sha256Hex(payload: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
