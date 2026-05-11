import { z } from "zod";

export const iceServerConfigSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional()
});

export const iceConfigSourceSchema = z.enum(["ephemeral", "static", "stun-only"]);

export const roomMediaConnectionStateSchema = z.enum([
  "idle",
  "connecting",
  "buffering",
  "live",
  "reconnecting",
  "failed"
]);

export const trackPieceInfoSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  chunkSize: z.number().int().positive(),
  hash: z.string(),
  ownerPeerId: z.string()
});

export const trackAvailabilitySchema = z.object({
  trackId: z.string(),
  ownerPeerId: z.string(),
  availableChunks: z.array(z.number().int().nonnegative()),
  announcedAt: z.string().datetime()
});

export const trackAvailabilityAnnouncementSchema = z.object({
  roomId: z.string(),
  trackId: z.string(),
  ownerPeerId: z.string(),
  nickname: z.string(),
  assetKind: z.enum(["relay", "original"]).optional(),
  assetHash: z.string().optional(),
  totalChunks: z.number().int().nonnegative(),
  chunkSize: z.number().int().positive(),
  availableChunks: z.array(z.number().int().nonnegative()),
  pieceHashes: z.array(z.string()).optional(),
  source: z.enum(["live_upload", "local_cache"]),
  announcedAt: z.string().datetime()
});

export const peerSignalMessageSchema = z.object({
  roomId: z.string(),
  fromPeerId: z.string(),
  toPeerId: z.string(),
  channelKind: z.enum(["data", "media"]),
  mediaEpoch: z.number().int().nonnegative().optional(),
  transportEpoch: z.number().int().nonnegative().optional(),
  recoveryGeneration: z.number().int().nonnegative().optional(),
  type: z.enum(["offer", "answer", "candidate"]),
  payload: z.record(z.unknown())
});

export const p2pDataMessageSchema = z.union([
  z.object({
    kind: z.literal("request-piece"),
    trackId: z.string(),
    chunkIndex: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal("request-pieces"),
    requestId: z.string(),
    trackId: z.string(),
    chunkIndexes: z.array(z.number().int().nonnegative()).min(1)
  }),
  z.object({
    kind: z.literal("send-piece"),
    requestId: z.string().optional(),
    trackId: z.string(),
    chunkIndex: z.number().int().nonnegative(),
    totalChunks: z.number().int().positive(),
    chunkSize: z.number().int().positive(),
    mimeType: z.string(),
    pieceHash: z.string(),
    payloadBase64: z.string()
  })
]);

export const peerRecentEventSchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  peerId: z.string(),
  channelKind: z.enum(["data", "media", "system"]),
  direction: z.enum(["sent", "received", "local"]),
  event: z.string(),
  summary: z.string(),
  level: z.enum(["info", "warning", "error"]).default("info")
});

export const peerSignalStatsSchema = z.object({
  sentOffers: z.number().int().nonnegative(),
  receivedOffers: z.number().int().nonnegative(),
  sentAnswers: z.number().int().nonnegative(),
  receivedAnswers: z.number().int().nonnegative(),
  sentCandidates: z.number().int().nonnegative(),
  receivedCandidates: z.number().int().nonnegative()
});

export const remoteTrackStatusSchema = z.object({
  received: z.boolean(),
  boundToAudioElement: z.boolean(),
  lastTrackAt: z.string().datetime().nullable(),
  lastBoundAt: z.string().datetime().nullable(),
  lastAudioEvent: z.enum(["playing", "waiting", "pause", "error"]).nullable(),
  currentTrackId: z.string().nullable().optional(),
  mediaEpoch: z.number().int().nonnegative().nullable().optional(),
  sourcePeerId: z.string().nullable().optional(),
  traceKey: z.string().nullable().optional(),
  trackId: z.string().nullable().optional(),
  trackMuted: z.boolean().nullable().optional(),
  trackEnabled: z.boolean().nullable().optional(),
  trackReadyState: z.enum(["live", "ended"]).nullable().optional(),
  audioPaused: z.boolean().nullable().optional(),
  audioMuted: z.boolean().nullable().optional(),
  audioReadyState: z.number().int().min(0).max(4).nullable().optional(),
  hasSrcObject: z.boolean().nullable().optional(),
  currentSrc: z.string().nullable().optional(),
  audioVolume: z.number().min(0).max(1).nullable().optional(),
  lastPlayAttemptAt: z.string().datetime().nullable().optional(),
  lastPlayAttemptResult: z.enum(["ok", "rejected"]).nullable().optional(),
  lastPlayAttemptError: z.string().nullable().optional(),
  currentGeneration: z.string().nullable().optional(),
  boundGeneration: z.string().nullable().optional(),
  playingGeneration: z.string().nullable().optional(),
  recoveryStage: z
    .enum([
      "idle",
      "waiting-track",
      "rebind-element",
      "retry-play",
      "rebind-and-play",
      "restart-peer"
    ])
    .nullable()
    .optional(),
  restartAttempt: z.number().int().nonnegative().nullable().optional(),
  publishGeneration: z.number().int().nonnegative().nullable().optional(),
  attachedTrackId: z.string().nullable().optional(),
  negotiatedTrackId: z.string().nullable().optional(),
  makingOffer: z.boolean().nullable().optional(),
  signalingState: z.string().nullable().optional()
});

export const progressivePlaybackStatusSchema = z.object({
  activeSource: z.enum(["remote-stream", "progressive-local", "full-local"]).nullable(),
  playbackConnectionKey: z.string().nullable().optional(),
  playbackSurfaceKey: z.string().nullable().optional(),
  playbackTimelineKey: z.string().nullable().optional(),
  roomChangeKind: z
    .enum([
      "presence-only",
      "catalog-only",
      "playback-timeline",
      "playback-topology",
      "transport-topology"
    ])
    .nullable()
    .optional(),
  remoteOutputMode: z.enum(["audible", "held-silent", "inactive"]).nullable().optional(),
  sourceResetReason: z
    .enum([
      "track-changed",
      "source-session-changed",
      "source-peer-changed",
      "media-epoch-changed",
      "transport-epoch-changed",
      "playback-stopped",
      "none"
    ])
    .nullable()
    .optional(),
  remoteSurfacePreserved: z.boolean().optional(),
  listenerPlaybackState: z
    .enum([
      "idle",
      "awaiting-offer",
      "negotiating",
      "stream-bound",
      "playback-starting",
      "live",
      "recovering-soft",
      "recovering-hard",
      "failed"
    ])
    .nullable()
    .optional(),
  activeRecoveryActionType: z
    .enum([
      "retry-play",
      "rebind-element",
      "restart-listener-ice",
      "reset-listener-peer",
      "restart-data-peer",
      "full-resubscribe"
    ])
    .nullable()
    .optional(),
  activeRecoveryActionResult: z
    .enum(["running", "completed", "failed", "dropped"])
    .nullable()
    .optional(),
  activeRecoveryActionStartedAt: z.string().datetime().nullable().optional(),
  activeRecoveryActionReason: z.string().nullable().optional(),
  lastRecoveryRecommendationScope: z.enum(["media", "data", "room"]).nullable().optional(),
  lastRecoveryRecommendationLevel: z
    .enum(["soft", "ice-restart", "hard-recreate", "full-resubscribe"])
    .nullable()
    .optional(),
  lastRecoveryRecommendationReason: z.string().nullable().optional(),
  lastRecoveryRecommendationAt: z.string().datetime().nullable().optional(),
  recoveryDropReason: z
    .enum([
      "stale-connection-key",
      "lower-priority-running",
      "suppressed-by-guard",
      "missing-peer"
    ])
    .nullable()
    .optional(),
  socketDisconnectGraceActive: z.boolean().optional(),
  mediaTransportState: z
    .enum(["idle", "prewarming", "connected", "publishing", "failed"])
    .nullable()
    .optional(),
  transportEpoch: z.number().int().nonnegative().nullable().optional(),
  usingSilentPrewarmTrack: z.boolean().optional(),
  publishedTrackKind: z
    .enum(["silent-prewarm", "host-capture", "relay-stream", "none"])
    .nullable()
    .optional(),
  hostPublishSource: z
    .enum(["local-audio", "remote-audio", "pcm-relay-stream", "silent-prewarm", "none"])
    .nullable()
    .optional(),
  hostPublishReadiness: z.enum(["idle", "awaiting-audio", "ready", "failed"]).nullable().optional(),
  hostPublishFailureReason: z.string().nullable().optional(),
  resolvedPublishElement: z.enum(["local-audio", "remote-audio", "none"]).nullable().optional(),
  resolvedPublishStreamKind: z
    .enum(["audio-element-capture", "pcm-relay-stream", "silent-prewarm", "none"])
    .nullable()
    .optional(),
  mediaBootstrapState: z
    .enum(["idle", "bootstrapping", "recovering", "failed", "steady"])
    .nullable()
    .optional(),
  mediaFailureReason: z.string().nullable().optional(),
  transportResetReason: z
    .enum(["source-changed", "socket-reconnect", "explicit-hard-reset", "none"])
    .nullable()
    .optional(),
  hostPublishingReady: z.boolean().optional(),
  listenerRecoveryAttempt: z.number().int().nonnegative().nullable().optional(),
  mediaNegotiationRole: z.enum(["publisher", "listener"]).nullable().optional(),
  listenerAwaitingPublisherOffer: z.boolean().optional(),
  lastIgnoredOfferReason: z
    .enum(["offer-collision", "stale-generation", "wrong-role", "none"])
    .nullable()
    .optional(),
  publisherBootstrapRequestedAt: z.string().datetime().nullable().optional(),
  publisherBootstrapAttempts: z.number().int().nonnegative().nullable().optional(),
  dataRequiredForPlayback: z.boolean().optional(),
  firstAudibleAt: z.string().datetime().nullable().optional(),
  firstTransportConnectedAt: z.string().datetime().nullable().optional(),
  recoveryPhase: z
    .enum([
      "joining",
      "resyncing",
      "bootstrapping-data",
      "bootstrapping-media",
      "playing-local-fallback",
      "steady"
    ])
    .nullable()
    .optional(),
  recoveryMode: z.enum(["late-join", "rejoin", "steady"]).nullable().optional(),
  recoveryGeneration: z.number().int().nonnegative().nullable().optional(),
  bootstrapSourcePeerId: z.string().nullable().optional(),
  bootstrapStartedAt: z.string().datetime().nullable().optional(),
  pendingSnapshot: z.boolean().optional(),
  pendingData: z.boolean().optional(),
  pendingMedia: z.boolean().optional(),
  listenerBootstrapAttempts: z.number().int().nonnegative().nullable().optional(),
  fullLocalRecoveryActive: z.boolean().optional(),
  shadowWarmupActive: z.boolean().optional(),
  audioUnlocked: z.boolean().optional(),
  sourceStartState: z
    .enum(["idle", "awaiting-unlock", "starting", "live", "failed"])
    .nullable()
    .optional(),
  lastSourceStartError: z.string().nullable().optional(),
  transportGovernorMode: z
    .enum(["bootstrap", "segment-catchup", "local-primary", "emergency-fallback"])
    .nullable()
    .optional(),
  engineType: z.enum(["none", "mse", "pcm"]).nullable(),
  contiguousBufferedMs: z.number().int().nonnegative(),
  aheadBufferedMs: z.number().int().nonnegative(),
  schedulerPolicy: z
    .enum(["startup", "steady", "catchup", "outrun-recovery", "pause-fill", "background"])
    .nullable(),
  startupReady: z.boolean(),
  fallbackReason: z.string().nullable(),
  estimatedFillTimeMs: z.number().int().nonnegative().nullable().optional(),
  remainingPlaybackMs: z.number().int().nonnegative().nullable().optional(),
  bufferSafetyMarginMs: z.number().int().nullable().optional(),
  pendingPlaybackIntent: z.string().nullable().optional(),
  intentMatchedSource: z
    .enum(["remote-stream", "progressive-local", "full-local"])
    .nullable()
    .optional(),
  lastPlayStartFailure: z.string().nullable().optional(),
  nextQueueTrackPrefetch: z.string().nullable().optional(),
  remoteFirstLock: z.boolean().optional(),
  remoteFirstLockReason: z.string().nullable().optional(),
  localTakeoverCooldownMs: z.number().int().nonnegative().nullable().optional(),
  fullLocalReady: z.boolean().optional(),
  fullLocalEligible: z.boolean().optional(),
  fullLocalBlockedReason: z.string().nullable().optional(),
  progressiveLocalEligible: z.boolean().optional(),
  progressiveLocalBlockedReason: z.string().nullable().optional(),
  hostCaptureRefreshKey: z.string().nullable().optional(),
  hostCaptureForcedRefresh: z.boolean().optional(),
  hostCaptureMode: z.enum(["native", "audio-context"]).nullable().optional(),
  hostCaptureMediaEpoch: z.number().int().nonnegative().nullable().optional(),
  hostCaptureTrackId: z.string().nullable().optional(),
  hostCaptureTrackMuted: z.boolean().nullable().optional(),
  hostCaptureTrackEnabled: z.boolean().nullable().optional(),
  hostCaptureTrackReadyState: z.enum(["live", "ended"]).nullable().optional(),
  hostCaptureTrackCount: z.number().int().nonnegative().nullable().optional(),
  publishGeneration: z.number().int().nonnegative().nullable().optional(),
  hostPublishKey: z.string().nullable().optional(),
  hostPublishStage: z
    .enum(["idle", "waiting-source-audio", "capture-ready", "published"])
    .nullable()
    .optional(),
  hostPublishedListenerSet: z.string().nullable().optional(),
  attachedTrackId: z.string().nullable().optional(),
  negotiatedTrackId: z.string().nullable().optional(),
  makingOffer: z.boolean().nullable().optional(),
  signalingState: z.string().nullable().optional(),
  currentSessionUserId: z.string().nullable().optional(),
  playbackSourceSessionId: z.string().nullable().optional(),
  currentPeerId: z.string().nullable().optional(),
  playbackSourcePeerId: z.string().nullable().optional(),
  isSourceOwner: z.boolean().optional(),
  localAudioPaused: z.boolean().nullable().optional(),
  localAudioMuted: z.boolean().nullable().optional(),
  localAudioVolume: z.number().min(0).max(1).nullable().optional(),
  localAudioReadyState: z.number().int().min(0).max(4).nullable().optional(),
  localAudioCurrentSrc: z.string().nullable().optional(),
  localAudioHasSrcObject: z.boolean().nullable().optional(),
  pcmEngineStatus: z
    .enum(["idle", "opening", "ready", "failed", "destroyed"])
    .nullable()
    .optional(),
  pcmAudioContextState: z.enum(["suspended", "running", "closed", "interrupted"]).nullable().optional(),
  pcmHasOutputStream: z.boolean().nullable().optional(),
  pcmDirectOutputConnected: z.boolean().nullable().optional(),
  pcmContiguousChunkCount: z.number().int().nonnegative().nullable().optional(),
  pcmContiguousByteLength: z.number().int().nonnegative().nullable().optional(),
  pcmDecodedSegmentCount: z.number().int().nonnegative().nullable().optional(),
  pcmScheduledSegmentCount: z.number().int().nonnegative().nullable().optional(),
  pcmDecodedPacketCount: z.number().int().nonnegative().nullable().optional(),
  pcmDecoderFlushCount: z.number().int().nonnegative().nullable().optional(),
  pcmLastDecodedAtMs: z.number().int().nonnegative().nullable().optional(),
  pcmBufferedAheadMs: z.number().int().nonnegative().nullable().optional(),
  pcmPlayoutState: z.enum(["playing", "buffering", "paused"]).nullable().optional(),
  pcmLastBlockedReason: z.string().nullable().optional(),
  startupBufferMs: z.number().int().nonnegative().nullable().optional(),
  comfortBufferedMs: z.number().int().nonnegative().nullable().optional(),
  averageDriftMs: z.number().nonnegative().nullable().optional(),
  maxDriftMs: z.number().nonnegative().nullable().optional(),
  waitingEventsLast30s: z.number().int().nonnegative().nullable().optional(),
  stalledEventsLast30s: z.number().int().nonnegative().nullable().optional(),
  playbackRecoveryStage: z
    .enum([
      "startup-buffering",
      "steady",
      "degraded",
      "shadow-catchup",
      "audible-local-fallback",
      "remote-recovery"
    ])
    .nullable()
    .optional(),
  audibleLocalFallbackActive: z.boolean().optional(),
  maxContinuousPlaybackMsLast30s: z.number().int().nonnegative().nullable().optional(),
  schedulerBudgetTier: z.enum(["critical", "protected", "comfort", "expanded"]).nullable().optional(),
  lastStablePlaybackAt: z.string().datetime().nullable().optional()
});

export const peerDiagnosticsSnapshotSchema = z.object({
  peerId: z.string(),
  dataConnectionState: z.string().nullable(),
  dataChannelState: z.string().nullable().optional(),
  mediaConnectionState: z.string().nullable(),
  dataIceState: z.string().nullable(),
  mediaIceState: z.string().nullable(),
  transportHealth: z
    .enum(["healthy", "media-only", "degraded", "recovering", "reconnecting", "failed"])
    .nullable()
    .optional(),
  transportScore: z.enum(["healthy", "degraded", "unstable", "failed"]).nullable().optional(),
  stableTransportKind: z.enum(["direct", "relay"]).nullable().optional(),
  lastFailureReason: z.string().nullable().optional(),
  lastRecoveryAction: z
    .enum(["soft", "ice-restart", "hard-recreate", "full-resubscribe"])
    .nullable()
    .optional(),
  recoveryActionLevel: z
    .enum(["observe", "soft-media-retry", "peer-restart", "hard-reconnect", "full-resubscribe"])
    .nullable()
    .optional(),
  iceRestartCount: z.number().int().nonnegative().nullable().optional(),
  hardRecreateCount: z.number().int().nonnegative().nullable().optional(),
  degradedReason: z.string().nullable().optional(),
  lastAvailabilitySeenAt: z.string().datetime().nullable().optional(),
  lastPieceReceivedAt: z.string().datetime().nullable().optional(),
  iceConfigSource: iceConfigSourceSchema.nullable().optional(),
  dataCandidateType: z.string().nullable(),
  mediaCandidateType: z.string().nullable(),
  mediaProtocol: z.string().nullable(),
  currentRoundTripTimeMs: z.number().nonnegative().nullable(),
  availableOutgoingBitrateKbps: z.number().nonnegative().nullable(),
  targetAudioBitrateKbps: z.number().nonnegative().nullable().optional(),
  configuredAudioMaxBitrateKbps: z.number().nonnegative().nullable().optional(),
  senderAudioMaxBitrateKbps: z.number().nonnegative().nullable().optional(),
  opusFmtpLine: z.string().nullable().optional(),
  packetLossRate: z.number().nonnegative().nullable().optional(),
  receiverJitterTargetMs: z.number().nonnegative().nullable().optional(),
  startupBufferMs: z.number().nonnegative().nullable().optional(),
  lastStablePlaybackAt: z.string().datetime().nullable().optional(),
  mediaReceiveBitrateKbps: z.number().nonnegative().nullable(),
  mediaSendBitrateKbps: z.number().nonnegative().nullable(),
  pieceDownloadRateKbps: z.number().nonnegative().nullable(),
  pieceUploadRateKbps: z.number().nonnegative().nullable(),
  pieceRttMsP50: z.number().nonnegative().nullable().optional(),
  pieceRttMsP95: z.number().nonnegative().nullable().optional(),
  pieceTimeoutRate: z.number().min(0).max(100).nullable().optional(),
  dataBufferedAmountBytes: z.number().int().nonnegative().nullable().optional(),
  lastAudibleProgressAt: z.string().datetime().nullable().optional(),
  lastMediaStatsProgressAt: z.string().datetime().nullable().optional(),
  lastDataActivityAt: z.string().datetime().nullable().optional(),
  audibleSource: z.enum(["remote-stream", "progressive-local", "full-local"]).nullable().optional(),
  bufferingWhileAudible: z.boolean().optional(),
  recoverySuppressedReason: z.string().nullable().optional(),
  zeroProgressMs: z.number().int().nonnegative().nullable().optional(),
  consecutiveNoProgressMs: z.number().int().nonnegative().nullable().optional(),
  packetsLost: z.number().int().nullable(),
  jitterMs: z.number().nonnegative().nullable(),
  timeOnRemoteStreamMs: z.number().int().nonnegative().nullable(),
  signalStats: peerSignalStatsSchema,
  remoteTrackStatus: remoteTrackStatusSchema,
  progressivePlaybackStatus: progressivePlaybackStatusSchema.optional(),
  lastError: z.string().nullable(),
  updatedAt: z.string().datetime(),
  recentEvents: z.array(peerRecentEventSchema)
});

export const iceConfigResponseSchema = z.object({
  iceServers: z.array(iceServerConfigSchema),
  ttlSeconds: z.number().int().positive(),
  source: iceConfigSourceSchema
});

export type TrackPieceInfo = z.infer<typeof trackPieceInfoSchema>;
export type TrackAvailability = z.infer<typeof trackAvailabilitySchema>;
export type TrackAvailabilityAnnouncement = z.infer<typeof trackAvailabilityAnnouncementSchema>;
export type PeerSignalMessage = z.infer<typeof peerSignalMessageSchema>;
export type P2PDataMessage = z.infer<typeof p2pDataMessageSchema>;
export type IceServerConfig = z.infer<typeof iceServerConfigSchema>;
export type RoomMediaConnectionState = z.infer<typeof roomMediaConnectionStateSchema>;
export type IceConfigSource = z.infer<typeof iceConfigSourceSchema>;
export type PeerRecentEvent = z.infer<typeof peerRecentEventSchema>;
export type PeerSignalStats = z.infer<typeof peerSignalStatsSchema>;
export type RemoteTrackStatus = z.infer<typeof remoteTrackStatusSchema>;
export type ProgressivePlaybackStatus = z.infer<typeof progressivePlaybackStatusSchema>;
export type PeerDiagnosticsSnapshot = z.infer<typeof peerDiagnosticsSnapshotSchema>;
export type IceConfigResponse = z.infer<typeof iceConfigResponseSchema>;
