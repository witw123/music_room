export type DataChannelQueuedSendItem = {
  data: string | ArrayBuffer;
  trackId?: string;
  chunkIndex?: number;
  payloadBytes?: number;
};

type DataChannelLifecycleEntry = {
  channel?: RTCDataChannel | null;
  dataChannelState: RTCDataChannelState | null;
  lastSignalProgressAtMs: number;
  reconnectAttempts: number;
  sendQueue: DataChannelQueuedSendItem[];
  releasing: boolean;
};

type DataChannelManagerCallbacks = {
  onDataChannelStateChange?: (payload: {
    peerId: string;
    state: RTCDataChannelState;
  }) => void;
  onDataBufferedAmountChange?: (payload: {
    peerId: string;
    bufferedAmountBytes: number;
  }) => void;
  onPeerConnectionChange?: (payload: {
    peerId: string;
    state: RTCPeerConnectionState;
  }) => void;
  onPeerStalled?: (payload: {
    peerId: string;
    reason: "watchdog-timeout" | "connection-failed" | "data-channel-closed";
  }) => void;
  onPieceSent?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    payloadBytes: number;
  }) => void;
};

export class DataChannelManager {
  private readonly autoReconnect: boolean;
  private readonly sendQueueLowWatermarkBytes: number;
  private readonly sendQueueHighWatermarkBytes: number;
  private readonly callbacks: DataChannelManagerCallbacks;

  constructor(input: {
    autoReconnect: boolean;
    sendQueueLowWatermarkBytes: number;
    sendQueueHighWatermarkBytes?: number;
  } & DataChannelManagerCallbacks) {
    this.autoReconnect = input.autoReconnect;
    this.sendQueueLowWatermarkBytes = input.sendQueueLowWatermarkBytes;
    this.sendQueueHighWatermarkBytes = input.sendQueueHighWatermarkBytes ?? 1024 * 1024;
    this.callbacks = input;
  }

  bind(input: {
    peerId: string;
    entry: DataChannelLifecycleEntry;
    channel: RTCDataChannel;
    flushSendQueue: () => void;
    schedulePeerWatchdog: () => void;
    clearPendingRequestsForPeer: (peerId: string) => void;
    schedulePeerReconnect: () => void;
    onMessage: (event: MessageEvent) => void | Promise<void>;
  }) {
    const { channel, entry, peerId } = input;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = this.sendQueueLowWatermarkBytes;
    entry.dataChannelState = channel.readyState;
    entry.lastSignalProgressAtMs = Date.now();
    this.callbacks.onDataChannelStateChange?.({
      peerId,
      state: channel.readyState
    });
    this.callbacks.onDataBufferedAmountChange?.({
      peerId,
      bufferedAmountBytes: channel.bufferedAmount
    });
    input.schedulePeerWatchdog();

    channel.onopen = () => {
      entry.dataChannelState = channel.readyState;
      entry.lastSignalProgressAtMs = Date.now();
      entry.reconnectAttempts = 0;
      this.callbacks.onDataChannelStateChange?.({
        peerId,
        state: channel.readyState
      });
      this.callbacks.onDataBufferedAmountChange?.({
        peerId,
        bufferedAmountBytes: channel.bufferedAmount
      });
      input.flushSendQueue();
      input.schedulePeerWatchdog();
    };

    channel.onbufferedamountlow = () => {
      this.callbacks.onDataBufferedAmountChange?.({
        peerId,
        bufferedAmountBytes: channel.bufferedAmount
      });
      input.flushSendQueue();
    };

    channel.onmessage = async (event) => {
      entry.lastSignalProgressAtMs = Date.now();
      await input.onMessage(event);
    };

    channel.onclose = () => {
      entry.dataChannelState = "closed";
      entry.sendQueue = [];
      this.callbacks.onDataChannelStateChange?.({
        peerId,
        state: "closed"
      });
      this.callbacks.onDataBufferedAmountChange?.({
        peerId,
        bufferedAmountBytes: 0
      });
      input.clearPendingRequestsForPeer(peerId);
      this.callbacks.onPeerConnectionChange?.({
        peerId,
        state: "closed"
      });
      const closedAction = resolveDataChannelClosedAction({
        releasing: entry.releasing,
        autoReconnect: this.autoReconnect
      });
      if (closedAction.shouldReportStalled) {
        this.callbacks.onPeerStalled?.({
          peerId,
          reason: "data-channel-closed"
        });
      }
      if (closedAction.shouldScheduleReconnect) {
        input.schedulePeerReconnect();
      }
    };
  }

  enqueueSendItem(input: {
    peerId: string;
    entry: DataChannelLifecycleEntry;
    item: DataChannelQueuedSendItem;
    schedulePeerReconnect: () => void;
  }) {
    if (input.entry.releasing) {
      return;
    }

    input.entry.sendQueue.push(input.item);
    this.flushSendQueue(input);
  }

  flushSendQueue(input: {
    peerId: string;
    entry: DataChannelLifecycleEntry;
    schedulePeerReconnect: () => void;
  }) {
    const channel = input.entry.channel;
    if (!channel || !shouldFlushDataChannelQueue({
      hasChannel: true,
      readyState: channel.readyState,
      releasing: input.entry.releasing
    })) {
      return;
    }

    while (
      shouldSendQueuedDataChannelItem({
        queueLength: input.entry.sendQueue.length,
        bufferedAmountBytes: channel.bufferedAmount,
        highWatermarkBytes: this.sendQueueHighWatermarkBytes
      })
    ) {
      const nextItem = input.entry.sendQueue.shift()!;
      try {
        if (typeof nextItem.data === "string") {
          channel.send(nextItem.data);
        } else {
          channel.send(nextItem.data);
        }
      } catch {
        input.entry.sendQueue.unshift(nextItem);
        this.callbacks.onPeerStalled?.({
          peerId: input.peerId,
          reason: "data-channel-closed"
        });
        if (this.autoReconnect) {
          input.schedulePeerReconnect();
        }
        break;
      }
      if (
        typeof nextItem.trackId === "string" &&
        typeof nextItem.chunkIndex === "number" &&
        typeof nextItem.payloadBytes === "number"
      ) {
        this.callbacks.onPieceSent?.({
          peerId: input.peerId,
          trackId: nextItem.trackId,
          chunkIndex: nextItem.chunkIndex,
          payloadBytes: nextItem.payloadBytes
        });
      }
    }

    this.callbacks.onDataBufferedAmountChange?.({
      peerId: input.peerId,
      bufferedAmountBytes: channel.bufferedAmount
    });
  }
}

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
