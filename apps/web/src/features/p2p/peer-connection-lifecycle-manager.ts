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
  type PeerEntry
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
    this.peerConnections = new PeerConnectionRegistry(input.localPeerId);
    this.statsSampler = new PeerStatsSampler({
      activeStatsSamplingIntervalMs: 1_000,
      steadyStatsSamplingIntervalMs: 5_000,
      onStatsSample: input.onStatsSample,
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
      onPeerConnectionChange: this.onPeerConnectionChange,
      onIceConnectionStateChange: this.onIceConnectionStateChange,
      onPeerStalled: this.onPeerStalled,
      schedulePeerReconnect: (currentPeerId, currentEntry) =>
        this.schedulePeerReconnect(currentPeerId, currentEntry),
      schedulePeerWatchdog: (currentPeerId, currentEntry) =>
        this.schedulePeerWatchdog(currentPeerId, currentEntry),
      releasePeer: (currentPeerId, currentEntry) =>
        this.releasePeer(currentPeerId, currentEntry),
      bindChannel: (currentPeerId, currentEntry, channel) =>
        this.bindChannelCallback(currentPeerId, currentEntry, channel)
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
        entry.controlChannel = controlChannel;
        entry.dataChannel = dataChannel;
        entry.channel = controlChannel;
        this.bindChannelCallback(peerId, entry, controlChannel);
        this.bindChannelCallback(peerId, entry, dataChannel);
        await this.signaling.createAndSendOffer(peerId, connection);
        entry.lastSignalProgressAtMs = Date.now();
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
