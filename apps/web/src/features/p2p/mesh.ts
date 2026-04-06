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
  getTrackPieceManifest
} from "@/lib/indexeddb";
import {
  samplePeerConnectionStats,
  type PeerConnectionStatsSample,
  type PeerConnectionStatsSnapshot
} from "./connection-stats";
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
  }) => void;
  onPieceSent?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    payloadBytes: number;
  }) => void;
  onPieceRequestTimeout?: (payload: {
    trackId: string;
    chunkIndex: number;
    peerId: string;
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
  onSignal?: (payload: {
    peerId: string;
    direction: "sent" | "received";
    type: PeerSignalMessage["type"];
  }) => void;
  onStatsSample?: (payload: {
    peerId: string;
    sample: PeerConnectionStatsSample;
  }) => void;
};

type PeerEntry = {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
  /** The peerId that initiated this connection (so we don't initiate twice) */
  initiatorPeerId: string | null;
  pendingCandidates: RTCIceCandidateInit[];
  statsIntervalId: ReturnType<typeof setInterval> | null;
  statsSnapshot: PeerConnectionStatsSnapshot | null;
  dataChannelState: RTCDataChannelState | null;
  createdAtMs: number;
  lastSignalProgressAtMs: number;
  reconnectAttempts: number;
  reconnectTimerId: ReturnType<typeof setTimeout> | null;
  watchdogTimerId: ReturnType<typeof setTimeout> | null;
  releasing: boolean;
  operationChain: Promise<void>;
};

type PendingPieceRequest = {
  peerId: string;
  expectedTotalChunks?: number;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PieceFrameHeader = {
  kind: "send-piece";
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
  pieceHash: string;
};

type BinaryPieceMessage = PieceFrameHeader & {
  header: PieceFrameHeader;
  payload: ArrayBuffer;
};

type IncomingPieceBatchItem = {
  peerId: string;
  message: BinaryPieceMessage;
  pendingRequest?: PendingPieceRequest;
};

type CachedPieceManifestHeader = {
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
};

export class P2PMesh {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly expectedPeerIds = new Set<string>();
  private readonly pendingPieceRequests = new Map<string, PendingPieceRequest>();
  private readonly pendingIncomingPieces: IncomingPieceBatchItem[] = [];
  private readonly pieceManifestHeaders = new Map<string, CachedPieceManifestHeader>();
  private pieceFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pieceFlushInFlight = false;
  private readonly reconnectBackoffMs = [1_000, 2_000, 4_000, 8_000] as const;
  private readonly dataOpenTimeoutMs = 8_000;
  private readonly dataConnectingTimeoutMs = 12_000;
  private readonly connectionProgressTimeoutMs = 15_000;
  private readonly activeStatsSamplingIntervalMs = 1_000;
  private readonly steadyStatsSamplingIntervalMs = 5_000;
  private statsSamplingMode: "off" | "steady" | "active" = "active";

  constructor(
    private readonly roomId: string,
    private readonly localPeerId: string,
    private readonly sendSignal: (payload: PeerSignalMessage) => void,
    private readonly callbacks: MeshCallbacks,
    private readonly iceServers: IceServerConfig[] = []
  ) {}

  async syncPeers(
    remotePeerIds: string[],
    options?: { forceReconnectDegraded?: boolean }
  ) {
    const nextPeers = new Set(remotePeerIds.filter((peerId) => peerId && peerId !== this.localPeerId));
    this.expectedPeerIds.clear();
    for (const peerId of nextPeers) {
      this.expectedPeerIds.add(peerId);
    }

    for (const peerId of nextPeers) {
      const existing = this.peers.get(peerId);
      if (
        existing &&
        (options?.forceReconnectDegraded || this.shouldRestartPeer(existing))
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

    for (const [peerId, entry] of this.peers.entries()) {
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
    const entry = this.peers.get(payload.fromPeerId) ?? (await this.ensurePeer(payload.fromPeerId, false));
    entry.lastSignalProgressAtMs = Date.now();

    if (payload.type === "offer") {
      await this.enqueuePeerOperation(entry, async () => {
        this.callbacks.onSignal?.({
          peerId: payload.fromPeerId,
          direction: "received",
          type: "offer"
        });
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
        await this.flushPendingCandidates(entry);
        const answer = await entry.connection.createAnswer();
        await entry.connection.setLocalDescription(answer);
        entry.lastSignalProgressAtMs = Date.now();
        this.callbacks.onSignal?.({
          peerId: payload.fromPeerId,
          direction: "sent",
          type: "answer"
        });
        this.sendSignal({
          roomId: this.roomId,
          fromPeerId: this.localPeerId,
          toPeerId: payload.fromPeerId,
          channelKind: "data",
          type: "answer",
          payload: answer as unknown as Record<string, unknown>
        });
      });
      return;
    }

    if (payload.type === "answer") {
      await this.enqueuePeerOperation(entry, async () => {
        this.callbacks.onSignal?.({
          peerId: payload.fromPeerId,
          direction: "received",
          type: "answer"
        });
        const remoteDescription = toSessionDescriptionInit(payload.payload);
        if (!remoteDescription) {
          return;
        }

        if (entry.connection.signalingState !== "have-local-offer") {
          return;
        }

        await this.applyRemoteDescription(entry, remoteDescription);
        await this.flushPendingCandidates(entry);
        entry.lastSignalProgressAtMs = Date.now();
      });
      return;
    }

    if (payload.type === "candidate") {
      await this.enqueuePeerOperation(entry, async () => {
        this.callbacks.onSignal?.({
          peerId: payload.fromPeerId,
          direction: "received",
          type: "candidate"
        });
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
    for (const [peerId, entry] of this.peers.entries()) {
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
    const entry = this.peers.get(peerId);
    if (!entry?.channel || entry.channel.readyState !== "open") {
      return false;
    }

    const requestKey = this.buildRequestKey(trackId, chunkIndex);
    if (this.pendingPieceRequests.has(requestKey)) {
      return false;
    }

    const payload: P2PDataMessage = {
      kind: "request-piece",
      trackId,
      chunkIndex
    };
    entry.channel.send(JSON.stringify(payload));
    const timeoutId = setTimeout(() => {
      this.pendingPieceRequests.delete(requestKey);
      this.callbacks.onPieceRequestTimeout?.({
        trackId,
        chunkIndex,
        peerId
      });
    }, timeoutMs);
    this.pendingPieceRequests.set(requestKey, { peerId, expectedTotalChunks, timeoutId });
    return true;
  }

  getConnectedPeerIds() {
    return [...this.peers.entries()]
      .filter(([, entry]) => entry.channel?.readyState === "open")
      .map(([peerId]) => peerId);
  }

  destroy() {
    this.expectedPeerIds.clear();
    for (const pendingRequest of this.pendingPieceRequests.values()) {
      clearTimeout(pendingRequest.timeoutId);
    }
    this.pendingPieceRequests.clear();
    if (this.pieceFlushTimer) {
      clearTimeout(this.pieceFlushTimer);
      this.pieceFlushTimer = null;
    }
    this.pendingIncomingPieces.length = 0;

    for (const [peerId, entry] of this.peers.entries()) {
      this.releasePeer(peerId, entry);
    }
    this.peers.clear();
  }

  private async ensurePeer(peerId: string, shouldInitiate: boolean) {
    const existing = this.peers.get(peerId);

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

    const connection = new RTCPeerConnection({
      iceServers: this.iceServers.length > 0 ? this.iceServers : [{ urls: "stun:stun.l.google.com:19302" }]
    });
    const entry: PeerEntry = {
      connection,
      channel: null,
      initiatorPeerId: shouldInitiate ? this.localPeerId : null,
      pendingCandidates: [],
      statsIntervalId: null,
      statsSnapshot: null,
      dataChannelState: null,
      createdAtMs: Date.now(),
      lastSignalProgressAtMs: Date.now(),
      reconnectAttempts: 0,
      reconnectTimerId: null,
      watchdogTimerId: null,
      releasing: false,
      operationChain: Promise.resolve()
    };
    this.startStatsSampling(peerId, entry);

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }
      entry.lastSignalProgressAtMs = Date.now();

      this.callbacks.onSignal?.({
        peerId,
        direction: "sent",
        type: "candidate"
      });
      this.sendSignal({
        roomId: this.roomId,
        fromPeerId: this.localPeerId,
        toPeerId: peerId,
        channelKind: "data",
        type: "candidate",
        payload: event.candidate.toJSON() as unknown as Record<string, unknown>
      });
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

      if (this.peers.get(peerId) === entry) {
        if (connection.connectionState === "failed" || connection.connectionState === "closed") {
          if (this.expectedPeerIds.has(peerId)) {
            this.schedulePeerReconnect(peerId, entry);
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
      if (this.peers.get(peerId) === entry) {
        this.schedulePeerWatchdog(peerId, entry);
      }
    };

    connection.ondatachannel = (event) => {
      entry.channel = event.channel;
      this.bindChannel(peerId, entry, entry.channel);
    };

    if (shouldInitiate) {
      const channel = connection.createDataChannel("music-room-p2p", {
        ordered: false
      });
      entry.channel = channel;
      this.bindChannel(peerId, entry, channel);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      entry.lastSignalProgressAtMs = Date.now();
      this.callbacks.onSignal?.({
        peerId,
        direction: "sent",
        type: "offer"
      });
      this.sendSignal({
        roomId: this.roomId,
        fromPeerId: this.localPeerId,
        toPeerId: peerId,
        channelKind: "data",
        type: "offer",
        payload: offer as unknown as Record<string, unknown>
      });
    }

    this.peers.set(peerId, entry);
    this.schedulePeerWatchdog(peerId, entry);
    return entry;
  }

  private bindChannel(peerId: string, entry: PeerEntry, channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    entry.dataChannelState = channel.readyState;
    entry.lastSignalProgressAtMs = Date.now();
    this.callbacks.onDataChannelStateChange?.({
      peerId,
      state: channel.readyState
    });
    this.schedulePeerWatchdog(peerId, entry);

    channel.onopen = () => {
      entry.dataChannelState = channel.readyState;
      entry.lastSignalProgressAtMs = Date.now();
      entry.reconnectAttempts = 0;
      this.callbacks.onDataChannelStateChange?.({
        peerId,
        state: channel.readyState
      });
      this.schedulePeerWatchdog(peerId, entry);
    };

    channel.onmessage = async (event) => {
      entry.lastSignalProgressAtMs = Date.now();
      const message = await parseIncomingMessage(event.data);
      if (!message) {
        return;
      }

      if (message.kind === "request-piece") {
        if (channel.readyState !== "open") {
          return;
        }

        const piece = await getCachedPiece(message.trackId, this.localPeerId, message.chunkIndex);
        if (!piece) {
          return;
        }
        let manifestHeader = this.pieceManifestHeaders.get(message.trackId) ?? null;
        if (!manifestHeader) {
          const manifest = await getTrackPieceManifest(message.trackId);
          if (manifest) {
            manifestHeader = {
              totalChunks: manifest.totalChunks,
              chunkSize: manifest.chunkSize,
              mimeType: manifest.mimeType || "audio/mpeg"
            };
            this.pieceManifestHeaders.set(message.trackId, manifestHeader);
          }
        }

        let totalChunks = manifestHeader?.totalChunks ?? 0;
        if (totalChunks <= 0) {
          const chunkIndexes = await getCachedPieceIndexes(message.trackId, this.localPeerId);
          totalChunks = chunkIndexes.length;
          manifestHeader = {
            totalChunks,
            chunkSize: manifestHeader?.chunkSize ?? piece.chunkSize,
            mimeType: manifestHeader?.mimeType || "audio/mpeg"
          };
          this.pieceManifestHeaders.set(message.trackId, manifestHeader);
        }

        if (channel.readyState !== "open") {
          return;
        }

        channel.send(
          buildPieceFrame(
            {
              kind: "send-piece",
              trackId: message.trackId,
              chunkIndex: piece.chunkIndex,
              totalChunks,
              chunkSize: manifestHeader?.chunkSize ?? piece.chunkSize,
              mimeType: manifestHeader?.mimeType || "audio/mpeg",
              pieceHash: piece.hash
            },
            piece.payload
          )
        );
        this.callbacks.onPieceSent?.({
          peerId,
          trackId: message.trackId,
          chunkIndex: piece.chunkIndex,
          payloadBytes: piece.payload.byteLength
        });
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
      }
    };

    channel.onclose = () => {
      entry.dataChannelState = "closed";
      this.callbacks.onDataChannelStateChange?.({
        peerId,
        state: "closed"
      });
      this.clearPendingRequestsForPeer(peerId);
      this.callbacks.onPeerConnectionChange?.({
        peerId,
        state: "closed"
      });
      if (entry.releasing) {
        return;
      }
      this.schedulePeerReconnect(peerId, entry);
    };
  }

  private releasePeer(peerId: string, entry: PeerEntry) {
    entry.releasing = true;
    if (this.peers.get(peerId) === entry) {
      this.peers.delete(peerId);
    }
    this.clearPeerTimers(entry);
    this.clearPendingRequestsForPeer(peerId);
    this.stopStatsSampling(entry);
    entry.channel?.close();
    entry.connection.close();
  }

  private shouldRestartPeer(entry: PeerEntry) {
    if (entry.releasing) {
      return false;
    }

    if (
      entry.connection.connectionState === "failed" ||
      entry.connection.connectionState === "closed" ||
      entry.dataChannelState === "closed"
    ) {
      return true;
    }

    return this.isPeerStalled(entry, Date.now());
  }

  private isPeerStalled(entry: PeerEntry, now: number) {
    const channelState = entry.channel?.readyState ?? null;
    const connectionState = entry.connection.connectionState;

    if (channelState === "open") {
      return false;
    }

    if (now - entry.createdAtMs >= this.dataOpenTimeoutMs) {
      return true;
    }

    if (
      channelState === "connecting" &&
      now - entry.lastSignalProgressAtMs >= this.dataConnectingTimeoutMs
    ) {
      return true;
    }

    if (
      (connectionState === "new" ||
        connectionState === "connecting" ||
        connectionState === "disconnected") &&
      now - entry.lastSignalProgressAtMs >= this.connectionProgressTimeoutMs
    ) {
      return true;
    }

    return false;
  }

  private schedulePeerWatchdog(peerId: string, entry: PeerEntry) {
    if (entry.releasing || !this.expectedPeerIds.has(peerId)) {
      this.clearPeerWatchdog(entry);
      return;
    }

    this.clearPeerWatchdog(entry);
    entry.watchdogTimerId = setTimeout(() => {
      if (this.peers.get(peerId) !== entry || entry.releasing || !this.expectedPeerIds.has(peerId)) {
        return;
      }

      if (this.isPeerStalled(entry, Date.now())) {
        this.schedulePeerReconnect(peerId, entry);
        return;
      }

      this.schedulePeerWatchdog(peerId, entry);
    }, 1_000);
  }

  private schedulePeerReconnect(peerId: string, entry: PeerEntry) {
    if (entry.releasing || !this.expectedPeerIds.has(peerId)) {
      this.releasePeer(peerId, entry);
      return;
    }

    this.clearPeerWatchdog(entry);
    if (entry.reconnectTimerId) {
      return;
    }

    const delay =
      this.reconnectBackoffMs[
        Math.min(entry.reconnectAttempts, this.reconnectBackoffMs.length - 1)
      ];
    entry.reconnectAttempts += 1;
    entry.reconnectTimerId = setTimeout(() => {
      entry.reconnectTimerId = null;
      if (this.peers.get(peerId) !== entry || entry.releasing || !this.expectedPeerIds.has(peerId)) {
        return;
      }

      void this.recreatePeer(peerId, entry);
    }, delay);
  }

  private async recreatePeer(peerId: string, entry: PeerEntry) {
    const reconnectAttempts = entry.reconnectAttempts;
    this.releasePeer(peerId, entry);
    const nextEntry = await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId));
    nextEntry.reconnectAttempts = reconnectAttempts;
  }

  private clearPeerWatchdog(entry: PeerEntry) {
    if (!entry.watchdogTimerId) {
      return;
    }

    clearTimeout(entry.watchdogTimerId);
    entry.watchdogTimerId = null;
  }

  private clearPeerReconnectTimer(entry: PeerEntry) {
    if (!entry.reconnectTimerId) {
      return;
    }

    clearTimeout(entry.reconnectTimerId);
    entry.reconnectTimerId = null;
  }

  private clearPeerTimers(entry: PeerEntry) {
    this.clearPeerWatchdog(entry);
    this.clearPeerReconnectTimer(entry);
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

  private async flushPendingCandidates(entry: PeerEntry) {
    if (entry.pendingCandidates.length === 0) {
      return;
    }

    const nextCandidates = [...entry.pendingCandidates];
    entry.pendingCandidates = [];
    for (const candidate of nextCandidates) {
      try {
        await entry.connection.addIceCandidate(candidate);
      } catch {
        if (!entry.connection.remoteDescription) {
          entry.pendingCandidates.push(candidate);
        }
      }
    }
  }

  private enqueuePeerOperation<T>(entry: PeerEntry, task: () => Promise<T>) {
    const run = entry.operationChain
      .catch(() => undefined)
      .then(async () => {
        if (entry.releasing) {
          return undefined as T;
        }
        return task();
      });
    entry.operationChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
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
        this.shouldIgnoreStaleAnswerError(entry, error)
      ) {
        return;
      }
      throw error;
    }
  }

  private shouldIgnoreStaleAnswerError(entry: PeerEntry, error: unknown) {
    if (entry.connection.signalingState === "have-local-offer") {
      return false;
    }

    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return /wrong state:\s*stable/i.test(message) || /Called in wrong state:\s*stable/i.test(message);
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
    const batch = this.pendingIncomingPieces.splice(0, 8);

    try {
      const validationResults = await validateTrackPiecePayloadBatch(
        batch.map((item) => ({
          payload: item.message.payload,
          expectedHash: item.message.pieceHash
        }))
      );

      const validPieces = batch
        .map((item, index) => ({ item, isValid: validationResults[index] ?? false }))
        .filter((entry) => entry.isValid);

      if (validPieces.length > 0) {
        await cacheTrackPieces(
          validPieces.map(({ item }) => ({
            pieceId: `${item.message.trackId}:${this.localPeerId}:${item.message.chunkIndex}`,
            trackId: item.message.trackId,
            peerId: this.localPeerId,
            chunkIndex: item.message.chunkIndex,
            chunkSize: item.message.payload.byteLength,
            hash: item.message.pieceHash,
            payload: item.message.payload
          }))
        );
      }

      for (const [index, item] of batch.entries()) {
        if (!(validationResults[index] ?? false)) {
          this.callbacks.onPieceRequestTimeout?.({
            trackId: item.message.trackId,
            chunkIndex: item.message.chunkIndex,
            peerId: item.peerId
          });
          continue;
        }

        this.pieceManifestHeaders.set(item.message.trackId, {
          totalChunks: item.pendingRequest?.expectedTotalChunks ?? item.message.totalChunks,
          chunkSize: item.message.header.chunkSize,
          mimeType: item.message.header.mimeType
        });

        this.callbacks.onPieceReceived({
          peerId: item.peerId,
          trackId: item.message.header.trackId,
          chunkIndex: item.message.header.chunkIndex,
          totalChunks: item.pendingRequest?.expectedTotalChunks ?? item.message.totalChunks,
          chunkSize: item.message.header.chunkSize,
          mimeType: item.message.header.mimeType,
          payloadBytes: item.message.payload.byteLength
        });
      }
    } finally {
      this.pieceFlushInFlight = false;
      if (this.pendingIncomingPieces.length > 0) {
        this.scheduleIncomingPieceFlush();
      }
    }
  }
}

async function parseIncomingMessage(data: unknown): Promise<
  P2PDataMessage | BinaryPieceMessage | null
> {
  if (typeof data === "string") {
    let parsedMessage: unknown;

    try {
      parsedMessage = JSON.parse(data);
    } catch {
      return null;
    }

    const result = p2pDataMessageSchema.safeParse(parsedMessage);
    return result.success ? result.data : null;
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
  };
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

function buildPieceFrame(header: PieceFrameHeader, payload: ArrayBuffer) {
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(JSON.stringify(header));
  const payloadBytes = new Uint8Array(payload);
  const frame = new Uint8Array(4 + headerBytes.byteLength + payloadBytes.byteLength);

  new DataView(frame.buffer).setUint32(0, headerBytes.byteLength, false);
  frame.set(headerBytes, 4);
  frame.set(payloadBytes, 4 + headerBytes.byteLength);

  return frame.buffer;
}

function decodePieceFrame(buffer: ArrayBuffer) {
  if (buffer.byteLength < 5) {
    return null;
  }

  const view = new DataView(buffer);
  const headerLength = view.getUint32(0, false);
  const payloadOffset = 4 + headerLength;

  if (headerLength <= 0 || payloadOffset > buffer.byteLength) {
    return null;
  }

  const headerBytes = new Uint8Array(buffer, 4, headerLength);
  const payload = buffer.slice(payloadOffset);

  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return null;
  }

  if (!isPieceFrameHeader(parsedHeader)) {
    return null;
  }

  return {
    header: parsedHeader,
    payload
  };
}

function isPieceFrameHeader(value: unknown): value is PieceFrameHeader {
  if (!value || typeof value !== "object") {
    return false;
  }

  const header = value as Record<string, unknown>;
  return (
    header.kind === "send-piece" &&
    typeof header.trackId === "string" &&
    typeof header.chunkIndex === "number" &&
    typeof header.totalChunks === "number" &&
    typeof header.chunkSize === "number" &&
    typeof header.mimeType === "string" &&
    typeof header.pieceHash === "string"
  );
}

function isBinaryPieceMessage(value: P2PDataMessage | BinaryPieceMessage): value is BinaryPieceMessage {
  return "header" in value && "payload" in value;
}

function toSessionDescriptionInit(payload: Record<string, unknown>): RTCSessionDescriptionInit | null {
  if (typeof payload.type !== "string") {
    return null;
  }

  return {
    type: payload.type as RTCSdpType,
    sdp: typeof payload.sdp === "string" ? payload.sdp : undefined
  };
}

function toIceCandidateInit(payload: Record<string, unknown>): RTCIceCandidateInit | null {
  if (typeof payload.candidate !== "string") {
    return null;
  }

  return {
    candidate: payload.candidate,
    sdpMid: typeof payload.sdpMid === "string" ? payload.sdpMid : undefined,
    sdpMLineIndex:
      typeof payload.sdpMLineIndex === "number" ? payload.sdpMLineIndex : undefined,
    usernameFragment:
      typeof payload.usernameFragment === "string" ? payload.usernameFragment : undefined
  };
}
