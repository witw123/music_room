import type { RoomSnapshot } from "@music-room/shared";
import type {
  ProgressiveEngineType,
  ProgressivePlaybackSource
} from "../progressive-playback";
import type { PlaybackRecoveryStage } from "./pipeline-types";

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

export function resolveSchedulerBufferHealth(input: {
  waitingEventsLast30s: number;
  stalledEventsLast30s: number;
}) {
  if (input.stalledEventsLast30s > 0) {
    return "critical" as const;
  }

  if (input.waitingEventsLast30s > 0) {
    return "low" as const;
  }

  return "healthy" as const;
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

export function resolveContinuousPlaybackStart(input: {
  activeStartedAtMs: number | null;
  timestampMs: number;
}) {
  return input.activeStartedAtMs ?? input.timestampMs;
}

export function prunePlaybackQualityTimestamps(
  timestamps: readonly number[],
  nowMs: number,
  windowMs: number
) {
  return timestamps.filter((timestampMs) => nowMs - timestampMs <= windowMs);
}

export function appendPlaybackQualityTimestamp(input: {
  timestamps: readonly number[];
  timestampMs: number;
  windowMs: number;
}) {
  return prunePlaybackQualityTimestamps(
    [...input.timestamps, input.timestampMs],
    input.timestampMs,
    input.windowMs
  );
}

export function pruneContinuousPlaybackSegments(
  segments: readonly ContinuousPlaybackSegment[],
  nowMs: number,
  windowMs: number
) {
  const windowStart = nowMs - windowMs;
  return segments.filter((segment) => segment.endedAtMs >= windowStart);
}

export function resolveContinuousPlaybackInterruption(input: {
  segments: readonly ContinuousPlaybackSegment[];
  activeStartedAtMs: number | null;
  timestampMs: number;
  windowMs: number;
}) {
  if (input.activeStartedAtMs === null) {
    return {
      segments: [...input.segments],
      activeStartedAtMs: null
    };
  }

  return {
    segments: pruneContinuousPlaybackSegments(
      [
        ...input.segments,
        {
          startedAtMs: input.activeStartedAtMs,
          endedAtMs: input.timestampMs
        }
      ],
      input.timestampMs,
      input.windowMs
    ),
    activeStartedAtMs: null
  };
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

export function resolveContinuousPlaybackWindowMetrics(input: {
  segments: readonly ContinuousPlaybackSegment[];
  activeStartedAtMs: number | null;
  nowMs: number;
  windowMs: number;
}) {
  const segments = pruneContinuousPlaybackSegments(
    input.segments,
    input.nowMs,
    input.windowMs
  );

  return {
    segments,
    maxContinuousPlaybackMs: resolveMaxContinuousPlaybackMs({
      segments,
      activeStartedAtMs: input.activeStartedAtMs,
      nowMs: input.nowMs,
      windowMs: input.windowMs
    })
  };
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
  progressiveEngineType: ProgressiveEngineType;
  startupBufferMs: number;
}) {
  return [
    input.playbackCurrentTrackId ?? "none",
    input.playbackStatus ?? "none",
    input.playbackMediaEpoch ?? "none",
    input.currentTrackFormatKey,
    input.progressiveManifestKey,
    input.activePlaybackSource,
    input.progressiveEngineType,
    input.startupBufferMs
  ].join("|");
}
