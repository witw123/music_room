import type { P2PDataMessage, PeerSignalMessage } from "@music-room/shared";
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
};

export class P2PMesh {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly pendingPieceRequests = new Map<string, ReturnType<typeof setTimeout>>();

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
        const shouldInitiate = this.localPeerId.localeCompare(peerId) < 0;
        await this.ensurePeer(peerId, shouldInitiate);
      }
    }

    for (const [peerId, entry] of this.peers.entries()) {
      if (!nextPeers.has(peerId)) {
        entry.channel?.close();
        entry.connection.close();
        this.peers.delete(peerId);
      }
    }
  }

  async handleSignal(payload: PeerSignalMessage) {
    if (payload.toPeerId !== this.localPeerId) {
      return;
    }

    const entry = await this.ensurePeer(payload.fromPeerId, false);

    if (payload.type === "offer") {
      await entry.connection.setRemoteDescription(
        payload.payload as unknown as RTCSessionDescriptionInit
      );
      const answer = await entry.connection.createAnswer();
      await entry.connection.setLocalDescription(answer);
      this.sendSignal({
        roomId: this.roomId,
        fromPeerId: this.localPeerId,
        toPeerId: payload.fromPeerId,
        type: "answer",
        payload: answer as unknown as Record<string, unknown>
      });
      return;
    }

    if (payload.type === "answer") {
      await entry.connection.setRemoteDescription(
        payload.payload as unknown as RTCSessionDescriptionInit
      );
      return;
    }

    if (payload.type === "candidate") {
      await entry.connection.addIceCandidate(payload.payload as RTCIceCandidateInit);
    }
  }

  requestPiece(peerId: string, trackId: string, chunkIndex: number, timeoutMs = 6000) {
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
    this.pendingPieceRequests.set(requestKey, timeoutId);
    return true;
  }

  getConnectedPeerIds() {
    return [...this.peers.entries()]
      .filter(([, entry]) => entry.connection.connectionState === "connected")
      .map(([peerId]) => peerId);
  }

  destroy() {
    for (const timeoutId of this.pendingPieceRequests.values()) {
      clearTimeout(timeoutId);
    }
    this.pendingPieceRequests.clear();

    for (const entry of this.peers.values()) {
      entry.channel?.close();
      entry.connection.close();
    }
    this.peers.clear();
  }

  private async ensurePeer(peerId: string, shouldInitiate: boolean) {
    const existing = this.peers.get(peerId);
    if (existing) {
      return existing;
    }

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    const entry: PeerEntry = {
      connection,
      channel: null
    };

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      this.sendSignal({
        roomId: this.roomId,
        fromPeerId: this.localPeerId,
        toPeerId: peerId,
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
        type: "offer",
        payload: offer as unknown as Record<string, unknown>
      });
    }

    this.peers.set(peerId, entry);
    return entry;
  }

  private bindChannel(peerId: string, channel: RTCDataChannel) {
    channel.onmessage = async (event) => {
      const message = JSON.parse(String(event.data)) as P2PDataMessage;

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
        const timeoutId = this.pendingPieceRequests.get(requestKey);
        if (timeoutId) {
          clearTimeout(timeoutId);
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
          totalChunks: message.totalChunks,
          mimeType: message.mimeType
        });
      }
    };

    channel.onclose = () => {
      this.callbacks.onPeerConnectionChange?.({
        peerId,
        state: "closed"
      });
    };
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
