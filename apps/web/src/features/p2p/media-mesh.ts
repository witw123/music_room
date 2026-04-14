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
    transportEpoch: number;
    negotiationRole: "publisher" | "listener";
    publishGeneration: number;
    attachedTrackId: string | null;
    negotiatedTrackId: string | null;
    makingOffer: boolean;
    signalingState: RTCSignalingState;
    pendingRestart: boolean;
    ignoreOffer: boolean;
    listenerAwaitingPublisherOffer: boolean;
    lastIgnoredOfferReason: "offer-collision" | "stale-generation" | "wrong-role" | "none";
  }) => void;
  onConnectionStateChange?: (payload: {
    peerId: string;
    state: MediaConnectionState;
    connectedPeerIds: string[];
    recoverableFailure?: boolean;
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

type MediaMeshOptions = {
  resolveConnectionConfig?: (peerId: string) => Partial<RTCConfiguration> | null | undefined;
};

type MediaPeerEntry = {
  connection: RTCPeerConnection;
  stream: MediaStream | null;
  senders: RTCRtpSender[];
  receiver: RTCRtpReceiver | null;
  pendingCandidates: RTCIceCandidateInit[];
  wantsIncomingAudio: boolean;
  negotiationRole: "publisher" | "listener";
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
  recoverableFailure: boolean;
  listenerAwaitingPublisherOffer: boolean;
  lastIgnoredOfferReason: "offer-collision" | "stale-generation" | "wrong-role" | "none";
  isPolite: boolean;
  released: boolean;
  operationChain: Promise<void>;
  weakReceiverWindowCount: number;
  healthyReceiverWindowCount: number;
};

const stableReceiverJitterTargetMs = 120;
const constrainedReceiverJitterTargetMs = 220;
const weakLinkReceiverJitterTargetMs = 320;
const receiverJitterRetuneHysteresisMs = 80;
const activeStatsSamplingIntervalMs = 1_000;
const steadyStatsSamplingIntervalMs = 5_000;
const receiverJitterWeakUpgradeWindowCount = 2;
const receiverJitterHealthyDowngradeWindowCount = 3;
const musicAudioTargetBitrateBps = 510_000;

export function tuneOpusSdpForMusic(sdp: string | null | undefined) {
  if (!sdp) {
    return sdp ?? "";
  }

  const lines = sdp.split(/\r\n|\n/);
  const opusPayloadTypes = new Set<string>();
  for (const line of lines) {
    const match = /^a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?$/i.exec(line.trim());
    if (match?.[1]) {
      opusPayloadTypes.add(match[1]);
    }
  }

  if (opusPayloadTypes.size === 0) {
    return sdp;
  }

  const tunedLines: string[] = [];
  const seenFmtp = new Set<string>();
  for (const line of lines) {
    tunedLines.push(line);

    const rtpMapMatch = /^a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?$/i.exec(line.trim());
    if (rtpMapMatch?.[1] && opusPayloadTypes.has(rtpMapMatch[1]) && !seenFmtp.has(rtpMapMatch[1])) {
      const hasExistingFmtp = lines.some((candidate) =>
        new RegExp(`^a=fmtp:${rtpMapMatch[1]}\\s`, "i").test(candidate.trim())
      );
      if (!hasExistingFmtp) {
        tunedLines.push(
          `a=fmtp:${rtpMapMatch[1]} maxaveragebitrate=${musicAudioTargetBitrateBps};stereo=1;sprop-stereo=1;cbr=1;usedtx=0`
        );
        seenFmtp.add(rtpMapMatch[1]);
      }
      continue;
    }

    const fmtpMatch = /^a=fmtp:(\d+)\s+(.+)$/i.exec(line.trim());
    if (!fmtpMatch?.[1] || !opusPayloadTypes.has(fmtpMatch[1])) {
      continue;
    }

    const params = fmtpMatch[2]
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const paramMap = new Map<string, string>();
    for (const entry of params) {
      const [rawKey, rawValue = ""] = entry.split("=");
      paramMap.set(rawKey.trim().toLowerCase(), rawValue.trim());
    }
    paramMap.set("maxaveragebitrate", `${musicAudioTargetBitrateBps}`);
    paramMap.set("stereo", "1");
    paramMap.set("sprop-stereo", "1");
    paramMap.set("cbr", "1");
    paramMap.set("usedtx", "0");
    tunedLines[tunedLines.length - 1] =
      `a=fmtp:${fmtpMatch[1]} ` +
      [...paramMap.entries()].map(([key, value]) => `${key}=${value}`).join(";");
    seenFmtp.add(fmtpMatch[1]);
  }

  return tunedLines.join("\r\n");
}

function tuneSessionDescriptionForMusic<T extends RTCSessionDescriptionInit>(description: T): T {
  if (!description.sdp) {
    return description;
  }

  return {
    ...description,
    sdp: tuneOpusSdpForMusic(description.sdp)
  };
}

export class RoomMediaMesh {
  private readonly peers = new Map<string, MediaPeerEntry>();
  private currentMediaEpoch = 0;
  private currentTransportEpoch = 0;
  private latestLocalStream: MediaStream | null = null;
  private statsSamplingMode: "off" | "steady" | "active" = "active";
  private readonly resolveConnectionConfig?: MediaMeshOptions["resolveConnectionConfig"];

  constructor(
    private readonly roomId: string,
    private readonly localPeerId: string,
    private readonly sendSignal: (payload: PeerSignalMessage) => void,
    private readonly iceServers: IceServerConfig[],
    private readonly callbacks: MediaMeshCallbacks,
    options: MediaMeshOptions = {}
  ) {
    this.resolveConnectionConfig = options.resolveConnectionConfig;
  }

  async syncHostPeers(
    remotePeerIds: string[],
    localStream: MediaStream | null,
    mediaEpoch = 0,
    transportEpoch = this.currentTransportEpoch
  ) {
    this.latestLocalStream = localStream;
    this.currentMediaEpoch = mediaEpoch;
    if (this.currentTransportEpoch !== transportEpoch) {
      this.resetTransportState(transportEpoch);
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
    const incomingTransportEpoch = payload.transportEpoch ?? 0;

    if (incomingTransportEpoch < this.currentTransportEpoch) {
      const staleEntry = this.peers.get(payload.fromPeerId);
      if (staleEntry) {
        staleEntry.lastIgnoredOfferReason = "stale-generation";
        this.emitPeerRuntimeState(payload.fromPeerId, staleEntry);
      }
      return;
    }

    if (incomingTransportEpoch > this.currentTransportEpoch) {
      this.resetTransportState(incomingTransportEpoch);
    }
    this.currentMediaEpoch = Math.max(this.currentMediaEpoch, incomingMediaEpoch);

    const localStream = this.latestLocalStream;
    const hasOutgoingTrack = !!localStream && localStream.getAudioTracks().length > 0;
    const expectedNegotiationRole = hasOutgoingTrack ? "publisher" : "listener";
    const existingEntry = this.peers.get(payload.fromPeerId);
    if (existingEntry && existingEntry.negotiationRole !== expectedNegotiationRole) {
      this.releasePeer(payload.fromPeerId, existingEntry, { explicit: true });
    }
    const entry =
      this.peers.get(payload.fromPeerId) ??
      this.createPeer(payload.fromPeerId, !hasOutgoingTrack, expectedNegotiationRole);

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
        entry.lastIgnoredOfferReason = entry.ignoreOffer ? "offer-collision" : "none";
        if (!entry.ignoreOffer) {
          entry.listenerAwaitingPublisherOffer = false;
        }
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
        const answer = tuneSessionDescriptionForMusic(await entry.connection.createAnswer());
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
          transportEpoch: this.currentTransportEpoch,
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
    this.resetTransportState(this.currentTransportEpoch);
  }

  setTransportEpoch(transportEpoch: number) {
    if (transportEpoch === this.currentTransportEpoch) {
      return;
    }

    this.resetTransportState(transportEpoch);
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

  async restartPeer(peerId: string, localStream: MediaStream | null = null) {
    return this.restartPublishingPeer(peerId, localStream);
  }

  async restartPublishingPeer(peerId: string, localStream: MediaStream | null = null) {
    const effectiveLocalStream = localStream ?? this.latestLocalStream;
    const existingEntry = this.peers.get(peerId);
    if (existingEntry) {
      this.releasePeer(peerId, existingEntry, { explicit: true });
    }

    const entry = this.createPeer(peerId, false, "publisher");
    await this.enqueuePeerOperation(entry, async () => {
      const streamChanged = await this.attachStream(entry, effectiveLocalStream);
      await this.maybeSendOffer(peerId, entry, effectiveLocalStream, true, streamChanged);
    });
    return entry;
  }

  async restartIce(peerId: string, localStream: MediaStream | null = null) {
    const entry = this.peers.get(peerId);
    if (entry?.negotiationRole === "listener") {
      return this.restartListenerIce(peerId);
    }

    return this.restartPublishingIce(peerId, localStream);
  }

  async restartPublishingIce(peerId: string, localStream: MediaStream | null = null) {
    const entry = this.peers.get(peerId);
    if (
      !entry ||
      entry.released ||
      entry.connection.connectionState === "closed" ||
      entry.connection.connectionState === "failed"
    ) {
      return null;
    }

    const effectiveLocalStream = localStream ?? this.latestLocalStream;
    return this.enqueuePeerOperation(entry, async () => {
      if (entry.released) {
        return null;
      }

      const streamChanged = await this.attachStream(entry, effectiveLocalStream);
      await this.maybeSendOffer(peerId, entry, effectiveLocalStream, true, streamChanged, true);
      return entry;
    });
  }

  async restartListenerIce(peerId: string) {
    const entry = this.peers.get(peerId);
    if (
      !entry ||
      entry.released ||
      entry.negotiationRole !== "listener" ||
      entry.connection.connectionState === "closed" ||
      entry.connection.connectionState === "failed"
    ) {
      return null;
    }

    return this.enqueuePeerOperation(entry, async () => {
      if (entry.released) {
        return null;
      }

      entry.listenerAwaitingPublisherOffer = true;
      entry.lastIgnoredOfferReason = "wrong-role";
      entry.pendingRestart = false;
      if (typeof entry.connection.restartIce === "function") {
        entry.connection.restartIce();
      }
      this.emitPeerRuntimeState(peerId, entry);
      return entry;
    });
  }

  async resetListenerPeer(peerId: string) {
    const existingEntry = this.peers.get(peerId);
    if (existingEntry) {
      this.releasePeer(peerId, existingEntry, { explicit: true });
    }

    return this.createPeer(peerId, true, "listener", {
      awaitingPublisherOffer: true,
      lastIgnoredOfferReason: "wrong-role"
    });
  }

  private async ensurePeer(peerId: string, localStream: MediaStream | null, initiateOffer: boolean) {
    const existingEntry = this.peers.get(peerId);
    const shouldRecreatePeer =
      !!existingEntry &&
      !existingEntry.released &&
      (existingEntry.connection.connectionState === "closed" ||
        existingEntry.connection.connectionState === "failed" ||
        existingEntry.negotiationRole !== "publisher" ||
        existingEntry.recoverableFailure);
    if (existingEntry && shouldRecreatePeer) {
      this.releasePeer(peerId, existingEntry, { explicit: true });
    }
    const entry = this.peers.get(peerId) ?? this.createPeer(peerId, false, "publisher");
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
    streamChanged: boolean,
    forceIceRestart = false
  ) {
    if (entry.negotiationRole !== "publisher") {
      entry.listenerAwaitingPublisherOffer = true;
      if (initiateOffer || forceIceRestart) {
        entry.lastIgnoredOfferReason = "wrong-role";
      }
      entry.pendingRestart = false;
      this.emitPeerRuntimeState(peerId, entry);
      return;
    }

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
      entry.listenerAwaitingPublisherOffer = false;
      entry.pendingRestart = shouldOfferForRecvOnly || shouldOfferForOutgoingTrack;
      this.emitPeerRuntimeState(peerId, entry);
      return;
    }

    entry.listenerAwaitingPublisherOffer = false;
    entry.lastIgnoredOfferReason = "none";
    entry.pendingRestart = false;
    entry.makingOffer = true;
    this.emitPeerRuntimeState(peerId, entry);
    try {
      const offer = tuneSessionDescriptionForMusic(
        await entry.connection.createOffer(forceIceRestart ? { iceRestart: true } : undefined)
      );
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
        transportEpoch: this.currentTransportEpoch,
        type: "offer",
        payload: offer as unknown as Record<string, unknown>
      });
    } finally {
      entry.makingOffer = false;
      this.emitPeerRuntimeState(peerId, entry);
    }
  }

  private createPeer(
    peerId: string,
    wantsIncomingAudio: boolean,
    negotiationRole: "publisher" | "listener",
    options?: {
      awaitingPublisherOffer?: boolean;
      lastIgnoredOfferReason?: "offer-collision" | "stale-generation" | "wrong-role" | "none";
    }
  ) {
    const connection = new RTCPeerConnection(this.buildConnectionConfig(peerId));
    const entry: MediaPeerEntry = {
      connection,
      stream: null,
      senders: [],
      receiver: null,
      pendingCandidates: [],
      wantsIncomingAudio,
      negotiationRole,
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
      recoverableFailure: false,
      listenerAwaitingPublisherOffer: options?.awaitingPublisherOffer ?? false,
      lastIgnoredOfferReason: options?.lastIgnoredOfferReason ?? "none",
      isPolite: wantsIncomingAudio,
      released: false,
      operationChain: Promise.resolve(),
      weakReceiverWindowCount: 0,
      healthyReceiverWindowCount: 0
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
        transportEpoch: this.currentTransportEpoch,
        type: "candidate",
        payload: event.candidate.toJSON() as unknown as Record<string, unknown>
      });
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      const nextStream = stream ?? new MediaStream([event.track]);
      entry.listenerAwaitingPublisherOffer = false;
      entry.lastIgnoredOfferReason = "none";
      this.emitPeerRuntimeState(peerId, entry);
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

      if (entry.released) {
        return;
      }

      if (connection.connectionState === "failed" || connection.connectionState === "closed") {
        entry.pendingRestart = true;
        entry.recoverableFailure = true;
        entry.listenerAwaitingPublisherOffer = entry.negotiationRole === "listener";
        this.emitPeerRuntimeState(peerId, entry);
        this.callbacks.onConnectionStateChange?.({
          peerId,
          state: connection.connectionState,
          connectedPeerIds: this.getConnectedPeerIds(),
          recoverableFailure: true
        });
        if (entry.wantsIncomingAudio) {
          this.callbacks.onSourcePeerFailed?.({
            peerId,
            mediaEpoch: this.currentMediaEpoch
          });
        }
        return;
      }

      entry.recoverableFailure = false;
      this.callbacks.onConnectionStateChange?.({
        peerId,
        state: connection.connectionState,
        connectedPeerIds: this.getConnectedPeerIds(),
        recoverableFailure: false
      });
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
      await this.configureAudioSender(entry, sender, nextTrack, musicAudioTargetBitrateBps);
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
            entry.configuredAudioMaxBitrateBps ?? musicAudioTargetBitrateBps
          );
        })
      ).catch(() => undefined);
    }

    entry.stream = localStream;
    return true;
  }

  private releasePeer(
    peerId: string,
    entry: MediaPeerEntry,
    options?: {
      explicit?: boolean;
    }
  ) {
    entry.released = true;
    entry.recoverableFailure = false;
    this.stopStatsSampling(entry);
    if (entry.connection.connectionState !== "closed") {
      entry.connection.close();
    }
    this.peers.delete(peerId);
    this.callbacks.onConnectionStateChange?.({
      peerId,
      state: "closed",
      connectedPeerIds: this.getConnectedPeerIds(),
      recoverableFailure: options?.explicit ? false : undefined
    });
  }

  private resetTransportState(nextTransportEpoch: number) {
    this.currentTransportEpoch = nextTransportEpoch;
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
      transportEpoch: this.currentTransportEpoch,
      negotiationRole: entry.negotiationRole,
      publishGeneration: entry.publishGeneration,
      attachedTrackId: entry.attachedTrackId,
      negotiatedTrackId: entry.negotiatedTrackId,
      makingOffer: entry.makingOffer,
      signalingState: entry.connection.signalingState,
      pendingRestart: entry.pendingRestart,
      ignoreOffer: entry.ignoreOffer,
      listenerAwaitingPublisherOffer: entry.listenerAwaitingPublisherOffer,
      lastIgnoredOfferReason: entry.lastIgnoredOfferReason
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
      entry.lastIgnoredOfferReason = "none";
    } catch (error) {
      if (
        remoteDescription.type === "answer" &&
        this.shouldIgnoreStaleAnswerError(entry, error)
      ) {
        return;
      }
      throw error;
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

  private shouldIgnoreStaleAnswerError(entry: MediaPeerEntry, error: unknown) {
    if (entry.connection.signalingState === "have-local-offer") {
      return false;
    }

    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return /wrong state:\s*stable/i.test(message) || /Called in wrong state:\s*stable/i.test(message);
  }

  private getPeerIdForEntry(entry: MediaPeerEntry) {
    for (const [peerId, candidate] of this.peers.entries()) {
      if (candidate === entry) {
        return peerId;
      }
    }
    return this.localPeerId;
  }

  private buildConnectionConfig(peerId: string): RTCConfiguration {
    return {
      iceServers:
        this.iceServers.length > 0 ? this.iceServers : [{ urls: "stun:stun.l.google.com:19302" }],
      ...(this.resolveConnectionConfig?.(peerId) ?? {})
    };
  }

  private startStatsSampling(peerId: string, entry: MediaPeerEntry) {
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
      const sample = nextStats.sample;
      const receiverJitterTargetMs = this.resolveReceiverJitterTargetMs(entry, sample);
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
    const samplingIntervalMs =
      this.statsSamplingMode === "steady"
        ? steadyStatsSamplingIntervalMs
        : activeStatsSamplingIntervalMs;
    entry.statsIntervalId = setInterval(() => {
      void emitStatsSample();
    }, samplingIntervalMs);
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
    maxBitrateBps: number | null
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
        ...(parameters.encodings && parameters.encodings.length > 0
          ? {
              encodings: parameters.encodings.map((encoding) => {
                const nextEncoding: RTCRtpEncodingParameters & {
                  maxBitrate?: number;
                  dtx?: "disabled" | "enabled";
                } = {
                  ...encoding
                };
                delete nextEncoding.maxBitrate;
                if (hasEncodingDtxFlag(encoding)) {
                  nextEncoding.dtx = "disabled";
                }
                if (typeof maxBitrateBps === "number") {
                  nextEncoding.maxBitrate = maxBitrateBps;
                }
                return nextEncoding;
              })
            }
          : typeof maxBitrateBps === "number"
            ? {
                encodings: [
                  {
                    maxBitrate: maxBitrateBps
                  } satisfies RTCRtpEncodingParameters
                ]
              }
            : {})
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

  private resolveReceiverJitterTargetMs(
    entry: MediaPeerEntry,
    sample: PeerConnectionStatsSample
  ) {
    const constrainedTransport = sample.protocol === "tcp" || sample.candidateType === "relay";
    const severeWeakLink = isSevereWeakLink(sample);
    const weakLink = severeWeakLink || isWeakLink(sample);
    const currentTargetMs = entry.configuredReceiverJitterTargetMs;

    if (weakLink) {
      entry.weakReceiverWindowCount += 1;
      entry.healthyReceiverWindowCount = 0;
    } else {
      entry.healthyReceiverWindowCount += 1;
      entry.weakReceiverWindowCount = 0;
    }

    if (
      weakLink &&
      (severeWeakLink ||
        currentTargetMs === weakLinkReceiverJitterTargetMs ||
        entry.weakReceiverWindowCount >= receiverJitterWeakUpgradeWindowCount)
    ) {
      return weakLinkReceiverJitterTargetMs;
    }

    if (
      currentTargetMs === weakLinkReceiverJitterTargetMs &&
      entry.healthyReceiverWindowCount < receiverJitterHealthyDowngradeWindowCount
    ) {
      return currentTargetMs;
    }

    if (
      currentTargetMs === constrainedReceiverJitterTargetMs &&
      !constrainedTransport &&
      entry.healthyReceiverWindowCount < receiverJitterHealthyDowngradeWindowCount
    ) {
      return currentTargetMs;
    }

    return constrainedTransport
      ? constrainedReceiverJitterTargetMs
      : stableReceiverJitterTargetMs;
  }
}

export function resolvePreferredAudioMaxBitrateBps(
  sample: PeerConnectionStatsSample,
  currentConfiguredBitrateBps: number | null = null
) {
  void sample;
  void currentConfiguredBitrateBps;
  return musicAudioTargetBitrateBps;
}

export function resolvePreferredReceiverJitterTargetMs(
  sample: PeerConnectionStatsSample,
  currentConfiguredTargetMs: number | null = null
) {
  const constrainedTransport = sample.protocol === "tcp" || sample.candidateType === "relay";
  const severeWeakLink = isSevereWeakLink(sample);
  const weakLink = severeWeakLink || isWeakLink(sample);

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

function isSevereWeakLink(sample: PeerConnectionStatsSample) {
  return (
    (typeof sample.currentRoundTripTimeMs === "number" && sample.currentRoundTripTimeMs >= 220) ||
    (typeof sample.packetLossRate === "number" && sample.packetLossRate >= 8) ||
    (typeof sample.packetsLost === "number" &&
      sample.packetLossRate === null &&
      sample.packetsLost >= 120) ||
    (typeof sample.jitterMs === "number" && sample.jitterMs >= 45)
  );
}

function isWeakLink(sample: PeerConnectionStatsSample) {
  return (
    (typeof sample.currentRoundTripTimeMs === "number" && sample.currentRoundTripTimeMs >= 180) ||
    (typeof sample.packetLossRate === "number" && sample.packetLossRate >= 6) ||
    (typeof sample.packetsLost === "number" &&
      sample.packetLossRate === null &&
      sample.packetsLost >= 80) ||
    (typeof sample.jitterMs === "number" && sample.jitterMs >= 30)
  );
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
