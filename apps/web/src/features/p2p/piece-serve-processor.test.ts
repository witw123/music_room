import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedPiece,
  getCachedPiecesByIndexes,
  getCachedPieceIndexes,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash
} from "@/lib/indexeddb";
import { decodePieceFrame } from "./piece-frame-codec";
import { PieceServeProcessor } from "./piece-serve-processor";

vi.mock("@/lib/indexeddb", () => ({
  getCachedPiece: vi.fn(),
  getCachedPiecesByIndexes: vi.fn(async () => []),
  getCachedPieceIndexes: vi.fn(async () => []),
  getTrackPieceManifest: vi.fn(async () => null),
  getTrackPieceManifestByFileHash: vi.fn(async () => null),
  localCacheOwnerKey: "__local__"
}));

describe("PieceServeProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves a cached piece with persisted manifest metadata", async () => {
    const payload = new TextEncoder().encode("piece-1").buffer;
    const hash = await sha256Hex(payload);
    vi.mocked(getCachedPiece).mockResolvedValueOnce({
      pieceId: "track_1:peer_a:0",
      trackId: "track_1",
      peerId: "peer_a",
      chunkIndex: 0,
      chunkSize: payload.byteLength,
      hash,
      createdAt: "2026-04-03T16:30:00.000Z",
      payload
    });
    vi.mocked(getTrackPieceManifest).mockResolvedValueOnce({
      trackId: "track_1",
      fileHash: "hash-track-1",
      mimeType: "audio/flac",
      codec: "flac",
      sizeBytes: payload.byteLength,
      durationMs: 1000,
      totalChunks: 4,
      chunkSize: payload.byteLength,
      updatedAt: "2026-04-03T16:30:00.000Z"
    });
    const enqueueSendItem = vi.fn();
    const onPieceServed = vi.fn();
    const processor = new PieceServeProcessor({
      localPeerId: "peer_a",
      maxDataChannelPayloadBytes: 48 * 1024,
      enqueueSendItem,
      onPieceServed
    });

    await processor.servePieceRequest({
      peerId: "peer_b",
      entry: openEntry(),
      request: {
        trackId: "track_1",
        chunkIndex: 0,
        requestId: "request-1"
      }
    });

    expect(getCachedPieceIndexes).not.toHaveBeenCalled();
    expect(enqueueSendItem).toHaveBeenCalledTimes(1);
    const queuedFrame = enqueueSendItem.mock.calls[0]?.[2]?.data;
    expect(queuedFrame).toBeInstanceOf(ArrayBuffer);
    expect(decodePieceFrame(queuedFrame)).toMatchObject({
      header: {
        kind: "send-piece",
        requestId: "request-1",
        trackId: "track_1",
        chunkIndex: 0,
        totalChunks: 4,
        chunkSize: payload.byteLength,
        mimeType: "audio/flac",
        pieceHash: hash
      },
      payload
    });
    expect(onPieceServed).toHaveBeenCalledWith({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndex: 0,
      payloadBytes: payload.byteLength,
      requestId: "request-1"
    });
  });

  it("serves batched cached piece requests with one IndexedDB read", async () => {
    const firstPayload = new TextEncoder().encode("piece-0").buffer;
    const secondPayload = new TextEncoder().encode("piece-1").buffer;
    const firstHash = await sha256Hex(firstPayload);
    const secondHash = await sha256Hex(secondPayload);
    vi.mocked(getCachedPiecesByIndexes).mockResolvedValueOnce([
      {
        pieceId: "hash-track-1:7:__local__:0",
        trackId: "track_1",
        fileHash: "hash-track-1",
        peerId: "peer_a",
        ownerKey: "__local__",
        chunkIndex: 0,
        chunkSize: 7,
        hash: firstHash,
        createdAt: "2026-04-03T16:30:00.000Z",
        payload: firstPayload
      },
      {
        pieceId: "hash-track-1:7:__local__:1",
        trackId: "track_1",
        fileHash: "hash-track-1",
        peerId: "peer_a",
        ownerKey: "__local__",
        chunkIndex: 1,
        chunkSize: 7,
        hash: secondHash,
        createdAt: "2026-04-03T16:30:00.000Z",
        payload: secondPayload
      }
    ]);
    vi.mocked(getTrackPieceManifest).mockResolvedValueOnce({
      trackId: "track_1",
      fileHash: "hash-track-1",
      mimeType: "audio/flac",
      codec: "flac",
      sizeBytes: firstPayload.byteLength + secondPayload.byteLength,
      durationMs: 1000,
      totalChunks: 2,
      chunkSize: 7,
      updatedAt: "2026-04-03T16:30:00.000Z"
    });
    const enqueueSendItem = vi.fn();
    const onPieceServed = vi.fn();
    const processor = new PieceServeProcessor({
      localPeerId: "peer_a",
      maxDataChannelPayloadBytes: 48 * 1024,
      resolveTrackCacheIdentity: () => ({
        fileHash: "hash-track-1",
        ownerKey: "__local__",
        chunkSize: 7
      }),
      enqueueSendItem,
      onPieceServed
    });

    await processor.servePieceRequests({
      peerId: "peer_b",
      entry: openEntry(),
      requests: [
        { trackId: "track_1", chunkIndex: 0, requestId: "request-1" },
        { trackId: "track_1", chunkIndex: 1, requestId: "request-1" }
      ]
    });

    expect(getCachedPiece).not.toHaveBeenCalled();
    expect(getCachedPiecesByIndexes).toHaveBeenCalledWith(
      "track_1",
      "peer_a",
      [0, 1],
      {
        fileHash: "hash-track-1",
        ownerKey: "__local__",
        chunkSize: 7
      }
    );
    expect(enqueueSendItem).toHaveBeenCalledTimes(2);
    expect(onPieceServed.mock.calls.map(([payload]) => payload.chunkIndex)).toEqual([0, 1]);
  });

  it("uses fallback payloads when the local cached piece is missing", async () => {
    const payload = new TextEncoder().encode("fallback-piece").buffer;
    const hash = await sha256Hex(payload);
    vi.mocked(getCachedPiece).mockResolvedValueOnce(null);
    const resolvePieceRequestFallback = vi.fn(async () => ({
      payload,
      hash,
      totalChunks: 2,
      chunkSize: payload.byteLength,
      mimeType: "audio/mpeg"
    }));
    const enqueueSendItem = vi.fn();
    const onPieceServeMiss = vi.fn();
    const processor = new PieceServeProcessor({
      localPeerId: "peer_a",
      maxDataChannelPayloadBytes: 48 * 1024,
      resolvePieceRequestFallback,
      enqueueSendItem,
      onPieceServeMiss
    });

    await processor.servePieceRequest({
      peerId: "peer_b",
      entry: openEntry(),
      request: {
        trackId: "track_1",
        chunkIndex: 1
      }
    });

    expect(resolvePieceRequestFallback).toHaveBeenCalledWith({
      trackId: "track_1",
      chunkIndex: 1
    });
    expect(onPieceServeMiss).not.toHaveBeenCalled();
    expect(enqueueSendItem).toHaveBeenCalledTimes(1);
    expect(decodePieceFrame(enqueueSendItem.mock.calls[0]?.[2]?.data)).toMatchObject({
      header: {
        kind: "send-piece",
        trackId: "track_1",
        chunkIndex: 1,
        totalChunks: 2,
        chunkSize: payload.byteLength,
        mimeType: "audio/mpeg",
        pieceHash: hash
      },
      payload
    });
  });

  it("serves cached pieces with file-hash manifest metadata when the room track id changed", async () => {
    const payload = new TextEncoder().encode("piece-1").buffer;
    const hash = await sha256Hex(payload);
    vi.mocked(getCachedPiece).mockResolvedValueOnce({
      pieceId: "hash-track-1:7:__local__:0",
      trackId: "track_old",
      fileHash: "hash-track-1",
      peerId: "peer_a",
      ownerKey: "__local__",
      chunkIndex: 0,
      chunkSize: payload.byteLength,
      hash,
      createdAt: "2026-04-03T16:30:00.000Z",
      payload
    });
    vi.mocked(getTrackPieceManifest).mockResolvedValueOnce(undefined);
    vi.mocked(getTrackPieceManifestByFileHash).mockResolvedValueOnce({
      trackId: "track_old",
      fileHash: "hash-track-1",
      mimeType: "audio/flac",
      codec: "flac",
      sizeBytes: payload.byteLength * 5,
      durationMs: 5000,
      totalChunks: 5,
      chunkSize: payload.byteLength,
      updatedAt: "2026-04-03T16:30:00.000Z"
    });
    const enqueueSendItem = vi.fn();
    const processor = new PieceServeProcessor({
      localPeerId: "peer_a",
      maxDataChannelPayloadBytes: 48 * 1024,
      resolveTrackCacheIdentity: () => ({
        fileHash: "hash-track-1",
        ownerKey: "__local__",
        chunkSize: payload.byteLength
      }),
      enqueueSendItem
    });

    await processor.servePieceRequest({
      peerId: "peer_b",
      entry: openEntry(),
      request: {
        trackId: "track_new",
        chunkIndex: 0
      }
    });

    expect(getTrackPieceManifestByFileHash).toHaveBeenCalledWith("hash-track-1");
    expect(enqueueSendItem).toHaveBeenCalledTimes(1);
    expect(decodePieceFrame(enqueueSendItem.mock.calls[0]?.[2]?.data)).toMatchObject({
      header: {
        kind: "send-piece",
        trackId: "track_new",
        chunkIndex: 0,
        totalChunks: 5,
        chunkSize: payload.byteLength,
        mimeType: "audio/flac",
        pieceHash: hash
      },
      payload
    });
  });

  it("fragments oversized frames before enqueueing them for the data channel", async () => {
    const payload = new Uint8Array(128 * 1024).fill(7).buffer;
    const hash = await sha256Hex(payload);
    vi.mocked(getCachedPiece).mockResolvedValueOnce({
      pieceId: "track_1:peer_a:0",
      trackId: "track_1",
      peerId: "peer_a",
      chunkIndex: 0,
      chunkSize: payload.byteLength,
      hash,
      createdAt: "2026-04-03T16:30:00.000Z",
      payload
    });
    vi.mocked(getTrackPieceManifest).mockResolvedValueOnce({
      trackId: "track_1",
      fileHash: "hash-track-1",
      mimeType: "audio/flac",
      codec: "flac",
      sizeBytes: payload.byteLength,
      durationMs: 1000,
      totalChunks: 1,
      chunkSize: payload.byteLength,
      updatedAt: "2026-04-03T16:30:00.000Z"
    });
    const enqueueSendItem = vi.fn();
    const processor = new PieceServeProcessor({
      localPeerId: "peer_a",
      maxDataChannelPayloadBytes: 48 * 1024,
      enqueueSendItem
    });

    await processor.servePieceRequest({
      peerId: "peer_b",
      entry: openEntry(),
      request: {
        trackId: "track_1",
        chunkIndex: 0
      }
    });

    expect(enqueueSendItem.mock.calls.length).toBeGreaterThan(1);
    expect(
      enqueueSendItem.mock.calls.every(([, , item]) => item.data.byteLength <= 48 * 1024)
    ).toBe(true);
  });

  it("reports a serve miss when the data channel is not open", async () => {
    const onPieceServeMiss = vi.fn();
    const enqueueSendItem = vi.fn();
    const processor = new PieceServeProcessor({
      localPeerId: "peer_a",
      maxDataChannelPayloadBytes: 48 * 1024,
      enqueueSendItem,
      onPieceServeMiss
    });

    await processor.servePieceRequest({
      peerId: "peer_b",
      entry: {
        channel: {
          readyState: "closed"
        }
      },
      request: {
        trackId: "track_1",
        chunkIndex: 0
      }
    });

    expect(getCachedPiece).not.toHaveBeenCalled();
    expect(enqueueSendItem).not.toHaveBeenCalled();
    expect(onPieceServeMiss).toHaveBeenCalledWith({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndex: 0,
      reason: "channel-not-open"
    });
  });
});

function openEntry() {
  return {
    channel: {
      readyState: "open" as const
    }
  };
}

async function sha256Hex(payload: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
