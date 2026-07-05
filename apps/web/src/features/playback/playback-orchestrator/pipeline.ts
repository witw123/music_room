import type { PlaybackSnapshot, RoomSnapshot, TrackMeta } from "@music-room/shared";
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

function isSlidingWindowPlaybackSource(source: ProgressivePlaybackSource) {
  return source === "progressive-local" || source === "lossless-local";
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
