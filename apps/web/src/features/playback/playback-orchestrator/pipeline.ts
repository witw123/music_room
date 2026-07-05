import type { PlaybackSnapshot, RoomSnapshot, TrackMeta } from "@music-room/shared";
import type {
  ProgressiveEngineType,
  ProgressivePlaybackSource
} from "../progressive-playback";

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
