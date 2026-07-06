import type { PeerConnectionStatsSnapshot } from "./connection-stats";

export type QueuedSendItem = {
  data: string | ArrayBuffer;
  trackId?: string;
  chunkIndex?: number;
  payloadBytes?: number;
};

export type PeerEntry = {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
  /** The peerId that initiated this connection (so we don't initiate twice) */
  initiatorPeerId: string | null;
  pendingCandidates: RTCIceCandidateInit[];
  statsIntervalId: ReturnType<typeof setInterval> | null;
  statsSnapshot: PeerConnectionStatsSnapshot | null;
  dataChannelState: RTCDataChannelState | null;
  createdAtMs: number;
  lastSignalProgressAtMs: number;
  reconnectAttempts: number;
  reconnectTimerId: ReturnType<typeof setTimeout> | null;
  watchdogTimerId: ReturnType<typeof setTimeout> | null;
  sendQueue: QueuedSendItem[];
  releasing: boolean;
  operationChain: Promise<void>;
};

export function createPeerEntry(input: {
  connection: RTCPeerConnection;
  initiatorPeerId: string | null;
  nowMs: number;
}): PeerEntry {
  return {
    connection: input.connection,
    channel: null,
    initiatorPeerId: input.initiatorPeerId,
    pendingCandidates: [],
    statsIntervalId: null,
    statsSnapshot: null,
    dataChannelState: null,
    createdAtMs: input.nowMs,
    lastSignalProgressAtMs: input.nowMs,
    reconnectAttempts: 0,
    reconnectTimerId: null,
    watchdogTimerId: null,
    sendQueue: [],
    releasing: false,
    operationChain: Promise.resolve()
  };
}

export function isPeerStalled(input: {
  entry: PeerEntry;
  nowMs: number;
  dataOpenTimeoutMs: number;
  dataConnectingTimeoutMs: number;
  connectionProgressTimeoutMs: number;
}) {
  const { entry } = input;
  const channelState = entry.channel?.readyState ?? null;
  const connectionState = entry.connection.connectionState;

  if (channelState === "open") {
    return false;
  }

  if (input.nowMs - entry.createdAtMs >= input.dataOpenTimeoutMs) {
    return true;
  }

  if (
    channelState === "connecting" &&
    input.nowMs - entry.lastSignalProgressAtMs >= input.dataConnectingTimeoutMs
  ) {
    return true;
  }

  if (
    (connectionState === "new" ||
      connectionState === "connecting" ||
      connectionState === "disconnected") &&
    input.nowMs - entry.lastSignalProgressAtMs >= input.connectionProgressTimeoutMs
  ) {
    return true;
  }

  return false;
}

export function shouldRestartPeer(input: {
  entry: PeerEntry;
  nowMs: number;
  dataOpenTimeoutMs: number;
  dataConnectingTimeoutMs: number;
  connectionProgressTimeoutMs: number;
}) {
  const { entry } = input;
  if (entry.releasing) {
    return false;
  }

  if (
    entry.connection.connectionState === "failed" ||
    entry.connection.connectionState === "closed" ||
    entry.dataChannelState === "closed"
  ) {
    return true;
  }

  return isPeerStalled(input);
}

export function clearPeerWatchdog(entry: PeerEntry) {
  if (!entry.watchdogTimerId) {
    return;
  }

  clearTimeout(entry.watchdogTimerId);
  entry.watchdogTimerId = null;
}

export function clearPeerReconnectTimer(entry: PeerEntry) {
  if (!entry.reconnectTimerId) {
    return;
  }

  clearTimeout(entry.reconnectTimerId);
  entry.reconnectTimerId = null;
}

export function clearPeerTimers(entry: PeerEntry) {
  clearPeerWatchdog(entry);
  clearPeerReconnectTimer(entry);
}

export class PeerConnectionRegistry {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly expectedPeerIds = new Set<string>();

  constructor(private readonly localPeerId: string) {}

  setExpectedRemotePeerIds(remotePeerIds: string[]) {
    this.expectedPeerIds.clear();
    for (const peerId of remotePeerIds) {
      if (!peerId || peerId === this.localPeerId) {
        continue;
      }
      this.expectedPeerIds.add(peerId);
    }

    return new Set(this.expectedPeerIds);
  }

  expects(peerId: string) {
    return this.expectedPeerIds.has(peerId);
  }

  clearExpected() {
    this.expectedPeerIds.clear();
  }

  get(peerId: string) {
    return this.peers.get(peerId) ?? null;
  }

  set(peerId: string, entry: PeerEntry) {
    this.peers.set(peerId, entry);
  }

  entries() {
    return this.peers.entries();
  }

  deleteIfCurrent(peerId: string, entry: PeerEntry) {
    if (this.peers.get(peerId) !== entry) {
      return false;
    }

    this.peers.delete(peerId);
    return true;
  }

  clearPeers() {
    this.peers.clear();
  }

  getConnectedPeerIds() {
    return [...this.peers.entries()]
      .filter(([, entry]) => entry.channel?.readyState === "open")
      .map(([peerId]) => peerId);
  }
}
