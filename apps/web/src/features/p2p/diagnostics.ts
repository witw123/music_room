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
  recordEvent?: boolean;
  update?: (snapshot: PeerDiagnosticsSnapshot) => PeerDiagnosticsSnapshot;
  now?: string;
};

const maxGlobalEvents = 100;
const maxPeerEvents = 12;

function isSameEventSignature(
  left: Pick<
    PeerRecentEvent,
    "peerId" | "channelKind" | "direction" | "event" | "summary" | "level"
  >,
  right: Pick<
    PeerRecentEvent,
    "peerId" | "channelKind" | "direction" | "event" | "summary" | "level"
  >
) {
  return (
    left.peerId === right.peerId &&
    left.channelKind === right.channelKind &&
    left.direction === right.direction &&
    left.event === right.event &&
    left.summary === right.summary &&
    left.level === right.level
  );
}

function upsertRecentEvent(
  events: PeerRecentEvent[],
  nextEvent: PeerRecentEvent,
  maxEvents: number
) {
  const currentTop = events[0];

  if (currentTop && isSameEventSignature(currentTop, nextEvent)) {
    return [nextEvent, ...events.slice(1)];
  }

  return [nextEvent, ...events].slice(0, maxEvents);
}

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
  const shouldRecordEvent = input.recordEvent ?? true;
  const event: PeerRecentEvent | null = shouldRecordEvent
    ? {
        id: `${timestamp}:${input.peerId}:${input.channelKind}:${input.event}:${Math.random().toString(36).slice(2, 8)}`,
        timestamp,
        peerId: input.peerId,
        channelKind: input.channelKind,
        direction: input.direction,
        event: input.event,
        summary: input.summary,
        level: input.level ?? "info"
      }
    : null;
  const baseUpdated: PeerDiagnosticsSnapshot = {
    ...current,
    updatedAt: timestamp,
    recentEvents: event
      ? upsertRecentEvent(current.recentEvents, event, maxPeerEvents)
      : current.recentEvents
  };
  const nextSnapshot = input.update ? input.update(baseUpdated) : baseUpdated;

  return {
    peers: {
      ...state.peers,
      [input.peerId]: nextSnapshot
    },
    recentEvents: event
      ? upsertRecentEvent(state.recentEvents, event, maxGlobalEvents)
      : state.recentEvents
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
    dataChannelState: null,
    mediaConnectionState: null,
    dataIceState: null,
    mediaIceState: null,
    transportHealth: null,
    degradedReason: null,
    lastAvailabilitySeenAt: null,
    lastPieceReceivedAt: null,
    dataCandidateType: null,
    mediaCandidateType: null,
    mediaProtocol: null,
    currentRoundTripTimeMs: null,
    availableOutgoingBitrateKbps: null,
    targetAudioBitrateKbps: null,
    packetLossRate: null,
    receiverJitterTargetMs: null,
    startupBufferMs: null,
    lastStablePlaybackAt: null,
    mediaReceiveBitrateKbps: null,
    mediaSendBitrateKbps: null,
    pieceDownloadRateKbps: null,
    pieceUploadRateKbps: null,
    packetsLost: null,
    jitterMs: null,
    timeOnRemoteStreamMs: null,
    signalStats: createEmptySignalStats(),
    remoteTrackStatus: createEmptyRemoteTrackStatus(),
    progressivePlaybackStatus: {
      activeSource: null,
      audioUnlocked: false,
      sourceStartState: "idle",
      lastSourceStartError: null,
      transportGovernorMode: null,
      engineType: null,
      contiguousBufferedMs: 0,
      aheadBufferedMs: 0,
      schedulerPolicy: null,
      startupReady: false,
      fallbackReason: null,
      estimatedFillTimeMs: null,
      remainingPlaybackMs: null,
      bufferSafetyMarginMs: null,
      pendingPlaybackIntent: null,
      intentMatchedSource: null,
      lastPlayStartFailure: null,
      nextQueueTrackPrefetch: null,
      remoteFirstLock: false,
      remoteFirstLockReason: null,
      localTakeoverCooldownMs: null,
      fullLocalReady: false,
      fullLocalEligible: false,
      fullLocalBlockedReason: null,
      progressiveLocalEligible: false,
      progressiveLocalBlockedReason: null,
      hostCaptureRefreshKey: null,
      hostCaptureForcedRefresh: false,
      hostCaptureMode: null,
      hostCaptureMediaEpoch: null,
      startupBufferMs: null,
      lastStablePlaybackAt: null
    },
    lastError: null,
    updatedAt: now,
    recentEvents: []
  };
}
