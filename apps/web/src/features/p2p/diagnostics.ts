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
    lastAudioEvent: null,
    currentTrackId: null,
    mediaEpoch: null,
    sourcePeerId: null,
    traceKey: null,
    trackId: null,
    trackMuted: null,
    trackEnabled: null,
    trackReadyState: null,
    audioPaused: null,
    audioMuted: null,
    audioReadyState: null,
    hasSrcObject: null,
    currentSrc: null,
    audioVolume: null,
    lastPlayAttemptAt: null,
    lastPlayAttemptResult: null,
    lastPlayAttemptError: null,
    currentGeneration: null,
    boundGeneration: null,
    playingGeneration: null,
    recoveryStage: "idle",
    restartAttempt: null,
    publishGeneration: null,
    attachedTrackId: null,
    negotiatedTrackId: null,
    makingOffer: null,
    signalingState: null
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
    transportScore: null,
    stableTransportKind: null,
    lastFailureReason: null,
    lastRecoveryAction: null,
    recoveryActionLevel: null,
    iceRestartCount: null,
    hardRecreateCount: null,
    degradedReason: null,
    lastAvailabilitySeenAt: null,
    lastPieceReceivedAt: null,
    iceConfigSource: null,
    dataCandidateType: null,
    mediaCandidateType: null,
    mediaProtocol: null,
    currentRoundTripTimeMs: null,
    availableOutgoingBitrateKbps: null,
    targetAudioBitrateKbps: null,
    configuredAudioMaxBitrateKbps: null,
    senderAudioMaxBitrateKbps: null,
    opusFmtpLine: null,
    packetLossRate: null,
    receiverJitterTargetMs: null,
    startupBufferMs: null,
    lastStablePlaybackAt: null,
    mediaReceiveBitrateKbps: null,
    mediaSendBitrateKbps: null,
    pieceDownloadRateKbps: null,
    pieceUploadRateKbps: null,
    pieceRttMsP50: null,
    pieceRttMsP95: null,
    pieceTimeoutRate: null,
    dataBufferedAmountBytes: null,
    lastAudibleProgressAt: null,
    lastMediaStatsProgressAt: null,
    lastDataActivityAt: null,
    audibleSource: null,
    bufferingWhileAudible: false,
    recoverySuppressedReason: null,
    zeroProgressMs: null,
    consecutiveNoProgressMs: null,
    packetsLost: null,
    jitterMs: null,
    timeOnRemoteStreamMs: null,
    signalStats: createEmptySignalStats(),
    remoteTrackStatus: createEmptyRemoteTrackStatus(),
    progressivePlaybackStatus: {
      activeSource: null,
      playbackConnectionKey: null,
      playbackSurfaceKey: null,
      playbackTimelineKey: null,
      roomChangeKind: null,
      remoteOutputMode: "inactive",
      sourceResetReason: "none",
      remoteSurfacePreserved: false,
      listenerPlaybackState: "idle",
      activeRecoveryActionType: null,
      activeRecoveryActionResult: null,
      activeRecoveryActionStartedAt: null,
      activeRecoveryActionReason: null,
      lastRecoveryRecommendationScope: null,
      lastRecoveryRecommendationLevel: null,
      lastRecoveryRecommendationReason: null,
      lastRecoveryRecommendationAt: null,
      recoveryDropReason: null,
      socketDisconnectGraceActive: false,
      mediaTransportState: "idle",
      transportEpoch: null,
      usingSilentPrewarmTrack: false,
      publishedTrackKind: "none",
      hostPublishSource: "none",
      hostPublishReadiness: "idle",
      hostPublishFailureReason: null,
      resolvedPublishElement: "none",
      resolvedPublishStreamKind: "none",
      mediaBootstrapState: "idle",
      mediaFailureReason: null,
      transportResetReason: "none",
      hostPublishingReady: false,
      listenerRecoveryAttempt: null,
      mediaNegotiationRole: null,
      listenerAwaitingPublisherOffer: false,
      lastIgnoredOfferReason: "none",
      publisherBootstrapRequestedAt: null,
      publisherBootstrapAttempts: null,
      dataRequiredForPlayback: true,
      firstAudibleAt: null,
      firstTransportConnectedAt: null,
      recoveryPhase: null,
      recoveryMode: null,
      recoveryGeneration: null,
      bootstrapSourcePeerId: null,
      bootstrapStartedAt: null,
      pendingSnapshot: false,
      pendingData: false,
      pendingMedia: false,
      listenerBootstrapAttempts: null,
      fullLocalRecoveryActive: false,
      shadowWarmupActive: false,
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
      hostCaptureTrackId: null,
      hostCaptureTrackMuted: null,
      hostCaptureTrackEnabled: null,
      hostCaptureTrackReadyState: null,
      hostCaptureTrackCount: null,
      publishGeneration: null,
      hostPublishKey: null,
      hostPublishStage: "idle",
      hostPublishedListenerSet: null,
      attachedTrackId: null,
      negotiatedTrackId: null,
      makingOffer: null,
      signalingState: null,
      currentSessionUserId: null,
      playbackSourceSessionId: null,
      currentPeerId: null,
      playbackSourcePeerId: null,
      isSourceOwner: false,
      localAudioPaused: null,
      localAudioMuted: null,
      localAudioVolume: null,
      localAudioReadyState: null,
      localAudioCurrentSrc: null,
      localAudioHasSrcObject: null,
      pcmEngineStatus: null,
      pcmAudioContextState: null,
      pcmHasOutputStream: null,
      pcmContiguousChunkCount: null,
      pcmContiguousByteLength: null,
      pcmDecodedSegmentCount: null,
      pcmScheduledSegmentCount: null,
      pcmBufferedAheadMs: null,
      pcmPlayoutState: null,
      pcmLastBlockedReason: null,
      startupBufferMs: null,
      comfortBufferedMs: null,
      averageDriftMs: null,
      maxDriftMs: null,
      waitingEventsLast30s: null,
      stalledEventsLast30s: null,
      playbackRecoveryStage: null,
      audibleLocalFallbackActive: false,
      maxContinuousPlaybackMsLast30s: null,
      schedulerBudgetTier: null,
      lastStablePlaybackAt: null
    },
    lastError: null,
    updatedAt: now,
    recentEvents: []
  };
}
