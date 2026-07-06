import { describe, expect, it, vi } from "vitest";
import {
  DataChannelManager,
  resolveDataChannelClosedAction,
  shouldFlushDataChannelQueue,
  shouldSendQueuedDataChannelItem
} from "./data-channel-manager";

class FakeDataChannel {
  binaryType: BinaryType = "blob";
  readyState: RTCDataChannelState = "connecting";
  onmessage: ((event: MessageEvent) => void | Promise<void>) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onbufferedamountlow: (() => void) | null = null;
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
}

describe("data channel manager policy", () => {
  it("only flushes send queues for live open channels", () => {
    expect(
      shouldFlushDataChannelQueue({
        hasChannel: true,
        readyState: "open",
        releasing: false
      })
    ).toBe(true);
    expect(
      shouldFlushDataChannelQueue({
        hasChannel: false,
        readyState: null,
        releasing: false
      })
    ).toBe(false);
    expect(
      shouldFlushDataChannelQueue({
        hasChannel: true,
        readyState: "connecting",
        releasing: false
      })
    ).toBe(false);
    expect(
      shouldFlushDataChannelQueue({
        hasChannel: true,
        readyState: "open",
        releasing: true
      })
    ).toBe(false);
  });

  it("keeps sending while queued data exists and buffered amount is below high watermark", () => {
    expect(
      shouldSendQueuedDataChannelItem({
        queueLength: 2,
        bufferedAmountBytes: 256 * 1024,
        highWatermarkBytes: 1024 * 1024
      })
    ).toBe(true);
    expect(
      shouldSendQueuedDataChannelItem({
        queueLength: 0,
        bufferedAmountBytes: 256 * 1024,
        highWatermarkBytes: 1024 * 1024
      })
    ).toBe(false);
    expect(
      shouldSendQueuedDataChannelItem({
        queueLength: 1,
        bufferedAmountBytes: 1024 * 1024,
        highWatermarkBytes: 1024 * 1024
      })
    ).toBe(false);
  });

  it("reports stalled and schedules reconnect only for unexpected closes", () => {
    expect(
      resolveDataChannelClosedAction({
        releasing: false,
        autoReconnect: true
      })
    ).toEqual({
      shouldReportStalled: true,
      shouldScheduleReconnect: true
    });
    expect(
      resolveDataChannelClosedAction({
        releasing: false,
        autoReconnect: false
      })
    ).toEqual({
      shouldReportStalled: true,
      shouldScheduleReconnect: false
    });
    expect(
      resolveDataChannelClosedAction({
        releasing: true,
        autoReconnect: true
      })
    ).toEqual({
      shouldReportStalled: false,
      shouldScheduleReconnect: false
    });
  });

  it("binds initial channel state and open/buffer-low lifecycle callbacks", () => {
    const dataChannelStates: unknown[] = [];
    const bufferedAmounts: unknown[] = [];
    const flushSendQueue = vi.fn();
    const schedulePeerWatchdog = vi.fn();
    const manager = new DataChannelManager({
      autoReconnect: true,
      sendQueueLowWatermarkBytes: 384 * 1024,
      onDataChannelStateChange: (payload) => dataChannelStates.push(payload),
      onDataBufferedAmountChange: (payload) => bufferedAmounts.push(payload)
    });
    const entry = {
      dataChannelState: null as RTCDataChannelState | null,
      lastSignalProgressAtMs: 0,
      reconnectAttempts: 2,
      sendQueue: [],
      releasing: false
    };
    const channel = new FakeDataChannel();
    channel.bufferedAmount = 512;

    manager.bind({
      peerId: "peer_b",
      entry,
      channel: channel as unknown as RTCDataChannel,
      flushSendQueue,
      schedulePeerWatchdog,
      clearPendingRequestsForPeer: vi.fn(),
      schedulePeerReconnect: vi.fn(),
      onMessage: vi.fn()
    });

    expect(channel.binaryType).toBe("arraybuffer");
    expect(channel.bufferedAmountLowThreshold).toBe(384 * 1024);
    expect(entry.dataChannelState).toBe("connecting");
    expect(dataChannelStates).toContainEqual({ peerId: "peer_b", state: "connecting" });
    expect(bufferedAmounts).toContainEqual({ peerId: "peer_b", bufferedAmountBytes: 512 });
    expect(schedulePeerWatchdog).toHaveBeenCalledTimes(1);

    channel.readyState = "open";
    channel.bufferedAmount = 128;
    channel.onopen?.();
    channel.onbufferedamountlow?.();

    expect(entry.dataChannelState).toBe("open");
    expect(entry.reconnectAttempts).toBe(0);
    expect(flushSendQueue).toHaveBeenCalledTimes(2);
    expect(schedulePeerWatchdog).toHaveBeenCalledTimes(2);
    expect(bufferedAmounts).toContainEqual({ peerId: "peer_b", bufferedAmountBytes: 128 });
  });

  it("delegates message events and handles unexpected channel close", async () => {
    const onMessage = vi.fn();
    const clearPendingRequestsForPeer = vi.fn();
    const schedulePeerReconnect = vi.fn();
    const onPeerStalled = vi.fn();
    const onPeerConnectionChange = vi.fn();
    const manager = new DataChannelManager({
      autoReconnect: true,
      sendQueueLowWatermarkBytes: 384 * 1024,
      onPeerConnectionChange,
      onPeerStalled
    });
    const entry = {
      dataChannelState: null as RTCDataChannelState | null,
      lastSignalProgressAtMs: 0,
      reconnectAttempts: 0,
      sendQueue: [{ data: "queued" }],
      releasing: false
    };
    const channel = new FakeDataChannel();

    manager.bind({
      peerId: "peer_b",
      entry,
      channel: channel as unknown as RTCDataChannel,
      flushSendQueue: vi.fn(),
      schedulePeerWatchdog: vi.fn(),
      clearPendingRequestsForPeer,
      schedulePeerReconnect,
      onMessage
    });

    await channel.onmessage?.({ data: "hello" } as MessageEvent);
    channel.onclose?.();

    expect(onMessage).toHaveBeenCalledWith({ data: "hello" });
    expect(entry.lastSignalProgressAtMs).toBeGreaterThan(0);
    expect(entry.dataChannelState).toBe("closed");
    expect(entry.sendQueue).toEqual([]);
    expect(clearPendingRequestsForPeer).toHaveBeenCalledWith("peer_b");
    expect(onPeerConnectionChange).toHaveBeenCalledWith({ peerId: "peer_b", state: "closed" });
    expect(onPeerStalled).toHaveBeenCalledWith({
      peerId: "peer_b",
      reason: "data-channel-closed"
    });
    expect(schedulePeerReconnect).toHaveBeenCalledTimes(1);
  });
});
