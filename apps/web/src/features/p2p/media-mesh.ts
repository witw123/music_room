import type { IceServerConfig, PeerSignalMessage } from "@music-room/shared";

type MediaConnectionState = "idle" | RTCPeerConnectionState;

type MediaMeshCallbacks = {
  onRemoteStream: (stream: MediaStream | null) => void;
  onConnectionStateChange?: (payload: {
    peerId: string;
    state: MediaConnectionState;
    connectedPeerIds: string[];
  }) => void;
};

type MediaPeerEntry = {
  connection: RTCPeerConnection;
  stream: MediaStream | null;
  senders: RTCRtpSender[];
  pendingCandidates: RTCIceCandidateInit[];
};

export class RoomMediaMesh {
  private readonly peers = new Map<string, MediaPeerEntry>();
  private currentMediaEpoch = 0;

  constructor(
    private readonly roomId: string,
    private readonly localPeerId: string,
    private readonly sendSignal: (payload: PeerSignalMessage) => void,
    private readonly iceServers: IceServerConfig[],
    private readonly callbacks: MediaMeshCallbacks
  ) {}

  async syncHostPeers(remotePeerIds: string[], localStream: MediaStream | null, mediaEpoch = 0) {
    if (this.currentMediaEpoch !== mediaEpoch) {
      this.resetForMediaEpoch(mediaEpoch);
    }

    const nextPeers = new Set(remotePeerIds.filter((peerId) => peerId && peerId !== this.localPeerId));

    for (const peerId of nextPeers) {
      const shouldInitiateOffer = !this.peers.has(peerId);
      await this.ensurePeer(peerId, localStream, shouldInitiateOffer);
    }

    for (const [peerId, entry] of this.peers.entries()) {
      if (!nextPeers.has(peerId)) {
        this.releasePeer(peerId, entry);
      }
    }
  }

  async updateLocalStream(localStream: MediaStream | null) {
    for (const [peerId, entry] of this.peers.entries()) {
      this.attachStream(entry, localStream);
      if (entry.connection.signalingState === "stable") {
        const offer = await entry.connection.createOffer();
        await entry.connection.setLocalDescription(offer);
        this.sendSignal({
          roomId: this.roomId,
          fromPeerId: this.localPeerId,
          toPeerId: peerId,
          channelKind: "media",
          mediaEpoch: this.currentMediaEpoch,
          type: "offer",
          payload: offer as unknown as Record<string, unknown>
        });
      }
    }
  }

  async handleSignal(payload: PeerSignalMessage) {
    if (payload.channelKind !== "media" || payload.toPeerId !== this.localPeerId) {
      return;
    }

    const incomingMediaEpoch = payload.mediaEpoch ?? 0;

    if (incomingMediaEpoch < this.currentMediaEpoch) {
      return;
    }

    if (incomingMediaEpoch > this.currentMediaEpoch) {
      this.resetForMediaEpoch(incomingMediaEpoch);
    }

    const entry = this.peers.get(payload.fromPeerId) ?? this.createPeer(payload.fromPeerId, true);

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
        channelKind: "media",
        mediaEpoch: this.currentMediaEpoch,
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

  getConnectedPeerIds() {
    return [...this.peers.entries()]
      .filter(([, entry]) => entry.connection.connectionState === "connected")
      .map(([peerId]) => peerId);
  }

  destroy() {
    this.resetForMediaEpoch(this.currentMediaEpoch);
  }

  private async ensurePeer(peerId: string, localStream: MediaStream | null, initiateOffer: boolean) {
    const entry = this.peers.get(peerId) ?? this.createPeer(peerId, false);
    const streamChanged = this.attachStream(entry, localStream);

    if (
      entry.connection.signalingState === "stable" &&
      localStream &&
      localStream.getAudioTracks().length > 0 &&
      (initiateOffer ||
        streamChanged ||
        entry.connection.connectionState === "new" ||
        entry.connection.connectionState === "disconnected" ||
        entry.connection.connectionState === "failed")
    ) {

      const offer = await entry.connection.createOffer();
      await entry.connection.setLocalDescription(offer);
      this.sendSignal({
        roomId: this.roomId,
        fromPeerId: this.localPeerId,
        toPeerId: peerId,
        channelKind: "media",
        mediaEpoch: this.currentMediaEpoch,
        type: "offer",
        payload: offer as unknown as Record<string, unknown>
      });
    }

    return entry;
  }

  private createPeer(peerId: string, wantsIncomingAudio: boolean) {
    const connection = new RTCPeerConnection({
      iceServers: this.iceServers.length > 0 ? this.iceServers : [{ urls: "stun:stun.l.google.com:19302" }]
    });
    const entry: MediaPeerEntry = {
      connection,
      stream: null,
      senders: [],
      pendingCandidates: []
    };

    if (wantsIncomingAudio) {
      connection.addTransceiver("audio", {
        direction: "recvonly"
      });
    }

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      this.sendSignal({
        roomId: this.roomId,
        fromPeerId: this.localPeerId,
        toPeerId: peerId,
        channelKind: "media",
        mediaEpoch: this.currentMediaEpoch,
        type: "candidate",
        payload: event.candidate.toJSON() as unknown as Record<string, unknown>
      });
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      const nextStream = stream ?? new MediaStream([event.track]);
      this.callbacks.onRemoteStream(nextStream);
      event.track.onunmute = () => {
        this.callbacks.onRemoteStream(nextStream);
      };
    };

    connection.onconnectionstatechange = () => {
      this.callbacks.onConnectionStateChange?.({
        peerId,
        state: connection.connectionState,
        connectedPeerIds: this.getConnectedPeerIds()
      });

      if (
        connection.connectionState === "failed" ||
        connection.connectionState === "disconnected" ||
        connection.connectionState === "closed"
      ) {
        if (entry.stream) {
          this.callbacks.onRemoteStream(null);
        }

        if (this.peers.get(peerId) === entry) {
          this.releasePeer(peerId, entry);
        }
      }
    };

    this.peers.set(peerId, entry);
    return entry;
  }

  private attachStream(entry: MediaPeerEntry, localStream: MediaStream | null) {
    if (entry.stream === localStream) {
      return false;
    }

    const audioTracks = localStream?.getAudioTracks() ?? [];
    const nextTrack = audioTracks[0] ?? null;

    if (entry.senders.length === 0 && nextTrack) {
      entry.senders = [entry.connection.addTrack(nextTrack, localStream as MediaStream)];
      entry.stream = localStream;
      return true;
    }

    if (entry.senders.length > 0) {
      for (const sender of entry.senders) {
        void sender.replaceTrack(nextTrack);
      }
    }

    entry.stream = localStream;
    return true;
  }

  private releasePeer(peerId: string, entry: MediaPeerEntry) {
    this.peers.delete(peerId);
    if (entry.connection.connectionState !== "closed") {
      entry.connection.close();
    }
    this.callbacks.onConnectionStateChange?.({
      peerId,
      state: "closed",
      connectedPeerIds: this.getConnectedPeerIds()
    });
  }

  private resetForMediaEpoch(nextMediaEpoch: number) {
    for (const [peerId, entry] of this.peers.entries()) {
      this.releasePeer(peerId, entry);
    }
    this.peers.clear();
    this.currentMediaEpoch = nextMediaEpoch;
    this.callbacks.onRemoteStream(null);
  }

  private async flushPendingCandidates(entry: MediaPeerEntry) {
    if (entry.pendingCandidates.length === 0) {
      return;
    }

    const nextCandidates = [...entry.pendingCandidates];
    entry.pendingCandidates = [];
    for (const candidate of nextCandidates) {
      await entry.connection.addIceCandidate(candidate);
    }
  }
}

function toSessionDescriptionInit(payload: Record<string, unknown>): RTCSessionDescriptionInit | null {
  const type = typeof payload.type === "string" ? payload.type : null;
  const sdp = typeof payload.sdp === "string" ? payload.sdp : null;

  if (!type || !sdp) {
    return null;
  }

  return {
    type: type as RTCSdpType,
    sdp
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
