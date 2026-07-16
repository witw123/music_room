import type {
  IceServerConfig
} from "@music-room/shared";
import {
  SignalingTransport,
  type PeerLinkKind
} from "./signaling-transport";
import {
  MeshHealthMonitor
} from "./mesh-health-monitor";
import {
  PeerStatsSampler
} from "./peer-stats-sampler";
import {
  PeerConnectionRegistry,
  createPeerEntry,
  enqueuePeerOperation,
  flushPendingCandidates,
  shouldRestartPeer,
  type PeerEntry,
  type PeerMediaState
} from "./peer-connection-registry";
import {
  bindPeerConnectionEvents,
  buildPeerConnectionConfig,
  releasePeerConnectionEntry,
  resolveExistingPeerConnectionAction,
  shouldInitiatePeerConnection
} from "./peer-connection-lifecycle";
import {
  samplePeerConnectionStats,
  type PeerConnectionStatsSample
} from "./connection-stats";

type PeerStalledReason = "watchdog-timeout" | "connection-failed" | "data-channel-closed";

type PeerConnectionLifecycleManagerInput = {
  localPeerId: string;
  autoReconnect: boolean;
  iceServers: IceServerConfig[];
  resolveConnectionConfig?: (peerId: string) => Partial<RTCConfiguration> | null | undefined;
  signaling: SignalingTransport;
  bindChannel: (peerId: string, entry: PeerEntry, channel: RTCDataChannel) => void;
  clearPendingRequestsForPeer: (peerId: string) => void;
  onPeerConnectionChange?: (payload: {
    peerId: string;
    state: RTCPeerConnectionState;
    linkKind?: PeerLinkKind;
  }) => void;
  onIceConnectionStateChange?: (payload: {
    peerId: string;
    state: RTCIceConnectionState;
    linkKind?: PeerLinkKind;
  }) => void;
  onDataBufferedAmountChange?: (payload: {
    peerId: string;
    bufferedAmountBytes: number;
  }) => void;
  onStatsSample?: (payload: {
    peerId: string;
    sample: PeerConnectionStatsSample;
  }) => void;
  onPeerStalled?: (payload: {
    peerId: string;
    reason: PeerStalledReason;
  }) => void;
  onRemoteAudioTrack?: (payload: {
    peerId: string;
    entry: PeerEntry;
    track: MediaStreamTrack;
    streams: readonly MediaStream[];
  }) => void;
  onMediaStateChange?: (payload: {
    peerId: string;
    entry: PeerEntry;
    direction: "sender" | "receiver";
    state: PeerEntry["senderTrackState"];
  }) => void;
  onMediaTrackMuted?: (payload: { peerId: string; trackId: string }) => void;
  onMediaRecovery?: (payload: {
    peerId: string;
    reason: "loss" | "jitter" | "no-packets" | "connection-failed";
    restartCount: number;
  }) => void;
};

type MediaRecoveryState = {
  degradedWindows: number;
  noPacketWindows: number;
  noSendPacketWindows: number;
  highLossWindows: number;
  highJitterWindows: number;
  restartTimesMs: number[];
  failureReportedAtMs: number | null;
  disconnectedTimerId: ReturnType<typeof setTimeout> | null;
};

const mediaTrackWatchdogGraceMs = 3_000;
const mediaRecoveryCooldownMs = 3_000;

function createMediaRecoveryState(): MediaRecoveryState {
  return {
    degradedWindows: 0,
    noPacketWindows: 0,
    noSendPacketWindows: 0,
    highLossWindows: 0,
    highJitterWindows: 0,
    restartTimesMs: [],
    failureReportedAtMs: null,
    disconnectedTimerId: null
  };
}

export class PeerConnectionLifecycleManager {
  private readonly peerConnections: PeerConnectionRegistry;
  private readonly healthMonitor: MeshHealthMonitor;
  private readonly statsSampler: PeerStatsSampler;
  private readonly localPeerId: string;
  private readonly autoReconnect: boolean;
  private readonly iceServers: IceServerConfig[];
  private readonly resolveConnectionConfig?: PeerConnectionLifecycleManagerInput["resolveConnectionConfig"];
  private readonly signaling: SignalingTransport;
  private readonly bindChannelCallback: PeerConnectionLifecycleManagerInput["bindChannel"];
  private readonly clearPendingRequestsForPeerCallback: PeerConnectionLifecycleManagerInput["clearPendingRequestsForPeer"];
  private readonly onPeerConnectionChange?: PeerConnectionLifecycleManagerInput["onPeerConnectionChange"];
  private readonly onIceConnectionStateChange?: PeerConnectionLifecycleManagerInput["onIceConnectionStateChange"];
  private readonly onDataBufferedAmountChange?: PeerConnectionLifecycleManagerInput["onDataBufferedAmountChange"];
  private readonly onPeerStalled?: PeerConnectionLifecycleManagerInput["onPeerStalled"];
  private readonly onRemoteAudioTrack?: PeerConnectionLifecycleManagerInput["onRemoteAudioTrack"];
  private readonly onMediaStateChange?: PeerConnectionLifecycleManagerInput["onMediaStateChange"];
  private readonly onMediaTrackMuted?: PeerConnectionLifecycleManagerInput["onMediaTrackMuted"];
  private readonly onMediaRecovery?: PeerConnectionLifecycleManagerInput["onMediaRecovery"];
  private readonly mediaRecovery = new Map<string, MediaRecoveryState>();
  private readonly latestMediaSamples = new Map<string, PeerConnectionStatsSample>();
  private localAudioStream: MediaStream | null = null;
  private localAudioSourcePeerId: string | null = null;
  private localAudioMaxBitrateKbps: number | null = null;

  constructor(input: PeerConnectionLifecycleManagerInput) {
    this.localPeerId = input.localPeerId;
    this.autoReconnect = input.autoReconnect;
    this.iceServers = input.iceServers;
    this.resolveConnectionConfig = input.resolveConnectionConfig;
    this.signaling = input.signaling;
    this.bindChannelCallback = input.bindChannel;
    this.clearPendingRequestsForPeerCallback = input.clearPendingRequestsForPeer;
    this.onPeerConnectionChange = input.onPeerConnectionChange;
    this.onIceConnectionStateChange = input.onIceConnectionStateChange;
    this.onDataBufferedAmountChange = input.onDataBufferedAmountChange;
    this.onPeerStalled = input.onPeerStalled;
    this.onRemoteAudioTrack = input.onRemoteAudioTrack;
    this.onMediaStateChange = input.onMediaStateChange;
    this.onMediaTrackMuted = input.onMediaTrackMuted;
    this.onMediaRecovery = input.onMediaRecovery;
    this.peerConnections = new PeerConnectionRegistry(input.localPeerId);
    this.statsSampler = new PeerStatsSampler({
      activeStatsSamplingIntervalMs: 1_000,
      steadyStatsSamplingIntervalMs: 5_000,
      onStatsSample: (payload) => {
        const mediaEntry = this.peerConnections.get(payload.peerId, "media");
        const mediaSample = !!mediaEntry &&
          (mediaEntry.senderTrackState === "live" || mediaEntry.receiverTrackState === "live" ||
            payload.sample.mediaReceiveBitrateKbps !== null ||
            payload.sample.mediaSendBitrateKbps !== null);
        const previousMedia = mediaEntry
          ? this.latestMediaSamples.get(payload.peerId)
          : null;
        if (mediaSample) {
          this.latestMediaSamples.set(payload.peerId, payload.sample);
        }
        const mergedSample = mediaSample || !previousMedia
          ? payload.sample
          : {
              ...payload.sample,
              mediaReceiveBitrateKbps: previousMedia.mediaReceiveBitrateKbps,
              mediaSendBitrateKbps: previousMedia.mediaSendBitrateKbps,
              senderTrackId: previousMedia.senderTrackId,
              receiverTrackId: previousMedia.receiverTrackId,
              senderCodecId: previousMedia.senderCodecId,
              receiverCodecId: previousMedia.receiverCodecId,
              opusCodec: previousMedia.opusCodec,
              opusFmtpLine: previousMedia.opusFmtpLine,
              packetLossRate: previousMedia.packetLossRate,
              jitterMs: previousMedia.jitterMs,
              lastMediaPacketAtMs: previousMedia.lastMediaPacketAtMs
            };
        const configured = this.peerConnections.get(payload.peerId, "media")?.configuredAudioMaxBitrateKbps ??
          this.peerConnections.get(payload.peerId)?.configuredAudioMaxBitrateKbps ?? null;
        input.onStatsSample?.({
          peerId: payload.peerId,
          sample: {
            ...mergedSample,
            configuredAudioMaxBitrateKbps: configured
          }
        });
        this.observeMediaHealth(payload.peerId, mergedSample);
      },
      samplePeerConnectionStats
    });
    this.healthMonitor = new MeshHealthMonitor({
      autoReconnect: input.autoReconnect,
      reconnectBackoffMs: [1_000, 2_000, 4_000, 8_000],
      dataOpenTimeoutMs: 8_000,
      dataConnectingTimeoutMs: 12_000,
      connectionProgressTimeoutMs: 15_000,
      isExpectedPeer: (peerId) => this.peerConnections.expects(peerId),
      getPeerEntry: (peerId) => this.peerConnections.get(peerId),
      onPeerStalled: input.onPeerStalled,
      releasePeer: (peerId, entry) => this.releasePeer(peerId, entry),
      recreatePeer: (peerId, entry) => this.recreatePeer(peerId, entry)
    });
  }

  async syncPeers(
    remotePeerIds: string[],
    options?: { forceReconnectDegraded?: boolean }
  ) {
    const nextPeers = this.peerConnections.setExpectedRemotePeerIds(remotePeerIds);

    for (const peerId of nextPeers) {
      const existing = this.peerConnections.get(peerId, "data");
      if (
        existing &&
        (options?.forceReconnectDegraded || this.shouldRestartPeerEntry(existing))
      ) {
        await this.recreatePeer(peerId, existing);
      }

      if (!existing) {
        await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId), "data");
      }

      const dataEntry = this.peerConnections.get(peerId, "data");
      if (dataEntry) {
        this.schedulePeerWatchdog(peerId, dataEntry);
      }
      // Always pass media peers through ensurePeer. Unlike the data path, this
      // used to reuse a failed/closed media entry and leave a new listener
      // with a permanently missing receiver track.
      const mediaEntry = await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId), "media");
      this.scheduleMediaWatchdog(peerId, mediaEntry);
      void this.enqueueMediaOperation(peerId, mediaEntry);
    }

    for (const [peerId, entry] of this.peerConnections.allEntries()) {
      if (!nextPeers.has(peerId)) {
        this.releasePeer(peerId, entry);
      }
    }
  }

  getPeerEntry(peerId: string, linkKind: PeerLinkKind = "data") {
    return this.peerConnections.get(peerId, linkKind);
  }

  getPeerIdForEntry(entry: PeerEntry) {
    return this.peerConnections.allEntries().find(([, currentEntry]) => currentEntry === entry)?.[0] ?? null;
  }

  getConnectedPeerIds() {
    return this.peerConnections.getConnectedPeerIds();
  }

  getPeerMediaState(peerId: string): PeerMediaState | null {
    const entry = this.peerConnections.get(peerId, "media");
    if (!entry) {
      return null;
    }
    this.recoverRemoteAudioTrackFromReceiver(peerId, entry);
    return {
      senderTrackState: entry.senderTrackState,
      receiverTrackState: entry.receiverTrackState,
      remoteStream: entry.remoteAudioStream,
      remoteTrackId: entry.remoteAudioTrackId,
      receiverRtpActive: entry.receiverRtpActive ||
        (this.latestMediaSamples.get(peerId)?.mediaReceiveBitrateKbps ?? 0) > 0,
      sourcePeerId: entry.remoteAudioStream ? peerId : null
    };
  }

  setLocalAudioStream(
    stream: MediaStream | null,
    sourcePeerId: string | null,
    maxBitrateKbps: number | null = null
  ) {
    const normalizedBitrateKbps = normalizeAudioBitrateKbps(maxBitrateKbps);
    const previousTrack = this.localAudioStream?.getAudioTracks()[0] ?? null;
    const nextTrack = stream?.getAudioTracks()[0] ?? null;
    if (
      this.localAudioStream === stream &&
      this.localAudioSourcePeerId === sourcePeerId &&
      this.localAudioMaxBitrateKbps === normalizedBitrateKbps &&
      previousTrack === nextTrack &&
      (nextTrack === null || nextTrack.readyState === "live")
    ) {
      return;
    }
    this.localAudioStream = stream;
    this.localAudioSourcePeerId = sourcePeerId;
    this.localAudioMaxBitrateKbps = normalizedBitrateKbps;
    for (const [peerId, entry] of this.peerConnections.entries("media")) {
      if (maxBitrateKbps === null) {
        entry.configuredAudioMaxBitrateKbps = null;
      }
      if (peerId === sourcePeerId) {
        this.clearMediaWatchdog(entry);
        this.scheduleMediaWatchdog(peerId, entry);
      }
      void this.enqueueMediaOperation(peerId, entry);
    }
  }

  async getOrCreatePeerEntry(peerId: string, linkKind: PeerLinkKind = "data") {
    return this.peerConnections.get(peerId, linkKind) ??
      (await this.ensurePeer(peerId, false, linkKind));
  }

  runPeerOperation<T>(entry: PeerEntry, task: () => Promise<T>) {
    return enqueuePeerOperation(entry, task);
  }

  async flushPendingCandidates(entry: PeerEntry) {
    await flushPendingCandidates(entry);
  }

  setStatsSamplingMode(mode: "off" | "steady" | "active") {
    this.statsSampler.setMode(mode, this.peerConnections.allEntries().map(([peerId, entry]) => [peerId, entry] as [string, PeerEntry]));
  }

  async restartPeer(peerId: string) {
    const entry = this.peerConnections.get(peerId, "data");
    if (!entry) {
      if (!this.peerConnections.expects(peerId)) {
        return null;
      }
      return this.ensurePeer(peerId, this.shouldInitiatePeer(peerId), "data");
    }

    return this.recreatePeer(peerId, entry);
  }

  async restartIce(peerId: string) {
    const entry = this.peerConnections.get(peerId, "data");
    if (!entry || entry.releasing) {
      return null;
    }
    return enqueuePeerOperation(entry, async () => {
      if (entry.releasing || entry.connection.signalingState !== "stable") {
        return null;
      }
      await this.signaling.createAndSendOffer(peerId, entry.connection, { iceRestart: true }, "data");
      entry.lastSignalProgressAtMs = Date.now();
      return entry;
    });
  }

  async restartMediaPeer(peerId: string) {
    const entry = this.peerConnections.get(peerId, "media");
    if (!entry || entry.releasing) {
      // A recovery-created media peer must actively announce itself. The
      // normal lexical initiator rule is only for the initial topology sync;
      // otherwise a listener can create a new recv peer and wait forever for
      // an offer from the source that still owns the old peer.
      return this.ensurePeer(peerId, true, "media");
    }

    const now = Date.now();
    const staleSignal = now - entry.lastSignalProgressAtMs >= 8_000;
    const missingExpectedTrack = this.hasExpectedRemoteAudioTrack(peerId) &&
      entry.receiverTrackState !== "live" &&
      now - entry.lastSignalProgressAtMs >= mediaTrackWatchdogGraceMs;
    if (
      entry.connection.connectionState === "failed" ||
      entry.connection.connectionState === "closed" ||
      (entry.connection.signalingState !== "stable" && staleSignal) ||
      (entry.connection.signalingState === "stable" && missingExpectedTrack)
    ) {
      const reconnectAttempts = entry.reconnectAttempts;
      this.releasePeer(peerId, entry);
      const nextEntry = await this.ensurePeer(peerId, true, "media");
      nextEntry.reconnectAttempts = reconnectAttempts + 1;
      return nextEntry;
    }

    // Let the initial offer/answer exchange finish before creating another
    // offer. The media watchdog will retry if the track still does not arrive.
    if (
      this.hasExpectedRemoteAudioTrack(peerId) &&
      entry.receiverTrackState !== "live" &&
      now - entry.lastSignalProgressAtMs < mediaTrackWatchdogGraceMs
    ) {
      this.scheduleMediaWatchdog(peerId, entry);
      return entry;
    }

    return enqueuePeerOperation(entry, async () => {
      if (entry.releasing || entry.connection.signalingState !== "stable") {
        return null;
      }

      await this.signaling.createAndSendOffer(
        peerId,
        entry.connection,
        { iceRestart: Boolean(entry.connection.remoteDescription) },
        "media"
      );
      entry.lastSignalProgressAtMs = Date.now();
      this.scheduleMediaWatchdog(peerId, entry);
      return entry;
    });
  }

  destroy() {
    this.peerConnections.clearExpected();
    for (const [peerId, entry] of this.peerConnections.allEntries()) {
      this.releasePeer(peerId, entry);
    }
    this.peerConnections.clearPeers();
  }

  schedulePeerWatchdog(peerId: string, entry: PeerEntry) {
    this.healthMonitor.schedulePeerWatchdog(peerId, entry);
  }

  schedulePeerReconnect(peerId: string, entry: PeerEntry) {
    this.healthMonitor.schedulePeerReconnect(peerId, entry);
  }

  private async ensurePeer(
    peerId: string,
    shouldInitiate: boolean,
    linkKind: PeerLinkKind = "data"
  ) {
    const existing = this.peerConnections.get(peerId, linkKind);

    if (existing) {
      const existingAction = resolveExistingPeerConnectionAction({
        entry: existing
      });
      if (existingAction === "release") {
        this.releasePeer(peerId, existing);
      } else {
        if (shouldInitiate && existing.initiatorPeerId === this.localPeerId) {
          return existing;
        }
        return existing;
      }
    }

    const connection = new RTCPeerConnection(
      buildPeerConnectionConfig({
        peerId,
        iceServers: this.iceServers,
        resolveConnectionConfig: this.resolveConnectionConfig
      })
    );
    const entry = createPeerEntry({
      connection,
      initiatorPeerId: shouldInitiate ? this.localPeerId : null,
      nowMs: Date.now(),
      linkKind
    });
    if (linkKind === "media" && typeof connection.addTransceiver === "function") {
      const transceiver = connection.addTransceiver("audio", {
        // Keep one bidirectional m-line for both source and listener roles.
        // The sender stream is attached explicitly when a source starts so
        // late joins and source changes still produce a usable ontrack event.
        direction: "sendrecv"
      });
      entry.audioTransceiver = transceiver;
      entry.audioSender = transceiver.sender;
      this.preferOpus(transceiver);
    }
    this.statsSampler.start(peerId, entry);

    bindPeerConnectionEvents({
      peerId,
      entry,
      localPeerId: this.localPeerId,
      connection,
      autoReconnect: this.autoReconnect,
      isCurrentEntry: (currentPeerId, currentEntry) =>
        this.peerConnections.get(currentPeerId, linkKind) === currentEntry,
      isExpectedPeer: (currentPeerId) => this.peerConnections.expects(currentPeerId),
      sendCandidate: (candidatePeerId, payload) =>
        this.signaling.send(candidatePeerId, "candidate", payload, linkKind),
      onPeerConnectionChange: (payload) => {
        this.onPeerConnectionChange?.(payload);
        if (payload.state === "connected") {
          if (linkKind === "media") {
            this.clearMediaDisconnectRecovery(payload.peerId);
            this.clearMediaWatchdog(entry);
            const hasOperationalMedia =
              entry.receiverTrackState === "live" ||
              (!this.hasExpectedRemoteAudioTrack(payload.peerId) &&
                entry.senderTrackState === "live") ||
              (this.latestMediaSamples.get(payload.peerId)?.mediaReceiveBitrateKbps ?? 0) > 0;
            if (hasOperationalMedia) {
              this.markMediaRecovered(payload.peerId);
            }
            void this.enqueueMediaOperation(payload.peerId, entry);
            if (this.hasExpectedRemoteAudioTrack(payload.peerId)) {
              this.scheduleMediaWatchdog(payload.peerId, entry);
            }
          }
        } else if (linkKind === "media" && payload.state === "failed" && !entry.releasing) {
          this.triggerMediaRecovery(payload.peerId, "connection-failed");
        } else if (linkKind === "media" && payload.state === "disconnected" && !entry.releasing) {
          this.scheduleMediaDisconnectRecovery(payload.peerId, entry);
        }
        if (
          linkKind === "media" &&
          payload.state !== "connected" &&
          !entry.releasing
        ) {
          this.scheduleMediaWatchdog(payload.peerId, entry);
        }
      },
      onIceConnectionStateChange: this.onIceConnectionStateChange,
      onPeerStalled: this.onPeerStalled,
      schedulePeerReconnect: (currentPeerId, currentEntry) =>
        this.schedulePeerReconnect(currentPeerId, currentEntry),
      schedulePeerWatchdog: (currentPeerId, currentEntry) =>
        this.schedulePeerWatchdog(currentPeerId, currentEntry),
      releasePeer: (currentPeerId, currentEntry) =>
        this.releasePeer(currentPeerId, currentEntry),
      bindChannel: (currentPeerId, currentEntry, channel) =>
        this.bindChannelCallback(currentPeerId, currentEntry, channel),
      onRemoteAudioTrack: this.onRemoteAudioTrack,
      onMediaStateChange: (payload) => {
        this.onMediaStateChange?.(payload);
        if (
          linkKind === "media" &&
          payload.direction === "receiver" &&
          payload.state === "live"
        ) {
          this.clearMediaWatchdog(entry);
          this.markMediaRecovered(payload.peerId);
        }
        if (
          linkKind === "media" &&
          payload.direction === "receiver" &&
          payload.state === "failed" &&
          !entry.releasing
        ) {
          this.triggerMediaRecovery(payload.peerId, "no-packets");
        }
      },
      onMediaTrackMuted: this.onMediaTrackMuted
    });

    this.peerConnections.set(peerId, entry, linkKind);
    if (linkKind === "data") {
      this.schedulePeerWatchdog(peerId, entry);
    } else {
      this.scheduleMediaWatchdog(peerId, entry);
    }
    try {
      if (shouldInitiate && linkKind === "data") {
        const controlChannel = connection.createDataChannel("music-room-control", {
          ordered: true
        });
        entry.channel = controlChannel;
        this.bindChannelCallback(peerId, entry, controlChannel);
        await enqueuePeerOperation(entry, async () => {
          await this.signaling.createAndSendOffer(peerId, connection);
          entry.lastSignalProgressAtMs = Date.now();
        });
      } else if (shouldInitiate && linkKind === "media") {
        await enqueuePeerOperation(entry, async () => {
          await this.syncLocalAudioToPeer(peerId, entry, false);
          try {
            await this.signaling.createAndSendOffer(peerId, connection, undefined, "media");
            entry.mediaNegotiationPending = false;
            entry.lastSignalProgressAtMs = Date.now();
            this.clearMediaSyncRetry(entry);
          } catch {
            this.scheduleMediaSyncRetry(peerId, entry);
          }
        });
      }

      return entry;
    } catch (error) {
      if (this.peerConnections.get(peerId, linkKind) === entry) {
        this.releasePeer(peerId, entry);
      }
      throw error;
    }
  }

  private releasePeer(peerId: string, entry: PeerEntry) {
    if (entry.linkKind === "media") {
      this.latestMediaSamples.delete(peerId);
      this.clearMediaDisconnectRecovery(peerId);
      // Keep recovery history while an expected media peer is being replaced.
      // Otherwise every failed recreation starts at attempt zero and the
      // listener can loop forever without reaching a stable retry path.
      if (!this.peerConnections.expects(peerId)) {
        this.mediaRecovery.delete(peerId);
      }
    }
    releasePeerConnectionEntry({
      peerId,
      entry,
      deleteIfCurrent: (currentPeerId, currentEntry) =>
        this.peerConnections.deleteIfCurrent(currentPeerId, currentEntry),
      clearPendingRequestsForPeer: this.clearPendingRequestsForPeerCallback,
      stopStatsSampling: (currentEntry) => this.statsSampler.stop(currentEntry),
      onDataBufferedAmountChange: this.onDataBufferedAmountChange
    });
  }

  private shouldRestartPeerEntry(entry: PeerEntry) {
    return shouldRestartPeer({
      entry,
      nowMs: Date.now(),
      dataOpenTimeoutMs: 8_000,
      dataConnectingTimeoutMs: 12_000,
      connectionProgressTimeoutMs: 15_000
    });
  }

  private async syncLocalAudioToPeer(
    peerId: string,
    entry: PeerEntry,
    renegotiate = true
  ) {
    if (entry.releasing) {
      return;
    }

    const desiredTrack =
      this.localAudioSourcePeerId === this.localPeerId
        ? this.localAudioStream?.getAudioTracks().find((track) => track.readyState === "live") ?? null
        : null;
    const currentTrack = entry.audioSender?.track ?? null;
    if (!desiredTrack && !entry.audioSender) {
      entry.senderTrackState = "none";
      return;
    }

    if (desiredTrack && !entry.audioSender) {
      if (typeof entry.connection.addTrack !== "function") {
        entry.senderTrackState = "failed";
        return;
      }
      entry.audioSender = entry.connection.addTrack(
        desiredTrack,
        this.localAudioStream ?? new MediaStream([desiredTrack])
      );
      entry.senderStreamId = this.localAudioStream?.id ?? null;
      entry.senderTrackState = "live";
      entry.mediaNegotiationPending = true;
      await this.applyAudioSenderParameters(entry.audioSender);
      this.onMediaStateChange?.({
        peerId,
        entry,
        direction: "sender",
        state: "live"
      });
      if (renegotiate && entry.connection.signalingState === "stable") {
        await this.signaling.createAndSendOffer(peerId, entry.connection, undefined, "media");
        entry.lastSignalProgressAtMs = Date.now();
        entry.mediaNegotiationPending = false;
      }
      return;
    }

    if (!entry.audioSender) {
      return;
    }

    const desiredStream = desiredTrack ? this.localAudioStream : null;
    if (
      desiredStream &&
      entry.senderStreamId !== desiredStream.id &&
      typeof entry.audioSender.setStreams === "function"
    ) {
      try {
        // addTransceiver creates a sender without an associated MediaStream.
        // Keep the stream id on the sender so the next SDP carries a stable
        // msid and the remote peer can reliably fire ontrack after a late
        // source start or media-peer recovery.
        entry.audioSender.setStreams(desiredStream);
        entry.senderStreamId = desiredStream.id;
        entry.mediaNegotiationPending = true;
      } catch {
        // setStreams is optional in older WebRTC implementations. The RTP
        // sender remains usable through replaceTrack below.
      }
    } else if (!desiredTrack) {
      entry.senderStreamId = null;
    }

    if (currentTrack !== desiredTrack) {
      try {
        await entry.audioSender.replaceTrack(desiredTrack);
        entry.senderTrackState = desiredTrack ? "live" : "none";
        // A track attached after the initial sendrecv offer still needs a
        // media re-offer so the remote peer receives the track identity/MSID
        // and fires ontrack. replaceTrack alone can leave a connected but
        // permanently silent receiver when the first offer had no track.
        entry.mediaNegotiationPending = true;
        await this.applyAudioSenderParameters(entry.audioSender);
        this.onMediaStateChange?.({
          peerId,
          entry,
          direction: "sender",
          state: entry.senderTrackState
        });
      } catch {
        entry.senderTrackState = "failed";
        this.onMediaStateChange?.({
          peerId,
          entry,
          direction: "sender",
          state: "failed"
        });
        this.scheduleMediaSyncRetry(peerId, entry);
      }
    }

    if (
      entry.audioSender &&
      entry.configuredAudioMaxBitrateKbps !== this.localAudioMaxBitrateKbps
    ) {
      await this.applyAudioSenderParameters(entry.audioSender);
      if (this.localAudioMaxBitrateKbps === null) {
        entry.configuredAudioMaxBitrateKbps = null;
      }
    }

    if (
      entry.mediaNegotiationPending &&
      renegotiate &&
      entry.connection.signalingState === "stable"
    ) {
      try {
        await this.signaling.createAndSendOffer(peerId, entry.connection, undefined, "media");
        entry.lastSignalProgressAtMs = Date.now();
        entry.mediaNegotiationPending = false;
        this.clearMediaSyncRetry(entry);
      } catch {
        this.scheduleMediaSyncRetry(peerId, entry);
      }
    } else if (entry.mediaNegotiationPending && renegotiate) {
      this.scheduleMediaSyncRetry(peerId, entry);
    }
  }

  private enqueueMediaOperation(peerId: string, entry: PeerEntry) {
    const operation = enqueuePeerOperation(entry, () => this.syncLocalAudioToPeer(peerId, entry));
    void operation.catch(() => {
      this.scheduleMediaSyncRetry(peerId, entry);
    });
    return operation;
  }

  private scheduleMediaSyncRetry(peerId: string, entry: PeerEntry) {
    if (
      entry.releasing ||
      this.peerConnections.get(peerId, "media") !== entry ||
      entry.mediaSyncRetryTimerId !== null
    ) {
      return;
    }

    const attempt = Math.min(entry.mediaSyncRetryAttempts + 1, 8);
    entry.mediaSyncRetryAttempts = attempt;
    const delayMs = Math.min(2_000, 100 * 2 ** (attempt - 1));
    entry.mediaSyncRetryTimerId = setTimeout(() => {
      entry.mediaSyncRetryTimerId = null;
      if (
        entry.releasing ||
        this.peerConnections.get(peerId, "media") !== entry
      ) {
        return;
      }
      void this.enqueueMediaOperation(peerId, entry);
    }, delayMs);
  }

  private clearMediaSyncRetry(entry: PeerEntry) {
    if (entry.mediaSyncRetryTimerId !== null) {
      clearTimeout(entry.mediaSyncRetryTimerId);
      entry.mediaSyncRetryTimerId = null;
    }
    entry.mediaSyncRetryAttempts = 0;
  }

  private async applyAudioSenderParameters(
    sender: RTCRtpSender,
    effectiveMaxBitrateKbps: number | null = this.localAudioMaxBitrateKbps
  ) {
    if (effectiveMaxBitrateKbps === null || typeof sender.getParameters !== "function") {
      return;
    }
    const targetBitrateKbps = normalizeAudioBitrateKbps(effectiveMaxBitrateKbps);
    if (targetBitrateKbps === null) {
      return;
    }
    try {
      const parameters = sender.getParameters();
      const encodings = parameters.encodings?.length
        ? parameters.encodings
        : [{} as RTCRtpEncodingParameters];
      parameters.encodings = encodings.map((encoding) => ({
        ...encoding,
        maxBitrate: Math.round(targetBitrateKbps * 1000),
        dtx: "disabled",
        // Keep the audio sender ahead of best-effort SCTP traffic when both
        // RTP and a manual original-file transfer share the same ICE path.
        priority: "high",
        networkPriority: "high"
      }));
      try {
        await sender.setParameters(parameters);
      } catch {
        // Older browsers reject the optional priority fields. Retry with the
        // required bitrate only so a codec update never disables the sender.
        parameters.encodings = encodings.map((encoding) => ({
          ...encoding,
          maxBitrate: Math.round(targetBitrateKbps * 1000)
        }));
        await sender.setParameters(parameters);
      }
      for (const [, entry] of this.peerConnections.allEntries()) {
        if (entry.audioSender === sender) {
          entry.configuredAudioMaxBitrateKbps = this.localAudioMaxBitrateKbps;
          entry.appliedAudioBitrateKbps = targetBitrateKbps;
          break;
        }
      }
    } catch {
      // Browser codecs may reject a runtime bitrate update; RTP remains usable.
    }
  }

  private async recreatePeer(peerId: string, entry: PeerEntry) {
    const reconnectAttempts = entry.reconnectAttempts;
    this.releasePeer(peerId, entry);
    const nextEntry = await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId));
    nextEntry.reconnectAttempts = reconnectAttempts;
    return nextEntry;
  }

  /** Re-run media sender setup after an incoming SDP answer/offer is applied. */
  async notifyRemoteDescriptionApplied(
    peerId: string,
    entry: PeerEntry,
    remoteDescriptionType: "offer" | "answer"
  ) {
    if (entry.linkKind !== "media" || entry.releasing) {
      return;
    }
    if (remoteDescriptionType === "offer") {
      // An incoming offer is still being answered by the signaling operation.
       // Bind the local source before createAnswer. The media m-line was
       // negotiated as sendrecv, so changing the source never needs another
       // offer.
      await this.syncLocalAudioToPeer(peerId, entry, false);
      entry.mediaNegotiationPending = false;
      return;
    }
    void this.enqueueMediaOperation(peerId, entry);
  }

  private preferOpus(transceiver: RTCRtpTransceiver) {
    try {
      const capabilities = RTCRtpReceiver.getCapabilities?.("audio")?.codecs ?? [];
      const opus = capabilities.filter((codec) => /opus/i.test(codec.mimeType));
      if (opus.length > 0) {
        transceiver.setCodecPreferences?.(opus);
      }
    } catch {
      // Codec preference APIs are optional; normal SDP negotiation still works.
    }
  }

  private observeMediaHealth(peerId: string, sample: PeerConnectionStatsSample) {
    const entry = this.peerConnections.get(peerId, "media");
    if (!entry || entry.releasing) {
      return;
    }
    const mediaObserved = entry.senderTrackState === "live" ||
      entry.receiverTrackState === "live" ||
      (sample.mediaReceiveBitrateKbps ?? 0) > 0 ||
      (sample.mediaSendBitrateKbps ?? 0) > 0;
    if (!mediaObserved) {
      return;
    }
    const state = this.mediaRecovery.get(peerId) ?? createMediaRecoveryState();
    const loss = sample.packetLossRate ?? 0;
    const jitter = sample.jitterMs ?? 0;
    // A null bitrate means that the browser did not provide a comparable
    // stats sample yet. Treating it as zero creates false recovery cycles,
    // especially for a source that joined as the non-initiating peer.
    const noReceivePackets = entry.receiverTrackState === "live" &&
      sample.mediaReceiveBitrateKbps !== null &&
      sample.mediaReceiveBitrateKbps <= 0;
    const noSendPackets = entry.senderTrackState === "live" &&
      sample.mediaSendBitrateKbps !== null &&
      sample.mediaSendBitrateKbps <= 0;
    const localSourceIsActive = this.localAudioSourcePeerId === this.localPeerId &&
      !!this.localAudioStream?.getAudioTracks().some((track) => track.readyState === "live");
    state.degradedWindows = loss >= 3 || jitter >= 20 ? state.degradedWindows + 1 : 0;
    state.noPacketWindows = noReceivePackets ? state.noPacketWindows + 1 : 0;
    state.noSendPacketWindows = noSendPackets ? state.noSendPacketWindows + 1 : 0;
    if ((sample.mediaReceiveBitrateKbps ?? 0) > 0) {
      entry.receiverRtpActive = true;
      this.markMediaRecovered(peerId);
    } else if (noReceivePackets && state.noPacketWindows >= 1) {
      entry.receiverRtpActive = false;
    }
    if (localSourceIsActive && noSendPackets && state.noSendPacketWindows === 1) {
      // Keep the source peer alive. A zero outbound sample can be a silent
      // audio window or a stats gap; refresh the sender binding without
      // tearing down the ICE/DTLS connection that is still carrying media.
      void this.enqueueMediaOperation(peerId, entry);
    }
    state.highLossWindows = loss >= 5 ? state.highLossWindows + 1 : 0;
    state.highJitterWindows = jitter >= 30 ? state.highJitterWindows + 1 : 0;
    const reason = (
      (noReceivePackets && state.noPacketWindows >= 2) ||
      (!localSourceIsActive && noSendPackets && state.noSendPacketWindows >= 2)
    )
      ? "no-packets" as const
      : state.highLossWindows >= 3
        ? "loss" as const
        : state.highJitterWindows >= 3
          ? "jitter" as const
          : state.degradedWindows >= 3
            ? "loss" as const
            : null;
    if (!reason) {
      this.mediaRecovery.set(peerId, state);
      return;
    }
    this.mediaRecovery.set(peerId, state);
    this.triggerMediaRecovery(peerId, reason);
  }

  private scheduleMediaDisconnectRecovery(peerId: string, entry: PeerEntry) {
    const state = this.mediaRecovery.get(peerId) ?? createMediaRecoveryState();
    if (state.disconnectedTimerId !== null) {
      return;
    }
    state.disconnectedTimerId = setTimeout(() => {
      state.disconnectedTimerId = null;
      if (
        !entry.releasing &&
        (entry.connection.connectionState === "disconnected" ||
          entry.connection.iceConnectionState === "disconnected")
      ) {
        this.triggerMediaRecovery(peerId, "connection-failed");
      }
    }, 2_000);
    this.mediaRecovery.set(peerId, state);
  }

  private scheduleMediaWatchdog(peerId: string, entry: PeerEntry) {
    if (entry.linkKind !== "media" || entry.releasing || entry.mediaWatchdogTimerId !== null) {
      return;
    }

    const watchdogDelayMs =
      entry.connection.connectionState === "connected" &&
      this.hasExpectedRemoteAudioTrack(peerId)
        ? mediaTrackWatchdogGraceMs
        : 8_000;
    entry.mediaWatchdogTimerId = setTimeout(() => {
      entry.mediaWatchdogTimerId = null;
      if (
        entry.releasing ||
        this.peerConnections.get(peerId, "media") !== entry
      ) {
        return;
      }

      const waitingForRemoteTrack =
        entry.connection.connectionState === "connected" &&
        this.hasExpectedRemoteAudioTrack(peerId) &&
        entry.receiverTrackState !== "live";
      if (waitingForRemoteTrack) {
        const waitingForMs = Date.now() - entry.lastSignalProgressAtMs;
        if (waitingForMs < mediaTrackWatchdogGraceMs) {
          this.scheduleMediaWatchdog(peerId, entry);
          return;
        }
        if (
          entry.connection.signalingState !== "stable" &&
          waitingForMs < 8_000
        ) {
          // Let an in-flight answer finish before declaring negotiation lost.
          // The timer must be kept alive; otherwise have-local-offer can leave
          // the listener waiting forever when the answer is delayed.
          this.scheduleMediaWatchdog(peerId, entry);
          return;
        }

        // ICE can be connected while the media m-line/track negotiation was
        // lost. Re-offer the media peer so the receiver gets ontrack without
        // disturbing the already healthy data peer.
        this.triggerMediaRecovery(peerId, "no-packets");
        return;
      }

      if (entry.connection.connectionState === "connected") {
        return;
      }

      const now = Date.now();
      const staleForMs = now - entry.lastSignalProgressAtMs;
      const ageMs = now - entry.createdAtMs;
      if (staleForMs < 8_000 && ageMs < 15_000) {
        this.scheduleMediaWatchdog(peerId, entry);
        return;
      }

      // A lost offer/answer can leave a perfectly healthy data connection
      // with a media connection stuck in new/checking/have-local-offer. A
      // media-only offer retries that path without touching DataChannel.
      this.triggerMediaRecovery(peerId, "connection-failed");
    }, watchdogDelayMs);
  }

  private clearMediaWatchdog(entry: PeerEntry) {
    if (entry.mediaWatchdogTimerId === null) {
      return;
    }
    clearTimeout(entry.mediaWatchdogTimerId);
    entry.mediaWatchdogTimerId = null;
  }

  private clearMediaDisconnectRecovery(peerId: string) {
    const state = this.mediaRecovery.get(peerId);
    if (!state || state.disconnectedTimerId === null) {
      return;
    }
    clearTimeout(state.disconnectedTimerId);
    state.disconnectedTimerId = null;
    this.mediaRecovery.set(peerId, state);
  }

  private triggerMediaRecovery(
    peerId: string,
    reason: "loss" | "jitter" | "no-packets" | "connection-failed"
  ) {
    const entry = this.peerConnections.get(peerId, "media");
    if (!entry || entry.releasing) {
      return;
    }
    const state = this.mediaRecovery.get(peerId) ?? createMediaRecoveryState();
    const now = Date.now();
    state.restartTimesMs = state.restartTimesMs.filter((timestamp) => now - timestamp < 30_000);
    const lastRecoveryAtMs = state.restartTimesMs[state.restartTimesMs.length - 1] ?? null;
    if (lastRecoveryAtMs !== null && now - lastRecoveryAtMs < mediaRecoveryCooldownMs) {
      this.mediaRecovery.set(peerId, state);
      this.scheduleMediaWatchdog(peerId, entry);
      return;
    }
    if (
      entry.connection.signalingState !== "stable" &&
      Date.now() - entry.lastSignalProgressAtMs < 8_000
    ) {
      this.mediaRecovery.set(peerId, state);
      this.scheduleMediaWatchdog(peerId, entry);
      return;
    }
    state.restartTimesMs.push(now);
    state.degradedWindows = 0;
    state.noPacketWindows = 0;
    state.noSendPacketWindows = 0;
    state.highLossWindows = 0;
    state.highJitterWindows = 0;
    const restartCount = state.restartTimesMs.length;
    const shouldReportFailure = restartCount >= 2 &&
      (state.failureReportedAtMs === null || now - state.failureReportedAtMs >= 30_000);
    if (shouldReportFailure) {
      state.failureReportedAtMs = now;
    }
    this.mediaRecovery.set(peerId, state);
    this.onMediaRecovery?.({
      peerId,
      reason: shouldReportFailure ? "connection-failed" : reason,
      restartCount
    });
    void this.restartMediaPeer(peerId);
  }

  private markMediaRecovered(peerId: string) {
    const state = this.mediaRecovery.get(peerId);
    if (!state) {
      return;
    }
    state.degradedWindows = 0;
    state.noPacketWindows = 0;
    state.noSendPacketWindows = 0;
    state.highLossWindows = 0;
    state.highJitterWindows = 0;
    state.restartTimesMs = [];
    state.failureReportedAtMs = null;
    this.mediaRecovery.set(peerId, state);
  }

  private hasExpectedRemoteAudioTrack(peerId: string) {
    return this.localAudioSourcePeerId !== null &&
      this.localAudioSourcePeerId !== this.localPeerId &&
      this.localAudioSourcePeerId === peerId;
  }

  private recoverRemoteAudioTrackFromReceiver(peerId: string, entry: PeerEntry) {
    if (entry.remoteAudioStream || entry.releasing) {
      return;
    }

    let receiver = entry.audioReceiver;
    if (!receiver) {
      try {
        const receivers = entry.connection.getReceivers?.() ?? [];
        receiver = receivers.find((candidate) => candidate.track?.kind === "audio") ?? null;
      } catch {
        return;
      }
    }

    const track = receiver?.track;
    if (!receiver || !track || track.kind !== "audio" || track.readyState !== "live") {
      return;
    }

    // Chromium can expose the receiver track before delivering ontrack after
    // a renegotiation. Adopt it on the next runtime poll so a connected media
    // Peer cannot remain permanently silent just because that event was lost.
    try {
      entry.audioReceiver = receiver;
      entry.remoteAudioStream = new MediaStream([track]);
      entry.remoteAudioTrackId = track.id;
      entry.receiverTrackState = "live";
      entry.receiverRtpActive = track.muted !== true;
      this.clearMediaWatchdog(entry);
      this.markMediaRecovered(peerId);
    } catch {
      // MediaStream construction is unavailable only in non-browser test or
      // embedded environments; the normal ontrack path remains intact.
    }
  }

  private shouldInitiatePeer(peerId: string) {
    return shouldInitiatePeerConnection(this.localPeerId, peerId);
  }
}

function normalizeAudioBitrateKbps(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value);
}
