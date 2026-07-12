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
});

describe("calculateInitialCreditBytes", () => {
  it("clamps the BDP window to 2MB-64MB", () => {
    expect(calculateInitialCreditBytes({ chunkSize: 128 * 1024, throughputKbps: 1, rttMs: 1 }))
      .toBe(2 * 1024 * 1024);
    expect(calculateInitialCreditBytes({ chunkSize: 128 * 1024, throughputKbps: 1_000_000, rttMs: 10_000 }))
      .toBe(64 * 1024 * 1024);
  });
});
