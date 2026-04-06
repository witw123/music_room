import type { IceServerConfig, PeerSignalMessage } from "@music-room/shared";
import {
  samplePeerConnectionStats,
  type PeerConnectionStatsSample,
  type PeerConnectionStatsSnapshot
} from "./connection-stats";

type MediaConnectionState = "idle" | RTCPeerConnectionState;

type MediaMeshCallbacks = {
  onRemoteStream: (stream: MediaStream | null) => void;
  onPeerRuntimeState?: (payload: {
    peerId: string;
    publishGeneration: number;
    attachedTrackId: string | null;
    negotiatedTrackId: string | null;
    makingOffer: boolean;
    signalingState: RTCSignalingState;
    pendingRestart: boolean;
    ignoreOffer: boolean;
  }) => void;
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
  statsIntervalId: ReturnType<typeof setInterval> | null;
  configuredAudioMaxBitrateBps: number | null;
  configuredReceiverJitterTargetMs: number | null;
  statsSnapshot: PeerConnectionStatsSnapshot | null;
  publishGeneration: number;
  attachedTrackId: string | null;
  negotiatedTrackId: string | null;
  makingOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  ignoreOffer: boolean;
  pendingRestart: boolean;
  isPolite: boolean;
  released: boolean;
  operationChain: Promise<void>;
};

const directAudioMaxBitrateBps = 256_000;
const constrainedAudioMaxBitrateBps = 208_000;
const relayAudioMaxBitrateBps = 144_000;
const weakLinkAudioMaxBitrateBps = 96_000;
const minimumAudioMaxBitrateBps = 64_000;
const stableReceiverJitterTargetMs = 320;
const constrainedReceiverJitterTargetMs = 420;
const weakLinkReceiverJitterTargetMs = 620;
const audioRetuneStepBps = 32_000;
const receiverJitterRetuneHysteresisMs = 120;

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
      await this.enqueuePeerOperation(entry, async () => {
        const streamChanged = await this.attachStream(entry, localStream);
        await this.maybeSendOffer(peerId, entry, localStream, false, streamChanged);
      });
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
    const entry =
      this.peers.get(payload.fromPeerId) ??
      this.createPeer(payload.fromPeerId, !hasOutgoingTrack);

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

        const readyForOffer =
          !entry.makingOffer &&
          (entry.connection.signalingState === "stable" || entry.isSettingRemoteAnswerPending);
        const offerCollision = !readyForOffer;
        entry.ignoreOffer = !entry.isPolite && offerCollision;
        this.emitPeerRuntimeState(payload.fromPeerId, entry);
        if (entry.ignoreOffer) {
          return;
        }

        if (offerCollision && entry.isPolite && entry.connection.signalingState !== "stable") {
          await entry.connection.setLocalDescription({ type: "rollback" });
        }

        if (hasOutgoingTrack) {
          await this.attachStream(entry, localStream);
        }
        await this.applyRemoteDescription(entry, remoteDescription);
        await this.flushPendingCandidates(entry);
        const answer = await entry.connection.createAnswer();
        await entry.connection.setLocalDescription(answer);
        entry.negotiatedTrackId = entry.attachedTrackId;
        this.emitPeerRuntimeState(payload.fromPeerId, entry);
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
        await this.maybeFlushPendingRestart(payload.fromPeerId, entry);
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
        entry.negotiatedTrackId = entry.attachedTrackId;
        this.emitPeerRuntimeState(payload.fromPeerId, entry);
        await this.maybeFlushPendingRestart(payload.fromPeerId, entry);
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
        } catch {
          if (!entry.connection.remoteDescription) {
            entry.pendingCandidates.push(candidate);
          }
        }
      });
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
    await this.enqueuePeerOperation(entry, async () => {
      const streamChanged = await this.attachStream(entry, effectiveLocalStream);
      await this.maybeSendOffer(peerId, entry, effectiveLocalStream, true, streamChanged);
    });
    return entry;
  }

  private async ensurePeer(peerId: string, localStream: MediaStream | null, initiateOffer: boolean) {
    const entry = this.peers.get(peerId) ?? this.createPeer(peerId, false);
    await this.enqueuePeerOperation(entry, async () => {
      const streamChanged = await this.attachStream(entry, localStream);
      await this.maybeSendOffer(peerId, entry, localStream, initiateOffer, streamChanged);
    });

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
      entry.connection.signalingState !== "stable" ||
      (!shouldOfferForRecvOnly && !shouldOfferForOutgoingTrack)
    ) {
      entry.pendingRestart = shouldOfferForRecvOnly || shouldOfferForOutgoingTrack;
      this.emitPeerRuntimeState(peerId, entry);
      return;
    }

    entry.pendingRestart = false;
    entry.makingOffer = true;
    this.emitPeerRuntimeState(peerId, entry);
    try {
      const offer = await entry.connection.createOffer();
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
        mediaEpoch: this.currentMediaEpoch,
        type: "offer",
        payload: offer as unknown as Record<string, unknown>
      });
    } finally {
      entry.makingOffer = false;
      this.emitPeerRuntimeState(peerId, entry);
    }
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
      statsIntervalId: null,
      configuredAudioMaxBitrateBps: null,
      configuredReceiverJitterTargetMs: null,
      statsSnapshot: null,
      publishGeneration: 0,
      attachedTrackId: null,
      negotiatedTrackId: null,
      makingOffer: false,
      isSettingRemoteAnswerPending: false,
      ignoreOffer: false,
      pendingRestart: false,
      isPolite: wantsIncomingAudio,
      released: false,
      operationChain: Promise.resolve()
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
      this.emitPeerRuntimeState(peerId, entry);
      this.callbacks.onConnectionStateChange?.({
        peerId,
        state: connection.connectionState,
        connectedPeerIds: this.getConnectedPeerIds()
      });

      if (entry.released) {
        return;
      }

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
      this.emitPeerRuntimeState(peerId, entry);
      this.callbacks.onIceConnectionStateChange?.({
        peerId,
        state: connection.iceConnectionState
      });
    };

    this.peers.set(peerId, entry);
    this.emitPeerRuntimeState(peerId, entry);
    return entry;
  }

  private async attachStream(entry: MediaPeerEntry, localStream: MediaStream | null) {
    const audioTracks = localStream?.getAudioTracks() ?? [];
    const nextTrack = audioTracks[0] ?? null;
    const currentTrack = entry.senders[0]?.track ?? null;

    if (entry.stream === localStream && currentTrack === nextTrack) {
      return false;
    }

    entry.publishGeneration += 1;
    entry.attachedTrackId = nextTrack?.id ?? null;
    this.emitPeerRuntimeState(this.getPeerIdForEntry(entry), entry);

    if (entry.senders.length === 0 && nextTrack) {
      const sender = entry.connection.addTrack(nextTrack, localStream as MediaStream);
      entry.senders = [sender];
      await this.configureAudioSender(entry, sender, nextTrack, directAudioMaxBitrateBps);
      entry.stream = localStream;
      return true;
    }

    if (entry.senders.length > 0) {
      await Promise.all(
        entry.senders.map(async (sender) => {
          await sender.replaceTrack(nextTrack);
          await this.configureAudioSender(
            entry,
            sender,
            nextTrack,
            entry.configuredAudioMaxBitrateBps ?? directAudioMaxBitrateBps
          );
        })
      ).catch(() => undefined);
    }

    entry.stream = localStream;
    return true;
  }

  private releasePeer(peerId: string, entry: MediaPeerEntry) {
    entry.released = true;
    this.stopStatsSampling(entry);
    if (entry.connection.connectionState !== "closed") {
      entry.connection.close();
    }
    this.peers.delete(peerId);
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

  private emitPeerRuntimeState(peerId: string, entry: MediaPeerEntry) {
    this.callbacks.onPeerRuntimeState?.({
      peerId,
      publishGeneration: entry.publishGeneration,
      attachedTrackId: entry.attachedTrackId,
      negotiatedTrackId: entry.negotiatedTrackId,
      makingOffer: entry.makingOffer,
      signalingState: entry.connection.signalingState,
      pendingRestart: entry.pendingRestart,
      ignoreOffer: entry.ignoreOffer
    });
  }

  private enqueuePeerOperation<T>(entry: MediaPeerEntry, task: () => Promise<T>) {
    const run = entry.operationChain
      .catch(() => undefined)
      .then(async () => {
        if (entry.released) {
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
    entry: MediaPeerEntry,
    remoteDescription: RTCSessionDescriptionInit
  ) {
    if (remoteDescription.type === "answer") {
      entry.isSettingRemoteAnswerPending = true;
      this.emitPeerRuntimeState(this.getPeerIdForEntry(entry), entry);
    }

    try {
      await entry.connection.setRemoteDescription(remoteDescription);
      entry.ignoreOffer = false;
    } finally {
      if (remoteDescription.type === "answer") {
        entry.isSettingRemoteAnswerPending = false;
      }
      this.emitPeerRuntimeState(this.getPeerIdForEntry(entry), entry);
    }
  }

  private async maybeFlushPendingRestart(peerId: string, entry: MediaPeerEntry) {
    if (!entry.pendingRestart || entry.connection.signalingState !== "stable") {
      return;
    }

    const localStream = this.latestLocalStream;
    entry.pendingRestart = false;
    this.emitPeerRuntimeState(peerId, entry);
    const streamChanged = await this.attachStream(entry, localStream);
    await this.maybeSendOffer(peerId, entry, localStream, true, streamChanged);
  }

  private getPeerIdForEntry(entry: MediaPeerEntry) {
    for (const [peerId, candidate] of this.peers.entries()) {
      if (candidate === entry) {
        return peerId;
      }
    }
    return this.localPeerId;
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
      const receiverJitterTargetMs = resolvePreferredReceiverJitterTargetMs(
        sample,
        entry.configuredReceiverJitterTargetMs
      );
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

    const nextMaxBitrateBps = resolvePreferredAudioMaxBitrateBps(
      sample,
      entry.configuredAudioMaxBitrateBps
    );
    if (entry.configuredAudioMaxBitrateBps === nextMaxBitrateBps) {
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

export function resolvePreferredAudioMaxBitrateBps(
  sample: PeerConnectionStatsSample,
  currentConfiguredBitrateBps: number | null = null
) {
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
  } else if (weakLink && constrainedTransport) {
    targetMaxBitrateBps = Math.min(relayAudioMaxBitrateBps, constrainedAudioMaxBitrateBps);
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
    const headroomRatio = constrainedTransport ? 0.82 : 0.9;
    const measuredCeilingBps = Math.floor(
      sample.availableOutgoingBitrateKbps * 1000 * headroomRatio
    );
    targetMaxBitrateBps = Math.min(targetMaxBitrateBps, measuredCeilingBps);
  }

  const nextTargetBps = Math.max(
    minimumAudioMaxBitrateBps,
    Math.min(directAudioMaxBitrateBps, targetMaxBitrateBps)
  );

  if (
    currentConfiguredBitrateBps !== null &&
    Math.abs(currentConfiguredBitrateBps - nextTargetBps) < audioRetuneStepBps
  ) {
    return currentConfiguredBitrateBps;
  }

  return nextTargetBps;
}

export function resolvePreferredReceiverJitterTargetMs(
  sample: PeerConnectionStatsSample,
  currentConfiguredTargetMs: number | null = null
) {
  const constrainedTransport = sample.protocol === "tcp" || sample.candidateType === "relay";
  const severeWeakLink =
    (typeof sample.currentRoundTripTimeMs === "number" && sample.currentRoundTripTimeMs >= 220) ||
    (typeof sample.packetLossRate === "number" && sample.packetLossRate >= 8) ||
    (typeof sample.packetsLost === "number" &&
      sample.packetLossRate === null &&
      sample.packetsLost >= 120) ||
    (typeof sample.jitterMs === "number" && sample.jitterMs >= 45);
  const weakLink =
    severeWeakLink ||
    (typeof sample.currentRoundTripTimeMs === "number" && sample.currentRoundTripTimeMs >= 180) ||
    (typeof sample.packetLossRate === "number" && sample.packetLossRate >= 6) ||
    (typeof sample.packetsLost === "number" &&
      sample.packetLossRate === null &&
      sample.packetsLost >= 80) ||
    (typeof sample.jitterMs === "number" && sample.jitterMs >= 30);

  let nextTargetMs = stableReceiverJitterTargetMs;

  if (severeWeakLink || weakLink) {
    nextTargetMs = weakLinkReceiverJitterTargetMs;
  } else if (constrainedTransport) {
    nextTargetMs = constrainedReceiverJitterTargetMs;
  }

  if (
    currentConfiguredTargetMs !== null &&
    Math.abs(currentConfiguredTargetMs - nextTargetMs) < receiverJitterRetuneHysteresisMs
  ) {
    return currentConfiguredTargetMs;
  }

  return nextTargetMs;
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
