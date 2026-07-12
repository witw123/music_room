import { describe, expect, it, vi } from "vitest";
import { CacheStreamScheduler, calculateInitialCreditBytes } from "./cache-stream-scheduler";

describe("CacheStreamScheduler", () => {
  it("opens parallel streams and distributes normal chunks without overlap", () => {
    const sendControl = vi.fn();
    const scheduler = new CacheStreamScheduler({ sendControl });
    scheduler.setProvider({
      peerId: "peer-a",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 7 }],
      throughputKbps: 900,
      connected: true
    });
    scheduler.setProvider({
      peerId: "peer-b",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 7 }],
      throughputKbps: 700,
      connected: true
    });

    expect(
      scheduler.request({
        trackId: "track-1",
        chunkIndexes: [0, 1, 2, 3, 4, 5, 6, 7],
        totalChunks: 8,
        chunkSize: 128 * 1024,
        priority: "bulk"
      })
    ).toBe(true);

    const opens = sendControl.mock.calls.map(([peerId, message]) => ({ peerId, message }))
      .filter(({ message }) => message.kind === "cache-stream-open");
    expect(opens).toHaveLength(2);
    const ranges = opens.flatMap(({ message }) => message.ranges);
    expect(ranges.flatMap((range) => Array.from({ length: range.end - range.start + 1 }, (_, index) => range.start + index))
      .sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("allows a critical chunk to be assigned to a second provider", () => {
    const sendControl = vi.fn();
    const scheduler = new CacheStreamScheduler({ sendControl });
    for (const peerId of ["peer-a", "peer-b"]) {
      scheduler.setProvider({
        peerId,
        trackId: "track-1",
        availableRanges: [{ start: 0, end: 0 }],
        connected: true
      });
    }

    scheduler.request({
      trackId: "track-1",
      chunkIndexes: [0],
      totalChunks: 1,
      chunkSize: 128 * 1024,
      priority: "critical",
      preferredPeerId: "peer-a"
    });
    scheduler.request({
      trackId: "track-1",
      chunkIndexes: [0],
      totalChunks: 1,
      chunkSize: 128 * 1024,
      priority: "critical",
      allowRedundant: true,
      maxReplicas: 2,
      preferredPeerId: "peer-a"
    });

    expect(sendControl.mock.calls.filter(([, message]) => message.kind === "cache-stream-open"))
      .toHaveLength(2);
  });

  it("reassigns unconfirmed chunks when a provider disconnects", () => {
    const sendControl = vi.fn();
    const scheduler = new CacheStreamScheduler({ sendControl });
    scheduler.setProvider({
      peerId: "peer-a",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 2 }],
      connected: true
    });
    scheduler.setProvider({
      peerId: "peer-b",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 2 }],
      connected: true
    });
    scheduler.request({
      trackId: "track-1",
      chunkIndexes: [0, 1, 2],
      totalChunks: 3,
      chunkSize: 128 * 1024,
      priority: "critical",
      preferredPeerId: "peer-a"
    });

    const firstStream = sendControl.mock.calls.find(([, message]) => message.kind === "cache-stream-open");
    scheduler.markPeerConnected("peer-a", false);
    const replacement = sendControl.mock.calls
      .filter(([peerId, message]) => peerId === "peer-b" && message.kind === "cache-stream-open");

    expect(firstStream).toBeDefined();
    expect(replacement.length).toBeGreaterThan(0);
  });

  it("does not leave chunks assigned when the six-stream limit is reached", () => {
    const sendControl = vi.fn();
    const scheduler = new CacheStreamScheduler({ sendControl });
    for (let index = 0; index < 7; index += 1) {
      scheduler.setProvider({
        peerId: `peer-${index}`,
        trackId: "track-1",
        availableRanges: [{ start: 0, end: 6 }],
        connected: true
      });
    }

    expect(
      scheduler.request({
        trackId: "track-1",
        chunkIndexes: [0, 1, 2, 3, 4, 5, 6],
        totalChunks: 7,
        chunkSize: 128 * 1024,
        priority: "bulk"
      })
    ).toBe(true);
    const firstOpen = sendControl.mock.calls.find(([, message]) => message.kind === "cache-stream-open");
    if (!firstOpen) {
      throw new Error("expected an initial stream");
    }
    scheduler.handlePersisted({
      peerId: firstOpen[0],
      streamId: firstOpen[1].streamId,
      generation: firstOpen[1].generation,
      trackId: "track-1",
      chunkIndex: firstOpen[1].ranges[0].start,
      storedBytes: 128 * 1024
    });
    expect(
      scheduler.request({
        trackId: "track-1",
        chunkIndexes: [6],
        totalChunks: 7,
        chunkSize: 128 * 1024,
        priority: "bulk"
      })
    ).toBe(true);
    expect(sendControl.mock.calls.filter(([, message]) => message.kind === "cache-stream-open"))
      .toHaveLength(7);
  });

  it("reassigns a stream when its provider explicitly resets it", () => {
    const sendControl = vi.fn();
    const scheduler = new CacheStreamScheduler({ sendControl });
    for (const peerId of ["peer-a", "peer-b"]) {
      scheduler.setProvider({
        peerId,
        trackId: "track-1",
        availableRanges: [{ start: 0, end: 1 }],
        connected: true
      });
    }

    scheduler.request({
      trackId: "track-1",
      chunkIndexes: [0, 1],
      totalChunks: 2,
      chunkSize: 128 * 1024,
      priority: "critical",
      preferredPeerId: "peer-a"
    });
    const stream = sendControl.mock.calls.find(([, message]) => message.kind === "cache-stream-open");
    if (!stream) {
      throw new Error("expected a stream to reset");
    }
    scheduler.handleReset({
      peerId: "peer-a",
      streamId: stream[1].streamId,
      generation: stream[1].generation
    });

    expect(sendControl.mock.calls.some(([peerId, message]) =>
      peerId === "peer-b" && message.kind === "cache-stream-open"
    )).toBe(true);
  });
});

describe("calculateInitialCreditBytes", () => {
  it("clamps the BDP window to 2MB-64MB", () => {
    expect(calculateInitialCreditBytes({ chunkSize: 128 * 1024, throughputKbps: 1, rttMs: 1 }))
      .toBe(2 * 1024 * 1024);
    expect(calculateInitialCreditBytes({ chunkSize: 128 * 1024, throughputKbps: 1_000_000, rttMs: 10_000 }))
      .toBe(64 * 1024 * 1024);
  });
});
