import {
  p2pDataMessageSchema,
  type IceServerConfig,
  type P2PDataMessage,
  type PeerSignalMessage
} from "@music-room/shared";
import {
  cacheTrackPieces,
  getCachedPiece,
  getCachedPieceIndexes,
  getTrackPieceManifest,
  localCacheOwnerKey
} from "@/lib/indexeddb";
import {
  samplePeerConnectionStats,
  type PeerConnectionStatsSample
} from "./connection-stats";
import {
  assembleIncomingPieceFragments,
  buildPieceFrames,
  decodePieceFrame,
  type BinaryPieceFragmentMessage,
  type BinaryPieceMessage,
  type PendingIncomingPieceFragments
} from "./piece-frame-codec";
import {
  SignalingTransport,
  shouldIgnoreStaleAnswerError,
  toIceCandidateInit,
  toSessionDescriptionInit
} from "./signaling-transport";
import {
  DataChannelManager,
  shouldFlushDataChannelQueue,
  shouldSendQueuedDataChannelItem
} from "./data-channel-manager";
import {
  PeerConnectionRegistry,
  clearPeerTimers,
  createPeerEntry,
  enqueuePeerOperation,
  flushPendingCandidates,
  shouldRestartPeer,
  type PeerEntry,
  type QueuedSendItem
} from "./peer-connection-registry";
import { MeshHealthMonitor } from "./mesh-health-monitor";
import { validateTrackPiecePayloadBatch } from "./index";

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

type PendingPieceRequest = {
  peerId: string;
  requestId?: string;
  expectedTotalChunks?: number;
  requestedAtMs: number;
  timeoutMs: number;
  timeoutId: ReturnType<typeof setTimeout>;
};

type IncomingPieceBatchItem = {
  peerId: string;
  message: BinaryPieceMessage;
  pendingRequest?: PendingPieceRequest;
};

type ReceivedPieceCallbackPayload = {
  peerId: string;
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
  payloadBytes: number;
  requestId?: string;
  requestRttMs?: number | null;
};

type PersistableIncomingPiece = {
  item: IncomingPieceBatchItem;
  expectedHash: string;
  callbackPayload: ReceivedPieceCallbackPayload;
};

type CachedPieceManifestHeader = {
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
  pieceHashes?: string[];
};

export class P2PMesh {
  private readonly peerConnections: PeerConnectionRegistry;
  private readonly pendingPieceRequests = new Map<string, PendingPieceRequest>();
  private readonly pendingIncomingPieces: IncomingPieceBatchItem[] = [];
  private readonly pieceManifestHeaders = new Map<string, CachedPieceManifestHeader>();
  private pieceFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pieceFlushInFlight = false;
  private piecePersistChain: Promise<void> = Promise.resolve();
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
  private readonly resolvePieceRequestFallback?: MeshOptions["resolvePieceRequestFallback"];
  private readonly resolveTrackCacheIdentity?: MeshOptions["resolveTrackCacheIdentity"];
  private readonly pendingIncomingPieceFragments = new Map<string, PendingIncomingPieceFragments>();
  private readonly signaling: SignalingTransport;
  private readonly dataChannels: DataChannelManager;
  private readonly healthMonitor: MeshHealthMonitor;

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
    this.resolvePieceRequestFallback = options.resolvePieceRequestFallback;
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

    const normalizedChunkIndexes = [...new Set(chunkIndexes)]
      .filter((chunkIndex) => !this.pendingPieceRequests.has(this.buildRequestKey(trackId, chunkIndex)))
      .sort((left, right) => left - right);
    if (normalizedChunkIndexes.length === 0) {
      return false;
    }

    const requestId =
      normalizedChunkIndexes.length > 1 ? this.createRequestId(trackId, normalizedChunkIndexes) : undefined;
    const pendingRequests: Array<{ requestKey: string; chunkIndex: number; timeoutId: ReturnType<typeof setTimeout> }> = [];
    const requestedAtMs = Date.now();

    for (const chunkIndex of normalizedChunkIndexes) {
      const requestKey = this.buildRequestKey(trackId, chunkIndex);
      const timeoutId = setTimeout(() => {
        this.pendingPieceRequests.delete(requestKey);
        this.callbacks.onPieceRequestTimeout?.({
          trackId,
          chunkIndex,
          peerId,
          requestId,
          requestDurationMs: Date.now() - requestedAtMs
        });
      }, timeoutMs);
      this.pendingPieceRequests.set(requestKey, {
        peerId,
        requestId,
        expectedTotalChunks,
        requestedAtMs,
        timeoutMs,
        timeoutId
      });
      pendingRequests.push({ requestKey, chunkIndex, timeoutId });
    }

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
    for (const pendingRequest of this.pendingPieceRequests.values()) {
      clearTimeout(pendingRequest.timeoutId);
    }
    this.pendingPieceRequests.clear();
    if (this.pieceFlushTimer) {
      clearTimeout(this.pieceFlushTimer);
      this.pieceFlushTimer = null;
    }
    this.pendingIncomingPieces.length = 0;
    this.pendingIncomingPieceFragments.clear();

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
        const message = await parseIncomingMessage(event.data);
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
          const requestKey = this.buildRequestKey(message.trackId, message.chunkIndex);
          const pendingRequest = this.pendingPieceRequests.get(requestKey);
          if (pendingRequest) {
            clearTimeout(pendingRequest.timeoutId);
            this.pendingPieceRequests.delete(requestKey);
          }

          this.pendingIncomingPieces.push({
            peerId,
            message,
            pendingRequest
          });
          this.scheduleIncomingPieceFlush();
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
    if (entry.channel?.readyState !== "open") {
      this.callbacks.onPieceServeMiss?.({
        peerId,
        trackId: request.trackId,
        chunkIndex: request.chunkIndex,
        reason: "channel-not-open"
      });
      return;
    }

    const cacheIdentity = this.resolveTrackCacheIdentity?.(request.trackId) ?? null;
    const expectedChunkSize = cacheIdentity?.chunkSize ?? null;
    let piece: {
      chunkIndex: number;
      chunkSize: number;
      hash: string;
      payload: ArrayBuffer;
    } | null = await getCachedPiece(request.trackId, this.localPeerId, request.chunkIndex, {
      fileHash: cacheIdentity?.fileHash,
      ownerKey: cacheIdentity?.ownerKey ?? localCacheOwnerKey,
      chunkSize: expectedChunkSize
    });
    let manifestHeader = piece
      ? await this.resolveManifestHeader(request.trackId, expectedChunkSize ?? piece.chunkSize)
      : null;

    if (!piece || !manifestHeader) {
      const fallbackPiece = await this.resolvePieceRequestFallback?.({
        trackId: request.trackId,
        chunkIndex: request.chunkIndex
      });
      if (fallbackPiece) {
        piece = {
          chunkIndex: request.chunkIndex,
          chunkSize: fallbackPiece.payload.byteLength,
          hash: fallbackPiece.hash,
          payload: fallbackPiece.payload
        };
        manifestHeader = {
          totalChunks: fallbackPiece.totalChunks,
          chunkSize: fallbackPiece.chunkSize,
          mimeType: fallbackPiece.mimeType
        };
        this.pieceManifestHeaders.set(request.trackId, manifestHeader);
      }
    }

    if (!piece) {
      this.callbacks.onPieceServeMiss?.({
        peerId,
        trackId: request.trackId,
        chunkIndex: request.chunkIndex,
        reason: "piece-missing"
      });
      return;
    }

    if (!manifestHeader || entry.channel?.readyState !== "open") {
      this.callbacks.onPieceServeMiss?.({
        peerId,
        trackId: request.trackId,
        chunkIndex: request.chunkIndex,
        reason: "manifest-missing"
      });
      return;
    }

    const pieceFrames = buildPieceFrames(
      {
        requestId: request.requestId,
        trackId: request.trackId,
        chunkIndex: piece.chunkIndex,
        totalChunks: manifestHeader.totalChunks,
        chunkSize: manifestHeader.chunkSize,
        mimeType: manifestHeader.mimeType,
        pieceHash: piece.hash
      },
      piece.payload,
      this.maxDataChannelPayloadBytes
    );
    for (const frame of pieceFrames) {
      this.enqueueSendItem(peerId, entry, {
        data: frame.data,
        trackId: request.trackId,
        chunkIndex: piece.chunkIndex,
        payloadBytes: frame.payloadBytes
      });
    }
    this.callbacks.onPieceServed?.({
      peerId,
      trackId: request.trackId,
      chunkIndex: piece.chunkIndex,
      payloadBytes: piece.payload.byteLength,
      requestId: request.requestId
    });
  }

  private async resolveManifestHeader(trackId: string, fallbackChunkSize: number) {
    let manifestHeader = this.pieceManifestHeaders.get(trackId) ?? null;
    if (!manifestHeader) {
      const manifest = await getTrackPieceManifest(trackId);
      if (manifest) {
        manifestHeader = {
          totalChunks: manifest.totalChunks,
          chunkSize: manifest.chunkSize,
          mimeType: manifest.mimeType || "audio/mpeg",
          pieceHashes: manifest.pieceHashes
        };
        this.pieceManifestHeaders.set(trackId, manifestHeader);
      }
    }

    let totalChunks = manifestHeader?.totalChunks ?? 0;
    if (totalChunks <= 0) {
      const cacheIdentity = this.resolveTrackCacheIdentity?.(trackId) ?? null;
      const chunkIndexes = await getCachedPieceIndexes(trackId, this.localPeerId, {
        fileHash: cacheIdentity?.fileHash,
        ownerKey: cacheIdentity?.ownerKey ?? localCacheOwnerKey,
        chunkSize: cacheIdentity?.chunkSize
      });
      totalChunks = chunkIndexes.length;
      manifestHeader = {
        totalChunks,
        chunkSize: manifestHeader?.chunkSize ?? fallbackChunkSize,
        mimeType: manifestHeader?.mimeType || "audio/mpeg"
      };
      this.pieceManifestHeaders.set(trackId, manifestHeader);
    }

    return manifestHeader;
  }

  private enqueueSendItem(peerId: string, entry: PeerEntry, item: QueuedSendItem) {
    if (entry.releasing) {
      return;
    }

    entry.sendQueue.push(item);
    this.flushSendQueue(peerId, entry);
  }

  private flushSendQueue(peerId: string, entry: PeerEntry) {
    const channel = entry.channel;
    if (!channel || !shouldFlushDataChannelQueue({
      hasChannel: true,
      readyState: channel.readyState,
      releasing: entry.releasing
    })) {
      return;
    }

    while (
      shouldSendQueuedDataChannelItem({
        queueLength: entry.sendQueue.length,
        bufferedAmountBytes: channel.bufferedAmount,
        highWatermarkBytes: this.sendQueueHighWatermarkBytes
      })
    ) {
      const nextItem = entry.sendQueue.shift()!;
      try {
        if (typeof nextItem.data === "string") {
          channel.send(nextItem.data);
        } else {
          channel.send(nextItem.data);
        }
      } catch {
        entry.sendQueue.unshift(nextItem);
        this.callbacks.onPeerStalled?.({
          peerId,
          reason: "data-channel-closed"
        });
        if (this.autoReconnect) {
          this.schedulePeerReconnect(peerId, entry);
        }
        break;
      }
      if (
        typeof nextItem.trackId === "string" &&
        typeof nextItem.chunkIndex === "number" &&
        typeof nextItem.payloadBytes === "number"
      ) {
        this.callbacks.onPieceSent?.({
          peerId,
          trackId: nextItem.trackId,
          chunkIndex: nextItem.chunkIndex,
          payloadBytes: nextItem.payloadBytes
        });
      }
    }

    this.callbacks.onDataBufferedAmountChange?.({
      peerId,
      bufferedAmountBytes: channel.bufferedAmount
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
    if (
      !this.callbacks.onStatsSample ||
      entry.statsIntervalId ||
      this.statsSamplingMode === "off"
    ) {
      return;
    }

    const emitStatsSample = async () => {
      const nextStats = await samplePeerConnectionStats(entry.connection, entry.statsSnapshot);
      if (!nextStats) {
        return;
      }

      entry.statsSnapshot = nextStats.snapshot;
      this.callbacks.onStatsSample?.({
        peerId,
        sample: nextStats.sample
      });
    };

    void emitStatsSample();
    const samplingIntervalMs =
      this.statsSamplingMode === "steady"
        ? this.steadyStatsSamplingIntervalMs
        : this.activeStatsSamplingIntervalMs;
    entry.statsIntervalId = setInterval(() => {
      void emitStatsSample();
    }, samplingIntervalMs);
  }

  private stopStatsSampling(entry: PeerEntry) {
    if (!entry.statsIntervalId) {
      return;
    }

    clearInterval(entry.statsIntervalId);
    entry.statsIntervalId = null;
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
    for (const [requestKey, pendingRequest] of this.pendingPieceRequests.entries()) {
      if (pendingRequest.peerId !== peerId) {
        continue;
      }

      clearTimeout(pendingRequest.timeoutId);
      this.pendingPieceRequests.delete(requestKey);
    }
  }

  private buildRequestKey(trackId: string, chunkIndex: number) {
    return `${trackId}:${chunkIndex}`;
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

  private scheduleIncomingPieceFlush() {
    if (this.pieceFlushTimer || this.pieceFlushInFlight) {
      return;
    }

    this.pieceFlushTimer = setTimeout(() => {
      this.pieceFlushTimer = null;
      void this.flushIncomingPieces();
    }, 18);
  }

  private async flushIncomingPieces() {
    if (this.pieceFlushInFlight || this.pendingIncomingPieces.length === 0) {
      return;
    }

    this.pieceFlushInFlight = true;
    const batch = this.pendingIncomingPieces.splice(0, this.incomingPieceBatchSize);

    try {
      const expectedHashes = await Promise.all(
        batch.map(async (item) => {
          const manifestHeader = await this.resolveManifestHeader(
            item.message.trackId,
            item.message.header.chunkSize
          );
          return manifestHeader?.pieceHashes?.[item.message.chunkIndex] ?? item.message.pieceHash;
        })
      );
      const validationResults = await validateTrackPiecePayloadBatch(
        batch.map((item, index) => ({
          payload: item.message.payload,
          expectedHash: expectedHashes[index] ?? item.message.pieceHash
        }))
      );

      const persistablePieces: PersistableIncomingPiece[] = [];
      for (const [index, item] of batch.entries()) {
        if (!(validationResults[index] ?? false)) {
          this.callbacks.onPieceRequestTimeout?.({
            trackId: item.message.trackId,
            chunkIndex: item.message.chunkIndex,
            peerId: item.peerId,
            requestId: item.pendingRequest?.requestId,
            requestDurationMs:
              item.pendingRequest ? Date.now() - item.pendingRequest.requestedAtMs : 0
          });
          continue;
        }

        this.pieceManifestHeaders.set(item.message.trackId, {
          totalChunks: item.pendingRequest?.expectedTotalChunks ?? item.message.totalChunks,
          chunkSize: item.message.header.chunkSize,
          mimeType: item.message.header.mimeType,
          pieceHashes:
            this.pieceManifestHeaders.get(item.message.trackId)?.pieceHashes ??
            (item.message.pieceHash ? undefined : undefined)
        });

        const callbackPayload = {
          peerId: item.peerId,
          trackId: item.message.header.trackId,
          chunkIndex: item.message.header.chunkIndex,
          totalChunks: item.pendingRequest?.expectedTotalChunks ?? item.message.totalChunks,
          chunkSize: item.message.header.chunkSize,
          mimeType: item.message.header.mimeType,
          payloadBytes: item.message.payload.byteLength,
          requestId: item.message.header.requestId ?? item.pendingRequest?.requestId,
          requestRttMs:
            item.pendingRequest ? Date.now() - item.pendingRequest.requestedAtMs : null
        };
        const shouldPersistPiece = this.callbacks.onPieceReceived(callbackPayload);
        if (shouldPersistPiece === true) {
          persistablePieces.push({
            item,
            expectedHash: expectedHashes[index] ?? item.message.pieceHash,
            callbackPayload
          });
        }
      }

      if (persistablePieces.length > 0) {
        const piecesToPersist = persistablePieces.map(({ item, expectedHash }) => ({
          pieceId: `${
            this.resolveTrackCacheIdentity?.(item.message.trackId)?.fileHash ?? item.message.trackId
          }:${item.message.header.chunkSize}:${localCacheOwnerKey}:${item.message.chunkIndex}`,
          trackId: item.message.trackId,
          fileHash: this.resolveTrackCacheIdentity?.(item.message.trackId)?.fileHash ?? undefined,
          peerId: this.localPeerId,
          ownerKey: localCacheOwnerKey,
          chunkIndex: item.message.chunkIndex,
          chunkSize: item.message.payload.byteLength,
          hash: expectedHash,
          payload: item.message.payload
        }));
        const persistedPayloads = persistablePieces.map((piece) => piece.callbackPayload);
        this.piecePersistChain = this.piecePersistChain
          .catch(() => undefined)
          .then(async () => {
            await cacheTrackPieces(piecesToPersist);
            for (const payload of persistedPayloads) {
              this.callbacks.onPiecePersisted?.(payload);
            }
          });
      }
    } finally {
      this.pieceFlushInFlight = false;
      if (this.pendingIncomingPieces.length > 0) {
        this.scheduleIncomingPieceFlush();
      }
    }
  }

  private handleIncomingPieceFragment(peerId: string, message: BinaryPieceFragmentMessage) {
    this.purgeStaleIncomingPieceFragments();
    const fragmentKey = this.buildIncomingPieceFragmentKey(
      peerId,
      message.trackId,
      message.chunkIndex,
      message.requestId
    );
    const existing = this.pendingIncomingPieceFragments.get(fragmentKey);
    const fragmentState: PendingIncomingPieceFragments =
      existing &&
      existing.fragmentCount === message.fragmentCount &&
      existing.pieceHash === message.pieceHash
        ? existing
        : {
            peerId,
            requestId: message.requestId,
            trackId: message.trackId,
            chunkIndex: message.chunkIndex,
            totalChunks: message.totalChunks,
            chunkSize: message.chunkSize,
            mimeType: message.mimeType,
            pieceHash: message.pieceHash,
            fragmentCount: message.fragmentCount,
            receivedAtMs: Date.now(),
            fragments: new Map<number, ArrayBuffer>()
          };

    fragmentState.receivedAtMs = Date.now();
    fragmentState.fragments.set(message.fragmentIndex, message.payload);
    this.pendingIncomingPieceFragments.set(fragmentKey, fragmentState);

    if (fragmentState.fragments.size < fragmentState.fragmentCount) {
      return;
    }

    const assembledPayload = assembleIncomingPieceFragments(fragmentState);
    this.pendingIncomingPieceFragments.delete(fragmentKey);
    if (!assembledPayload) {
      return;
    }

    const requestKey = this.buildRequestKey(message.trackId, message.chunkIndex);
    const pendingRequest = this.pendingPieceRequests.get(requestKey);
    if (pendingRequest) {
      clearTimeout(pendingRequest.timeoutId);
      this.pendingPieceRequests.delete(requestKey);
    }

    this.pendingIncomingPieces.push({
      peerId,
      message: {
        kind: "send-piece",
        requestId: message.requestId,
        trackId: message.trackId,
        chunkIndex: message.chunkIndex,
        totalChunks: message.totalChunks,
        chunkSize: message.chunkSize,
        mimeType: message.mimeType,
        pieceHash: message.pieceHash,
        header: {
          kind: "send-piece",
          requestId: message.requestId,
          trackId: message.trackId,
          chunkIndex: message.chunkIndex,
          totalChunks: message.totalChunks,
          chunkSize: message.chunkSize,
          mimeType: message.mimeType,
          pieceHash: message.pieceHash
        },
        payload: assembledPayload
      },
      pendingRequest
    });
    this.scheduleIncomingPieceFlush();
  }

  private buildIncomingPieceFragmentKey(
    peerId: string,
    trackId: string,
    chunkIndex: number,
    requestId?: string
  ) {
    return `${peerId}:${trackId}:${chunkIndex}:${requestId ?? "none"}`;
  }

  private purgeStaleIncomingPieceFragments(now = Date.now()) {
    for (const [fragmentKey, fragmentState] of this.pendingIncomingPieceFragments.entries()) {
      if (now - fragmentState.receivedAtMs >= this.incomingPieceFragmentTtlMs) {
        this.pendingIncomingPieceFragments.delete(fragmentKey);
      }
    }
  }
}

async function parseIncomingMessage(data: unknown): Promise<
  P2PDataMessage | BinaryPieceMessage | BinaryPieceFragmentMessage | null
> {
  if (typeof data === "string") {
    let parsedMessage: unknown;

    try {
      parsedMessage = JSON.parse(data);
    } catch {
      return null;
    }

    const result = p2pDataMessageSchema.safeParse(parsedMessage);
    if (result.success) {
      return result.data;
    }

    if (isRequestPiecesDataMessage(parsedMessage)) {
      return parsedMessage;
    }

    return null;
  }

  const buffer = await toArrayBuffer(data);
  if (!buffer) {
    return null;
  }

  const frame = decodePieceFrame(buffer);
  if (!frame) {
    return null;
  }

  return {
    ...frame.header,
    header: frame.header,
    payload: frame.payload
  } as BinaryPieceMessage | BinaryPieceFragmentMessage;
}

function isRequestPiecesDataMessage(
  value: unknown
): value is Extract<P2PDataMessage, { kind: "request-pieces" }> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    kind?: unknown;
    requestId?: unknown;
    trackId?: unknown;
    chunkIndexes?: unknown;
  };

  return (
    candidate.kind === "request-pieces" &&
    typeof candidate.requestId === "string" &&
    candidate.requestId.length > 0 &&
    typeof candidate.trackId === "string" &&
    candidate.trackId.length > 0 &&
    Array.isArray(candidate.chunkIndexes) &&
    candidate.chunkIndexes.length > 0 &&
    candidate.chunkIndexes.every(
      (chunkIndex) =>
        typeof chunkIndex === "number" &&
        Number.isInteger(chunkIndex) &&
        chunkIndex >= 0
    )
  );
}

async function toArrayBuffer(data: unknown) {
  if (data instanceof ArrayBuffer) {
    return data;
  }

  if (ArrayBuffer.isView(data)) {
    const view = data;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer;
  }

  if (data instanceof Blob) {
    return data.arrayBuffer();
  }

  return null;
}

function isBinaryPieceMessage(value: P2PDataMessage | BinaryPieceMessage): value is BinaryPieceMessage {
  return "header" in value && "payload" in value;
}

function isBinaryPieceFragmentMessage(
  value: P2PDataMessage | BinaryPieceMessage | BinaryPieceFragmentMessage
): value is BinaryPieceFragmentMessage {
  return (
    "header" in value &&
    "payload" in value &&
    value.header.kind === "send-piece-fragment"
  );
}
