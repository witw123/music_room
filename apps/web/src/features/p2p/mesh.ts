import {
  type IceServerConfig,
  type P2PDataMessage,
  type PeerSignalMessage
} from "@music-room/shared";
import {
  samplePeerConnectionStats,
  type PeerConnectionStatsSample
} from "./connection-stats";
import {
  type BinaryPieceFragmentMessage
} from "./piece-frame-codec";
import {
  isBinaryPieceFragmentMessage,
  isBinaryPieceMessage,
  parseIncomingMeshMessage
} from "./mesh-message-codec";
import {
  SignalingTransport,
  shouldIgnoreStaleAnswerError,
  toIceCandidateInit,
  toSessionDescriptionInit
} from "./signaling-transport";
import {
  DataChannelManager,
  type DataChannelQueuedSendItem
} from "./data-channel-manager";
import {
  PieceRequestTracker
} from "./piece-request-tracker";
import { PieceFragmentTracker } from "./piece-fragment-tracker";
import { PieceInboundProcessor } from "./piece-inbound-processor";
import { PieceServeProcessor } from "./piece-serve-processor";
import {
  PeerConnectionRegistry,
  clearPeerTimers,
  createPeerEntry,
  enqueuePeerOperation,
  flushPendingCandidates,
  shouldRestartPeer,
  startPeerStatsSampling,
  stopPeerStatsSampling,
  type PeerEntry
} from "./peer-connection-registry";
import { MeshHealthMonitor } from "./mesh-health-monitor";

type MeshCallbacks = {
  onPieceReceived: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
    payloadBytes: number;
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
  private readonly peerConnections: PeerConnectionRegistry;
  private readonly pieceRequests = new PieceRequestTracker();
  private readonly reconnectBackoffMs = [1_000, 2_000, 4_000, 8_000] as const;
  private readonly dataOpenTimeoutMs = 8_000;
  private readonly dataConnectingTimeoutMs = 12_000;
  private readonly connectionProgressTimeoutMs = 15_000;
  private readonly activeStatsSamplingIntervalMs = 1_000;
  private readonly steadyStatsSamplingIntervalMs = 5_000;
  private readonly sendQueueLowWatermarkBytes = 384 * 1024;
  private readonly sendQueueHighWatermarkBytes = 1024 * 1024;
  private readonly incomingPieceBatchSize = 8;
  private readonly pieceServeBatchConcurrency = 3;
  private readonly maxDataChannelPayloadBytes = 48 * 1024;
  private readonly incomingPieceFragmentTtlMs = 15_000;
  private statsSamplingMode: "off" | "steady" | "active" = "active";
  private readonly autoReconnect: boolean;
  private readonly resolveConnectionConfig?: MeshOptions["resolveConnectionConfig"];
  private readonly resolveTrackCacheIdentity?: MeshOptions["resolveTrackCacheIdentity"];
  private readonly pieceFragments = new PieceFragmentTracker({
    ttlMs: this.incomingPieceFragmentTtlMs
  });
  private readonly signaling: SignalingTransport;
  private readonly dataChannels: DataChannelManager;
  private readonly healthMonitor: MeshHealthMonitor;
  private readonly inboundPieces: PieceInboundProcessor;
  private readonly pieceServe: PieceServeProcessor<PeerEntry>;

  constructor(
    private readonly roomId: string,
    private readonly localPeerId: string,
    private readonly sendSignal: (payload: PeerSignalMessage) => void,
    private readonly callbacks: MeshCallbacks,
    private readonly iceServers: IceServerConfig[] = [],
    options: MeshOptions = {}
    ) {
    this.peerConnections = new PeerConnectionRegistry(this.localPeerId);
    this.autoReconnect = options.autoReconnect ?? true;
    this.resolveConnectionConfig = options.resolveConnectionConfig;
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
    this.healthMonitor = new MeshHealthMonitor({
      autoReconnect: this.autoReconnect,
      reconnectBackoffMs: this.reconnectBackoffMs,
      dataOpenTimeoutMs: this.dataOpenTimeoutMs,
      dataConnectingTimeoutMs: this.dataConnectingTimeoutMs,
      connectionProgressTimeoutMs: this.connectionProgressTimeoutMs,
      isExpectedPeer: (peerId) => this.peerConnections.expects(peerId),
      getPeerEntry: (peerId) => this.peerConnections.get(peerId),
      onPeerStalled: this.callbacks.onPeerStalled,
      releasePeer: (peerId, entry) => this.releasePeer(peerId, entry),
      recreatePeer: (peerId, entry) => this.recreatePeer(peerId, entry)
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
  }

  async syncPeers(
    remotePeerIds: string[],
    options?: { forceReconnectDegraded?: boolean }
  ) {
    const nextPeers = this.peerConnections.setExpectedRemotePeerIds(remotePeerIds);

    for (const peerId of nextPeers) {
      const existing = this.peerConnections.get(peerId);
      if (
        existing &&
        (options?.forceReconnectDegraded || this.shouldRestartPeerEntry(existing))
      ) {
        await this.recreatePeer(peerId, existing);
        continue;
      }

      if (!existing) {
        await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId));
        continue;
      }

      this.schedulePeerWatchdog(peerId, existing);
    }

    for (const [peerId, entry] of this.peerConnections.entries()) {
      if (!nextPeers.has(peerId)) {
        this.releasePeer(peerId, entry);
      }
    }
  }

  async handleSignal(payload: PeerSignalMessage) {
    if (payload.channelKind !== "data" || payload.toPeerId !== this.localPeerId) {
      return;
    }

    // handleSignal is for processing incoming signals — always get/create the peer
    // entry and process the signal regardless of who initiated.
    const entry =
      this.peerConnections.get(payload.fromPeerId) ??
      (await this.ensurePeer(payload.fromPeerId, false));
    entry.lastSignalProgressAtMs = Date.now();

    if (payload.type === "offer") {
      await enqueuePeerOperation(entry, async () => {
        this.signaling.markReceived(payload.fromPeerId, "offer");
        const remoteDescription = toSessionDescriptionInit(payload.payload);
        if (!remoteDescription) {
          return;
        }

        if (
          entry.connection.signalingState !== "stable" &&
          entry.connection.signalingState !== "have-local-offer"
        ) {
          return;
        }

        await this.applyRemoteDescription(entry, remoteDescription);
        await flushPendingCandidates(entry);
        const answer = await entry.connection.createAnswer();
        await entry.connection.setLocalDescription(answer);
        entry.lastSignalProgressAtMs = Date.now();
        this.signaling.send(payload.fromPeerId, "answer", answer as unknown as Record<string, unknown>);
      });
      return;
    }

    if (payload.type === "answer") {
      await enqueuePeerOperation(entry, async () => {
        this.signaling.markReceived(payload.fromPeerId, "answer");
        const remoteDescription = toSessionDescriptionInit(payload.payload);
        if (!remoteDescription) {
          return;
        }

        if (entry.connection.signalingState !== "have-local-offer") {
          return;
        }

        await this.applyRemoteDescription(entry, remoteDescription);
        await flushPendingCandidates(entry);
        entry.lastSignalProgressAtMs = Date.now();
      });
      return;
    }

    if (payload.type === "candidate") {
      await enqueuePeerOperation(entry, async () => {
        this.signaling.markReceived(payload.fromPeerId, "candidate");
        const candidate = toIceCandidateInit(payload.payload);
        if (!candidate) {
          return;
        }

        if (!entry.connection.remoteDescription) {
          entry.pendingCandidates.push(candidate);
          return;
        }

        try {
          await entry.connection.addIceCandidate(candidate);
          entry.lastSignalProgressAtMs = Date.now();
        } catch {
          if (!entry.connection.remoteDescription) {
            entry.pendingCandidates.push(candidate);
          }
        }
      });
    }
  }

  setStatsSamplingMode(mode: "off" | "steady" | "active") {
    if (this.statsSamplingMode === mode) {
      return;
    }

    this.statsSamplingMode = mode;
    for (const [peerId, entry] of this.peerConnections.entries()) {
      this.stopStatsSampling(entry);
      this.startStatsSampling(peerId, entry);
    }
  }

  requestPiece(
    peerId: string,
    trackId: string,
    chunkIndex: number,
    expectedTotalChunks?: number,
    timeoutMs = 10000
  ) {
    return this.requestPieces(
      peerId,
      trackId,
      [chunkIndex],
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
    const entry = this.peerConnections.get(peerId);
    if (!entry?.channel || entry.channel.readyState !== "open") {
      return false;
    }

    const normalizedChunkIndexes = this.pieceRequests.getAvailableChunkIndexes(trackId, chunkIndexes);
    if (normalizedChunkIndexes.length === 0) {
      return false;
    }

    const requestId =
      normalizedChunkIndexes.length > 1 ? this.createRequestId(trackId, normalizedChunkIndexes) : undefined;
    this.pieceRequests.registerRequests({
      peerId,
      trackId,
      chunkIndexes: normalizedChunkIndexes,
      expectedTotalChunks,
      requestId,
      timeoutMs,
      onTimeout: this.callbacks.onPieceRequestTimeout
    });

    const payload: P2PDataMessage =
      normalizedChunkIndexes.length === 1
        ? {
            kind: "request-piece",
            trackId,
            chunkIndex: normalizedChunkIndexes[0]!
          }
        : {
            kind: "request-pieces",
            requestId: requestId!,
            trackId,
            chunkIndexes: normalizedChunkIndexes
          };
    this.enqueueSendItem(peerId, entry, {
      data: JSON.stringify(payload)
    });
    this.callbacks.onPieceRequestSent?.({
      peerId,
      trackId,
      chunkIndexes: normalizedChunkIndexes,
      requestId
    });
    return true;
  }

  getConnectedPeerIds() {
    return this.peerConnections.getConnectedPeerIds();
  }

  async restartPeer(peerId: string) {
    const entry = this.peerConnections.get(peerId);
    if (!entry) {
      if (!this.peerConnections.expects(peerId)) {
        return null;
      }
      return this.ensurePeer(peerId, this.shouldInitiatePeer(peerId));
    }

    return this.recreatePeer(peerId, entry);
  }

  async restartIce(peerId: string) {
    const entry = this.peerConnections.get(peerId);
    if (!entry || entry.releasing) {
      return null;
    }

    return enqueuePeerOperation(entry, async () => {
      if (entry.releasing || entry.connection.signalingState !== "stable") {
        return null;
      }

      const offer = await entry.connection.createOffer({ iceRestart: true });
      await entry.connection.setLocalDescription(offer);
      entry.lastSignalProgressAtMs = Date.now();
      this.signaling.send(peerId, "offer", offer as unknown as Record<string, unknown>);
      return entry;
    });
  }

  destroy() {
    this.peerConnections.clearExpected();
    this.pieceRequests.clearAll();
    this.inboundPieces.clear();
    this.pieceFragments.clearAll();

    for (const [peerId, entry] of this.peerConnections.entries()) {
      this.releasePeer(peerId, entry);
    }
    this.peerConnections.clearPeers();
  }

  private async ensurePeer(peerId: string, shouldInitiate: boolean) {
    const existing = this.peerConnections.get(peerId);

    if (existing) {
      if (
        existing.connection.connectionState === "failed" ||
        existing.connection.connectionState === "closed"
      ) {
        this.releasePeer(peerId, existing);
      } else {
      // If an entry exists and we are the initiator, do NOT initiate again.
      // The remote peer may already be trying to connect to us.
        if (shouldInitiate && existing.initiatorPeerId === this.localPeerId) {
          return existing;
        }
        // If an entry exists and we are NOT the initiator, return it.
        // handleSignal will use it to process the incoming offer/answer.
        return existing;
      }
    }

    const connection = new RTCPeerConnection(this.buildConnectionConfig(peerId));
    const entry = createPeerEntry({
      connection,
      initiatorPeerId: shouldInitiate ? this.localPeerId : null,
      nowMs: Date.now()
    });
    this.startStatsSampling(peerId, entry);

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }
      entry.lastSignalProgressAtMs = Date.now();

      this.signaling.send(
        peerId,
        "candidate",
        event.candidate.toJSON() as unknown as Record<string, unknown>
      );
    };

    connection.onconnectionstatechange = () => {
      entry.lastSignalProgressAtMs = Date.now();
      this.callbacks.onPeerConnectionChange?.({
        peerId,
        state: connection.connectionState
      });

      if (connection.connectionState === "connected" && entry.channel?.readyState === "open") {
        entry.reconnectAttempts = 0;
      }

      if (this.peerConnections.get(peerId) === entry) {
        if (connection.connectionState === "failed" || connection.connectionState === "closed") {
          if (this.peerConnections.expects(peerId)) {
            this.callbacks.onPeerStalled?.({
              peerId,
              reason: "connection-failed"
            });
            if (this.autoReconnect) {
              this.schedulePeerReconnect(peerId, entry);
            }
            return;
          }

          this.releasePeer(peerId, entry);
          return;
        }

        this.schedulePeerWatchdog(peerId, entry);
      }
    };

    connection.oniceconnectionstatechange = () => {
      entry.lastSignalProgressAtMs = Date.now();
      this.callbacks.onIceConnectionStateChange?.({
        peerId,
        state: connection.iceConnectionState
      });
      if (this.peerConnections.get(peerId) === entry) {
        this.schedulePeerWatchdog(peerId, entry);
      }
    };

    connection.ondatachannel = (event) => {
      entry.channel = event.channel;
      this.bindChannel(peerId, entry, entry.channel);
    };

    this.peerConnections.set(peerId, entry);
    this.schedulePeerWatchdog(peerId, entry);
    try {
      if (shouldInitiate) {
        const channel = connection.createDataChannel("music-room-p2p", {
          ordered: false
        });
        entry.channel = channel;
        this.bindChannel(peerId, entry, channel);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        entry.lastSignalProgressAtMs = Date.now();
        this.signaling.send(peerId, "offer", offer as unknown as Record<string, unknown>);
      }

      return entry;
    } catch (error) {
      if (this.peerConnections.get(peerId) === entry) {
        this.releasePeer(peerId, entry);
      }
      throw error;
    }
  }

  private bindChannel(peerId: string, entry: PeerEntry, channel: RTCDataChannel) {
    this.dataChannels.bind({
      peerId,
      entry,
      channel,
      flushSendQueue: () => this.flushSendQueue(peerId, entry),
      schedulePeerWatchdog: () => this.schedulePeerWatchdog(peerId, entry),
      clearPendingRequestsForPeer: (closedPeerId) => this.clearPendingRequestsForPeer(closedPeerId),
      schedulePeerReconnect: () => this.schedulePeerReconnect(peerId, entry),
      onMessage: async (event) => {
        const message = await parseIncomingMeshMessage(event.data);
        if (!message) {
          return;
        }

        if (message.kind === "request-piece") {
          this.callbacks.onPieceRequestReceived?.({
            peerId,
            trackId: message.trackId,
            chunkIndex: message.chunkIndex
          });
          await this.handlePieceRequest(peerId, entry, {
            trackId: message.trackId,
            chunkIndex: message.chunkIndex
          });
          return;
        }

        if (message.kind === "request-pieces") {
          const chunkIndexes = [...new Set(message.chunkIndexes)].sort((left, right) => left - right);
          for (let offset = 0; offset < chunkIndexes.length; offset += this.pieceServeBatchConcurrency) {
            const batch = chunkIndexes.slice(offset, offset + this.pieceServeBatchConcurrency);
            await Promise.all(
              batch.map(async (chunkIndex) => {
                this.callbacks.onPieceRequestReceived?.({
                  peerId,
                  trackId: message.trackId,
                  chunkIndex,
                  requestId: message.requestId
                });
                await this.handlePieceRequest(peerId, entry, {
                  trackId: message.trackId,
                  chunkIndex,
                  requestId: message.requestId
                });
              })
            );
          }
          return;
        }

        if (message.kind === "send-piece" && isBinaryPieceMessage(message)) {
          const pendingRequest = this.pieceRequests.take(message.trackId, message.chunkIndex);

          this.inboundPieces.enqueue({
            peerId,
            message,
            pendingRequest: pendingRequest ?? undefined
          });
          return;
        }

        if (message.kind === "send-piece-fragment" && isBinaryPieceFragmentMessage(message)) {
          this.handleIncomingPieceFragment(peerId, message);
        }
      }
    });
  }

  private async handlePieceRequest(
    peerId: string,
    entry: PeerEntry,
    request: {
      trackId: string;
      chunkIndex: number;
      requestId?: string;
    }
  ) {
    await this.pieceServe.servePieceRequest({
      peerId,
      entry,
      request
    });
  }

  private enqueueSendItem(peerId: string, entry: PeerEntry, item: DataChannelQueuedSendItem) {
    this.dataChannels.enqueueSendItem({
      peerId,
      entry,
      item,
      schedulePeerReconnect: () => this.schedulePeerReconnect(peerId, entry)
    });
  }

  private flushSendQueue(peerId: string, entry: PeerEntry) {
    this.dataChannels.flushSendQueue({
      peerId,
      entry,
      schedulePeerReconnect: () => this.schedulePeerReconnect(peerId, entry)
    });
  }

  private releasePeer(peerId: string, entry: PeerEntry) {
    entry.releasing = true;
    entry.sendQueue = [];
    this.peerConnections.deleteIfCurrent(peerId, entry);
    clearPeerTimers(entry);
    this.clearPendingRequestsForPeer(peerId);
    this.stopStatsSampling(entry);
    entry.channel?.close();
    entry.connection.close();
    this.callbacks.onDataBufferedAmountChange?.({
      peerId,
      bufferedAmountBytes: 0
    });
  }

  private shouldRestartPeerEntry(entry: PeerEntry) {
    return shouldRestartPeer({
      entry,
      nowMs: Date.now(),
      dataOpenTimeoutMs: this.dataOpenTimeoutMs,
      dataConnectingTimeoutMs: this.dataConnectingTimeoutMs,
      connectionProgressTimeoutMs: this.connectionProgressTimeoutMs
    });
  }

  private schedulePeerWatchdog(peerId: string, entry: PeerEntry) {
    this.healthMonitor.schedulePeerWatchdog(peerId, entry);
  }

  private schedulePeerReconnect(peerId: string, entry: PeerEntry) {
    this.healthMonitor.schedulePeerReconnect(peerId, entry);
  }

  private async recreatePeer(peerId: string, entry: PeerEntry) {
    const reconnectAttempts = entry.reconnectAttempts;
    this.releasePeer(peerId, entry);
    const nextEntry = await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId));
    nextEntry.reconnectAttempts = reconnectAttempts;
    return nextEntry;
  }

  private buildConnectionConfig(peerId: string): RTCConfiguration {
    return {
      iceServers:
        this.iceServers.length > 0 ? this.iceServers : [{ urls: "stun:stun.l.google.com:19302" }],
      ...(this.resolveConnectionConfig?.(peerId) ?? {})
    };
  }

  private startStatsSampling(peerId: string, entry: PeerEntry) {
    startPeerStatsSampling({
      peerId,
      entry,
      mode: this.statsSamplingMode,
      activeStatsSamplingIntervalMs: this.activeStatsSamplingIntervalMs,
      steadyStatsSamplingIntervalMs: this.steadyStatsSamplingIntervalMs,
      onStatsSample: this.callbacks.onStatsSample,
      samplePeerConnectionStats
    });
  }

  private stopStatsSampling(entry: PeerEntry) {
    stopPeerStatsSampling(entry);
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
    this.pieceRequests.clearPeer(peerId);
  }

  private createRequestId(trackId: string, chunkIndexes: number[]) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${trackId}:${crypto.randomUUID()}`;
    }

    return `${trackId}:${chunkIndexes[0] ?? 0}:${Date.now().toString(36)}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  private shouldInitiatePeer(peerId: string) {
    return this.localPeerId.localeCompare(peerId) < 0;
  }

  private handleIncomingPieceFragment(peerId: string, message: BinaryPieceFragmentMessage) {
    const assembledMessage = this.pieceFragments.addFragment(peerId, message);
    if (!assembledMessage) {
      return;
    }

    const pendingRequest = this.pieceRequests.take(message.trackId, message.chunkIndex);

    this.inboundPieces.enqueue({
      peerId,
      message: assembledMessage,
      pendingRequest: pendingRequest ?? undefined
    });
  }
}
