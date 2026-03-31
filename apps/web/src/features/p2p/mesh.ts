import {
  p2pDataMessageSchema,
  type P2PDataMessage,
  type PeerSignalMessage
} from "@music-room/shared";
import { cacheTrackPieces, getCachedPiece, getCachedPieceIndexes } from "@/lib/indexeddb";
import { validateTrackPiecePayload } from "./index";

type MeshCallbacks = {
  onPieceReceived: (payload: {
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
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
};

type PeerEntry = {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
  /** The peerId that initiated this connection (so we don't initiate twice) */
  initiatorPeerId: string | null;
  pendingCandidates: RTCIceCandidateInit[];
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
  mimeType: string;
  pieceHash: string;
};

type BinaryPieceMessage = PieceFrameHeader & {
  header: PieceFrameHeader;
  payload: ArrayBuffer;
};

export class P2PMesh {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly pendingPieceRequests = new Map<string, PendingPieceRequest>();

  constructor(
    private readonly roomId: string,
    private readonly localPeerId: string,
    private readonly sendSignal: (payload: PeerSignalMessage) => void,
    private readonly callbacks: MeshCallbacks
  ) {}

  async syncPeers(remotePeerIds: string[]) {
    const nextPeers = new Set(remotePeerIds.filter((peerId) => peerId && peerId !== this.localPeerId));

    for (const peerId of nextPeers) {
      if (!this.peers.has(peerId)) {
        // Always initiate — the other side may or may not also initiate, which is fine.
        // ensurePeer tracks initiatorPeerId to avoid duplicate connections.
        await this.ensurePeer(peerId, true);
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
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    const entry: PeerEntry = {
      connection,
      channel: null,
      initiatorPeerId: shouldInitiate ? this.localPeerId : null,
      pendingCandidates: []
    };

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

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
        const chunkIndexes = await getCachedPieceIndexes(message.trackId, this.localPeerId);

        if (channel.readyState !== "open") {
          return;
        }

        channel.send(
          buildPieceFrame(
            {
              kind: "send-piece",
              trackId: message.trackId,
              chunkIndex: piece.chunkIndex,
              totalChunks: chunkIndexes.length,
              mimeType: "audio/mpeg",
              pieceHash: piece.hash
            },
            piece.payload
          )
        );
        return;
      }

      if (message.kind === "send-piece" && isBinaryPieceMessage(message)) {
        const { header, payload } = message;
        const requestKey = this.buildRequestKey(message.trackId, message.chunkIndex);
        const pendingRequest = this.pendingPieceRequests.get(requestKey);
        if (pendingRequest) {
          clearTimeout(pendingRequest.timeoutId);
          this.pendingPieceRequests.delete(requestKey);
        }

        const isValid = await validateTrackPiecePayload(payload, message.pieceHash);
        if (!isValid) {
          this.callbacks.onPieceRequestTimeout?.({
            trackId: message.trackId,
            chunkIndex: message.chunkIndex,
            peerId
          });
          return;
        }

        await cacheTrackPieces([
          {
            pieceId: `${message.trackId}:${this.localPeerId}:${message.chunkIndex}`,
            trackId: message.trackId,
            peerId: this.localPeerId,
            chunkIndex: message.chunkIndex,
            chunkSize: payload.byteLength,
            hash: message.pieceHash,
            payload
          }
        ]);
        this.callbacks.onPieceReceived({
          trackId: header.trackId,
          chunkIndex: header.chunkIndex,
          totalChunks: pendingRequest?.expectedTotalChunks ?? message.totalChunks,
          mimeType: header.mimeType
        });
      }
    };

    channel.onclose = () => {
      this.clearPendingRequestsForPeer(peerId);
      this.callbacks.onPeerConnectionChange?.({
        peerId,
        state: "closed"
      });
    };
  }

  private releasePeer(peerId: string, entry: PeerEntry) {
    this.clearPendingRequestsForPeer(peerId);
    entry.channel?.close();
    entry.connection.close();
    this.peers.delete(peerId);
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
