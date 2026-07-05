import type {
  PeerDiagnosticsSnapshot,
  PlaybackSnapshot,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import type {
  ProgressiveEngineType,
  ProgressivePlaybackSource
} from "../progressive-playback";
import type { ProgressivePcmEngineSnapshot } from "../progressive-pcm-engine";

export type PlaybackRecoveryStage =
  | "startup-buffering"
  | "steady"
  | "degraded"
  | "shadow-catchup"
  | "audible-local-fallback";

export type SchedulerBudgetTier = "critical" | "protected" | "comfort" | "expanded";

export type TransportGovernorMode =
  | "bootstrap"
  | "segment-catchup"
  | "local-primary"
  | "emergency-fallback";

export type FullLocalPlaybackSessionState = {
  key: string | null;
  availableInSession: boolean;
};

const fullLocalMaxDriftMs = 180;
const haveCurrentDataReadyState = 2;

type TrackFormatInput = Pick<
  TrackMeta,
  "id" | "fileHash" | "durationMs" | "mimeType" | "codec"
> | null | undefined;

export function buildCurrentTrackFormatKey(track: TrackFormatInput) {
  return [
    track?.id ?? "none",
    track?.fileHash ?? "none",
    track?.durationMs ?? "unknown-duration",
    track?.mimeType ?? "unknown-mime",
    track?.codec ?? "unknown-codec"
  ].join("|");
}

type PlaybackPositionInput = Pick<
  PlaybackSnapshot,
  "status" | "currentTrackId" | "positionMs" | "startedAt" | "mediaEpoch"
> | null | undefined;

export function buildPlaybackPositionKey(playback: PlaybackPositionInput) {
  return [
    playback?.currentTrackId ?? "none",
    playback?.status ?? "none",
    playback?.positionMs ?? "unknown-position",
    playback?.startedAt ?? "not-started",
    playback?.mediaEpoch ?? "unknown-epoch"
  ].join("|");
}

export function buildAvailableChunksKey(chunks: readonly number[] | null | undefined) {
  return chunks?.join(",") ?? "none";
}

export function resolveActiveMemberPeerIds(
  members: readonly { peerId?: string | null }[] | null | undefined
) {
  return new Set(
    members
      ?.map((member) => member.peerId)
      .filter((memberPeerId): memberPeerId is string => !!memberPeerId) ?? []
  );
}

export function resolveAggregatePieceDownloadRateKbps(input: {
  peerDiagnostics: readonly Pick<
    PeerDiagnosticsSnapshot,
    "peerId" | "pieceDownloadRateKbps"
  >[];
  activeMemberPeerIds: ReadonlySet<string>;
}) {
  const values = input.peerDiagnostics
    .filter((snapshot) => input.activeMemberPeerIds.has(snapshot.peerId))
    .map((snapshot) => snapshot.pieceDownloadRateKbps)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0));
}

export function resolveCurrentBufferedFullLocalTrack<TFullLocal, TUploaded>(input: {
  currentTrackId: string | null | undefined;
  fullLocalPlaybackTracks: Record<string, TFullLocal>;
  uploadedTracks: Record<string, TUploaded>;
}): TFullLocal | TUploaded | null {
  return input.currentTrackId
    ? input.fullLocalPlaybackTracks[input.currentTrackId] ??
        input.uploadedTracks[input.currentTrackId] ??
        null
    : null;
}

export function resolveTrackAvailabilityAnnouncement<TAnnouncement>(input: {
  currentTrackId: string | null | undefined;
  availabilityByTrack: Record<string, Record<string, TAnnouncement>>;
  peerId: string;
}): TAnnouncement | null {
  return input.currentTrackId
    ? input.availabilityByTrack[input.currentTrackId]?.[input.peerId] ?? null
    : null;
}

export function resolveNextQueueTrackPrefetch(input: {
  queue: readonly { id: string; trackId: string }[] | null | undefined;
  currentQueueItemId: string | null | undefined;
  currentTrackId: string | null | undefined;
  tracks: readonly { id: string; title: string }[] | null | undefined;
  availabilityByTrack: Record<
    string,
    Record<string, { availableChunks?: readonly unknown[]; totalChunks?: number }>
  >;
  peerId: string;
}) {
  if (!input.queue?.length) {
    return null;
  }

  const currentQueueIndex = input.currentQueueItemId
    ? input.queue.findIndex((item) => item.id === input.currentQueueItemId)
    : input.currentTrackId
      ? input.queue.findIndex((item) => item.trackId === input.currentTrackId)
      : -1;
  const nextQueueItem =
    currentQueueIndex >= 0 ? input.queue[currentQueueIndex + 1] ?? null : null;
  if (!nextQueueItem) {
    return null;
  }

  const nextTrack = input.tracks?.find((track) => track.id === nextQueueItem.trackId) ?? null;
  if (!nextTrack) {
    return null;
  }

  const localAvailability = input.availabilityByTrack[nextTrack.id]?.[input.peerId] ?? null;
  const bufferedChunks = localAvailability?.availableChunks?.length ?? 0;
  const totalChunks = localAvailability?.totalChunks ?? 0;

  return `${nextTrack.title} ${bufferedChunks}/${totalChunks}`;
}

export function isSlidingWindowPlaybackSource(source: ProgressivePlaybackSource) {
  return source === "progressive-local" || source === "lossless-local";
}

export function resolveTransportGovernorMode(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  mediaConnectedPeersCount: number;
  connectedPeersCount: number;
  pendingPlaybackIntent: boolean;
  progressiveFallbackReason: string | null;
  progressiveLocalEligible: boolean;
}): TransportGovernorMode {
  if (
    isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    input.activePlaybackSource === "full-local"
  ) {
    return "local-primary";
  }

  if (
    input.progressiveFallbackReason ||
    input.pendingPlaybackIntent ||
    input.connectedPeersCount <= 0 ||
    !input.progressiveLocalEligible
  ) {
    return "bootstrap";
  }

  return "segment-catchup";
}

export function resolveSourceOwnerIdentity(input: {
  members: readonly { id: string; peerId?: string | null }[] | null | undefined;
  peerId: string;
  playbackSourceSessionId: string | null | undefined;
  playbackSourcePeerId: string | null | undefined;
  isSourceOwner: boolean;
}) {
  return {
    currentSessionUserId:
      input.members?.find((member) => member.peerId === input.peerId)?.id ?? null,
    playbackSourceSessionId: input.playbackSourceSessionId ?? null,
    currentPeerId: input.peerId || null,
    playbackSourcePeerId: input.playbackSourcePeerId ?? null,
    isSourceOwner: input.isSourceOwner
  };
}

export function getSlidingWindowPlayBlockedReason(source: ProgressivePlaybackSource) {
  return source === "lossless-local"
    ? "lossless-local-play-blocked"
    : "progressive-local-play-blocked";
}

export function isRecoverableProgressiveFallbackReason(reason: string | null | undefined) {
  return reason === "buffer-underrun" || reason === "stalled" || reason === "seek-outside-buffer";
}

export function shouldPublishProgressiveDiagnostic(input: {
  previousSignature: string | null;
  nextSignature: string;
}) {
  return input.previousSignature !== input.nextSignature;
}

export function shouldHoldSlidingWindowPlaybackForEngine(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  hasPcmEngine: boolean;
  hasMseEngine: boolean;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  return (
    isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
    hasActiveIntent &&
    !input.hasPcmEngine &&
    !input.hasMseEngine
  );
}

export function shouldResetAudioForPlaybackSurfaceChange(input: {
  previousPlaybackSurfaceKey: string | null | undefined;
  nextPlaybackSurfaceKey: string | null | undefined;
}) {
  return (
    !!input.previousPlaybackSurfaceKey &&
    input.previousPlaybackSurfaceKey !== input.nextPlaybackSurfaceKey
  );
}

export function resolvePlaybackSourceAfterProgressiveRuntimeFailure(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  hasProgressiveRuntimeFailure: boolean;
}) {
  if (
    input.hasProgressiveRuntimeFailure &&
    input.activePlaybackSource === "lossless-local"
  ) {
    return "progressive-local" satisfies ProgressivePlaybackSource;
  }

  return input.activePlaybackSource;
}

export function resolveFullLocalPlaybackSessionState(input: {
  currentSession: FullLocalPlaybackSessionState;
  playbackSurfaceKey: string | null;
  hasBufferedFullLocalTrack: boolean;
}): FullLocalPlaybackSessionState {
  if (input.currentSession.key !== input.playbackSurfaceKey) {
    return {
      key: input.playbackSurfaceKey,
      availableInSession: input.hasBufferedFullLocalTrack
    };
  }

  return {
    key: input.playbackSurfaceKey,
    availableInSession:
      input.currentSession.availableInSession || input.hasBufferedFullLocalTrack
  };
}

export function shouldPreferImmediateFullLocalRecovery(input: {
  isCurrentSourceOwner: boolean;
  audioUnlocked: boolean;
  hasBufferedFullLocalTrack: boolean;
  fullLocalRecoveryActive: boolean;
  recoveryPhase:
    | "joining"
    | "resyncing"
    | "bootstrapping-data"
    | "playing-local-fallback"
    | "steady";
  recoveryMode: "late-join" | "rejoin" | "steady";
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
}) {
  return (
    !input.isCurrentSourceOwner &&
    input.audioUnlocked &&
    input.hasBufferedFullLocalTrack &&
    input.fullLocalRecoveryActive &&
    input.recoveryPhase !== "steady" &&
    input.playbackStatus === "playing"
  );
}

export function shouldEnableFullLocalHandoff(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackRecoveryStage: PlaybackRecoveryStage;
  startupGatePending: boolean;
  localReady: boolean;
  driftMs: number;
  cooldownMs: number;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
    input.activePlaybackSource !== "full-local"
  ) {
    return false;
  }

  if (!input.localReady || input.cooldownMs > 0 || !Number.isFinite(input.driftMs)) {
    return false;
  }

  if (Math.abs(input.driftMs) > fullLocalMaxDriftMs) {
    return false;
  }

  if (input.activePlaybackSource === "full-local") {
    return true;
  }

  if (input.startupGatePending) {
    return false;
  }

  return input.playbackRecoveryStage !== "startup-buffering";
}

export function resolveFullLocalBlockedReason(input: {
  hasBufferedFullLocalTrack: boolean;
  canUseFullLocalForPlaybackSession: boolean;
  isCurrentSourceOwner: boolean;
  listenerLocalTakeoverEnabled: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  startupGatePending: boolean;
  fullLocalRecoveryActive: boolean;
}) {
  if (!input.hasBufferedFullLocalTrack) {
    return "track-not-fully-cached";
  }

  if (!input.canUseFullLocalForPlaybackSession) {
    return "full-local-not-available-at-playback-start";
  }

  if (
    !input.isCurrentSourceOwner &&
    !input.listenerLocalTakeoverEnabled &&
    input.activePlaybackSource !== "full-local"
  ) {
    return "listener-handoff-disabled";
  }

  if (input.startupGatePending && !input.fullLocalRecoveryActive) {
    return "cache-recovery-window";
  }

  return null;
}

export function shouldRecoverPausedFullLocalPlayback(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  audioUnlocked: boolean;
  localAudioPaused: boolean | null | undefined;
  localAudioReadyState: number | null | undefined;
  localAudioHasSrc: boolean;
  localAudioHasSrcObject: boolean;
}) {
  if (
    input.activePlaybackSource !== "full-local" ||
    input.playbackStatus !== "playing" ||
    !input.currentTrackId ||
    input.localAudioPaused !== true
  ) {
    return false;
  }

  return (
    input.localAudioHasSrcObject ||
    input.localAudioHasSrc ||
    (typeof input.localAudioReadyState === "number" &&
      input.localAudioReadyState >= haveCurrentDataReadyState) ||
    input.audioUnlocked
  );
}

export function shouldRecoverSilentSlidingWindowWithFullLocal(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  canUseFullLocalForPlaybackSession: boolean;
  fullLocalBlockedReason: string | null | undefined;
  slidingWindowStartupReady: boolean;
  localAudioPaused: boolean | null | undefined;
  localAudioMuted: boolean | null | undefined;
  localAudioVolume: number | null | undefined;
  localAudioReadyState: number | null | undefined;
  localAudioHasSrc: boolean;
  localAudioHasSrcObject: boolean;
  pcmAudioContextState: string | null | undefined;
  pcmDirectOutputConnected: boolean | null | undefined;
  pcmDecodedSegmentCount: number | null | undefined;
  pcmScheduledSegmentCount: number | null | undefined;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  if (
    !hasActiveIntent ||
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    !input.canUseFullLocalForPlaybackSession ||
    input.fullLocalBlockedReason !== null ||
    !input.slidingWindowStartupReady
  ) {
    return false;
  }

  const pcmElementOutputAudible =
    input.localAudioHasSrcObject &&
    input.localAudioPaused === false &&
    input.localAudioMuted !== true &&
    input.localAudioVolume !== 0;
  const pcmOutputAudible =
    input.pcmAudioContextState === "running" &&
    (input.pcmDecodedSegmentCount ?? 0) > 0 &&
    (input.pcmScheduledSegmentCount ?? 0) > 0 &&
    (input.pcmDirectOutputConnected !== false || pcmElementOutputAudible);
  if (pcmOutputAudible) {
    return false;
  }

  const hasPlayableElementOutput =
    (input.localAudioReadyState ?? 0) >= haveCurrentDataReadyState ||
    input.localAudioHasSrcObject ||
    input.localAudioHasSrc;

  return (
    input.localAudioPaused !== false ||
    input.localAudioMuted === true ||
    input.localAudioVolume === 0 ||
    !hasPlayableElementOutput
  );
}

export function resolveAudibleLocalFallbackActive(input: {
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveFallbackReason: string | null | undefined;
}) {
  return (
    !input.isCurrentSourceOwner &&
    (isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
      input.activePlaybackSource === "full-local") &&
    shouldPreferLocalTakeover({
      progressiveFallbackReason: input.progressiveFallbackReason
    })
  );
}

export function shouldAllowLocalTakeover(input: {
  listenerLocalTakeoverEnabled: boolean;
  nowMs: number;
  cooldownUntilMs: number;
  immediateFullLocalRecoveryEligible: boolean;
  canUseFullLocalForPlaybackSession: boolean;
  connectedPeersCount: number;
}) {
  return (
    input.listenerLocalTakeoverEnabled &&
    input.nowMs >= input.cooldownUntilMs &&
    (input.immediateFullLocalRecoveryEligible ||
      input.canUseFullLocalForPlaybackSession ||
      input.connectedPeersCount > 0)
  );
}

export function shouldSkipSecondaryPcmWarmupSync(input: {
  engineType: ProgressiveEngineType;
  engineReady: boolean;
  localReady: boolean;
}) {
  return input.engineType === "pcm" && (!input.engineReady || !input.localReady);
}

export function getAudibleElementVolume(userVolume: number) {
  if (!Number.isFinite(userVolume) || userVolume <= 0) {
    return 0.72;
  }

  return Math.min(1, userVolume);
}

export function resolveLocalAudioDiagnostics(
  localAudio:
    | Pick<
        HTMLAudioElement,
        "paused" | "muted" | "volume" | "readyState" | "currentSrc" | "srcObject"
      >
    | null
    | undefined
) {
  if (!localAudio) {
    return {
      localAudioPaused: null,
      localAudioMuted: null,
      localAudioVolume: null,
      localAudioReadyState: null,
      localAudioCurrentSrc: null,
      localAudioHasSrcObject: null
    };
  }

  return {
    localAudioPaused: localAudio.paused,
    localAudioMuted: localAudio.muted,
    localAudioVolume: localAudio.volume,
    localAudioReadyState: localAudio.readyState,
    localAudioCurrentSrc: localAudio.currentSrc || null,
    localAudioHasSrcObject: !!localAudio.srcObject
  };
}

export type ProgressiveDiagnosticSignatureInput = {
  activeSource: ProgressivePlaybackSource;
  playbackSurfaceKey: string | null;
  playbackTimelineKey: string | null;
  recoveryPhase: string;
  recoveryMode: string;
  recoveryGeneration: number | null;
  fullLocalRecoveryActive: boolean;
  transportGovernorMode: TransportGovernorMode;
  engineType: ProgressiveEngineType;
  contiguousBufferedMs: string | number;
  aheadBufferedMs: string | number;
  schedulerPolicy: string | null;
  startupReady: boolean;
  fallbackReason: string | null | undefined;
  estimatedFillTimeMs: string | number;
  remainingPlaybackMs: string | number;
  bufferSafetyMarginMs: string | number;
  playbackStartIntentLabel: string | null | undefined;
  intentMatchedSource: ProgressivePlaybackSource | null | undefined;
  lastPlayStartFailure: string | null | undefined;
  nextQueueTrackPrefetch: string | null | undefined;
  localTakeoverCooldownActive: boolean;
  progressiveLocalEligible: boolean;
  progressiveLocalBlockedReason: string | null | undefined;
  fullLocalReady: boolean;
  fullLocalEligible: boolean;
  fullLocalBlockedReason: string | null | undefined;
  currentSessionUserId: string | null | undefined;
  playbackSourceSessionId: string | null | undefined;
  currentPeerId: string | null | undefined;
  playbackSourcePeerId: string | null | undefined;
  isSourceOwner: boolean;
  localAudioPaused: boolean | null;
  localAudioMuted: boolean | null;
  localAudioVolume: number | null;
  localAudioReadyState: number | null;
  localAudioCurrentSrc: string | null;
  localAudioHasSrcObject: boolean | null;
  pcmEngineStatus: string | null | undefined;
  pcmAudioContextState: string | null | undefined;
  pcmDirectOutputConnected: boolean | null | undefined;
  pcmLastDecodeError: string | null | undefined;
  pcmDecodedSegmentCount: number | null | undefined;
  pcmScheduledSegmentCount: number | null | undefined;
  pcmLastBlockedReason: string | null | undefined;
  startupBufferMs: number;
  comfortBufferedMs: number;
  waitingEventsLast30s: number;
  stalledEventsLast30s: number;
  shadowWarmupActive: boolean;
  playbackRecoveryStage: PlaybackRecoveryStage;
  audibleLocalFallbackActive: boolean;
  schedulerBudgetTier: SchedulerBudgetTier;
  lastStablePlaybackAt: string | null | undefined;
};

export function resolveProgressiveDiagnosticSignature(
  input: ProgressiveDiagnosticSignatureInput
) {
  return [
    input.activeSource,
    input.playbackSurfaceKey,
    input.playbackTimelineKey,
    input.recoveryPhase,
    input.recoveryMode,
    input.recoveryGeneration,
    input.fullLocalRecoveryActive,
    input.transportGovernorMode,
    input.engineType,
    input.contiguousBufferedMs,
    input.aheadBufferedMs,
    input.schedulerPolicy,
    input.startupReady,
    input.fallbackReason ?? "",
    input.estimatedFillTimeMs,
    input.remainingPlaybackMs,
    input.bufferSafetyMarginMs,
    input.playbackStartIntentLabel ?? "",
    input.intentMatchedSource ?? "",
    input.lastPlayStartFailure ?? "",
    input.nextQueueTrackPrefetch ?? "",
    input.localTakeoverCooldownActive ? "cooldown" : "no-cooldown",
    input.progressiveLocalEligible,
    input.progressiveLocalBlockedReason ?? "",
    input.fullLocalReady,
    input.fullLocalEligible,
    input.fullLocalBlockedReason ?? "",
    input.currentSessionUserId ?? "",
    input.playbackSourceSessionId ?? "",
    input.currentPeerId ?? "",
    input.playbackSourcePeerId ?? "",
    input.isSourceOwner,
    input.localAudioPaused ?? "",
    input.localAudioMuted ?? "",
    input.localAudioVolume ?? "",
    input.localAudioReadyState ?? "",
    input.localAudioCurrentSrc ? "src" : "no-src",
    input.localAudioHasSrcObject ?? "",
    input.pcmEngineStatus ?? "",
    input.pcmAudioContextState ?? "",
    input.pcmDirectOutputConnected ?? "",
    input.pcmLastDecodeError ?? "",
    (input.pcmDecodedSegmentCount ?? 0) > 0 ? "decoded" : "no-decoded",
    (input.pcmScheduledSegmentCount ?? 0) > 0 ? "scheduled" : "no-scheduled",
    input.pcmLastBlockedReason ?? "",
    input.startupBufferMs,
    input.comfortBufferedMs,
    input.waitingEventsLast30s,
    input.stalledEventsLast30s,
    input.shadowWarmupActive,
    input.playbackRecoveryStage,
    input.audibleLocalFallbackActive,
    input.schedulerBudgetTier,
    input.lastStablePlaybackAt ?? ""
  ].join("|");
}

export function bucketDiagnosticDurationMs(
  value: number | null | undefined,
  bucketMs: number
) {
  if (value === null || typeof value === "undefined" || !Number.isFinite(value)) {
    return "";
  }

  return Math.round(value / bucketMs) * bucketMs;
}

export function getPcmEngineDiagnosticsKey(
  snapshot: ProgressivePcmEngineSnapshot | null | undefined
) {
  if (!snapshot) {
    return "none";
  }

  return [
    snapshot.status,
    snapshot.audioContextState ?? "none",
    snapshot.directOutputConnected ? "direct" : "no-direct",
    snapshot.decodedSegmentCount > 0 ? "decoded" : "no-decoded",
    snapshot.scheduledSegmentCount > 0 ? "scheduled" : "no-scheduled",
    snapshot.lastDecodeError ?? "none"
  ].join("|");
}

export function resolveMediaElementPlaybackRole(input: {
  target: "local" | "remote";
  activePlaybackSource: ProgressivePlaybackSource;
  shadowWarmupActive: boolean;
}) {
  if (input.target === "local") {
    return "audible-local" as const;
  }

  return "inactive" as const;
}

export function shouldWarmFullLocalWithSharedAudioElement(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
  canUseFullLocalForPlaybackSession: boolean;
  isCurrentSourceOwner: boolean;
}) {
  return (
    input.canUseFullLocalForPlaybackSession &&
    !input.isCurrentSourceOwner &&
    input.activePlaybackSource !== "full-local" &&
    input.progressiveEngineType === "none"
  );
}

export function hasSufficientBackingForFullLocalWarmup(input: {
  progressiveEngineType: ProgressiveEngineType;
  aheadBufferedMs: number;
  requiredAheadMs: number;
}) {
  if (input.progressiveEngineType === "none") {
    return true;
  }

  return input.aheadBufferedMs >= input.requiredAheadMs;
}

export function shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
  canUseFullLocalForPlaybackSession: boolean;
  fullLocalBlockedReason: string | null | undefined;
  localTakeoverAllowed: boolean;
  aheadBufferedMs: number;
  comfortBufferMs: number;
  warmupReadyAt: number | null;
  now: number;
  switchDelayMs: number;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    input.progressiveEngineType !== "none"
  ) {
    return false;
  }

  if (
    !input.canUseFullLocalForPlaybackSession ||
    input.fullLocalBlockedReason !== null ||
    !input.localTakeoverAllowed ||
    !hasSufficientBackingForFullLocalWarmup({
      progressiveEngineType: input.progressiveEngineType,
      aheadBufferedMs: input.aheadBufferedMs,
      requiredAheadMs: input.comfortBufferMs
    }) ||
    input.warmupReadyAt === null
  ) {
    return false;
  }

  return input.now - input.warmupReadyAt >= input.switchDelayMs;
}

export function shouldPrepareProgressiveRuntimeForSource(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
}) {
  return (
    input.progressiveEngineType !== "none" &&
    input.activePlaybackSource !== "full-local"
  );
}

export function shouldStartListenerProgressivePlayback(input: {
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  engineType: ProgressiveEngineType;
  startupReady: boolean;
  hasFullLocalTrack: boolean;
  progressiveFallbackReason: string | null | undefined;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  if (
    input.isCurrentSourceOwner ||
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    !hasActiveIntent ||
    input.engineType === "none" ||
    input.progressiveFallbackReason === "progressive-init-failed"
  ) {
    return false;
  }

  return input.startupReady;
}

export function shouldAttemptProgressiveLocalPlayback(input: {
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  engineType: ProgressiveEngineType;
  startupReady: boolean;
  hasFullLocalTrack: boolean;
  progressiveFallbackReason: string | null | undefined;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    !hasActiveIntent ||
    input.engineType === "none" ||
    input.progressiveFallbackReason === "progressive-init-failed"
  ) {
    return false;
  }

  if (input.isCurrentSourceOwner) {
    return true;
  }

  return shouldStartListenerProgressivePlayback(input);
}

export function resolveProgressiveLocalBlockedReason(input: {
  hasManifest: boolean;
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  engineType: ProgressiveEngineType;
  startupReady: boolean;
  hasFullLocalTrack: boolean;
  progressiveFallbackReason: string | null | undefined;
  localTakeoverCooldownMs: number;
  connectedPeersCount: number;
  aggregatePieceDownloadRateKbps: number | null;
  progressiveTakeoverReady: boolean;
}) {
  if (!input.hasManifest || input.engineType === "none") {
    return "progressive-engine-unavailable";
  }

  if (input.playbackStatus !== "playing" && input.playbackStatus !== "buffering") {
    return "playback-paused";
  }

  if (
    input.progressiveFallbackReason &&
    !isRecoverableProgressiveFallbackReason(input.progressiveFallbackReason)
  ) {
    return input.progressiveFallbackReason;
  }

  if (
    shouldAttemptProgressiveLocalPlayback({
      isCurrentSourceOwner: input.isCurrentSourceOwner,
      activePlaybackSource: input.activePlaybackSource,
      playbackStatus: input.playbackStatus,
      engineType: input.engineType,
      startupReady: input.startupReady,
      hasFullLocalTrack: input.hasFullLocalTrack,
      progressiveFallbackReason: input.progressiveFallbackReason
    })
  ) {
    return null;
  }

  if (input.localTakeoverCooldownMs > 0) {
    return "takeover-cooldown";
  }

  if (input.connectedPeersCount <= 0) {
    return "data-channel-not-ready";
  }

  if (
    input.aggregatePieceDownloadRateKbps === null ||
    !Number.isFinite(input.aggregatePieceDownloadRateKbps) ||
    input.aggregatePieceDownloadRateKbps <= 0
  ) {
    return "piece-download-not-ready";
  }

  if (!input.progressiveTakeoverReady) {
    return "local-prefix-not-ready";
  }

  return null;
}

export function shouldStartPcmSlidingWindowAudioElement(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  localReady: boolean;
  audioPaused: boolean;
  lastAttemptAtMs: number | null;
  nowMs: number;
  retryIntervalMs: number;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    (input.playbackStatus !== "playing" && input.playbackStatus !== "buffering") ||
    !input.localReady ||
    !input.audioPaused
  ) {
    return false;
  }

  return (
    input.lastAttemptAtMs === null ||
    input.nowMs - input.lastAttemptAtMs >= input.retryIntervalMs
  );
}

export function shouldUsePcmEngineForFullLocal(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  forceSourceOwnerLocalPlayback: boolean;
  sourceOwnerHasLocalTrack: boolean;
  hasFullLocalTrack: boolean;
  progressiveEngineType: ProgressiveEngineType;
}) {
  const wantsFullLocalPlayback =
    input.activePlaybackSource === "full-local" ||
    input.forceSourceOwnerLocalPlayback ||
    input.sourceOwnerHasLocalTrack;

  return (
    wantsFullLocalPlayback &&
    !input.hasFullLocalTrack &&
    input.progressiveEngineType === "pcm"
  );
}

export function resolvePlaybackRecoveryStage(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  startupGatePending: boolean;
  waitingEventsLast30s: number;
  stalledEventsLast30s: number;
  shadowWarmupActive: boolean;
  audibleLocalFallbackActive: boolean;
}) {
  if (input.audibleLocalFallbackActive) {
    return "audible-local-fallback" as const;
  }

  if (input.playbackStatus !== "playing" || input.startupGatePending) {
    return "startup-buffering" as const;
  }

  if (input.stalledEventsLast30s > 0 || input.waitingEventsLast30s > 0) {
    return "degraded" as const;
  }

  return "steady" as const;
}

export function resolveSchedulerBudgetTier(input: {
  bufferHealth: "healthy" | "low" | "critical";
  activePlaybackSource: ProgressivePlaybackSource;
  playbackRecoveryStage: PlaybackRecoveryStage;
}) {
  if (input.bufferHealth === "critical" || input.playbackRecoveryStage === "audible-local-fallback") {
    return "critical" as const;
  }

  if (
    input.playbackRecoveryStage === "startup-buffering" ||
    input.playbackRecoveryStage === "degraded"
  ) {
    return "protected" as const;
  }

  return "expanded" as const;
}

export function resolveEffectiveStartupBufferMs(input: {
  baseStartupBufferMs: number;
  waitingEventsLast30s: number;
  stalledEventsLast30s: number;
}) {
  if (input.stalledEventsLast30s > 0) {
    return input.baseStartupBufferMs + 220;
  }

  if (input.waitingEventsLast30s >= 2) {
    return input.baseStartupBufferMs + 140;
  }

  if (input.waitingEventsLast30s > 0) {
    return input.baseStartupBufferMs + 80;
  }

  return input.baseStartupBufferMs;
}

export function resolvePlaybackQualityMetrics(input: {
  nowMs: number;
  windowMs: number;
  waitingEventTimestamps: readonly number[];
  stalledEventTimestamps: readonly number[];
  driftSamples: readonly { timestampMs: number; driftMs: number }[];
  maxContinuousPlaybackMsLast30s: number;
}) {
  const waitingEvents = input.waitingEventTimestamps.filter(
    (timestampMs) => input.nowMs - timestampMs <= input.windowMs
  );
  const stalledEvents = input.stalledEventTimestamps.filter(
    (timestampMs) => input.nowMs - timestampMs <= input.windowMs
  );
  const driftSamples = input.driftSamples.filter(
    (sample) => input.nowMs - sample.timestampMs <= input.windowMs
  );
  const averageDriftMs =
    driftSamples.length > 0
      ? Math.round(
          driftSamples.reduce((sum, sample) => sum + sample.driftMs, 0) / driftSamples.length
        )
      : null;
  const maxDriftMs =
    driftSamples.length > 0
      ? Math.round(driftSamples.reduce((max, sample) => Math.max(max, sample.driftMs), 0))
      : null;

  return {
    waitingEventsLast30s: waitingEvents.length,
    stalledEventsLast30s: stalledEvents.length,
    averageDriftMs,
    maxDriftMs,
    maxContinuousPlaybackMsLast30s: input.maxContinuousPlaybackMsLast30s
  };
}

export type ContinuousPlaybackSegment = {
  startedAtMs: number;
  endedAtMs: number;
};

export function prunePlaybackQualityTimestamps(
  timestamps: readonly number[],
  nowMs: number,
  windowMs: number
) {
  return timestamps.filter((timestampMs) => nowMs - timestampMs <= windowMs);
}

export function pruneContinuousPlaybackSegments(
  segments: readonly ContinuousPlaybackSegment[],
  nowMs: number,
  windowMs: number
) {
  const windowStart = nowMs - windowMs;
  return segments.filter((segment) => segment.endedAtMs >= windowStart);
}

export function resolveMaxContinuousPlaybackMs(input: {
  segments: readonly ContinuousPlaybackSegment[];
  activeStartedAtMs: number | null;
  nowMs: number;
  windowMs: number;
}) {
  const windowStart = input.nowMs - input.windowMs;
  let maxDurationMs = 0;

  for (const segment of input.segments) {
    const startedAtMs = Math.max(segment.startedAtMs, windowStart);
    const endedAtMs = Math.min(segment.endedAtMs, input.nowMs);
    if (endedAtMs > startedAtMs) {
      maxDurationMs = Math.max(maxDurationMs, endedAtMs - startedAtMs);
    }
  }

  if (input.activeStartedAtMs !== null) {
    maxDurationMs = Math.max(
      maxDurationMs,
      input.nowMs - Math.max(input.activeStartedAtMs, windowStart)
    );
  }

  return maxDurationMs;
}

export type PlaybackDriftSample = {
  timestampMs: number;
  driftMs: number;
};

export function appendPlaybackDriftSample(input: {
  samples: readonly PlaybackDriftSample[];
  driftMs: number;
  timestampMs: number;
  windowMs: number;
}) {
  if (!Number.isFinite(input.driftMs)) {
    return input.samples;
  }

  return [
    ...input.samples,
    {
      timestampMs: input.timestampMs,
      driftMs: Math.abs(input.driftMs)
    }
  ].filter((sample) => input.timestampMs - sample.timestampMs <= input.windowMs);
}

export function resolveBufferSafetyMarginMs(input: {
  aheadBufferedMs: number;
  estimatedFillTimeMs: number | null;
}) {
  if (input.estimatedFillTimeMs === null) {
    return null;
  }

  return input.aheadBufferedMs - input.estimatedFillTimeMs;
}

export function shouldPreferLocalTakeover(input: {
  progressiveFallbackReason: string | null | undefined;
}) {
  return (
    input.progressiveFallbackReason === "buffer-underrun" ||
    input.progressiveFallbackReason === "stalled" ||
    input.progressiveFallbackReason === "seek-outside-buffer"
  );
}

export function buildProgressiveWarmupTimerKey(input: {
  playbackCurrentTrackId: string | null;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null;
  playbackMediaEpoch: number | null;
  currentTrackFormatKey: string;
  progressiveManifestKey: string;
  activePlaybackSource: ProgressivePlaybackSource;
  canUseFullLocalForPlaybackSession: boolean;
  progressiveEngineType: ProgressiveEngineType;
  progressiveStartupReady: boolean;
  startupBufferMs: number;
  progressiveLocalBlockedReason: string | null;
  isCurrentSourceOwner: boolean;
  playbackRecoveryStage: PlaybackRecoveryStage;
  progressiveFallbackReason: string | null;
  stalledEventsLast30s: number;
  waitingEventsLast30s: number;
}) {
  return [
    input.playbackCurrentTrackId ?? "none",
    input.playbackStatus ?? "none",
    input.playbackMediaEpoch ?? "none",
    input.currentTrackFormatKey,
    input.progressiveManifestKey,
    input.activePlaybackSource,
    input.canUseFullLocalForPlaybackSession ? "full-local-ready" : "full-local-missing",
    input.progressiveEngineType,
    input.progressiveStartupReady ? "startup-ready" : "startup-pending",
    input.startupBufferMs,
    input.progressiveLocalBlockedReason ?? "unblocked",
    input.isCurrentSourceOwner ? "source-owner" : "listener",
    input.playbackRecoveryStage,
    input.progressiveFallbackReason ?? "no-fallback",
    input.stalledEventsLast30s,
    input.waitingEventsLast30s
  ].join("|");
}
