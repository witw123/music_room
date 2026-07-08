import { describe, expect, it, vi } from "vitest";
import { buildPieceFrames } from "./piece-frame-codec";
import { PieceMessageRouter } from "./piece-message-router";

describe("PieceMessageRouter", () => {
  it("serves single and batched piece requests", async () => {
    const servePieceRequest = vi.fn();
    const servePieceRequests = vi.fn();
    const onPieceRequestReceived = vi.fn();
    const router = new PieceMessageRouter({
      pieceServeBatchConcurrency: 2,
      incomingPieceFragmentTtlMs: 15_000,
      servePieceRequest,
      servePieceRequests,
      takePendingRequest: vi.fn(),
      enqueueInboundPiece: vi.fn(),
      onPieceRequestReceived
    });
    const entry = openEntry();

    await router.handleChannelMessage({
      peerId: "peer_b",
      entry,
      data: JSON.stringify({
        kind: "request-piece",
        trackId: "track_1",
        chunkIndex: 0
      })
    });
    await router.handleChannelMessage({
      peerId: "peer_b",
      entry,
      data: JSON.stringify({
        kind: "request-pieces",
        requestId: "request-1",
        trackId: "track_1",
        chunkIndexes: [2, 1, 1, 0]
      })
    });

    expect(onPieceRequestReceived.mock.calls.map(([payload]) => payload.chunkIndex)).toEqual([
      0,
      0,
      1,
      2
    ]);
    expect(servePieceRequest.mock.calls.map(([input]) => input.request)).toEqual([
      {
        trackId: "track_1",
        chunkIndex: 0
      }
    ]);
    expect(servePieceRequests).toHaveBeenCalledWith({
      peerId: "peer_b",
      entry,
      requests: [
        {
          trackId: "track_1",
          chunkIndex: 0,
          requestId: "request-1"
        },
        {
          trackId: "track_1",
          chunkIndex: 1,
          requestId: "request-1"
        },
        {
          trackId: "track_1",
          chunkIndex: 2,
          requestId: "request-1"
        }
      ]
    });
  });

  it("enqueues received pieces with their pending request metadata", async () => {
    const payload = new TextEncoder().encode("piece-1").buffer;
    const [frame] = buildPieceFrames(
      {
        requestId: "request-1",
        trackId: "track_1",
        chunkIndex: 0,
        totalChunks: 1,
        chunkSize: payload.byteLength,
        mimeType: "audio/flac",
        pieceHash: "hash-1"
      },
      payload,
      48 * 1024
    );
    const pendingRequest = {
      peerId: "peer_b",
      requestId: "request-1",
      expectedTotalChunks: 1,
      requestedAtMs: 1_000,
      timeoutMs: 500,
      timeoutId: setTimeout(() => undefined, 500)
    };
    const enqueueInboundPiece = vi.fn();
    const router = new PieceMessageRouter({
      pieceServeBatchConcurrency: 2,
      incomingPieceFragmentTtlMs: 15_000,
      servePieceRequest: vi.fn(),
      takePendingRequest: vi.fn(() => pendingRequest),
      enqueueInboundPiece,
      onPieceRequestReceived: vi.fn()
    });

    await router.handleChannelMessage({
      peerId: "peer_b",
      entry: openEntry(),
      data: frame!.data
    });

    expect(enqueueInboundPiece).toHaveBeenCalledWith({
      peerId: "peer_b",
      message: expect.objectContaining({
        kind: "send-piece",
        trackId: "track_1",
        chunkIndex: 0,
        payload
      }),
      pendingRequest
    });
  });

  it("assembles fragments before enqueueing the incoming piece", async () => {
    const payload = new Uint8Array(128 * 1024).fill(7).buffer;
    const frames = buildPieceFrames(
      {
        requestId: "request-1",
        trackId: "track_1",
        chunkIndex: 0,
        totalChunks: 1,
        chunkSize: payload.byteLength,
        mimeType: "audio/flac",
        pieceHash: "hash-1"
      },
      payload,
      48 * 1024
    );
    const enqueueInboundPiece = vi.fn();
    const router = new PieceMessageRouter({
      pieceServeBatchConcurrency: 2,
      incomingPieceFragmentTtlMs: 15_000,
      servePieceRequest: vi.fn(),
      takePendingRequest: vi.fn(() => null),
      enqueueInboundPiece,
      onPieceRequestReceived: vi.fn()
    });

    for (const frame of frames) {
      await router.handleChannelMessage({
        peerId: "peer_b",
        entry: openEntry(),
        data: frame.data
      });
    }

    expect(frames.length).toBeGreaterThan(1);
    expect(enqueueInboundPiece).toHaveBeenCalledTimes(1);
    expect(enqueueInboundPiece).toHaveBeenCalledWith({
      peerId: "peer_b",
      message: expect.objectContaining({
        kind: "send-piece",
        trackId: "track_1",
        chunkIndex: 0,
        payload
      }),
      pendingRequest: undefined
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
