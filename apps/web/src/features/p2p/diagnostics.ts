import type {
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  PeerSignalStats,
  RemoteTrackStatus
} from "@music-room/shared";

export type DiagnosticsState = {
  peers: Record<string, PeerDiagnosticsSnapshot>;
  recentEvents: PeerRecentEvent[];
};

type DiagnosticsInput = {
  peerId: string;
  channelKind: PeerRecentEvent["channelKind"];
  direction: PeerRecentEvent["direction"];
  event: string;
  summary: string;
  level?: PeerRecentEvent["level"];
  update?: (snapshot: PeerDiagnosticsSnapshot) => PeerDiagnosticsSnapshot;
  now?: string;
};

const maxGlobalEvents = 100;
const maxPeerEvents = 12;

export function createEmptyDiagnosticsState(): DiagnosticsState {
  return {
    peers: {},
    recentEvents: []
  };
}

export function recordDiagnosticsEvent(
  state: DiagnosticsState,
  input: DiagnosticsInput
): DiagnosticsState {
  const timestamp = input.now ?? new Date().toISOString();
  const current = state.peers[input.peerId] ?? createPeerSnapshot(input.peerId, timestamp);
  const event: PeerRecentEvent = {
    id: `${timestamp}:${input.peerId}:${input.channelKind}:${input.event}:${Math.random().toString(36).slice(2, 8)}`,
    timestamp,
    peerId: input.peerId,
    channelKind: input.channelKind,
    direction: input.direction,
    event: input.event,
    summary: input.summary,
    level: input.level ?? "info"
  };
  const baseUpdated: PeerDiagnosticsSnapshot = {
    ...current,
    updatedAt: timestamp,
    recentEvents: [event, ...current.recentEvents].slice(0, maxPeerEvents)
  };
  const nextSnapshot = input.update ? input.update(baseUpdated) : baseUpdated;

  return {
    peers: {
      ...state.peers,
      [input.peerId]: nextSnapshot
    },
    recentEvents: [event, ...state.recentEvents].slice(0, maxGlobalEvents)
  };
}

export function createEmptySignalStats(): PeerSignalStats {
  return {
    sentOffers: 0,
    receivedOffers: 0,
    sentAnswers: 0,
    receivedAnswers: 0,
    sentCandidates: 0,
    receivedCandidates: 0
  };
}

export function createEmptyRemoteTrackStatus(): RemoteTrackStatus {
  return {
    received: false,
    boundToAudioElement: false,
    lastTrackAt: null,
    lastBoundAt: null,
    lastAudioEvent: null
  };
}

export function createPeerSnapshot(peerId: string, now = new Date().toISOString()): PeerDiagnosticsSnapshot {
  return {
    peerId,
    dataConnectionState: null,
    mediaConnectionState: null,
    dataIceState: null,
    mediaIceState: null,
    signalStats: createEmptySignalStats(),
    remoteTrackStatus: createEmptyRemoteTrackStatus(),
    lastError: null,
    updatedAt: now,
    recentEvents: []
  };
}
