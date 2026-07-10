import type {
  ProgressiveEngineType,
  ProgressivePlaybackSource
} from "../progressive-playback";
import type {
  PlaybackRecoveryStage,
  SchedulerBudgetTier,
  TransportGovernorMode
} from "./pipeline-types";

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
  serverClockOffsetMs: number | null | undefined;
  serverClockRoundTripMs: number | null | undefined;
  pcmDirectOutputConnected: boolean | null | undefined;
  pcmLastDecodeError: string | null | undefined;
  pcmDecodedSegmentCount: number | null | undefined;
  pcmScheduledSegmentCount: number | null | undefined;
  pcmLastBlockedReason: string | null | undefined;
  startupBufferMs: number;
  comfortBufferedMs: number;
  averageDriftMs: number | null;
  maxDriftMs: number | null;
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
    input.serverClockOffsetMs ?? "",
    input.serverClockRoundTripMs ?? "",
    input.pcmDirectOutputConnected ?? "",
    input.pcmLastDecodeError ?? "",
    (input.pcmDecodedSegmentCount ?? 0) > 0 ? "decoded" : "no-decoded",
    (input.pcmScheduledSegmentCount ?? 0) > 0 ? "scheduled" : "no-scheduled",
    input.pcmLastBlockedReason ?? "",
    input.startupBufferMs,
    input.comfortBufferedMs,
    input.averageDriftMs ?? "",
    input.maxDriftMs ?? "",
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

export function resolveProgressiveDiagnosticBuckets(input: {
  contiguousBufferedMs: number | null | undefined;
  aheadBufferedMs: number | null | undefined;
  estimatedFillTimeMs: number | null | undefined;
  remainingPlaybackMs: number | null | undefined;
  bufferSafetyMarginMs: number | null | undefined;
}) {
  return {
    contiguousBufferedMs: bucketDiagnosticDurationMs(input.contiguousBufferedMs, 1_000),
    aheadBufferedMs: bucketDiagnosticDurationMs(input.aheadBufferedMs, 1_000),
    estimatedFillTimeMs: bucketDiagnosticDurationMs(input.estimatedFillTimeMs, 2_000),
    remainingPlaybackMs: bucketDiagnosticDurationMs(input.remainingPlaybackMs, 5_000),
    bufferSafetyMarginMs: bucketDiagnosticDurationMs(input.bufferSafetyMarginMs, 1_000)
  };
}
