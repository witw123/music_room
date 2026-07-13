import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedPiecesByIndexes } from "@/lib/indexeddb";
import { CacheStreamProducer } from "./cache-stream-producer";

vi.mock("@/lib/indexeddb", () => ({
  getCachedPiecesByIndexes: vi.fn(),
  getTrackPieceManifest: vi.fn(),
  getTrackPieceManifestByFileHash: vi.fn(),
  localCacheOwnerKey: "local"
}));

const flushAsyncWork = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("CacheStreamProducer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the unread batch tail queued when credit is replenished one chunk at a time", async () => {
    const chunkCount = 40;
    const enqueueSendItem = vi.fn();
    vi.mocked(getCachedPiecesByIndexes).mockImplementation(
      async (trackId, peerId, chunkIndexes) =>
        chunkIndexes.map((chunkIndex) => ({
          pieceId: `${trackId}:${peerId}:${chunkIndex}`,
          trackId,
          peerId,
          chunkIndex,
          chunkSize: 1,
          hash: `hash-${chunkIndex}`,
          createdAt: "2026-07-13T00:00:00.000Z",
          payload: Uint8Array.of(chunkIndex).buffer
        }))
    );
    const producer = new CacheStreamProducer({
      localPeerId: "peer-local",
      enqueueSendItem,
      sendControl: vi.fn(),
      resolveMaxDataChannelPayloadBytes: () => 1024,
      resolveMaxInFlightBytes: () => chunkCount
    });
    producer.rememberManifestHeader("track-1", {
      totalChunks: chunkCount,
      chunkSize: 1,
      mimeType: "audio/mpeg"
    });

    await producer.handleMessage(
      "peer-remote",
      { dataChannel: { readyState: "open", bufferedAmount: 0 } },
      {
        kind: "cache-stream-open",
        protocolVersion: 3,
        streamId: "stream-1",
        trackId: "track-1",
        generation: 1,
        priority: "critical",
        ranges: [{ start: 0, end: chunkCount - 1 }],
        initialCreditBytes: 32
      }
    );

    expect(enqueueSendItem).toHaveBeenCalledTimes(32);

    for (let chunkIndex = 0; chunkIndex < chunkCount - 32; chunkIndex += 1) {
      await producer.handleMessage(
        "peer-remote",
        { dataChannel: { readyState: "open", bufferedAmount: 0 } },
        {
          kind: "cache-stream-credit",
          streamId: "stream-1",
          generation: 1,
          chunkIndex,
          creditBytes: 1
        }
      );
      await flushAsyncWork();
    }

    const sentChunkIndexes = enqueueSendItem.mock.calls.map(([, , item]) => item.chunkIndex);
    expect(sentChunkIndexes).toEqual(Array.from({ length: chunkCount }, (_, index) => index));
  });
});
