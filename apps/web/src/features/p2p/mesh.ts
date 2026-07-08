import {
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
  type DataChannelQueuedSendItem
} from "./data-channel-manager";
import { PieceRequestClient } from "./piece-request-client";
import { PieceMessageRouter } from "./piece-message-router";
import { PieceInboundProcessor } from "./piece-inbound-processor";
import { PieceServeProcessor } from "./piece-serve-processor";
import {
  type PeerEntry
} from "./peer-connection-registry";
import { PeerConnectionLifecycleManager } from "./peer-connection-lifecycle-manager";

type MeshCallbacks = {
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
    requestId?: string;
    requestRttMs?: number | null;
  }) => boolean | void;
  onPiecePersisted?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
    payloadBytes: number;
    requestId?: string;
    requestRttMs?: number | null;
  }) => void;
  onPieceSent?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    payloadBytes: number;
  }) => void;
  onPieceRequestSent?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndexes: number[];
    requestId?: string;
  }) => void;
  onPieceRequestReceived?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    requestId?: string;
  }) => void;
  onPieceServed?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    payloadBytes: number;
    requestId?: string;
  }) => void;
  onPieceServeMiss?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    reason: "channel-not-open" | "piece-missing" | "manifest-missing";
  }) => void;
  onPieceRequestTimeout?: (payload: {
    trackId: string;
    chunkIndex: number;
    peerId: string;
    requestId?: string;
    requestDurationMs: number;
  }) => void;
  onPeerConnectionChange?: (payload: {
    peerId: string;
    state: RTCPeerConnectionState;
  }) => void;
  onIceConnectionStateChange?: (payload: {
    peerId: string;
    state: RTCIceConnectionState;
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
    requestId?: string;
  } | null>;
  resolveTrackCacheIdentity?: (trackId: string) =>
    | {
        fileHash: string | null;
        ownerKey?: string | null;
        chunkSize?: number | null;
      }
    | null
    | undefined;
};

export class P2PMesh {
  private readonly sendQueueLowWatermarkBytes = 4 * 1024 * 1024;
  private readonly sendQueueHighWatermarkBytes = 16 * 1024 * 1024;
  private readonly incomingPieceBatchSize = 32;
  private readonly pieceServeBatchConcurrency = 128;
  private readonly maxDataChannelPayloadBytes = 240 * 1024;
  private readonly incomingPieceFragmentTtlMs = 15_000;
  private readonly autoReconnect: boolean;
  private readonly resolveTrackCacheIdentity?: MeshOptions["resolveTrackCacheIdentity"];
  private readonly signaling: SignalingTransport;
  private readonly peerLifecycle: PeerConnectionLifecycleManager;
  private readonly dataChannels: DataChannelManager;
  private readonly inboundPieces: PieceInboundProcessor;
  private readonly pieceServe: PieceServeProcessor<PeerEntry>;
  private readonly pieceRequestClient: PieceRequestClient<PeerEntry>;
  private readonly pieceMessages: PieceMessageRouter<PeerEntry>;

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
      onDataChannelStateChange: this.callbacks.onDataChannelStateChange,
      onDataBufferedAmountChange: this.callbacks.onDataBufferedAmountChange,
      onPeerConnectionChange: this.callbacks.onPeerConnectionChange,
      onPeerStalled: this.callbacks.onPeerStalled
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
      onPeerStalled: this.callbacks.onPeerStalled
    });
    this.pieceServe = new PieceServeProcessor<PeerEntry>({
      localPeerId: this.localPeerId,
      maxDataChannelPayloadBytes: this.maxDataChannelPayloadBytes,
      resolvePieceRequestFallback: options.resolvePieceRequestFallback,
      resolveTrackCacheIdentity: this.resolveTrackCacheIdentity,
      enqueueSendItem: (peerId, entry, item) => this.enqueueSendItem(peerId, entry, item),
      onPieceServed: this.callbacks.onPieceServed,
      onPieceServeMiss: this.callbacks.onPieceServeMiss
    });
    this.pieceRequestClient = new PieceRequestClient<PeerEntry>({
      getPeerEntry: (peerId) => this.peerLifecycle.getPeerEntry(peerId),
      enqueueSendItem: (peerId, entry, item) => this.enqueueSendItem(peerId, entry, item),
      onPieceRequestSent: this.callbacks.onPieceRequestSent,
      onPieceRequestTimeout: this.callbacks.onPieceRequestTimeout
    });
    this.inboundPieces = new PieceInboundProcessor({
      batchSize: this.incomingPieceBatchSize,
      localPeerId: this.localPeerId,
      resolveManifestHeader: (trackId, fallbackChunkSize) =>
        this.pieceServe.resolveManifestHeader(trackId, fallbackChunkSize),
      rememberManifestHeader: (trackId, header) =>
        this.pieceServe.rememberManifestHeader(trackId, header),
      resolveTrackCacheIdentity: this.resolveTrackCacheIdentity,
      onPieceReceived: this.callbacks.onPieceReceived,
      onPiecePersisted: this.callbacks.onPiecePersisted,
      onPieceRequestTimeout: this.callbacks.onPieceRequestTimeout
    });
    this.pieceMessages = new PieceMessageRouter<PeerEntry>({
      pieceServeBatchConcurrency: this.pieceServeBatchConcurrency,
      incomingPieceFragmentTtlMs: this.incomingPieceFragmentTtlMs,
      servePieceRequest: (input) => this.pieceServe.servePieceRequest(input),
      servePieceRequests: (input) => this.pieceServe.servePieceRequests(input),
      takePendingRequest: (trackId, chunkIndex) =>
        this.pieceRequestClient.takePendingRequest(trackId, chunkIndex),
      enqueueInboundPiece: (item) => this.inboundPieces.enqueue(item),
      onPieceRequestReceived: this.callbacks.onPieceRequestReceived
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
      getOrCreatePeerEntry: (peerId) => this.peerLifecycle.getOrCreatePeerEntry(peerId),
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
    return this.pieceRequestClient.requestPiece(
      peerId,
      trackId,
      chunkIndex,
      expectedTotalChunks,
      timeoutMs
    );
  }

  requestPieces(
    peerId: string,
    trackId: string,
    chunkIndexes: number[],
    expectedTotalChunks?: number,
    timeoutMs = 10000
  ) {
    return this.pieceRequestClient.requestPieces(
      peerId,
      trackId,
      chunkIndexes,
      expectedTotalChunks,
      timeoutMs
    );
  }

  getConnectedPeerIds() {
    return this.peerLifecycle.getConnectedPeerIds();
  }

  async restartPeer(peerId: string) {
    return this.peerLifecycle.restartPeer(peerId);
  }

  async restartIce(peerId: string) {
    return this.peerLifecycle.restartIce(peerId);
  }

  destroy() {
    this.pieceRequestClient.clearAll();
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
    this.pieceRequestClient.clearPeer(peerId);
  }
}
