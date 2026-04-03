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
import { samplePeerConnectionStats, type PeerConnectionStatsSample } from "./connection-stats";
import { validateTrackPiecePayloadBatch } from "./index";

type MeshCallbacks = {
  onPieceReceived: (payload: {
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
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
  private readonly pendingPieceRequests = new Map<string, PendingPieceRequest>();
  private readonly pendingIncomingPieces: IncomingPieceBatchItem[] = [];
  private readonly pieceManifestHeaders = new Map<string, CachedPieceManifestHeader>();
  private pieceFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pieceFlushInFlight = false;

  constructor(
    private readonly roomId: string,
    private readonly localPeerId: string,
    private readonly sendSignal: (payload: PeerSignalMessage) => void,
    private readonly callbacks: MeshCallbacks,
    private readonly iceServers: IceServerConfig[] = []
  ) {}

  async syncPeers(remotePeerIds: string[]) {
    const nextPeers = new Set(remotePeerIds.filter((peerId) => peerId && peerId !== this.localPeerId));

    for (const peerId of nextPeers) {
      if (!this.peers.has(peerId)) {
        // Always initiate — the other side may or may not also initiate, which is fine.
        // ensurePeer tracks initiatorPeerId to avoid duplicate connections.
        await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId));
      }
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

    if (payload.type === "offer") {
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

      await entry.connection.setRemoteDescription(remoteDescription);
      await this.flushPendingCandidates(entry);
      const answer = await entry.connection.createAnswer();
      await entry.connection.setLocalDescription(answer);
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
      return;
    }

    if (payload.type === "answer") {
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

      await entry.connection.setRemoteDescription(remoteDescription);
      await this.flushPendingCandidates(entry);
      return;
    }

    if (payload.type === "candidate") {
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

      await entry.connection.addIceCandidate(candidate);
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
      .filter(([, entry]) => entry.connection.connectionState === "connected")
      .map(([peerId]) => peerId);
  }

  destroy() {
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
      // If an entry exists and we are the initiator, do NOT initiate again.
      // The remote peer may already be trying to connect to us.
      if (shouldInitiate && existing.initiatorPeerId === this.localPeerId) {
        return existing;
      }
      // If an entry exists and we are NOT the initiator, return it.
      // handleSignal will use it to process the incoming offer/answer.
      return existing;
    }

    const connection = new RTCPeerConnection({
      iceServers: this.iceServers.length > 0 ? this.iceServers : [{ urls: "stun:stun.l.google.com:19302" }]
    });
    const entry: PeerEntry = {
      connection,
      channel: null,
      initiatorPeerId: shouldInitiate ? this.localPeerId : null,
      pendingCandidates: [],
      statsIntervalId: null
    };
    this.startStatsSampling(peerId, entry);

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

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
      this.callbacks.onPeerConnectionChange?.({
        peerId,
        state: connection.connectionState
      });
    };

    connection.oniceconnectionstatechange = () => {
      this.callbacks.onIceConnectionStateChange?.({
        peerId,
        state: connection.iceConnectionState
      });
    };

    connection.ondatachannel = (event) => {
      entry.channel = event.channel;
      this.bindChannel(peerId, entry.channel);
    };

    if (shouldInitiate) {
      const channel = connection.createDataChannel("music-room-p2p");
      entry.channel = channel;
      this.bindChannel(peerId, channel);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
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
    return entry;
  }

  private bindChannel(peerId: string, channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    this.callbacks.onDataChannelStateChange?.({
      peerId,
      state: channel.readyState
    });

    channel.onopen = () => {
      this.callbacks.onDataChannelStateChange?.({
        peerId,
        state: channel.readyState
      });
    };

    channel.onmessage = async (event) => {
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
      this.callbacks.onDataChannelStateChange?.({
        peerId,
        state: "closed"
      });
      this.clearPendingRequestsForPeer(peerId);
      this.callbacks.onPeerConnectionChange?.({
        peerId,
        state: "closed"
      });
    };
  }

  private releasePeer(peerId: string, entry: PeerEntry) {
    this.clearPendingRequestsForPeer(peerId);
    this.stopStatsSampling(entry);
    entry.channel?.close();
    entry.connection.close();
    this.peers.delete(peerId);
  }

  private startStatsSampling(peerId: string, entry: PeerEntry) {
    if (!this.callbacks.onStatsSample || entry.statsIntervalId) {
      return;
    }

    const emitStatsSample = async () => {
      const sample = await samplePeerConnectionStats(entry.connection);
      if (!sample) {
        return;
      }

      this.callbacks.onStatsSample?.({
        peerId,
        sample
      });
    };

    void emitStatsSample();
    entry.statsIntervalId = setInterval(() => {
      void emitStatsSample();
    }, 2_000);
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
      await entry.connection.addIceCandidate(candidate);
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
          trackId: item.message.header.trackId,
          chunkIndex: item.message.header.chunkIndex,
          totalChunks: item.pendingRequest?.expectedTotalChunks ?? item.message.totalChunks,
          chunkSize: item.message.header.chunkSize,
          mimeType: item.message.header.mimeType
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
