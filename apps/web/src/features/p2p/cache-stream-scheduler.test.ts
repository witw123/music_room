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

  it("keeps the source owner as a soft preference while using other providers", () => {
    const sendControl = vi.fn();
    const scheduler = new CacheStreamScheduler({ sendControl });
    scheduler.setProvider({
      peerId: "peer-source",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 3 }],
      throughputKbps: 900,
      connected: true
    });
    scheduler.setProvider({
      peerId: "peer-cache",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 3 }],
      throughputKbps: 700,
      connected: true
    });

    scheduler.request({
      trackId: "track-1",
      chunkIndexes: [0, 1, 2, 3],
      totalChunks: 4,
      chunkSize: 128 * 1024,
      priority: "critical",
      preferredPeerId: "peer-source"
    });

    const openPeers = sendControl.mock.calls
      .filter(([, message]) => message.kind === "cache-stream-open")
      .map(([peerId]) => peerId);
    expect(openPeers).toContain("peer-source");
    expect(openPeers).toContain("peer-cache");
  });

  it("does not assign a chunk to an explicitly empty provider range", () => {
    const sendControl = vi.fn();
    const scheduler = new CacheStreamScheduler({ sendControl });
    scheduler.setProvider({
      peerId: "peer-empty",
      trackId: "track-1",
      availableRanges: [],
      connected: true
    });
    scheduler.setProvider({
      peerId: "peer-ready",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 0 }],
      connected: true
    });

    scheduler.request({
      trackId: "track-1",
      chunkIndexes: [0],
      totalChunks: 1,
      chunkSize: 128 * 1024,
      priority: "critical",
      preferredPeerId: "peer-empty"
    });

    const open = sendControl.mock.calls.find(([, message]) => message.kind === "cache-stream-open");
    expect(open?.[0]).toBe("peer-ready");
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
    scheduler.inspectIncomingPiece({
      peerId: firstOpen[0],
      streamId: firstOpen[1].streamId,
      generation: firstOpen[1].generation,
      trackId: "track-1",
      chunkIndex: firstOpen[1].ranges[0].start,
      payloadBytes: 128 * 1024
    });
    scheduler.handleValidated({
      peerId: firstOpen[0],
      streamId: firstOpen[1].streamId,
      generation: firstOpen[1].generation,
      chunkIndex: firstOpen[1].ranges[0].start,
      storedBytes: 128 * 1024
    });
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

  it("reclaims a stream without waiting for a new request", () => {
    vi.useFakeTimers();
    const sendControl = vi.fn();
    const onStreamReset = vi.fn();
    const scheduler = new CacheStreamScheduler({ sendControl, onStreamReset });
    scheduler.setProvider({
      peerId: "peer-a",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 0 }],
      connected: true
    });
    scheduler.setProvider({
      peerId: "peer-b",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 0 }],
      connected: true
    });

    scheduler.request({
      trackId: "track-1",
      chunkIndexes: [0],
      totalChunks: 1,
      chunkSize: 128 * 1024,
      priority: "critical",
      preferredPeerId: "peer-a"
    });

    vi.advanceTimersByTime(16_000);

    expect(onStreamReset).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "peer-a",
        trackId: "track-1",
        chunkIndexes: [0],
        reason: "timeout"
      })
    );
    expect(sendControl.mock.calls.some(([peerId, message]) =>
      peerId === "peer-b" && message.kind === "cache-stream-open"
    )).toBe(true);
    vi.useRealTimers();
  });

  it("retries the same relay provider when it is the only source for a stalled critical stream", () => {
    vi.useFakeTimers();
    const sendControl = vi.fn();
    const onStreamReset = vi.fn();
    const scheduler = new CacheStreamScheduler({
      sendControl,
      onStreamReset,
      resolvePeerTransport: () => ({
        candidateType: "relay",
        protocol: "udp",
        transportScore: "degraded"
      })
    });
    scheduler.setProvider({
      peerId: "peer-only",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 2 }],
      connected: true
    });

    expect(
      scheduler.request({
        trackId: "track-1",
        chunkIndexes: [0, 1, 2],
        totalChunks: 3,
        chunkSize: 128 * 1024,
        priority: "critical",
        preferredPeerId: "peer-only",
        timeoutMs: 40_000
      })
    ).toBe(true);

    vi.advanceTimersByTime(8_000);

    expect(onStreamReset).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "peer-only",
        chunkIndexes: [0, 1, 2],
        reason: "timeout"
      })
    );
    expect(
      sendControl.mock.calls.filter(
        ([peerId, message]) => peerId === "peer-only" && message.kind === "cache-stream-open"
      )
    ).toHaveLength(2);
    vi.useRealTimers();
  });

  it("keeps an unstable UDP provider available for critical playback only", () => {
    const createScheduler = () => {
      const sendControl = vi.fn();
      const scheduler = new CacheStreamScheduler({
        sendControl,
        resolvePeerTransport: () => ({
          candidateType: "relay",
          protocol: "udp",
          transportScore: "unstable"
        })
      });
      scheduler.setProvider({
        peerId: "peer-only",
        trackId: "track-1",
        availableRanges: [{ start: 0, end: 0 }],
        connected: true
      });
      return { scheduler, sendControl };
    };
    const critical = createScheduler();
    const bulk = createScheduler();

    expect(
      critical.scheduler.request({
        trackId: "track-1",
        chunkIndexes: [0],
        totalChunks: 1,
        chunkSize: 128 * 1024,
        priority: "critical"
      })
    ).toBe(true);
    expect(
      bulk.scheduler.request({
        trackId: "track-1",
        chunkIndexes: [0],
        totalChunks: 1,
        chunkSize: 128 * 1024,
        priority: "bulk"
      })
    ).toBe(false);
    expect(critical.sendControl).toHaveBeenCalled();
    expect(bulk.sendControl).not.toHaveBeenCalled();
    critical.scheduler.clear();
    bulk.scheduler.clear();
  });

  it("keeps a stream alive for storage-failure retries", () => {
    const sendControl = vi.fn();
    const scheduler = new CacheStreamScheduler({ sendControl });
    scheduler.setProvider({
      peerId: "peer-a",
      trackId: "track-1",
      availableRanges: [{ start: 0, end: 0 }],
      connected: true
    });

    scheduler.request({
      trackId: "track-1",
      chunkIndexes: [0],
      totalChunks: 1,
      chunkSize: 128 * 1024,
      priority: "critical"
    });
    const open = sendControl.mock.calls.find(([, message]) => message.kind === "cache-stream-open");
    if (!open) {
      throw new Error("expected a stream");
    }

    scheduler.handleNack({
      peerId: "peer-a",
      streamId: open[1].streamId,
      generation: open[1].generation,
      trackId: "track-1",
      chunkIndex: 0,
      reason: "storage-failure",
      refundCreditBytes: 0
    });

    expect(scheduler.getMetrics()).toHaveLength(1);
    expect(sendControl.mock.calls.filter(([, message]) => message.kind === "cache-stream-open"))
      .toHaveLength(1);
  });
});

describe("calculateInitialCreditBytes", () => {
  it("clamps the BDP window to 8MB-32MB", () => {
    expect(calculateInitialCreditBytes({ chunkSize: 128 * 1024, throughputKbps: 1, rttMs: 1 }))
      .toBe(8 * 1024 * 1024);
    expect(calculateInitialCreditBytes({ chunkSize: 128 * 1024, throughputKbps: 1_000_000, rttMs: 10_000 }))
      .toBe(32 * 1024 * 1024);
  });
});
