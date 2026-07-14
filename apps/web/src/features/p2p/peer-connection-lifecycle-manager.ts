import type {
  IceServerConfig
} from "@music-room/shared";
import {
  SignalingTransport
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
  }) => void;
  onIceConnectionStateChange?: (payload: {
    peerId: string;
    state: RTCIceConnectionState;
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
};

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
    this.peerConnections = new PeerConnectionRegistry(input.localPeerId);
    this.statsSampler = new PeerStatsSampler({
      activeStatsSamplingIntervalMs: 1_000,
      steadyStatsSamplingIntervalMs: 5_000,
      onStatsSample: (payload) => {
        const configured = this.peerConnections.get(payload.peerId)?.configuredAudioMaxBitrateKbps ?? null;
        input.onStatsSample?.({
          peerId: payload.peerId,
          sample: {
            ...payload.sample,
            configuredAudioMaxBitrateKbps: configured
          }
        });
        void this.adaptAudioSenderBitrate(payload.peerId, payload.sample);
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
      const existing = this.peerConnections.get(peerId);
      if (
        existing &&
        (options?.forceReconnectDegraded || this.shouldRestartPeerEntry(existing))
      ) {
        await this.recreatePeer(peerId, existing);
        continue;
      }

      if (!existing) {
        await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId));
        continue;
      }

      this.schedulePeerWatchdog(peerId, existing);
      void this.enqueueMediaOperation(peerId, existing);
    }

    for (const [peerId, entry] of this.peerConnections.entries()) {
      if (!nextPeers.has(peerId)) {
        this.releasePeer(peerId, entry);
      }
    }
  }

  getPeerEntry(peerId: string) {
    return this.peerConnections.get(peerId);
  }

  getConnectedPeerIds() {
    return this.peerConnections.getConnectedPeerIds();
  }

  getPeerMediaState(peerId: string): PeerMediaState | null {
    const entry = this.peerConnections.get(peerId);
    if (!entry) {
      return null;
    }
    return {
      senderTrackState: entry.senderTrackState,
      receiverTrackState: entry.receiverTrackState,
      remoteStream: entry.remoteAudioStream,
      remoteTrackId: entry.remoteAudioTrackId,
      mediaSourcePeerId: entry.remoteAudioStream ? peerId : null
    };
  }

  setLocalAudioStream(
    stream: MediaStream | null,
    sourcePeerId: string | null,
    maxBitrateKbps: number | null = null
  ) {
    this.localAudioStream = stream;
    this.localAudioSourcePeerId = sourcePeerId;
    this.localAudioMaxBitrateKbps = maxBitrateKbps;
    for (const [peerId, entry] of this.peerConnections.entries()) {
      if (maxBitrateKbps === null) {
        entry.configuredAudioMaxBitrateKbps = null;
      }
      void this.enqueueMediaOperation(peerId, entry);
    }
  }

  async getOrCreatePeerEntry(peerId: string) {
    return this.peerConnections.get(peerId) ?? (await this.ensurePeer(peerId, false));
  }

  runPeerOperation<T>(entry: PeerEntry, task: () => Promise<T>) {
    return enqueuePeerOperation(entry, task);
  }

  async flushPendingCandidates(entry: PeerEntry) {
    await flushPendingCandidates(entry);
  }

  setStatsSamplingMode(mode: "off" | "steady" | "active") {
    this.statsSampler.setMode(mode, this.peerConnections.entries());
  }

  async restartPeer(peerId: string) {
    const entry = this.peerConnections.get(peerId);
    if (!entry) {
      if (!this.peerConnections.expects(peerId)) {
        return null;
      }
      return this.ensurePeer(peerId, this.shouldInitiatePeer(peerId));
    }

    return this.recreatePeer(peerId, entry);
  }

  async restartIce(peerId: string) {
    const entry = this.peerConnections.get(peerId);
    if (!entry || entry.releasing) {
      return null;
    }

    return enqueuePeerOperation(entry, async () => {
      if (entry.releasing || entry.connection.signalingState !== "stable") {
        return null;
      }

      await this.signaling.createAndSendOffer(peerId, entry.connection, { iceRestart: true });
      entry.lastSignalProgressAtMs = Date.now();
      return entry;
    });
  }

  destroy() {
    this.peerConnections.clearExpected();
    for (const [peerId, entry] of this.peerConnections.entries()) {
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

  private async ensurePeer(peerId: string, shouldInitiate: boolean) {
    const existing = this.peerConnections.get(peerId);

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
      nowMs: Date.now()
    });
    this.statsSampler.start(peerId, entry);

    bindPeerConnectionEvents({
      peerId,
      entry,
      localPeerId: this.localPeerId,
      connection,
      autoReconnect: this.autoReconnect,
      isCurrentEntry: (currentPeerId, currentEntry) =>
        this.peerConnections.get(currentPeerId) === currentEntry,
      isExpectedPeer: (currentPeerId) => this.peerConnections.expects(currentPeerId),
      sendCandidate: (candidatePeerId, payload) =>
        this.signaling.send(candidatePeerId, "candidate", payload),
      onPeerConnectionChange: (payload) => {
        this.onPeerConnectionChange?.(payload);
        if (payload.state === "connected") {
          void this.enqueueMediaOperation(payload.peerId, entry);
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
      onMediaStateChange: this.onMediaStateChange
    });

    this.peerConnections.set(peerId, entry);
    this.schedulePeerWatchdog(peerId, entry);
    try {
      if (shouldInitiate) {
        const controlChannel = connection.createDataChannel("music-room-control", {
          ordered: true
        });
        const dataChannel = connection.createDataChannel("music-room-data", {
          ordered: false
        });
        const originalChannel = connection.createDataChannel("music-room-original", {
          ordered: false
        });
        entry.controlChannel = controlChannel;
        entry.dataChannel = dataChannel;
        entry.originalChannel = originalChannel;
        entry.channel = controlChannel;
        this.bindChannelCallback(peerId, entry, controlChannel);
        this.bindChannelCallback(peerId, entry, dataChannel);
        this.bindChannelCallback(peerId, entry, originalChannel);
        await enqueuePeerOperation(entry, async () => {
          await this.syncLocalAudioToPeer(peerId, entry, false);
          await this.signaling.createAndSendOffer(peerId, connection);
          entry.mediaNegotiationPending = false;
          entry.lastSignalProgressAtMs = Date.now();
        });
      }

      return entry;
    } catch (error) {
      if (this.peerConnections.get(peerId) === entry) {
        this.releasePeer(peerId, entry);
      }
      throw error;
    }
  }

  private releasePeer(peerId: string, entry: PeerEntry) {
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
        await this.signaling.createAndSendOffer(peerId, entry.connection);
        entry.lastSignalProgressAtMs = Date.now();
        entry.mediaNegotiationPending = false;
      }
      return;
    }

    if (!entry.audioSender) {
      return;
    }

    if (currentTrack !== desiredTrack) {
      try {
        await entry.audioSender.replaceTrack(desiredTrack);
        entry.senderTrackState = desiredTrack ? "live" : "none";
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

    if (entry.mediaNegotiationPending && entry.connection.signalingState === "stable") {
      await this.signaling.createAndSendOffer(peerId, entry.connection);
      entry.lastSignalProgressAtMs = Date.now();
      entry.mediaNegotiationPending = false;
    }
  }

  private enqueueMediaOperation(peerId: string, entry: PeerEntry) {
    return enqueuePeerOperation(entry, () => this.syncLocalAudioToPeer(peerId, entry));
  }

  private async applyAudioSenderParameters(
    sender: RTCRtpSender,
    effectiveMaxBitrateKbps: number | null = this.localAudioMaxBitrateKbps
  ) {
    if (effectiveMaxBitrateKbps === null || typeof sender.getParameters !== "function") {
      return;
    }
    try {
      const parameters = sender.getParameters();
      const encodings = parameters.encodings?.length
        ? parameters.encodings
        : [{} as RTCRtpEncodingParameters];
      parameters.encodings = encodings.map((encoding) => ({
        ...encoding,
        maxBitrate: Math.max(64_000, Math.round(effectiveMaxBitrateKbps * 1000))
      }));
      await sender.setParameters(parameters);
      for (const [, entry] of this.peerConnections.entries()) {
        if (entry.audioSender === sender) {
          entry.configuredAudioMaxBitrateKbps = this.localAudioMaxBitrateKbps;
          entry.appliedAudioBitrateKbps = effectiveMaxBitrateKbps;
          break;
        }
      }
    } catch {
      // Browser codecs may reject a runtime bitrate update; RTP remains usable.
    }
  }

  private async adaptAudioSenderBitrate(
    peerId: string,
    sample: PeerConnectionStatsSample
  ) {
    const entry = this.peerConnections.get(peerId);
    const requestedMaxBitrateKbps = this.localAudioMaxBitrateKbps;
    const availableOutgoingBitrateKbps = sample.availableOutgoingBitrateKbps;
    if (
      !entry ||
      !entry.audioSender ||
      requestedMaxBitrateKbps === null ||
      typeof availableOutgoingBitrateKbps !== "number" ||
      !Number.isFinite(availableOutgoingBitrateKbps) ||
      availableOutgoingBitrateKbps <= 0
    ) {
      return;
    }

    const effectiveMaxBitrateKbps = Math.max(
      64,
      Math.min(requestedMaxBitrateKbps, Math.floor(availableOutgoingBitrateKbps * 0.65))
    );
    if (
      entry.appliedAudioBitrateKbps !== null &&
      Math.abs(entry.appliedAudioBitrateKbps - effectiveMaxBitrateKbps) < 8
    ) {
      return;
    }
    await enqueuePeerOperation(entry, async () => {
      if (entry.releasing || !entry.audioSender) {
        return;
      }
      await this.applyAudioSenderParameters(entry.audioSender, effectiveMaxBitrateKbps);
    });
  }

  private async recreatePeer(peerId: string, entry: PeerEntry) {
    const reconnectAttempts = entry.reconnectAttempts;
    this.releasePeer(peerId, entry);
    const nextEntry = await this.ensurePeer(peerId, this.shouldInitiatePeer(peerId));
    nextEntry.reconnectAttempts = reconnectAttempts;
    return nextEntry;
  }

  private shouldInitiatePeer(peerId: string) {
    return shouldInitiatePeerConnection(this.localPeerId, peerId);
  }
}
