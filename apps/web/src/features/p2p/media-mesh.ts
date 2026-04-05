import type { IceServerConfig, PeerSignalMessage } from "@music-room/shared";
import {
  samplePeerConnectionStats,
  type PeerConnectionStatsSample,
  type PeerConnectionStatsSnapshot
} from "./connection-stats";

type MediaConnectionState = "idle" | RTCPeerConnectionState;

type MediaMeshCallbacks = {
  onRemoteStream: (stream: MediaStream | null) => void;
  onConnectionStateChange?: (payload: {
    peerId: string;
    state: MediaConnectionState;
    connectedPeerIds: string[];
  }) => void;
  onIceConnectionStateChange?: (payload: {
    peerId: string;
    state: RTCIceConnectionState;
  }) => void;
  onSignal?: (payload: {
    peerId: string;
    direction: "sent" | "received";
    type: PeerSignalMessage["type"];
  }) => void;
  onRemoteTrack?: (payload: {
    peerId: string;
    trackId: string;
    trackMuted: boolean;
    trackEnabled: boolean;
    trackReadyState: MediaStreamTrackState;
  }) => void;
  onSourcePeerFailed?: (payload: {
    peerId: string;
    mediaEpoch: number;
  }) => void;
  onStatsSample?: (payload: {
    peerId: string;
    sample: PeerConnectionStatsSample;
  }) => void;
};

type MediaPeerEntry = {
  connection: RTCPeerConnection;
  stream: MediaStream | null;
  senders: RTCRtpSender[];
  receiver: RTCRtpReceiver | null;
  pendingCandidates: RTCIceCandidateInit[];
  wantsIncomingAudio: boolean;
  needsOffer: boolean;
  makingOffer: boolean;
  offerAttempt: number;
  statsIntervalId: ReturnType<typeof setInterval> | null;
  configuredAudioMaxBitrateBps: number | null;
  configuredReceiverJitterTargetMs: number | null;
  statsSnapshot: PeerConnectionStatsSnapshot | null;
};

const directAudioMaxBitrateBps = 192_000;
const constrainedAudioMaxBitrateBps = 144_000;
const relayAudioMaxBitrateBps = 80_000;
const weakLinkAudioMaxBitrateBps = 56_000;
const minimumAudioMaxBitrateBps = 40_000;
const stableReceiverJitterTargetMs = 320;
const constrainedReceiverJitterTargetMs = 480;
const weakLinkReceiverJitterTargetMs = 560;

export class RoomMediaMesh {
  private readonly peers = new Map<string, MediaPeerEntry>();
  private currentMediaEpoch = 0;
  private latestLocalStream: MediaStream | null = null;

  constructor(
    private readonly roomId: string,
    private readonly localPeerId: string,
    private readonly sendSignal: (payload: PeerSignalMessage) => void,
    private readonly iceServers: IceServerConfig[],
    private readonly callbacks: MediaMeshCallbacks
  ) {}

  async syncHostPeers(remotePeerIds: string[], localStream: MediaStream | null, mediaEpoch = 0) {
    this.latestLocalStream = localStream;
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
    this.latestLocalStream = localStream;
    for (const [peerId, entry] of this.peers.entries()) {
      this.attachStream(entry, localStream);
      entry.needsOffer = true;
      await this.flushPendingOffer(peerId, entry);
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

    const localStream = this.latestLocalStream;
    const hasOutgoingTrack = !!localStream && localStream.getAudioTracks().length > 0;
    let entry =
      this.peers.get(payload.fromPeerId) ??
      this.createPeer(payload.fromPeerId, !hasOutgoingTrack);

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

      entry = await this.preparePeerForIncomingOffer(payload.fromPeerId, entry, localStream);

      if (hasOutgoingTrack) {
        this.attachStream(entry, localStream);
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
        channelKind: "media",
        mediaEpoch: this.currentMediaEpoch,
        type: "answer",
        payload: answer as unknown as Record<string, unknown>
      });
      await this.flushPendingOffer(payload.fromPeerId, entry);
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
      await this.flushPendingOffer(payload.fromPeerId, entry);
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

      try {
        await entry.connection.addIceCandidate(candidate);
      } catch {
        if (!entry.connection.remoteDescription) {
          entry.pendingCandidates.push(candidate);
        }
      }
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

  async restartPeer(peerId: string, localStream: MediaStream | null = null) {
    const effectiveLocalStream = localStream ?? this.latestLocalStream;
    const existingEntry = this.peers.get(peerId);
    const wantsIncomingAudio =
      existingEntry?.wantsIncomingAudio ??
      !(effectiveLocalStream && effectiveLocalStream.getAudioTracks().length > 0);
    if (existingEntry) {
      this.releasePeer(peerId, existingEntry);
    }

    const entry = this.createPeer(peerId, wantsIncomingAudio);
    const streamChanged = this.attachStream(entry, effectiveLocalStream);
    await this.maybeSendOffer(peerId, entry, effectiveLocalStream, true, streamChanged);
    return entry;
  }

  private async ensurePeer(peerId: string, localStream: MediaStream | null, initiateOffer: boolean) {
    const entry = this.peers.get(peerId) ?? this.createPeer(peerId, false);
    const streamChanged = this.attachStream(entry, localStream);
    await this.maybeSendOffer(peerId, entry, localStream, initiateOffer, streamChanged);

    return entry;
  }

  private async maybeSendOffer(
    peerId: string,
    entry: MediaPeerEntry,
    localStream: MediaStream | null,
    initiateOffer: boolean,
    streamChanged: boolean
  ) {
    const hasOutgoingTrack = !!localStream && localStream.getAudioTracks().length > 0;
    const shouldOfferForRecvOnly = entry.wantsIncomingAudio && initiateOffer;
    const shouldOfferForOutgoingTrack =
      hasOutgoingTrack &&
      (initiateOffer ||
        streamChanged ||
        entry.connection.connectionState === "new" ||
        entry.connection.connectionState === "disconnected" ||
        entry.connection.connectionState === "failed");

    if (
      (!shouldOfferForRecvOnly && !shouldOfferForOutgoingTrack)
    ) {
      return;
    }

    entry.needsOffer = true;
    await this.flushPendingOffer(peerId, entry);
  }

  private async preparePeerForIncomingOffer(
    peerId: string,
    entry: MediaPeerEntry,
    localStream: MediaStream | null
  ) {
    entry.offerAttempt += 1;
    entry.makingOffer = false;

    if (entry.connection.signalingState === "stable") {
      return entry;
    }

    if (entry.connection.signalingState === "have-local-offer") {
      try {
        await entry.connection.setLocalDescription({ type: "rollback" });
        return entry;
      } catch {
        // Fall through and recreate the peer if rollback is unavailable.
      }
    }

    const wantsIncomingAudio = entry.wantsIncomingAudio;
    this.releasePeer(peerId, entry);
    const recreatedEntry = this.createPeer(peerId, wantsIncomingAudio);
    if (localStream) {
      this.attachStream(recreatedEntry, localStream);
    }
    return recreatedEntry;
  }

  private async sendOffer(peerId: string, entry: MediaPeerEntry) {
    if (
      this.peers.get(peerId) !== entry ||
      entry.connection.signalingState !== "stable" ||
      entry.makingOffer
    ) {
      return;
    }

    const offerAttempt = ++entry.offerAttempt;
    entry.needsOffer = false;
    entry.makingOffer = true;

    try {
      const offer = await entry.connection.createOffer();
      if (
        this.peers.get(peerId) !== entry ||
        entry.offerAttempt !== offerAttempt ||
        entry.connection.signalingState !== "stable"
      ) {
        return;
      }

      await entry.connection.setLocalDescription(offer);
      if (this.peers.get(peerId) !== entry || entry.offerAttempt !== offerAttempt) {
        return;
      }

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
        mediaEpoch: this.currentMediaEpoch,
        type: "offer",
        payload: offer as unknown as Record<string, unknown>
      });
    } finally {
      if (this.peers.get(peerId) === entry) {
        entry.makingOffer = false;
      }
    }
  }

  private async flushPendingOffer(peerId: string, entry: MediaPeerEntry) {
    if (
      !entry.needsOffer ||
      this.peers.get(peerId) !== entry ||
      entry.connection.signalingState !== "stable" ||
      entry.makingOffer
    ) {
      return;
    }

    await this.sendOffer(peerId, entry);
  }

  private createPeer(peerId: string, wantsIncomingAudio: boolean) {
    const connection = new RTCPeerConnection({
      iceServers: this.iceServers.length > 0 ? this.iceServers : [{ urls: "stun:stun.l.google.com:19302" }]
    });
    const entry: MediaPeerEntry = {
      connection,
      stream: null,
      senders: [],
      receiver: null,
      pendingCandidates: [],
      wantsIncomingAudio,
      needsOffer: false,
      makingOffer: false,
      offerAttempt: 0,
      statsIntervalId: null,
      configuredAudioMaxBitrateBps: null,
      configuredReceiverJitterTargetMs: null,
      statsSnapshot: null
    };
    this.startStatsSampling(peerId, entry);

    if (wantsIncomingAudio) {
      const transceiver = connection.addTransceiver("audio", {
        direction: "recvonly"
      });
      entry.receiver = transceiver.receiver ?? null;
      this.configureAudioTransceiverCodecPreferences(transceiver);
      this.configureReceiverJitterBuffer(entry, stableReceiverJitterTargetMs);
    }

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
        mediaEpoch: this.currentMediaEpoch,
        type: "candidate",
        payload: event.candidate.toJSON() as unknown as Record<string, unknown>
      });
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      const nextStream = stream ?? new MediaStream([event.track]);
      const emitRemoteTrackState = () => {
        this.callbacks.onRemoteTrack?.({
          peerId,
          trackId: event.track.id,
          trackMuted: event.track.muted,
          trackEnabled: event.track.enabled,
          trackReadyState: event.track.readyState
        });
      };
      emitRemoteTrackState();
      this.callbacks.onRemoteStream(nextStream);
      event.track.onunmute = () => {
        emitRemoteTrackState();
        this.callbacks.onRemoteStream(nextStream);
      };
      event.track.onmute = () => {
        emitRemoteTrackState();
      };
      event.track.onended = () => {
        emitRemoteTrackState();
      };
    };

    connection.onconnectionstatechange = () => {
      this.callbacks.onConnectionStateChange?.({
        peerId,
        state: connection.connectionState,
        connectedPeerIds: this.getConnectedPeerIds()
      });

      if (connection.connectionState === "failed" || connection.connectionState === "closed") {
        if (entry.wantsIncomingAudio) {
          this.callbacks.onSourcePeerFailed?.({
            peerId,
            mediaEpoch: this.currentMediaEpoch
          });
        }

        if (entry.stream) {
          this.callbacks.onRemoteStream(null);
        }

        if (this.peers.get(peerId) === entry) {
          this.releasePeer(peerId, entry);
        }
      }
    };

    connection.oniceconnectionstatechange = () => {
      this.callbacks.onIceConnectionStateChange?.({
        peerId,
        state: connection.iceConnectionState
      });
    };

    this.peers.set(peerId, entry);
    return entry;
  }

  private attachStream(entry: MediaPeerEntry, localStream: MediaStream | null) {
    const audioTracks = localStream?.getAudioTracks() ?? [];
    const nextTrack = audioTracks[0] ?? null;
    const currentTrack = entry.senders[0]?.track ?? null;

    if (entry.stream === localStream && currentTrack === nextTrack) {
      return false;
    }

    if (entry.senders.length === 0 && nextTrack) {
      const sender = entry.connection.addTrack(nextTrack, localStream as MediaStream);
      entry.senders = [sender];
      void this.configureAudioSender(entry, sender, nextTrack, directAudioMaxBitrateBps);
      entry.stream = localStream;
      return true;
    }

    if (entry.senders.length > 0) {
      for (const sender of entry.senders) {
        void sender
          .replaceTrack(nextTrack)
          .then(() =>
            this.configureAudioSender(
              entry,
              sender,
              nextTrack,
              entry.configuredAudioMaxBitrateBps ?? directAudioMaxBitrateBps
            )
          )
          .catch(() => undefined);
      }
    }

    entry.stream = localStream;
    return true;
  }

  private releasePeer(peerId: string, entry: MediaPeerEntry) {
    this.peers.delete(peerId);
    this.stopStatsSampling(entry);
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
    this.currentMediaEpoch = nextMediaEpoch;
    for (const [peerId, entry] of this.peers.entries()) {
      this.releasePeer(peerId, entry);
    }
    this.peers.clear();
    this.callbacks.onRemoteStream(null);
  }

  private async flushPendingCandidates(entry: MediaPeerEntry) {
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

  private startStatsSampling(peerId: string, entry: MediaPeerEntry) {
    if (!this.callbacks.onStatsSample || entry.statsIntervalId) {
      return;
    }

    const emitStatsSample = async () => {
      const nextStats = await samplePeerConnectionStats(entry.connection, entry.statsSnapshot);
      if (!nextStats) {
        return;
      }

      entry.statsSnapshot = nextStats.snapshot;
      const sample = nextStats.sample;
      const receiverJitterTargetMs = resolvePreferredReceiverJitterTargetMs(sample);
      this.configureReceiverJitterBuffer(entry, receiverJitterTargetMs);
      await this.tuneOutgoingAudio(entry, sample);
      this.callbacks.onStatsSample?.({
        peerId,
        sample: {
          ...sample,
          targetAudioBitrateKbps:
            entry.configuredAudioMaxBitrateBps !== null
              ? Math.round(entry.configuredAudioMaxBitrateBps / 1000)
              : null,
          receiverJitterTargetMs: entry.configuredReceiverJitterTargetMs
        }
      });
    };

    void emitStatsSample();
    entry.statsIntervalId = setInterval(() => {
      void emitStatsSample();
    }, 2_000);
  }

  private stopStatsSampling(entry: MediaPeerEntry) {
    if (!entry.statsIntervalId) {
      return;
    }

    clearInterval(entry.statsIntervalId);
    entry.statsIntervalId = null;
  }

  private async configureAudioSender(
    entry: MediaPeerEntry,
    sender: RTCRtpSender,
    track: MediaStreamTrack | null,
    maxBitrateBps: number
  ) {
    if (track && "contentHint" in track) {
      try {
        track.contentHint = "music";
      } catch {
        // Ignore unsupported content hints.
      }
    }

    if (!sender.getParameters || !sender.setParameters) {
      return;
    }

    try {
      const parameters = sender.getParameters();
      const nextParameters: RTCRtpSendParameters = {
        ...parameters,
        encodings:
          parameters.encodings && parameters.encodings.length > 0
            ? parameters.encodings.map((encoding) => ({
                ...encoding,
                maxBitrate: maxBitrateBps,
                ...(hasEncodingDtxFlag(encoding)
                  ? { dtx: "disabled" as "disabled" | "enabled" }
                  : {})
              }))
            : [
                {
                  maxBitrate: maxBitrateBps
                } satisfies RTCRtpEncodingParameters
              ]
      };
      await sender.setParameters(nextParameters);
      entry.configuredAudioMaxBitrateBps = maxBitrateBps;
    } catch {
      // Some runtimes reject sender parameter changes after negotiation; ignore and keep streaming.
    }
  }

  private async tuneOutgoingAudio(entry: MediaPeerEntry, sample: PeerConnectionStatsSample) {
    if (entry.senders.length === 0) {
      return;
    }

    const nextMaxBitrateBps = normalizeAudioBitrateBps(resolvePreferredAudioMaxBitrateBps(sample));
    if (!shouldRetuneConfiguredAudioBitrate(entry.configuredAudioMaxBitrateBps, nextMaxBitrateBps)) {
      return;
    }

    await Promise.all(
      entry.senders.map((sender) =>
        this.configureAudioSender(entry, sender, sender.track, nextMaxBitrateBps)
      )
    );
  }

  private configureReceiverJitterBuffer(entry: MediaPeerEntry, targetMs: number) {
    if (!entry.receiver) {
      return;
    }

    const receiverWithTarget = entry.receiver as RTCRtpReceiver & {
      jitterBufferTarget?: number;
    };
    if (typeof receiverWithTarget.jitterBufferTarget === "undefined") {
      return;
    }

    if (entry.configuredReceiverJitterTargetMs === targetMs) {
      return;
    }

    try {
      receiverWithTarget.jitterBufferTarget = targetMs / 1000;
      entry.configuredReceiverJitterTargetMs = targetMs;
    } catch {
      // Ignore unsupported setter failures and keep using browser defaults.
    }
  }

  private configureAudioTransceiverCodecPreferences(transceiver: RTCRtpTransceiver) {
    const codecCapabilities = getAudioCodecCapabilities();
    if (!codecCapabilities || typeof transceiver.setCodecPreferences !== "function") {
      return;
    }

    const opusCodecs = codecCapabilities.filter((codec) =>
      codec.mimeType.toLowerCase() === "audio/opus"
    );
    if (opusCodecs.length === 0) {
      return;
    }

    const remaining = codecCapabilities.filter(
      (codec) => codec.mimeType.toLowerCase() !== "audio/opus"
    );

    try {
      transceiver.setCodecPreferences([...opusCodecs, ...remaining]);
    } catch {
      // Ignore codec preference failures and keep browser negotiation defaults.
    }
  }
}

export function resolvePreferredAudioMaxBitrateBps(sample: PeerConnectionStatsSample) {
  const constrainedTransport = sample.protocol === "tcp" || sample.candidateType === "relay";
  const severeWeakLink =
    (typeof sample.currentRoundTripTimeMs === "number" && sample.currentRoundTripTimeMs >= 220) ||
    (typeof sample.packetLossRate === "number" && sample.packetLossRate >= 8) ||
    (typeof sample.packetsLost === "number" &&
      sample.packetLossRate === null &&
      sample.packetsLost >= 120) ||
    (typeof sample.jitterMs === "number" && sample.jitterMs >= 45);
  const weakLink =
    (typeof sample.currentRoundTripTimeMs === "number" && sample.currentRoundTripTimeMs >= 180) ||
    (typeof sample.packetLossRate === "number" && sample.packetLossRate >= 6) ||
    (typeof sample.packetsLost === "number" &&
      sample.packetLossRate === null &&
      sample.packetsLost >= 80) ||
    (typeof sample.jitterMs === "number" && sample.jitterMs >= 30);
  let targetMaxBitrateBps = directAudioMaxBitrateBps;

  if (severeWeakLink) {
    targetMaxBitrateBps = weakLinkAudioMaxBitrateBps;
  } else if (constrainedTransport) {
    targetMaxBitrateBps = relayAudioMaxBitrateBps;
  } else if (weakLink) {
    targetMaxBitrateBps = constrainedAudioMaxBitrateBps;
  }

  if (
    typeof sample.availableOutgoingBitrateKbps === "number" &&
    Number.isFinite(sample.availableOutgoingBitrateKbps) &&
    sample.availableOutgoingBitrateKbps > 0
  ) {
    const headroomRatio = constrainedTransport ? 0.78 : 0.88;
    const measuredCeilingBps = Math.floor(
      sample.availableOutgoingBitrateKbps * 1000 * headroomRatio
    );
    targetMaxBitrateBps = Math.min(targetMaxBitrateBps, measuredCeilingBps);
  }

  return Math.max(
    minimumAudioMaxBitrateBps,
    Math.min(directAudioMaxBitrateBps, targetMaxBitrateBps)
  );
}

export function resolvePreferredReceiverJitterTargetMs(sample: PeerConnectionStatsSample) {
  const constrainedTransport = sample.protocol === "tcp" || sample.candidateType === "relay";
  const weakLink =
    (typeof sample.currentRoundTripTimeMs === "number" && sample.currentRoundTripTimeMs >= 180) ||
    (typeof sample.packetLossRate === "number" && sample.packetLossRate >= 6) ||
    (typeof sample.packetsLost === "number" &&
      sample.packetLossRate === null &&
      sample.packetsLost >= 80) ||
    (typeof sample.jitterMs === "number" && sample.jitterMs >= 30);

  if (weakLink) {
    return weakLinkReceiverJitterTargetMs;
  }

  if (constrainedTransport) {
    return constrainedReceiverJitterTargetMs;
  }

  return stableReceiverJitterTargetMs;
}

export function normalizeAudioBitrateBps(bitrateBps: number) {
  const normalized = Math.floor(bitrateBps / 4_000) * 4_000;
  return Math.max(minimumAudioMaxBitrateBps, Math.min(directAudioMaxBitrateBps, normalized));
}

export function shouldRetuneConfiguredAudioBitrate(
  currentBitrateBps: number | null,
  nextBitrateBps: number
) {
  if (currentBitrateBps === null) {
    return true;
  }

  if (currentBitrateBps === nextBitrateBps) {
    return false;
  }

  return Math.abs(currentBitrateBps - nextBitrateBps) >= 12_000;
}

function getAudioCodecCapabilities() {
  const receiverCtor = globalThis.RTCRtpReceiver as
    | (typeof RTCRtpReceiver & {
        getCapabilities?: (kind: "audio") => RTCRtpCapabilities | null;
      })
    | undefined;

  return receiverCtor?.getCapabilities?.("audio")?.codecs ?? null;
}

function hasEncodingDtxFlag(encoding: RTCRtpEncodingParameters) {
  return "dtx" in (encoding as RTCRtpEncodingParameters & { dtx?: unknown });
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
