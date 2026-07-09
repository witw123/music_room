import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PieceRequestTracker } from "./piece-request-tracker";

describe("PieceRequestTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters out chunks that already have pending requests", () => {
    const tracker = new PieceRequestTracker();

    tracker.registerRequests({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndexes: [1],
      expectedTotalChunks: 4,
      requestId: undefined,
      timeoutMs: 1_000,
      onTimeout: vi.fn()
    });

    expect(tracker.getAvailableChunkIndexes("track_1", [1, 2, 2, 3])).toEqual([2, 3]);
  });

  it("reports timeouts with request duration and removes expired requests", async () => {
    const onTimeout = vi.fn();
    const tracker = new PieceRequestTracker();

    tracker.registerRequests({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndexes: [0, 1],
      expectedTotalChunks: 4,
      requestId: "request_1",
      timeoutMs: 500,
      onTimeout
    });

    vi.setSystemTime(1_600);
    await vi.advanceTimersByTimeAsync(500);

    expect(onTimeout).toHaveBeenCalledTimes(2);
    expect(onTimeout).toHaveBeenCalledWith({
      trackId: "track_1",
      chunkIndex: 0,
      peerId: "peer_b",
      requestId: "request_1",
      requestDurationMs: 1100
    });
    expect(tracker.get("track_1", 0)).toBeNull();
    expect(tracker.get("track_1", 1)).toBeNull();
  });

  it("takes a pending request and clears its timeout", async () => {
    const onTimeout = vi.fn();
    const tracker = new PieceRequestTracker();

    tracker.registerRequests({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndexes: [0],
      expectedTotalChunks: 4,
      requestId: undefined,
      timeoutMs: 500,
      onTimeout
    });

    const pendingRequest = tracker.take("track_1", 0);

    expect(pendingRequest).toMatchObject({
      peerId: "peer_b",
      expectedTotalChunks: 4,
      requestedAtMs: 1_000,
      timeoutMs: 500
    });

    await vi.advanceTimersByTimeAsync(600);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("allows bounded redundant requests and clears sibling replicas when one arrives", async () => {
    const onTimeout = vi.fn();
    const tracker = new PieceRequestTracker();

    tracker.registerRequests({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndexes: [0],
      expectedTotalChunks: 4,
      requestId: undefined,
      timeoutMs: 500,
      onTimeout
    });

    expect(
      tracker.getAvailableChunkIndexes("track_1", [0], {
        allowRedundant: true,
        maxReplicas: 2
      })
    ).toEqual([0]);

    tracker.registerRequests({
      peerId: "peer_c",
      trackId: "track_1",
      chunkIndexes: [0],
      expectedTotalChunks: 4,
      requestId: undefined,
      timeoutMs: 700,
      onTimeout,
      allowRedundant: true
    });

    expect(
      tracker.getAvailableChunkIndexes("track_1", [0], {
        allowRedundant: true,
        maxReplicas: 2
      })
    ).toEqual([]);

    const pendingRequest = tracker.take("track_1", 0);
    expect(pendingRequest?.peerId).toBe("peer_b");
    expect(tracker.get("track_1", 0)).toBeNull();

    await vi.advanceTimersByTimeAsync(800);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("clears requests for one peer without touching other peers", async () => {
    const onTimeout = vi.fn();
    const tracker = new PieceRequestTracker();

    tracker.registerRequests({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndexes: [0],
      expectedTotalChunks: 4,
      requestId: undefined,
      timeoutMs: 500,
      onTimeout
    });
    tracker.registerRequests({
      peerId: "peer_c",
      trackId: "track_1",
      chunkIndexes: [1],
      expectedTotalChunks: 4,
      requestId: undefined,
      timeoutMs: 500,
      onTimeout
    });

    tracker.clearPeer("peer_b");
    await vi.advanceTimersByTimeAsync(600);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "peer_c",
        chunkIndex: 1
      })
    );
    expect(tracker.get("track_1", 0)).toBeNull();
  });

  it("fails one unavailable replica without waiting for the request timeout", async () => {
    const onTimeout = vi.fn();
    const tracker = new PieceRequestTracker();

    tracker.registerRequests({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndexes: [0],
      expectedTotalChunks: 4,
      requestId: "request_b",
      timeoutMs: 500,
      onTimeout,
      allowRedundant: true
    });
    tracker.registerRequests({
      peerId: "peer_c",
      trackId: "track_1",
      chunkIndexes: [0],
      expectedTotalChunks: 4,
      requestId: "request_c",
      timeoutMs: 500,
      onTimeout,
      allowRedundant: true
    });

    const failed = tracker.fail({
      peerId: "peer_b",
      trackId: "track_1",
      chunkIndex: 0,
      requestId: "request_b"
    });

    expect(failed?.peerId).toBe("peer_b");
    expect(tracker.get("track_1", 0)?.peerId).toBe("peer_c");

    await vi.advanceTimersByTimeAsync(600);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "peer_c",
        requestId: "request_c",
        chunkIndex: 0
      })
    );
  });
});
