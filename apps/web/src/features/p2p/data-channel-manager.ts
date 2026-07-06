export function shouldFlushDataChannelQueue(input: {
  hasChannel: boolean;
  readyState: RTCDataChannelState | null;
  releasing: boolean;
}) {
  return input.hasChannel && input.readyState === "open" && !input.releasing;
}

export function shouldSendQueuedDataChannelItem(input: {
  queueLength: number;
  bufferedAmountBytes: number;
  highWatermarkBytes: number;
}) {
  return input.queueLength > 0 && input.bufferedAmountBytes < input.highWatermarkBytes;
}

export function resolveDataChannelClosedAction(input: {
  releasing: boolean;
  autoReconnect: boolean;
}) {
  if (input.releasing) {
    return {
      shouldReportStalled: false,
      shouldScheduleReconnect: false
    };
  }

  return {
    shouldReportStalled: true,
    shouldScheduleReconnect: input.autoReconnect
  };
}
