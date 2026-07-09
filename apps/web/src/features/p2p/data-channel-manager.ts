export type DataChannelQueuedSendItem = {
  data: string | ArrayBuffer;
  priority?: "control" | "critical" | "bulk";
  trackId?: string;
  chunkIndex?: number;
  payloadBytes?: number;
};

export type DataChannelSendBudget = {
  highWatermarkBytes: number;
  bulkHighWatermarkBytes: number;
  maxPayloadBytes: number;
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
  resolvePeerSendBudget?: (peerId: string) => DataChannelSendBudget | null | undefined;
};

export class DataChannelManager {
  private readonly autoReconnect: boolean;
  private readonly sendQueueLowWatermarkBytes: number;
  private readonly sendQueueHighWatermarkBytes: number;
  private readonly callbacks: DataChannelManagerCallbacks;
  private readonly resolvePeerSendBudget?: DataChannelManagerCallbacks["resolvePeerSendBudget"];

  constructor(input: {
    autoReconnect: boolean;
    sendQueueLowWatermarkBytes: number;
    sendQueueHighWatermarkBytes?: number;
  } & DataChannelManagerCallbacks) {
    this.autoReconnect = input.autoReconnect;
    this.sendQueueLowWatermarkBytes = input.sendQueueLowWatermarkBytes;
    this.sendQueueHighWatermarkBytes = input.sendQueueHighWatermarkBytes ?? 1024 * 1024;
    this.callbacks = input;
    this.resolvePeerSendBudget = input.resolvePeerSendBudget;
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
    this.updateBufferedAmountLowThreshold(peerId, entry, channel);
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

    this.updateBufferedAmountLowThreshold(input.peerId, input.entry, channel);
    while (input.entry.sendQueue.length > 0) {
      const budget = this.resolveSendBudget(input.peerId);
      const nextItemIndex = resolveNextSendQueueItemIndex({
        queue: input.entry.sendQueue,
        bufferedAmountBytes: channel.bufferedAmount,
        highWatermarkBytes: budget.highWatermarkBytes,
        bulkHighWatermarkBytes: budget.bulkHighWatermarkBytes
      });
      if (nextItemIndex < 0) {
        break;
      }
      const [nextItem] = input.entry.sendQueue.splice(nextItemIndex, 1);
      if (!nextItem) {
        break;
      }
      try {
        if (typeof nextItem.data === "string") {
          channel.send(nextItem.data);
        } else {
          channel.send(nextItem.data);
        }
      } catch {
        input.entry.sendQueue.splice(nextItemIndex, 0, nextItem);
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

    this.updateBufferedAmountLowThreshold(input.peerId, input.entry, channel);
    this.callbacks.onDataBufferedAmountChange?.({
      peerId: input.peerId,
      bufferedAmountBytes: channel.bufferedAmount
    });
  }

  private resolveSendBudget(peerId: string): DataChannelSendBudget {
    const resolved = this.resolvePeerSendBudget?.(peerId);
    const highWatermarkBytes =
      resolved?.highWatermarkBytes ?? this.sendQueueHighWatermarkBytes;
    return {
      highWatermarkBytes,
      bulkHighWatermarkBytes:
        resolved?.bulkHighWatermarkBytes ?? highWatermarkBytes,
      maxPayloadBytes: resolved?.maxPayloadBytes ?? Number.MAX_SAFE_INTEGER
    };
  }

  private updateBufferedAmountLowThreshold(
    peerId: string,
    entry: DataChannelLifecycleEntry,
    channel: RTCDataChannel
  ) {
    const budget = this.resolveSendBudget(peerId);
    channel.bufferedAmountLowThreshold = resolveDataChannelBufferedAmountLowThreshold({
      queue: entry.sendQueue,
      preferredLowWatermarkBytes: this.sendQueueLowWatermarkBytes,
      highWatermarkBytes: budget.highWatermarkBytes,
      bulkHighWatermarkBytes: budget.bulkHighWatermarkBytes
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
  bulkHighWatermarkBytes?: number;
  priority?: DataChannelQueuedSendItem["priority"];
}) {
  if (input.queueLength <= 0) {
    return false;
  }

  const priority = input.priority ?? "control";
  const watermark =
    priority === "bulk"
      ? input.bulkHighWatermarkBytes ?? input.highWatermarkBytes
      : input.highWatermarkBytes;
  return input.bufferedAmountBytes < watermark;
}

export function resolveNextSendQueueItemIndex(input: {
  queue: DataChannelQueuedSendItem[];
  bufferedAmountBytes: number;
  highWatermarkBytes: number;
  bulkHighWatermarkBytes: number;
}) {
  const priorities: Array<NonNullable<DataChannelQueuedSendItem["priority"]>> = [
    "control",
    "critical",
    "bulk"
  ];

  for (const priority of priorities) {
    if (
      !shouldSendQueuedDataChannelItem({
        queueLength: input.queue.length,
        bufferedAmountBytes: input.bufferedAmountBytes,
        highWatermarkBytes: input.highWatermarkBytes,
        bulkHighWatermarkBytes: input.bulkHighWatermarkBytes,
        priority
      })
    ) {
      continue;
    }

    const index = input.queue.findIndex(
      (item) => (item.priority ?? "control") === priority
    );
    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

export function resolveDataChannelBufferedAmountLowThreshold(input: {
  queue: DataChannelQueuedSendItem[];
  preferredLowWatermarkBytes: number;
  highWatermarkBytes: number;
  bulkHighWatermarkBytes: number;
}) {
  if (input.queue.length === 0) {
    return Math.max(0, Math.floor(input.preferredLowWatermarkBytes));
  }

  const hasControlOrCritical = input.queue.some(
    (item) => (item.priority ?? "control") !== "bulk"
  );
  const activeWatermark = hasControlOrCritical
    ? input.highWatermarkBytes
    : input.bulkHighWatermarkBytes;
  const adaptiveLowWatermark = Math.floor(Math.max(0, activeWatermark) / 2);

  return Math.max(
    0,
    Math.min(
      Math.floor(input.preferredLowWatermarkBytes),
      adaptiveLowWatermark
    )
  );
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
