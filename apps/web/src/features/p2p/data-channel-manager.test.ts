import { describe, expect, it } from "vitest";
import {
  resolveDataChannelClosedAction,
  shouldFlushDataChannelQueue,
  shouldSendQueuedDataChannelItem
} from "./data-channel-manager";

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
});
