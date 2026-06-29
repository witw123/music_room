import type { IceServerConfig, PeerSignalMessage } from "@music-room/shared";

type MediaMeshCallbacks = {
  getLocalStream?: () => MediaStream | null;
  onRemoteStream?: (payload: { peerId: string; stream: MediaStream }) => void;
  onRemoteStreamRemoved?: (payload: { peerId: string }) => void;
  onPeerConnectionChange?: (payload: { peerId: string; state: RTCPeerConnectionState }) => void;
  onIceConnectionStateChange?: (payload: { peerId: string; state: RTCIceConnectionState }) => void;
  onSignal?: (payload: {
    peerId: string;
    direction: "sent" | "received";
    type: PeerSignalMessage["type"];
  }) => void;
};

type MediaPeerEntry = {
  connection: RTCPeerConnection;
  initiatorPeerId: string | null;
  pendingCandidates: RTCIceCandidateInit[];
  remoteStream: MediaStream | null;
  localTrackIds: Set<string>;
  operationChain: Promise<void>;
  releasing: boolean;
};

export function shouldInitiateRoomMediaPeer(input: {
  localPeerId: string;
  remotePeerId: string;
  publishesLocalAudio: boolean;
}) {
  return (
    input.publishesLocalAudio &&
    !!input.localPeerId &&
    !!input.remotePeerId &&
    input.localPeerId !== input.remotePeerId
  );
}

export class RoomMediaMesh {
  private readonly peers = new Map<string, MediaPeerEntry>();
  private readonly expectedPeerIds = new Set<string>();
  private localStream: MediaStream | null = null;

  constructor(
    private readonly roomId: string,
    private readonly localPeerId: string,
    private readonly sendSignal: (payload: PeerSignalMessage) => void,
    private readonly callbacks: MediaMeshCallbacks,
    private readonly iceServers: IceServerConfig[] = []
  ) {}

  async syncPeers(remotePeerIds: string[], localStream?: MediaStream | null) {
    this.localStream = localStream ?? this.callbacks.getLocalStream?.() ?? null;
    const nextPeers = new Set(remotePeerIds.filter((peerId) => peerId && peerId !== this.localPeerId));
    this.expectedPeerIds.clear();
    for (const peerId of nextPeers) {
      this.expectedPeerIds.add(peerId);
    }

    for (const peerId of nextPeers) {
      const entry = await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId));
      const tracksChanged = await this.updateLocalTracks(entry);
      if (
        tracksChanged &&
        entry.connection.signalingState === "stable" &&
        this.shouldInitiatePeer(peerId)
      ) {
        await this.createAndSendOffer(peerId, entry);
      }
    }

    for (const [peerId, entry] of this.peers.entries()) {
      if (!nextPeers.has(peerId)) {
        this.releasePeer(peerId, entry);
      }
    }
  }

  async publishLocalStream(stream: MediaStream | null) {
    this.localStream = stream;
    for (const [peerId, entry] of this.peers.entries()) {
      const tracksChanged = await this.updateLocalTracks(entry);
      if (
        tracksChanged &&
        entry.connection.signalingState === "stable" &&
        this.shouldInitiatePeer(peerId)
      ) {
        await this.createAndSendOffer(peerId, entry);
      }
    }
  }

  async handleSignal(payload: PeerSignalMessage) {
    if (payload.channelKind !== "media" || payload.toPeerId !== this.localPeerId) {
      return;
    }

    const entry = this.peers.get(payload.fromPeerId) ?? (await this.ensurePeer(payload.fromPeerId, false));
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

        await entry.connection.setRemoteDescription(remoteDescription);
        await this.flushPendingCandidates(entry);
        await this.updateLocalTracks(entry);
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
          channelKind: "media",
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
        if (!remoteDescription || entry.connection.signalingState !== "have-local-offer") {
          return;
        }
        await entry.connection.setRemoteDescription(remoteDescription);
        await this.flushPendingCandidates(entry);
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
        await entry.connection.addIceCandidate(candidate).catch(() => {
          if (!entry.connection.remoteDescription) {
            entry.pendingCandidates.push(candidate);
          }
        });
      });
    }
  }

  getConnectedPeerIds() {
    return [...this.peers.entries()]
      .filter(([, entry]) => {
        const state = entry.connection.connectionState;
        return state === "connected" || state === "connecting";
      })
      .map(([peerId]) => peerId);
  }

  destroy() {
    this.expectedPeerIds.clear();
    for (const [peerId, entry] of this.peers.entries()) {
      this.releasePeer(peerId, entry);
    }
    this.peers.clear();
  }

  private async ensurePeer(peerId: string, shouldInitiate: boolean) {
    const existing = this.peers.get(peerId);
    if (existing && existing.connection.connectionState !== "closed") {
      return existing;
    }

    const connection = new RTCPeerConnection({
      iceServers: this.iceServers
    });
    const entry: MediaPeerEntry = {
      connection,
      initiatorPeerId: shouldInitiate ? this.localPeerId : null,
      pendingCandidates: [],
      remoteStream: null,
      localTrackIds: new Set(),
      operationChain: Promise.resolve(),
      releasing: false
    };

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
        channelKind: "media",
        type: "candidate",
        payload: event.candidate.toJSON() as unknown as Record<string, unknown>
      });
    };

    connection.onconnectionstatechange = () => {
      this.callbacks.onPeerConnectionChange?.({
        peerId,
        state: connection.connectionState
      });
      if (
        connection.connectionState === "failed" ||
        connection.connectionState === "closed" ||
        connection.connectionState === "disconnected"
      ) {
        this.callbacks.onRemoteStreamRemoved?.({ peerId });
      }
    };

    connection.oniceconnectionstatechange = () => {
      this.callbacks.onIceConnectionStateChange?.({
        peerId,
        state: connection.iceConnectionState
      });
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) {
        return;
      }
      entry.remoteStream = stream;
      this.callbacks.onRemoteStream?.({ peerId, stream });
    };

    this.peers.set(peerId, entry);
    await this.updateLocalTracks(entry);
    if (shouldInitiate) {
      await this.createAndSendOffer(peerId, entry);
    }

    return entry;
  }

  private async updateLocalTracks(entry: MediaPeerEntry) {
    const stream = this.localStream ?? this.callbacks.getLocalStream?.() ?? null;
    const audioTracks = stream?.getAudioTracks() ?? [];
    const nextTrackIds = new Set(audioTracks.map((track) => track.id));
    const senders = entry.connection.getSenders();
    let changed = false;
    for (const sender of senders) {
      if (sender.track?.kind === "audio" && !audioTracks.some((track) => track.id === sender.track?.id)) {
        entry.connection.removeTrack(sender);
        if (sender.track?.id) {
          entry.localTrackIds.delete(sender.track.id);
        }
        changed = true;
      }
    }

    for (const track of audioTracks) {
      if (entry.localTrackIds.has(track.id)) {
        continue;
      }
      entry.connection.addTrack(track, stream!);
      entry.localTrackIds.add(track.id);
      changed = true;
    }

    if (audioTracks.length === 0) {
      if (entry.localTrackIds.size > 0) {
        changed = true;
      }
      entry.localTrackIds.clear();
      return changed;
    }

    for (const trackId of [...entry.localTrackIds]) {
      if (!nextTrackIds.has(trackId)) {
        entry.localTrackIds.delete(trackId);
        changed = true;
      }
    }

    return changed;
  }

  private async createAndSendOffer(peerId: string, entry: MediaPeerEntry) {
    await this.enqueuePeerOperation(entry, async () => {
      if (entry.releasing || entry.connection.signalingState !== "stable") {
        return;
      }
      const offer = await entry.connection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      await entry.connection.setLocalDescription(offer);
      this.callbacks.onSignal?.({
        peerId,
        direction: "sent",
        type: "offer"
      });
      this.sendSignal({
        roomId: this.roomId,
        fromPeerId: this.localPeerId,
        toPeerId: peerId,
        channelKind: "media",
        type: "offer",
        payload: offer as unknown as Record<string, unknown>
      });
    });
  }

  private async flushPendingCandidates(entry: MediaPeerEntry) {
    if (!entry.connection.remoteDescription || entry.pendingCandidates.length === 0) {
      return;
    }
    const candidates = entry.pendingCandidates.splice(0, entry.pendingCandidates.length);
    for (const candidate of candidates) {
      await entry.connection.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  private enqueuePeerOperation(entry: MediaPeerEntry, operation: () => Promise<void>) {
    const nextOperation = entry.operationChain
      .catch(() => undefined)
      .then(() => {
        if (entry.releasing) {
          return;
        }
        return operation();
      });
    entry.operationChain = nextOperation.catch(() => undefined);
    return nextOperation;
  }

  private releasePeer(peerId: string, entry: MediaPeerEntry) {
    entry.releasing = true;
    entry.pendingCandidates = [];
    this.callbacks.onRemoteStreamRemoved?.({ peerId });
    try {
      entry.connection.close();
    } catch {
      // Ignore stale connection shutdown failures.
    }
  }

  private shouldInitiatePeer(peerId: string) {
    return shouldInitiateRoomMediaPeer({
      localPeerId: this.localPeerId,
      remotePeerId: peerId,
      publishesLocalAudio: this.hasPublishableLocalAudio()
    });
  }

  private hasPublishableLocalAudio() {
    const stream = this.localStream ?? this.callbacks.getLocalStream?.() ?? null;
    return (
      stream
        ?.getAudioTracks()
        .some((track) => track.readyState === "live" && track.enabled !== false) ?? false
    );
  }
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
