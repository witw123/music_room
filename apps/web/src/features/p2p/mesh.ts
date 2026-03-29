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
};

type PendingPieceRequest = {
  peerId: string;
  expectedTotalChunks?: number;
  timeoutId: ReturnType<typeof setTimeout>;
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

      await entry.connection.setRemoteDescription(remoteDescription);
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

      await entry.connection.setRemoteDescription(remoteDescription);
      return;
    }

    if (payload.type === "candidate") {
      const candidate = toIceCandidateInit(payload.payload);
      if (!candidate) {
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
    timeoutMs = 6000
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
      initiatorPeerId: shouldInitiate ? this.localPeerId : null
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
    channel.onmessage = async (event) => {
      let parsedMessage: unknown;

      try {
        parsedMessage = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const result = p2pDataMessageSchema.safeParse(parsedMessage);
      if (!result.success) {
        return;
      }

      const message: P2PDataMessage = result.data;

      if (message.kind === "request-piece") {
        const piece = await getCachedPiece(message.trackId, this.localPeerId, message.chunkIndex);
        if (!piece) {
          return;
        }
        const chunkIndexes = await getCachedPieceIndexes(message.trackId, this.localPeerId);

        const payload: P2PDataMessage = {
          kind: "send-piece",
          trackId: message.trackId,
          chunkIndex: piece.chunkIndex,
          totalChunks: chunkIndexes.length,
          mimeType: "audio/mpeg",
          pieceHash: piece.hash,
          payloadBase64: arrayBufferToBase64(piece.payload)
        };
        channel.send(JSON.stringify(payload));
        return;
      }

      if (message.kind === "send-piece") {
        const requestKey = this.buildRequestKey(message.trackId, message.chunkIndex);
        const pendingRequest = this.pendingPieceRequests.get(requestKey);
        if (pendingRequest) {
          clearTimeout(pendingRequest.timeoutId);
          this.pendingPieceRequests.delete(requestKey);
        }

        const payload = base64ToArrayBuffer(message.payloadBase64);
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
          trackId: message.trackId,
          chunkIndex: message.chunkIndex,
          totalChunks: pendingRequest?.expectedTotalChunks ?? message.totalChunks,
          mimeType: message.mimeType
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

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
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
