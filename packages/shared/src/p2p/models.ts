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
  totalChunks: z.number().int().nonnegative(),
  chunkSize: z.number().int().positive(),
  availableChunks: z.array(z.number().int().nonnegative()),
  source: z.enum(["live_upload", "local_cache"]),
  announcedAt: z.string().datetime()
});

export const peerSignalMessageSchema = z.object({
  roomId: z.string(),
  fromPeerId: z.string(),
  toPeerId: z.string(),
  channelKind: z.enum(["data", "media"]),
  mediaEpoch: z.number().int().nonnegative().optional(),
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
    kind: z.literal("send-piece"),
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
  lastAudioEvent: z.enum(["playing", "waiting", "pause", "error"]).nullable()
});

export const progressivePlaybackStatusSchema = z.object({
  activeSource: z.enum(["remote-stream", "progressive-local", "full-local"]).nullable(),
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
  startupBufferMs: z.number().int().nonnegative().nullable().optional(),
  lastStablePlaybackAt: z.string().datetime().nullable().optional()
});

export const peerDiagnosticsSnapshotSchema = z.object({
  peerId: z.string(),
  dataConnectionState: z.string().nullable(),
  dataChannelState: z.string().nullable().optional(),
  mediaConnectionState: z.string().nullable(),
  dataIceState: z.string().nullable(),
  mediaIceState: z.string().nullable(),
  transportHealth: z.enum(["healthy", "media-only", "reconnecting", "failed"]).nullable().optional(),
  degradedReason: z.string().nullable().optional(),
  lastAvailabilitySeenAt: z.string().datetime().nullable().optional(),
  lastPieceReceivedAt: z.string().datetime().nullable().optional(),
  dataCandidateType: z.string().nullable(),
  mediaCandidateType: z.string().nullable(),
  mediaProtocol: z.string().nullable(),
  currentRoundTripTimeMs: z.number().nonnegative().nullable(),
  availableOutgoingBitrateKbps: z.number().nonnegative().nullable(),
  targetAudioBitrateKbps: z.number().nonnegative().nullable().optional(),
  packetLossRate: z.number().nonnegative().nullable().optional(),
  receiverJitterTargetMs: z.number().nonnegative().nullable().optional(),
  startupBufferMs: z.number().nonnegative().nullable().optional(),
  lastStablePlaybackAt: z.string().datetime().nullable().optional(),
  mediaReceiveBitrateKbps: z.number().nonnegative().nullable(),
  mediaSendBitrateKbps: z.number().nonnegative().nullable(),
  pieceDownloadRateKbps: z.number().nonnegative().nullable(),
  pieceUploadRateKbps: z.number().nonnegative().nullable(),
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
