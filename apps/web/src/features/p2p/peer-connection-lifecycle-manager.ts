import type {
  IceServerConfig
} from "@music-room/shared";
import {
  SignalingTransport,
  type PeerLinkKind,
  type SignalType
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
import {
  audioBitrateDegradationConfirmWindows,
  hasAudioNetworkDegradationSignal,
  maximumAudioBitrateKbps,
  resolveAggregateAudioBitratesKbps,
  type AggregateAudioBitrateInput
} from "./audio-bitrate-policy";

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
    linkKind?: PeerLinkKind;
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
  lastMediaReceivePacketAtMs: number | null;
  lastMediaSendPacketAtMs: number | null;
  highLossWindows: number;
  highJitterWindows: number;
  positiveMediaWindows: number;
  restartTimesMs: number[];
  failureReportedAtMs: number | null;
  disconnectedTimerId: ReturnType<typeof setTimeout> | null;
};

const mediaTrackWatchdogGraceMs = 3_000;
const mediaRecoveryCooldownMs = 3_000;
const mediaNoReceiveRecoveryWindows = 4;
const mediaNoSendRecoveryWindows = 4;
const mediaRecoveryHealthyLossThreshold = 3;
const mediaRecoveryHealthyJitterThreshold = 20;
const incomingMediaAdmissionGraceMs = 8_000;

function createMediaRecoveryState(): MediaRecoveryState {
  return {
    degradedWindows: 0,
    noPacketWindows: 0,
    noSendPacketWindows: 0,
    lastMediaReceivePacketAtMs: null,
    lastMediaSendPacketAtMs: null,
    highLossWindows: 0,
    highJitterWindows: 0,
    positiveMediaWindows: 0,
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
  private readonly audioBitrateDegradationWindows = new Map<string, number>();
  private readonly mediaRecoveryOperations = new Map<string, Promise<PeerEntry | null>>();
  private readonly provisionalIncomingMediaTimers = new WeakMap<
    PeerEntry,
    ReturnType<typeof setTimeout>
  >();
  private readonly pendingIncomingMediaAdmissionPeerIds = new Set<string>();
  private connectionGenerationSequence = 0;
  private localAudioStream: MediaStream | null = null;
  private localAudioSourcePeerId: string | null = null;
  private localAudioMaxBitrateKbps: number | null = null;
  private expectedRemotePeerIds = new Set<string>();
  // Before the first authoritative member snapshot arrives, an incoming offer
  // can legitimately beat topology reconciliation. Once initialized, only
  // explicitly expected peers may allocate a new RTCPeerConnection.
  private topologyInitialized = false;
  private topologyOperationChain: Promise<void> = Promise.resolve();
  private destroyed = false;

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
      activeStatsSamplingIntervalMs: 750,
      steadyStatsSamplingIntervalMs: 2_000,
      onStatsSample: (payload) => {
        const mediaEntry = this.peerConnections.get(payload.peerId, "media");
        const isMediaSample = payload.linkKind === "media" && !!mediaEntry;
        if (isMediaSample) {
          this.latestMediaSamples.set(payload.peerId, payload.sample);
        }
        const configured = this.peerConnections.get(payload.peerId, "media")?.configuredAudioMaxBitrateKbps ??
          this.peerConnections.get(payload.peerId)?.configuredAudioMaxBitrateKbps ?? null;
        input.onStatsSample?.({
          peerId: payload.peerId,
          linkKind: payload.linkKind,
          sample: {
            ...payload.sample,
            configuredAudioMaxBitrateKbps: configured
          }
        });
        if (isMediaSample) {
          this.adaptAudioBitrate(payload.peerId, mediaEntry, payload.sample);
          this.observeMediaHealth(payload.peerId, payload.sample);
        }
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
      recreatePeer: (peerId, entry) => this.enqueueTopologyOperation(() =>
        this.recreatePeerNow(peerId, entry)
      )
    });
  }

  syncPeers(
    remotePeerIds: string[],
    options?: { forceReconnectDegraded?: boolean }
  ) {
    if (this.destroyed) {
      return Promise.resolve();
    }
    return this.enqueueTopologyOperation(() => this.syncPeersNow(remotePeerIds, options));
  }

  private async syncPeersNow(
    remotePeerIds: string[],
    options?: { forceReconnectDegraded?: boolean }
  ) {
    if (this.destroyed) {
      return;
    }
    const nextPeers = this.peerConnections.setExpectedRemotePeerIds(remotePeerIds);
    this.expectedRemotePeerIds = nextPeers;
    this.topologyInitialized = true;

    for (const peerId of nextPeers) {
      const existing = this.peerConnections.get(peerId, "data");
      if (
        existing &&
        (options?.forceReconnectDegraded || this.shouldRestartPeerEntry(existing))
      ) {
        await this.recreatePeerNow(peerId, existing);
      }

      if (!existing) {
        await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId), "data");
      }

      const dataEntry = this.peerConnections.get(peerId, "data");
      if (dataEntry) {
        this.schedulePeerWatchdog(peerId, dataEntry);
      }
    }

    for (const [peerId, entry] of this.peerConnections.allEntries()) {
      const expected = entry.linkKind === "data"
        ? nextPeers.has(peerId)
        : this.expectedMediaPeerIds().has(peerId);
      if (entry.linkKind === "media" && expected) {
        this.clearProvisionalIncomingMediaAdmission(entry);
      }
      if (
        !expected &&
        !(entry.linkKind === "media" && (
          this.hasProvisionalIncomingMediaAdmission(entry) ||
          this.pendingIncomingMediaAdmissionPeerIds.has(peerId)
        ))
      ) {
        this.releasePeer(peerId, entry);
      }
    }

    await this.reconcileMediaTopology();
  }

  private enqueueTopologyOperation<T>(task: () => Promise<T>) {
    const operation = this.topologyOperationChain.then(task, task);
    this.topologyOperationChain = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private expectedMediaPeerIds() {
    const expected = new Set<string>();
    if (this.localAudioSourcePeerId === this.localPeerId) {
      // Keep media fanout peers for as long as we are the active source, even
      // before the broadcast MediaStreamTrack is live. Gating topology on a
      // live track released every listener media PC whenever the destination
      // was briefly missing (local-audio resolve, underrun recovery, etc.) and
      // forced a connect → audible → silent recovery loop.
      for (const peerId of this.expectedRemotePeerIds) {
        expected.add(peerId);
      }
      return expected;
    }

    if (
      this.localAudioSourcePeerId !== null &&
      this.expectedRemotePeerIds.has(this.localAudioSourcePeerId)
    ) {
      expected.add(this.localAudioSourcePeerId);
    }
    return expected;
  }

  private isIncomingPeerAdmitted(
    peerId: string,
    linkKind: PeerLinkKind,
    signalType?: SignalType
  ) {
    if (!this.topologyInitialized) {
      return true;
    }
    // The playback snapshot can identify the active source before the member
    // presence update adds that source to expectedRemotePeerIds. Do not drop
    // its first media offer in that window; the provisional admission below
    // will be promoted when topology catches up or released on timeout.
    if (
      linkKind === "media" &&
      this.localAudioSourcePeerId !== null &&
      this.localAudioSourcePeerId === peerId
    ) {
      return true;
    }
    if (!this.expectedRemotePeerIds.has(peerId)) {
      // On a late join, the source offer can arrive before either the
      // playback snapshot or the member presence patch. Keep this exception
      // limited to media negotiation signals and only while no source is
      // known; data peers and stale answers remain strictly topology-bound.
      return linkKind === "media" &&
        this.localAudioSourcePeerId === null &&
        (signalType === "offer" || signalType === "candidate");
    }
    if (linkKind === "data") {
      return true;
    }

    // A newly joined listener can receive the source's media offer before its
    // playback snapshot has populated localAudioSourcePeerId. Admit media
    // signals from known room members during that short window; once a source
    // is known, keep the active-source admission check strict.
    return this.localAudioSourcePeerId === null || this.expectedMediaPeerIds().has(peerId);
  }

  private hasLiveLocalAudioTrack() {
    return !!this.localAudioStream?.getAudioTracks().some((track) => track.readyState === "live");
  }

  private provisionallyAdmitIncomingMedia(peerId: string, entry: PeerEntry) {
    this.clearProvisionalIncomingMediaAdmission(entry);
    const timer = setTimeout(() => {
      this.provisionalIncomingMediaTimers.delete(entry);
      if (
        entry.releasing ||
        this.peerConnections.get(peerId, "media") !== entry ||
        this.expectedMediaPeerIds().has(peerId)
      ) {
        return;
      }
      this.releasePeer(peerId, entry);
    }, incomingMediaAdmissionGraceMs);
    this.provisionalIncomingMediaTimers.set(entry, timer);
  }

  private hasProvisionalIncomingMediaAdmission(entry: PeerEntry) {
    return this.provisionalIncomingMediaTimers.has(entry);
  }

  private clearProvisionalIncomingMediaAdmission(entry: PeerEntry) {
    const timer = this.provisionalIncomingMediaTimers.get(entry);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.provisionalIncomingMediaTimers.delete(entry);
    }
  }

  private async reconcileMediaTopology() {
    if (this.destroyed) {
      return;
    }
    const expectedMedia = this.expectedMediaPeerIds();
    for (const [peerId, entry] of this.peerConnections.entries("media")) {
      if (expectedMedia.has(peerId)) {
        this.clearProvisionalIncomingMediaAdmission(entry);
      } else if (
        !this.hasProvisionalIncomingMediaAdmission(entry) &&
        !this.pendingIncomingMediaAdmissionPeerIds.has(peerId)
      ) {
        this.releasePeer(peerId, entry);
      }
    }

    for (const peerId of expectedMedia) {
      const entry = await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId), "media");
      this.scheduleMediaWatchdog(peerId, entry);
      await this.enqueueMediaOperation(peerId, entry).catch(() => undefined);
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
    this.recoverRemoteAudioTrackFromReceiver(entry);
    const remoteTrack = entry.audioReceiver?.track ??
      entry.remoteAudioStream?.getAudioTracks()[0] ??
      null;
    const receiverTrackState = entry.receiverTrackState === "failed" &&
      remoteTrack?.readyState === "live"
      ? "live"
      : entry.receiverTrackState;
    return {
      senderTrackState: entry.senderTrackState,
      // A muted receiver track is still usable. Keep the audio element bound
      // to it while RTP recovers so Chromium can use its jitter buffer instead
      // of entering the missing-track path for every loss burst.
      receiverTrackState,
      remoteStream: entry.remoteAudioStream,
      remoteTrackId: entry.remoteAudioTrackId,
      receiverRtpActive: entry.receiverRtpActive,
      sourcePeerId: entry.remoteAudioStream ? peerId : null
    };
  }

  setLocalAudioStream(
    stream: MediaStream | null,
    sourcePeerId: string | null,
    maxBitrateKbps: number | null = null
  ) {
    if (this.destroyed) {
      return;
    }
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
    void this.enqueueTopologyOperation(() => this.reconcileMediaTopology()).catch(() => undefined);
  }

  async getOrCreatePeerEntry(peerId: string, linkKind: PeerLinkKind = "data") {
    return this.peerConnections.get(peerId, linkKind) ??
      (await this.ensurePeer(peerId, false, linkKind));
  }

  async getOrCreateIncomingPeerEntry(
    peerId: string,
    linkKind: PeerLinkKind = "data",
    signalType?: SignalType
  ): Promise<PeerEntry | null> {
    if (this.destroyed || !this.isIncomingPeerAdmitted(peerId, linkKind, signalType)) {
      return null;
    }

    const existing = this.peerConnections.get(peerId, linkKind);
    if (existing && !existing.releasing) {
      return existing;
    }

    const shouldProvisionallyAdmit = linkKind === "media" &&
      !this.expectedMediaPeerIds().has(peerId);
    if (shouldProvisionallyAdmit) {
      // ensurePeer is async and yields even when it only allocates the local
      // RTCPeerConnection. Mark the peer before that yield so a concurrent
      // topology reconcile cannot release the entry before its timer exists.
      this.pendingIncomingMediaAdmissionPeerIds.add(peerId);
    }
    try {
      const entry = await this.ensurePeer(peerId, false, linkKind);
      if (shouldProvisionallyAdmit && !entry.releasing) {
        this.provisionallyAdmitIncomingMedia(peerId, entry);
      }
      return entry;
    } finally {
      if (shouldProvisionallyAdmit) {
        this.pendingIncomingMediaAdmissionPeerIds.delete(peerId);
      }
    }
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
    return this.enqueueTopologyOperation(() => this.restartPeerNow(peerId));
  }

  private async restartPeerNow(peerId: string) {
    const entry = this.peerConnections.get(peerId, "data");
    if (!entry) {
      if (!this.peerConnections.expects(peerId)) {
        return null;
      }
      return this.ensurePeer(peerId, this.shouldInitiatePeer(peerId), "data");
    }

    return this.recreatePeerNow(peerId, entry);
  }

  async restartIce(peerId: string) {
    return this.enqueueTopologyOperation(() => this.restartIceNow(peerId));
  }

  private async restartIceNow(peerId: string) {
    const entry = this.peerConnections.get(peerId, "data");
    if (!entry || entry.releasing) {
      return null;
    }
    return enqueuePeerOperation(entry, async () => {
      if (entry.releasing || entry.connection.signalingState !== "stable") {
        return null;
      }
      await this.signaling.createAndSendOffer(
        peerId,
        entry.connection,
        { iceRestart: true },
        "data",
        entry.connectionGeneration
      );
      entry.lastSignalProgressAtMs = Date.now();
      return entry;
    });
  }

  async restartMediaPeer(peerId: string, options?: { forceRecreate?: boolean }) {
    const inFlight = this.mediaRecoveryOperations.get(peerId);
    if (inFlight) {
      return inFlight;
    }

    // Topology reconciliation and media recovery both replace entries. Keep
    // them on one queue so a recovery cannot recreate a peer that a concurrent
    // source/topology update is about to release.
    const operation = this.enqueueTopologyOperation(() =>
      this.restartMediaPeerNow(peerId, options)
    );
    this.mediaRecoveryOperations.set(peerId, operation);
    try {
      return await operation;
    } finally {
      if (this.mediaRecoveryOperations.get(peerId) === operation) {
        this.mediaRecoveryOperations.delete(peerId);
      }
    }
  }

  private async restartMediaPeerNow(peerId: string, options?: { forceRecreate?: boolean }) {
    const entry = this.peerConnections.get(peerId, "media");
    if (!this.expectedMediaPeerIds().has(peerId)) {
      if (entry) {
        this.releasePeer(peerId, entry);
      }
      return null;
    }
    if (!entry || entry.releasing) {
      // A forced recovery-created media peer must actively announce itself;
      // a normal topology repair stays passive and lets the current source
      // create the first offer with its real audio track.
      const allowEmptyMediaOffer = options?.forceRecreate === true;
      const recoveryInitiator = allowEmptyMediaOffer
        ? true
        : this.shouldInitiatePeer(peerId);
      return this.ensurePeer(peerId, recoveryInitiator, "media", allowEmptyMediaOffer);
    }

    const now = Date.now();
    const staleSignal = now - entry.lastSignalProgressAtMs >= 8_000;
    const waitingForExpectedTrack = this.hasExpectedRemoteAudioTrack(peerId) &&
      entry.receiverTrackState !== "live";
    const missingExpectedTrack = waitingForExpectedTrack &&
      now - entry.lastSignalProgressAtMs >= mediaTrackWatchdogGraceMs;
    // forceRecreate may announce a replacement peer, but a missing remote
    // track alone must never recreate with an empty listener offer. That path
    // races the source track offer and recreates the sound/silence loop.
    const isLocalSource = this.localAudioSourcePeerId === this.localPeerId;
    const allowEmptyMediaOffer = options?.forceRecreate === true;
    const recoveryInitiator = allowEmptyMediaOffer
      ? true
      : this.shouldInitiatePeer(peerId);
    const connectionBroken =
      entry.connection.connectionState === "failed" ||
      entry.connection.connectionState === "closed";
    if (options?.forceRecreate || connectionBroken) {
      const reconnectAttempts = entry.reconnectAttempts;
      this.releasePeer(peerId, entry);
      const nextEntry = await this.ensurePeer(peerId, recoveryInitiator, "media", allowEmptyMediaOffer);
      nextEntry.reconnectAttempts = reconnectAttempts + 1;
      return nextEntry;
    }

    // Let the initial offer/answer exchange finish before creating another
    // offer. The media watchdog will retry once the track grace expires.
    if (waitingForExpectedTrack && !missingExpectedTrack) {
      this.scheduleMediaWatchdog(peerId, entry);
      return entry;
    }

    if (
      waitingForExpectedTrack &&
      entry.mediaMissingTrackRecoveryAttempted
    ) {
      // One recovery offer is enough to repair a lost late-join negotiation.
      // Repeating offers against a stable, connected peer creates offer glare
      // and repeatedly resets the receiver's jitter buffer without improving
      // the media path.
      return entry;
    }

    if (
      entry.connection.signalingState !== "stable" &&
      staleSignal
    ) {
      const reconnectAttempts = entry.reconnectAttempts;
      this.releasePeer(peerId, entry);
      const nextEntry = await this.ensurePeer(peerId, recoveryInitiator, "media", allowEmptyMediaOffer);
      nextEntry.reconnectAttempts = reconnectAttempts + 1;
      return nextEntry;
    }

    // Connected (or stable) but still missing the remote track: never recreate
    // the PeerConnection. Soft re-offers keep ICE/DTLS and the polite-peer
    // rollback path absorbs offer glare with the source.
    return enqueuePeerOperation(entry, async () => {
      if (entry.releasing || entry.connection.signalingState !== "stable") {
        return null;
      }

      if (isLocalSource) {
        await this.syncLocalAudioToPeer(peerId, entry, true);
      } else {
        await this.signaling.createAndSendOffer(
          peerId,
          entry.connection,
          { iceRestart: Boolean(entry.connection.remoteDescription) },
          "media",
          entry.connectionGeneration
        );
        if (waitingForExpectedTrack) {
          entry.mediaMissingTrackRecoveryAttempted = true;
        }
      }
      entry.lastSignalProgressAtMs = Date.now();
      this.scheduleMediaWatchdog(peerId, entry);
      return entry;
    });
  }

  destroy() {
    this.destroyed = true;
    this.peerConnections.clearExpected();
    this.expectedRemotePeerIds.clear();
    this.pendingIncomingMediaAdmissionPeerIds.clear();
    this.localAudioStream = null;
    this.localAudioSourcePeerId = null;
    this.localAudioMaxBitrateKbps = null;
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
    linkKind: PeerLinkKind = "data",
    allowEmptyMediaOffer = false
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
      connectionGeneration: ++this.connectionGenerationSequence,
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
      isExpectedPeer: (currentPeerId) => linkKind === "data"
        ? this.peerConnections.expects(currentPeerId)
        : this.expectedMediaPeerIds().has(currentPeerId) ||
          this.hasProvisionalIncomingMediaAdmission(entry),
      sendCandidate: (candidatePeerId, payload) =>
        this.signaling.send(
          candidatePeerId,
          "candidate",
          payload,
          linkKind,
          entry.connectionGeneration
        ),
      onPeerConnectionChange: (payload) => {
        this.onPeerConnectionChange?.(payload);
        if (payload.state === "connected") {
          if (linkKind === "media") {
            this.clearMediaDisconnectRecovery(payload.peerId);
            this.clearMediaWatchdog(entry);
            const hasOperationalMedia =
              (entry.receiverTrackState === "live" && entry.receiverRtpActive) ||
              (!this.hasExpectedRemoteAudioTrack(payload.peerId) &&
                entry.senderTrackState === "live") ||
              (this.latestMediaSamples.get(payload.peerId)?.mediaReceiveBitrateKbps ?? 0) > 0 ||
              (this.latestMediaSamples.get(payload.peerId)?.mediaSendBitrateKbps ?? 0) > 0;
            if (hasOperationalMedia) {
              this.markMediaRecovered(payload.peerId);
            }
            void this.enqueueMediaOperation(payload.peerId, entry);
            if (this.hasExpectedRemoteAudioTrack(payload.peerId)) {
              this.scheduleMediaWatchdog(payload.peerId, entry);
            }
          }
        } else if (
          linkKind === "media" &&
          (payload.state === "failed" || payload.state === "closed") &&
          !entry.releasing
        ) {
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
          if (entry.receiverRtpActive) {
            this.markMediaRecovered(payload.peerId);
          }
        }
        if (
          linkKind === "media" &&
          payload.direction === "receiver" &&
          payload.state === "ended" &&
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
          await this.signaling.createAndSendOffer(
            peerId,
            connection,
            undefined,
            "data",
            entry.connectionGeneration
          );
          entry.lastSignalProgressAtMs = Date.now();
        });
      } else if (
        linkKind === "media" &&
        (shouldInitiate ||
          (this.localAudioSourcePeerId === this.localPeerId && this.hasLiveLocalAudioTrack()))
      ) {
        await enqueuePeerOperation(entry, async () => {
          await this.syncLocalAudioToPeer(peerId, entry, false);
          // Do not negotiate an empty media m-line during topology sync. A
          // listener-created sendrecv offer with no source track races with
          // the real source offer when playback starts, leaving both peers in
          // have-local-offer and the listener without an ontrack event. The
          // source-side sync below will create the first offer once a live
          // track is attached; recovery offers remain available for an
          // already-established peer.
          if (!allowEmptyMediaOffer && !entry.audioSender?.track) {
            return;
          }
          try {
            await this.signaling.createAndSendOffer(
              peerId,
              connection,
              undefined,
              "media",
              entry.connectionGeneration
            );
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
      this.clearProvisionalIncomingMediaAdmission(entry);
      this.latestMediaSamples.delete(peerId);
      this.audioBitrateDegradationWindows.delete(peerId);
      this.clearMediaDisconnectRecovery(peerId);
      // Keep recovery history while an expected media peer is being replaced.
      // Otherwise every failed recreation starts at attempt zero and the
      // listener can loop forever without reaching a stable retry path.
      if (!this.expectedMediaPeerIds().has(peerId)) {
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
        await this.signaling.createAndSendOffer(
          peerId,
          entry.connection,
          undefined,
          "media",
          entry.connectionGeneration
        );
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
        await this.signaling.createAndSendOffer(
          peerId,
          entry.connection,
          undefined,
          "media",
          entry.connectionGeneration
        );
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
      for (const [, entry] of this.peerConnections.allEntries()) {
        if (entry.audioSender === sender) {
          entry.configuredAudioMaxBitrateKbps = this.localAudioMaxBitrateKbps;
          entry.appliedAudioBitrateKbps = null;
          break;
        }
      }
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

  private adaptAudioBitrate(
    peerId: string,
    entry: PeerEntry | null,
    sample: PeerConnectionStatsSample
  ) {
    if (
      !entry ||
      entry.releasing ||
      !entry.audioSender?.track ||
      this.localAudioSourcePeerId !== this.localPeerId ||
      this.localAudioMaxBitrateKbps === null
    ) {
      return;
    }

    const degradationWindows = hasAudioNetworkDegradationSignal({
      packetLossRate: sample.packetLossRate ?? null,
      jitterMs: sample.jitterMs ?? null,
      roundTripTimeMs: sample.currentRoundTripTimeMs
    })
      ? Math.min(
          audioBitrateDegradationConfirmWindows,
          (this.audioBitrateDegradationWindows.get(peerId) ?? 0) + 1
        )
      : 0;
    if (degradationWindows > 0) {
      this.audioBitrateDegradationWindows.set(peerId, degradationWindows);
    } else {
      this.audioBitrateDegradationWindows.delete(peerId);
    }
    const nextKbps = this.resolveAggregateAudioBitrate(peerId, sample);
    const currentKbps = entry.appliedAudioBitrateKbps ?? this.localAudioMaxBitrateKbps;
    if (nextKbps === null || nextKbps === currentKbps) {
      return;
    }

    void enqueuePeerOperation(entry, async () => {
      if (
        entry.releasing ||
        entry.audioSender === null ||
        this.localAudioSourcePeerId !== this.localPeerId ||
        this.localAudioMaxBitrateKbps === null
      ) {
        return;
      }
      const latestKbps = this.resolveAggregateAudioBitrate(peerId, sample);
      if (latestKbps !== null && latestKbps !== entry.appliedAudioBitrateKbps) {
        await this.applyAudioSenderParameters(entry.audioSender, latestKbps);
      }
    }).catch(() => undefined);
  }

  private resolveAggregateAudioBitrate(
    peerId: string,
    fallbackSample: PeerConnectionStatsSample
  ) {
    if (this.localAudioMaxBitrateKbps === null) {
      return null;
    }

    const inputs: AggregateAudioBitrateInput[] = [];
    for (const [currentPeerId, currentEntry] of this.peerConnections.entries("media")) {
      if (currentEntry.releasing || !currentEntry.audioSender?.track) {
        continue;
      }
      const currentSample = currentPeerId === peerId
        ? fallbackSample
        : this.latestMediaSamples.get(currentPeerId);
      inputs.push({
        peerId: currentPeerId,
        requestedKbps: this.localAudioMaxBitrateKbps,
        currentKbps: currentEntry.appliedAudioBitrateKbps ?? this.localAudioMaxBitrateKbps,
        availableOutgoingBitrateKbps: currentSample?.availableOutgoingBitrateKbps ?? null,
        packetLossRate: currentSample?.packetLossRate ?? null,
        jitterMs: currentSample?.jitterMs ?? null,
        roundTripTimeMs: currentSample?.currentRoundTripTimeMs ?? null,
        degradedNetworkWindows: this.audioBitrateDegradationWindows.get(currentPeerId) ?? 0
      });
    }
    return resolveAggregateAudioBitratesKbps(inputs).get(peerId) ?? null;
  }

  private async recreatePeerNow(peerId: string, entry: PeerEntry): Promise<PeerEntry | null> {
    if (
      entry.linkKind !== "data" ||
      !this.expectedRemotePeerIds.has(peerId) ||
      this.peerConnections.get(peerId, "data") !== entry
    ) {
      return this.peerConnections.get(peerId, "data");
    }
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
    const previousReceivePacketAtMs = state.lastMediaReceivePacketAtMs;
    const previousSendPacketAtMs = state.lastMediaSendPacketAtMs;
    const currentReceivePacketAtMs = sample.lastMediaReceivePacketAtMs ?? null;
    const currentSendPacketAtMs = sample.lastMediaSendPacketAtMs ?? null;
    const receivePacketTimestampAdvanced = currentReceivePacketAtMs !== null &&
      (previousReceivePacketAtMs === null || currentReceivePacketAtMs > previousReceivePacketAtMs);
    const sendPacketTimestampAdvanced = currentSendPacketAtMs !== null &&
      (previousSendPacketAtMs === null || currentSendPacketAtMs > previousSendPacketAtMs);
    if (
      currentReceivePacketAtMs !== null &&
      (previousReceivePacketAtMs === null || currentReceivePacketAtMs >= previousReceivePacketAtMs)
    ) {
      state.lastMediaReceivePacketAtMs = currentReceivePacketAtMs;
    }
    if (
      currentSendPacketAtMs !== null &&
      (previousSendPacketAtMs === null || currentSendPacketAtMs >= previousSendPacketAtMs)
    ) {
      state.lastMediaSendPacketAtMs = currentSendPacketAtMs;
    }
    // A zero bitrate can be a rounded or delayed stats window. Only count it
    // as a packet outage after the browser has supplied a stable packet
    // timestamp and that timestamp stops advancing.
    const receivePacketTimestampStalled = currentReceivePacketAtMs !== null &&
      previousReceivePacketAtMs !== null &&
      !receivePacketTimestampAdvanced;
    const sendPacketTimestampStalled = currentSendPacketAtMs !== null &&
      previousSendPacketAtMs !== null &&
      !sendPacketTimestampAdvanced;
    const noReceivePackets = entry.receiverTrackState === "live" &&
      sample.mediaReceiveBitrateKbps !== null &&
      sample.mediaReceiveBitrateKbps <= 0 &&
      receivePacketTimestampStalled;
    const noSendPackets = entry.senderTrackState === "live" &&
      sample.mediaSendBitrateKbps !== null &&
      sample.mediaSendBitrateKbps <= 0 &&
      sendPacketTimestampStalled;
    const localSourceIsActive = this.localAudioSourcePeerId === this.localPeerId &&
      !!this.localAudioStream?.getAudioTracks().some((track) => track.readyState === "live");
    state.degradedWindows = loss >= 3 || jitter >= 20 ? state.degradedWindows + 1 : 0;
    state.noPacketWindows = noReceivePackets ? state.noPacketWindows + 1 : 0;
    state.noSendPacketWindows = noSendPackets ? state.noSendPacketWindows + 1 : 0;
    const hasPositiveMediaWindow =
      (sample.mediaReceiveBitrateKbps ?? 0) > 0 ||
      (sample.mediaSendBitrateKbps ?? 0) > 0;
    const hasHealthyMediaWindow = hasPositiveMediaWindow &&
      loss < mediaRecoveryHealthyLossThreshold &&
      jitter < mediaRecoveryHealthyJitterThreshold;
    this.mediaRecovery.set(peerId, state);
    if ((sample.mediaReceiveBitrateKbps ?? 0) > 0) {
      const wasReceiverLive = entry.receiverTrackState === "live";
      const wasReceiverRtpActive = entry.receiverRtpActive;
      this.recoverRemoteAudioTrackFromReceiver(entry);
      const receiverTrack = entry.audioReceiver?.track ??
        entry.remoteAudioStream?.getAudioTracks()[0] ??
        null;
      if (
        receiverTrack?.kind === "audio" &&
        receiverTrack.readyState === "live"
      ) {
        if (entry.receiverMuteTimerId !== null) {
          clearTimeout(entry.receiverMuteTimerId);
          entry.receiverMuteTimerId = null;
        }
        entry.receiverTrackState = "live";
      }
      entry.receiverRtpActive = true;
      if ((!wasReceiverLive || !wasReceiverRtpActive) && entry.receiverTrackState === "live") {
        this.onMediaStateChange?.({
          peerId,
          entry,
          direction: "receiver",
          state: "live"
        });
      }
    } else if (noReceivePackets && state.noPacketWindows >= 1) {
      entry.receiverRtpActive = false;
    }
    state.highLossWindows = loss >= 5 ? state.highLossWindows + 1 : 0;
    state.highJitterWindows = jitter >= 30 ? state.highJitterWindows + 1 : 0;
    if (hasHealthyMediaWindow) {
      this.markMediaRecovered(peerId);
    } else {
      state.positiveMediaWindows = 0;
      this.mediaRecovery.set(peerId, state);
    }
    if (localSourceIsActive && noSendPackets && state.noSendPacketWindows === 1) {
      // Keep the source peer alive. A zero outbound sample can be a silent
      // audio window or a stats gap; refresh the sender binding without
      // tearing down the ICE/DTLS connection that is still carrying media.
      void this.enqueueMediaOperation(peerId, entry);
    }
    const reason = (
      (noReceivePackets && state.noPacketWindows >= mediaNoReceiveRecoveryWindows) ||
      (noSendPackets && state.noSendPacketWindows >= mediaNoSendRecoveryWindows)
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
        if (entry.mediaMissingTrackRecoveryAttempted) {
          return;
        }
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
    const connectedLiveMediaHasPacketGap = reason === "no-packets" &&
      entry.connection.connectionState === "connected" &&
      (entry.senderTrackState === "live" || entry.receiverTrackState === "live");
    if (connectedLiveMediaHasPacketGap) {
      // ICE/DTLS is still healthy and the negotiated track is still usable.
      // Re-offering here tears down the receiver's jitter buffer and turns a
      // transient RTP/statistics gap into a repeating silence cycle. Keep the
      // existing track and let RTP/unmute or the connection-state watchdog
      // recover it; missing/ended tracks still take the recovery path below.
      state.noPacketWindows = 0;
      state.noSendPacketWindows = 0;
      this.mediaRecovery.set(peerId, state);
      return;
    }
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
    state.positiveMediaWindows = 0;
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
    void this.restartMediaPeer(peerId, {
      // A sender can remain "live" while its RTP pipeline is wedged. In that
      // state replaceTrack is a no-op, so recreate only this media peer after
      // several consecutive zero-rate samples.
      // A receiver with a live track must keep that PeerConnection and use an
      // ICE restart below; recreating it discards the jitter buffer and can
      // race the source's late-join offer into a permanent recovery loop.
      forceRecreate: reason === "no-packets" &&
        this.localAudioSourcePeerId === this.localPeerId &&
        entry.senderTrackState === "live" &&
        entry.connection.connectionState !== "connected"
    });
  }

  private markMediaRecovered(peerId: string) {
    const state = this.mediaRecovery.get(peerId);
    if (!state) {
      return;
    }
    // Do not clear recovery history merely because RTP still trickles in. The
    // caller has already classified this window as healthy, and the counters
    // below also protect connection-state callbacks that have no fresh stats.
    if (state.highLossWindows > 0 || state.highJitterWindows > 0) {
      state.positiveMediaWindows = 0;
      this.mediaRecovery.set(peerId, state);
      return;
    }
    state.positiveMediaWindows = Math.min(3, state.positiveMediaWindows + 1);
    if (state.positiveMediaWindows < 3) {
      this.mediaRecovery.set(peerId, state);
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

  private recoverRemoteAudioTrackFromReceiver(entry: PeerEntry) {
    if (entry.releasing) {
      return;
    }

    let receiver = entry.audioReceiver;
    if (
      !receiver?.track ||
      receiver.track.kind !== "audio" ||
      receiver.track.readyState !== "live"
    ) {
      try {
        const receivers = entry.connection.getReceivers?.() ?? [];
        receiver = receivers.find((candidate) =>
          candidate.track?.kind === "audio" && candidate.track.readyState === "live"
        ) ?? null;
      } catch {
        return;
      }
    }

    const track = receiver?.track;
    if (!receiver || !track || track.kind !== "audio" || track.readyState !== "live") {
      return;
    }

    const streamHasTrack = entry.remoteAudioStream?.getAudioTracks().some(
      (candidate) => candidate.id === track.id
    );
    if (entry.remoteAudioTrackId === track.id && streamHasTrack) {
      return;
    }

    // Chromium can expose the receiver track before delivering ontrack after
    // a renegotiation. Adopt it on the next runtime poll so a connected media
    // Peer cannot remain permanently silent just because that event was lost.
    try {
      entry.audioReceiver = receiver;
      if (!streamHasTrack) {
        entry.remoteAudioStream = new MediaStream([track]);
      }
      entry.remoteAudioTrackId = track.id;
      entry.receiverTrackState = "live";
      entry.receiverRtpActive = track.muted !== true;
      entry.mediaMissingTrackRecoveryAttempted = false;
      this.clearMediaWatchdog(entry);
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

  return Math.min(maximumAudioBitrateKbps, Math.round(value));
}
