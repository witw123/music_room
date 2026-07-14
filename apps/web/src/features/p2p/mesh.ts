import {
  type AssetAvailabilityAnnouncement,
  type AssetUnitDescriptor,
  type CacheStreamMessage,
  type IceServerConfig,
  type PeerSignalMessage
} from "@music-room/shared";
import {
  type PeerConnectionStatsSample
} from "./connection-stats";
import {
  SignalingTransport,
  shouldIgnoreStaleAnswerError
} from "./signaling-transport";
import {
  DataChannelManager,
  type DataChannelSendBudget,
  type DataChannelQueuedSendItem
} from "./data-channel-manager";
import { PieceMessageRouter } from "./piece-message-router";
import { PieceInboundProcessor } from "./piece-inbound-processor";
import {
  type PeerEntry
} from "./peer-connection-registry";
import { PeerConnectionLifecycleManager } from "./peer-connection-lifecycle-manager";
import { CacheStreamProducer, type CacheStreamProducerMetrics } from "./cache-stream-producer";
import {
  CacheStreamScheduler,
  type CacheStreamRequestOptions,
  type CacheStreamResetReason,
  type CacheStreamSchedulerMetrics
} from "./cache-stream-scheduler";
import { pieceMemoryBuffer } from "./piece-memory-buffer";
import { AssetTransferManager } from "./asset-transfer-manager";

type MeshCallbacks = {
  onAssetUnitPersisted?: (payload: {
    peerId: string;
    descriptor: AssetUnitDescriptor;
    payloadBytes: number;
  }) => void;
  onAssetStreamReset?: (payload: {
    peerId: string;
    assetId: string;
    unitIndexes: number[];
    reason: string;
  }) => void;
  onPieceReceived: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
    payloadBytes: number;
    /** Raw piece payload — available for in-memory buffering before persistence. */
    payload: ArrayBuffer;
    streamId: string;
    generation: number;
  }) => boolean | void;
  onPieceValidated?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    payloadBytes: number;
    streamId: string;
    generation: number;
  }) => void;
  onPiecePersisted?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
    payloadBytes: number;
    streamId: string;
    generation: number;
  }) => void;
  onPieceSent?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    payloadBytes: number;
  }) => void;
  onInboundBacklog?: (payload: {
    peerId: string;
    validationQueueBytes: number;
    persistenceBacklogBytes: number;
    persistenceWorkerCount: number;
    lastNackReason?: string;
  }) => void;
  onCacheStreamMetrics?: (payload: CacheStreamProducerMetrics | CacheStreamSchedulerMetrics) => void;
  onCacheStreamReset?: (payload: {
    peerId: string;
    trackId: string;
    streamId: string;
    generation: number;
    chunkIndexes: number[];
    reason: CacheStreamResetReason;
  }) => void;
  onPeerConnectionChange?: (payload: {
    peerId: string;
    state: RTCPeerConnectionState;
    linkKind?: "data" | "media";
  }) => void;
  onIceConnectionStateChange?: (payload: {
    peerId: string;
    state: RTCIceConnectionState;
    linkKind?: "data" | "media";
  }) => void;
  onDataChannelStateChange?: (payload: {
    peerId: string;
    state: RTCDataChannelState;
  }) => void;
  onDataBufferedAmountChange?: (payload: {
    peerId: string;
    bufferedAmountBytes: number;
  }) => void;
  onSignal?: (payload: {
    peerId: string;
    direction: "sent" | "received";
    type: PeerSignalMessage["type"];
  }) => void;
  onStatsSample?: (payload: {
    peerId: string;
    sample: PeerConnectionStatsSample;
  }) => void;
  onPeerStalled?: (payload: {
    peerId: string;
    reason: "watchdog-timeout" | "connection-failed" | "data-channel-closed";
  }) => void;
  onRemoteAudioTrack?: (payload: {
    peerId: string;
    stream: MediaStream;
    track: MediaStreamTrack;
  }) => void;
  onMediaStateChange?: (payload: {
    peerId: string;
    direction: "sender" | "receiver";
    state: "none" | "live" | "ended" | "failed";
  }) => void;
  onMediaTrackMuted?: (payload: { peerId: string; trackId: string }) => void;
  onMediaRecovery?: (payload: {
    peerId: string;
    reason: "loss" | "jitter" | "no-packets" | "connection-failed";
    restartCount: number;
  }) => void;
};

type MeshOptions = {
  autoReconnect?: boolean;
  resolveConnectionConfig?: (peerId: string) => Partial<RTCConfiguration> | null | undefined;
  resolvePieceRequestFallback?: (input: {
    trackId: string;
    chunkIndex: number;
  }) => Promise<{
    payload: ArrayBuffer;
    hash: string;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
  } | null>;
  resolveTrackCacheIdentity?: (trackId: string) =>
    | {
        fileHash: string | null;
        ownerKey?: string | null;
        chunkSize?: number | null;
      }
    | null
    | undefined;
  resolvePeerSendBudget?: (peerId: string) => DataChannelSendBudget | null | undefined;
  resolvePeerTransport?: (peerId: string) => {
    candidateType?: string | null;
    protocol?: string | null;
    relayProtocol?: string | null;
    transportScore?: "healthy" | "degraded" | "unstable" | "failed" | null;
  } | null | undefined;
  resolveInitialCreditBytes?: (input: {
    peerId: string;
    chunkSize: number;
    priority: "critical" | "bulk";
  }) => number | null | undefined;
  resolveLocalAssetUnit?: (
    assetId: string,
    unitIndex: number
  ) => Promise<{ descriptor: AssetUnitDescriptor; payload: ArrayBuffer } | null>;
  persistInboundAssetUnit?: (
    peerId: string,
    descriptor: AssetUnitDescriptor,
    payload: ArrayBuffer
  ) => Promise<void>;
};

export class P2PMesh {
  private readonly sendQueueLowWatermarkBytes = 4 * 1024 * 1024;
  private readonly sendQueueHighWatermarkBytes = 16 * 1024 * 1024;
  private readonly incomingPieceBatchSize = 32;
  private readonly maxDataChannelPayloadBytes = 240 * 1024;
  private readonly incomingPieceFragmentTtlMs = 15_000;
  private readonly autoReconnect: boolean;
  private readonly resolveTrackCacheIdentity?: MeshOptions["resolveTrackCacheIdentity"];
  private readonly signaling: SignalingTransport;
  private readonly peerLifecycle: PeerConnectionLifecycleManager;
  private readonly dataChannels: DataChannelManager;
  private readonly inboundPieces: PieceInboundProcessor;
  private readonly pieceMessages: PieceMessageRouter<PeerEntry>;
  private readonly cacheStreamScheduler: CacheStreamScheduler;
  private readonly cacheStreamProducer: CacheStreamProducer<PeerEntry>;
  private readonly assetTransfers: AssetTransferManager;

  constructor(
    private readonly roomId: string,
    private readonly localPeerId: string,
    private readonly sendSignal: (payload: PeerSignalMessage) => void,
    private readonly callbacks: MeshCallbacks,
    private readonly iceServers: IceServerConfig[] = [],
    options: MeshOptions = {}
    ) {
    this.autoReconnect = options.autoReconnect ?? true;
    this.resolveTrackCacheIdentity = options.resolveTrackCacheIdentity;
    this.cacheStreamScheduler = new CacheStreamScheduler({
      sendControl: (peerId, message) => this.sendCacheStreamControl(peerId, message),
      resolvePeerTransport: options.resolvePeerTransport,
      resolveInitialCreditBytes: options.resolveInitialCreditBytes,
      onStreamReset: this.callbacks.onCacheStreamReset
    });
    this.signaling = new SignalingTransport({
      roomId: this.roomId,
      localPeerId: this.localPeerId,
      sendSignal: this.sendSignal,
      onSignal: this.callbacks.onSignal
    });
    this.dataChannels = new DataChannelManager({
      autoReconnect: this.autoReconnect,
      sendQueueLowWatermarkBytes: this.sendQueueLowWatermarkBytes,
      sendQueueHighWatermarkBytes: this.sendQueueHighWatermarkBytes,
      onPieceSent: this.callbacks.onPieceSent,
      onDataChannelStateChange: (payload) => {
        this.cacheStreamScheduler.markPeerConnected(payload.peerId, payload.state === "open");
        this.callbacks.onDataChannelStateChange?.(payload);
      },
      onDataBufferedAmountChange: (payload) => {
        this.cacheStreamProducer?.resumePeer(payload.peerId);
        this.callbacks.onDataBufferedAmountChange?.(payload);
      },
      onPeerConnectionChange: this.callbacks.onPeerConnectionChange,
      onPeerStalled: this.callbacks.onPeerStalled,
      resolvePeerSendBudget: options.resolvePeerSendBudget
    });
    this.cacheStreamProducer = new CacheStreamProducer<PeerEntry>({
      localPeerId: this.localPeerId,
      enqueueSendItem: (peerId, entry, item) => this.enqueueSendItem(peerId, entry, item),
      sendControl: (peerId, entry, message) => this.enqueueCacheStreamControl(peerId, entry, message),
      resolveTrackCacheIdentity: this.resolveTrackCacheIdentity,
      resolvePieceFallback: options.resolvePieceRequestFallback,
      resolveMaxDataChannelPayloadBytes: (peerId) =>
        options.resolvePeerSendBudget?.(peerId)?.maxPayloadBytes ?? this.maxDataChannelPayloadBytes,
      resolveDataChannelBufferedAmountBytes: (peerId, entry) =>
        Math.max(entry.dataChannel?.bufferedAmount ?? 0, entry.channel?.bufferedAmount ?? 0),
      resolveMaxInFlightBytes: (peerId) =>
        Math.min(
          32 * 1024 * 1024,
          Math.max(
            8 * 1024 * 1024,
            options.resolvePeerSendBudget?.(peerId)?.highWatermarkBytes ?? 16 * 1024 * 1024
          )
        ),
      onMetrics: (metrics) => this.callbacks.onCacheStreamMetrics?.(metrics)
    });
    this.assetTransfers = new AssetTransferManager({
      sendControl: (peerId, message) => {
        const entry = this.peerLifecycle.getPeerEntry(peerId);
        if (!entry) {
          return false;
        }
        this.enqueueSendItem(peerId, entry, {
          data: JSON.stringify(message),
          channel: "control",
          priority: "control"
        });
        return true;
      },
      sendBinary: (peerId, kind, payload) => {
        if (kind !== "original") {
          return false;
        }
        const entry = this.peerLifecycle.getPeerEntry(peerId);
        if (!entry) {
          return false;
        }
        this.enqueueSendItem(peerId, entry, {
          data: payload,
          channel: "original",
          priority: "bulk",
          payloadBytes: payload.byteLength
        });
        return true;
      },
      resolveLocalUnit: options.resolveLocalAssetUnit ?? (async () => null),
      persistInboundUnit:
        options.persistInboundAssetUnit ??
        (async () => {
          throw new Error("No asset persistence callback is configured.");
        }),
      onUnitPersisted: this.callbacks.onAssetUnitPersisted,
      onStreamReset: this.callbacks.onAssetStreamReset
    });
    this.peerLifecycle = new PeerConnectionLifecycleManager({
      localPeerId: this.localPeerId,
      autoReconnect: this.autoReconnect,
      iceServers: this.iceServers,
      resolveConnectionConfig: options.resolveConnectionConfig,
      signaling: this.signaling,
      bindChannel: (peerId, entry, channel) => this.bindChannel(peerId, entry, channel),
      clearPendingRequestsForPeer: (peerId) => this.clearPendingRequestsForPeer(peerId),
      onPeerConnectionChange: this.callbacks.onPeerConnectionChange,
      onIceConnectionStateChange: this.callbacks.onIceConnectionStateChange,
      onDataBufferedAmountChange: this.callbacks.onDataBufferedAmountChange,
      onStatsSample: this.callbacks.onStatsSample,
      onPeerStalled: this.callbacks.onPeerStalled,
      onRemoteAudioTrack: ({ peerId, entry, track, streams }) => {
        const stream = entry.remoteAudioStream ?? streams[0] ?? new MediaStream([track]);
        this.callbacks.onRemoteAudioTrack?.({ peerId, stream, track });
      },
      onMediaStateChange: ({ peerId, direction, state }) => {
        this.callbacks.onMediaStateChange?.({ peerId, direction, state });
      },
      onMediaTrackMuted: this.callbacks.onMediaTrackMuted,
      onMediaRecovery: this.callbacks.onMediaRecovery
    });
    this.inboundPieces = new PieceInboundProcessor({
      batchSize: this.incomingPieceBatchSize,
      localPeerId: this.localPeerId,
      resolveManifestHeader: (trackId, fallbackChunkSize) =>
        this.cacheStreamProducer.resolveManifestHeader(trackId, fallbackChunkSize),
      rememberManifestHeader: (trackId, header) =>
        this.cacheStreamProducer.rememberManifestHeader(trackId, header),
      resolveTrackCacheIdentity: this.resolveTrackCacheIdentity,
      onPieceReceived: this.callbacks.onPieceReceived,
      onPieceValidated: (payload) => {
        this.callbacks.onPieceValidated?.({
          peerId: payload.peerId,
          trackId: payload.trackId,
          chunkIndex: payload.chunkIndex,
          payloadBytes: payload.payloadBytes,
          streamId: payload.streamId,
          generation: payload.generation
        });
        if (payload.streamId && typeof payload.generation === "number") {
          this.cacheStreamScheduler.handleValidated({
            peerId: payload.peerId,
            streamId: payload.streamId,
            generation: payload.generation,
            chunkIndex: payload.chunkIndex,
            storedBytes: payload.payloadBytes
          });
        }
        this.reportInboundBacklog(payload.peerId);
      },
      onPiecePersisted: (payload) => {
        this.callbacks.onPiecePersisted?.(payload);
        if (payload.streamId && typeof payload.generation === "number") {
          this.cacheStreamScheduler.handlePersisted({
            peerId: payload.peerId,
            streamId: payload.streamId,
            generation: payload.generation,
            trackId: payload.trackId,
            chunkIndex: payload.chunkIndex,
            storedBytes: payload.payloadBytes
          });
        }
        this.reportInboundBacklog(payload.peerId);
      },
      onPieceNack: ({
        peerId,
        trackId,
        chunkIndex,
        streamId,
        generation,
        reason,
        refundCreditBytes
      }) => {
        this.cacheStreamScheduler.handleNack({
          peerId,
          trackId,
          chunkIndex,
          streamId,
          generation,
          reason,
          refundCreditBytes
        });
        this.reportInboundBacklog(peerId, reason);
      }
    });
    this.pieceMessages = new PieceMessageRouter<PeerEntry>({
      incomingPieceFragmentTtlMs: this.incomingPieceFragmentTtlMs,
      enqueueInboundPiece: (item) => this.inboundPieces.enqueue(item),
      acceptLegacyBinaryFrames: false,
      onCacheStreamMessage: ({ peerId, message }) => {
        const entry = this.peerLifecycle.getPeerEntry(peerId);
        if (!entry) {
          return;
        }
        if (message.kind === "cache-stream-reset") {
          this.cacheStreamScheduler.handleReset({
            peerId,
            streamId: message.streamId,
            generation: message.generation,
            reason: message.reason
          });
        }
        return this.cacheStreamProducer.handleMessage(peerId, entry, message);
      },
      onCacheStreamPiece: ({ peerId, trackId, streamId, generation, chunkIndex, payloadBytes }) => {
        const decision = this.cacheStreamScheduler.inspectIncomingPiece({
          peerId,
          trackId,
          streamId,
          generation,
          chunkIndex,
          payloadBytes
        });
        if (decision === "duplicate") {
          this.cacheStreamScheduler.ackDuplicate({
            peerId,
            streamId,
            generation,
            chunkIndex,
            storedBytes: payloadBytes
          });
        }
        return decision === "accepted";
      }
    });
  }

  async syncPeers(
    remotePeerIds: string[],
    options?: { forceReconnectDegraded?: boolean }
  ) {
    await this.peerLifecycle.syncPeers(remotePeerIds, options);
  }

  async handleSignal(payload: PeerSignalMessage) {
    await this.signaling.handleIncomingSignal(payload, {
      getOrCreatePeerEntry: (peerId, linkKind) =>
        this.peerLifecycle.getOrCreatePeerEntry(peerId, linkKind),
      runPeerOperation: (entry, task) => this.peerLifecycle.runPeerOperation(entry, task),
      applyRemoteDescription: (entry, remoteDescription) =>
        this.applyRemoteDescription(entry, remoteDescription),
      flushPendingCandidates: (entry) => this.peerLifecycle.flushPendingCandidates(entry)
    });
  }

  setStatsSamplingMode(mode: "off" | "steady" | "active") {
    this.peerLifecycle.setStatsSamplingMode(mode);
  }

  requestPiece(
    peerId: string,
    trackId: string,
    chunkIndex: number,
    expectedTotalChunks?: number,
    timeoutMs = 10000
  ) {
    return this.requestPieces(peerId, trackId, [chunkIndex], expectedTotalChunks, timeoutMs);
  }

  requestPieces(
    peerId: string,
    trackId: string,
    chunkIndexes: number[],
    expectedTotalChunks?: number,
    timeoutMs = 10000,
    options?: CacheStreamRequestOptions
  ) {
    this.inboundPieces.resumeTrack(trackId);
    return this.cacheStreamScheduler.request({
      trackId,
      chunkIndexes,
      totalChunks: Math.max(expectedTotalChunks ?? 0, ...chunkIndexes.map((index) => index + 1)),
      chunkSize: this.resolveTrackCacheIdentity?.(trackId)?.chunkSize ?? 128 * 1024,
      priority: options?.priority === "bulk" ? "bulk" : "critical",
      preferredPeerId: peerId,
      allowRedundant: options?.allowRedundant,
      maxReplicas: options?.maxReplicas,
      timeoutMs: options?.timeoutMs ?? timeoutMs
    });
  }

  updateCacheStreamProvider(provider: Parameters<CacheStreamScheduler["setProvider"]>[0]) {
    this.cacheStreamScheduler.setProvider(provider);
  }

  updateAssetProvider(announcement: AssetAvailabilityAnnouncement) {
    if (announcement.assetKind !== "original") {
      return;
    }
    if (announcement.ownerPeerId === this.localPeerId) {
      return;
    }
    this.assetTransfers.setProvider(announcement);
  }

  requestOriginalAssetUnits(input: {
    assetId: string;
    assetKind: "original";
    unitIndexes: number[];
    totalUnits: number;
    priority: "critical" | "playback-fill" | "bulk";
    preferredPeerId?: string | null;
    maxReplicas?: number;
  }) {
    return this.assetTransfers.request(input);
  }

  cancelOriginalAssetRequests(assetId: string) {
    this.assetTransfers.cancel(assetId);
  }

  removeAssetProvider(assetId: string, peerId: string) {
    this.assetTransfers.removeProvider(assetId, peerId);
  }

  markPeerTransportUnavailable(peerId: string) {
    this.cacheStreamScheduler.markPeerTransportUnavailable(peerId);
    this.cacheStreamProducer.clearPeer(peerId, "peer-closed");
    this.assetTransfers.removePeer(peerId);
  }

  markPeerTransportAvailable(peerId: string) {
    this.cacheStreamScheduler.markPeerTransportAvailable(peerId);
  }

  removeCacheStreamProvider(trackId: string, peerId: string) {
    this.cacheStreamScheduler.removeProvider(trackId, peerId);
  }

  getCacheStreamMetrics() {
    return [
      ...this.cacheStreamScheduler.getMetrics(),
      ...this.cacheStreamProducer.getMetrics()
    ];
  }

  async clearCacheStreamTrack(trackId: string) {
    this.cacheStreamScheduler.clearTrack(trackId);
    this.cacheStreamProducer.clearTrack(trackId);
    pieceMemoryBuffer.clearTrack(trackId);
    await this.inboundPieces.clearTrack(trackId);
  }

  getInboundTransferBacklog() {
    return this.inboundPieces.getBacklogSnapshot();
  }

  getConnectedPeerIds() {
    return this.peerLifecycle.getConnectedPeerIds();
  }

  setLocalAudioStream(
    stream: MediaStream | null,
    sourcePeerId: string | null,
    maxBitrateKbps: number | null = null
  ) {
    this.peerLifecycle.setLocalAudioStream(stream, sourcePeerId, maxBitrateKbps);
  }

  getPeerMediaState(peerId: string) {
    return this.peerLifecycle.getPeerMediaState(peerId);
  }

  async restartPeer(peerId: string) {
    return this.peerLifecycle.restartPeer(peerId);
  }

  async restartIce(peerId: string) {
    return this.peerLifecycle.restartIce(peerId);
  }

  async restartMediaPeer(peerId: string) {
    return this.peerLifecycle.restartMediaPeer(peerId);
  }

  refreshPeerDataBudget(peerId: string) {
    const entry = this.peerLifecycle.getPeerEntry(peerId);
    if (entry) {
      this.flushSendQueue(peerId, entry);
    }
  }

  destroy() {
    this.assetTransfers.clear();
    this.cacheStreamScheduler.clear();
    this.cacheStreamProducer.clear();
    this.inboundPieces.clear();
    this.pieceMessages.clear();
    this.peerLifecycle.destroy();
  }

  private bindChannel(peerId: string, entry: PeerEntry, channel: RTCDataChannel) {
    this.dataChannels.bind({
      peerId,
      entry,
      channel,
      flushSendQueue: () => this.flushSendQueue(peerId, entry),
      schedulePeerWatchdog: () => this.peerLifecycle.schedulePeerWatchdog(peerId, entry),
      clearPendingRequestsForPeer: (closedPeerId) => this.clearPendingRequestsForPeer(closedPeerId),
      schedulePeerReconnect: () => this.peerLifecycle.schedulePeerReconnect(peerId, entry),
      onMessage: async (event) => {
        if (await this.assetTransfers.handleChannelMessage(peerId, event.data)) {
          return;
        }
        await this.pieceMessages.handleChannelMessage({
          peerId,
          entry,
          data: event.data
        });
      }
    });
  }

  private enqueueSendItem(peerId: string, entry: PeerEntry, item: DataChannelQueuedSendItem) {
    this.dataChannels.enqueueSendItem({
      peerId,
      entry,
      item,
      schedulePeerReconnect: () => this.peerLifecycle.schedulePeerReconnect(peerId, entry)
    });
  }

  private flushSendQueue(peerId: string, entry: PeerEntry) {
    this.dataChannels.flushSendQueue({
      peerId,
      entry,
      schedulePeerReconnect: () => this.peerLifecycle.schedulePeerReconnect(peerId, entry)
    });
  }

  private async applyRemoteDescription(
    entry: PeerEntry,
    remoteDescription: RTCSessionDescriptionInit
  ) {
    try {
      await entry.connection.setRemoteDescription(remoteDescription);
    } catch (error) {
      if (
        remoteDescription.type === "answer" &&
        shouldIgnoreStaleAnswerError(entry.connection.signalingState, error)
      ) {
        return;
      }
      throw error;
    }
  }

  private clearPendingRequestsForPeer(peerId: string) {
    this.cacheStreamScheduler.markPeerConnected(peerId, false);
    this.cacheStreamProducer.clearPeer(peerId);
  }

  private sendCacheStreamControl(peerId: string, message: CacheStreamMessage) {
    const entry = this.peerLifecycle.getPeerEntry(peerId);
    if (entry) {
      this.enqueueCacheStreamControl(peerId, entry, message);
    }
  }

  private enqueueCacheStreamControl(peerId: string, entry: PeerEntry, message: CacheStreamMessage) {
    this.enqueueSendItem(peerId, entry, {
      data: JSON.stringify(message),
      channel: "control",
      priority: "control"
    });
  }

  private reportInboundBacklog(peerId: string, lastNackReason?: string) {
    const backlog = this.inboundPieces.getBacklogSnapshot();
    this.callbacks.onInboundBacklog?.({
      peerId,
      validationQueueBytes: backlog.validationQueueBytes,
      persistenceBacklogBytes: backlog.persistenceBacklogBytes,
      persistenceWorkerCount: backlog.persistenceWorkerCount,
      lastNackReason
    });
  }
}
