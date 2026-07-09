import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PieceRequestClient } from "./piece-request-client";

type TestPeerEntry = {
  channel?: {
    readyState: RTCDataChannelState;
  } | null;
};

describe("PieceRequestClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues a single piece request and reports it", () => {
    const enqueueSendItem = vi.fn();
    const onPieceRequestSent = vi.fn();
    const client = new PieceRequestClient<TestPeerEntry>({
      getPeerEntry: () => openEntry(),
      enqueueSendItem,
      onPieceRequestSent
    });

    expect(client.requestPiece("peer_b", "track_1", 2, 4, 1_000)).toBe(true);

    expect(enqueueSendItem).toHaveBeenCalledWith(
      "peer_b",
      expect.any(Object),
      {
        data: JSON.stringify({
          kind: "request-piece",
          trackId: "track_1",
          chunkIndex: 2
        }),
        priority: "control"
      }
    );
    expect(onPieceRequestSent).toHaveBeenCalledWith({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndexes: [2],
      requestId: undefined
    });
  });

  it("deduplicates batched requests against pending chunks", () => {
    const enqueueSendItem = vi.fn();
    const onPieceRequestSent = vi.fn();
    const client = new PieceRequestClient<TestPeerEntry>({
      getPeerEntry: () => openEntry(),
      enqueueSendItem,
      createRequestId: () => "request-1",
      onPieceRequestSent
    });

    expect(client.requestPiece("peer_b", "track_1", 1, 4, 1_000)).toBe(true);
    expect(client.requestPieces("peer_b", "track_1", [1, 2, 2, 3], 4, 1_000)).toBe(true);

    expect(enqueueSendItem).toHaveBeenLastCalledWith(
      "peer_b",
      expect.any(Object),
      {
        data: JSON.stringify({
          kind: "request-pieces",
          requestId: "request-1",
          trackId: "track_1",
          chunkIndexes: [2, 3]
        }),
        priority: "control"
      }
    );
    expect(onPieceRequestSent).toHaveBeenLastCalledWith({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndexes: [2, 3],
      requestId: "request-1"
    });
  });

  it("returns false when the peer channel is unavailable or every chunk is pending", () => {
    const enqueueSendItem = vi.fn();
    const client = new PieceRequestClient<TestPeerEntry>({
      getPeerEntry: (peerId) => (peerId === "peer_closed" ? closedEntry() : openEntry()),
      enqueueSendItem
    });

    expect(client.requestPiece("peer_closed", "track_1", 0)).toBe(false);
    expect(client.requestPiece("peer_b", "track_1", 0, undefined, 1_000)).toBe(true);
    expect(client.requestPiece("peer_b", "track_1", 0, undefined, 1_000)).toBe(false);
  });

  it("allows bounded redundant requests for urgent chunks", () => {
    const enqueueSendItem = vi.fn();
    const client = new PieceRequestClient<TestPeerEntry>({
      getPeerEntry: () => openEntry(),
      enqueueSendItem
    });

    expect(client.requestPiece("peer_b", "track_1", 0, 2, 1_000)).toBe(true);
    expect(
      client.requestPieces("peer_c", "track_1", [0], 2, 1_000, {
        allowRedundant: true,
        maxReplicas: 2
      })
    ).toBe(true);
    expect(
      client.requestPieces("peer_d", "track_1", [0], 2, 1_000, {
        allowRedundant: true,
        maxReplicas: 2
      })
    ).toBe(false);

    expect(enqueueSendItem).toHaveBeenCalledTimes(2);
    expect(client.takePendingRequest("track_1", 0)?.peerId).toBe("peer_b");
    expect(client.takePendingRequest("track_1", 0)).toBeNull();
  });

  it("clears pending requests when a peer is removed", async () => {
    const onPieceRequestTimeout = vi.fn();
    const client = new PieceRequestClient<TestPeerEntry>({
      getPeerEntry: () => openEntry(),
      enqueueSendItem: vi.fn(),
      onPieceRequestTimeout
    });

    client.requestPieces("peer_b", "track_1", [0, 1], 2, 500);
    client.clearPeer("peer_b");
    vi.setSystemTime(1_600);
    await vi.advanceTimersByTimeAsync(500);

    expect(onPieceRequestTimeout).not.toHaveBeenCalled();
    expect(client.takePendingRequest("track_1", 0)).toBeNull();
  });
});

function openEntry() {
  return {
    channel: {
      readyState: "open" as const
    }
  };
}

function closedEntry() {
  return {
    channel: {
      readyState: "closed" as const
    }
  };
}
