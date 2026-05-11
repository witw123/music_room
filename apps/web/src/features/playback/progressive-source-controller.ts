import {
  getFullLocalStableWindowMs,
  type ProgressivePlaybackSource
} from "./progressive-playback";

export type ProgressiveWarmupDecision = {
  nextSource: ProgressivePlaybackSource;
  nextWarmupReadyAt: number | null;
  clearFallbackReason: boolean;
};

type BufferedLocalWarmupTarget = Extract<
  ProgressivePlaybackSource,
  "progressive-local" | "full-local"
>;

export function getInitialProgressivePlaybackSource(hasFullLocalTrack: boolean) {
  return hasFullLocalTrack ? "full-local" : ("progressive-local" satisfies ProgressivePlaybackSource);
}

export function shouldForceSourceOwnerLocalPlayback(input: {
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  hasFullLocalTrack: boolean;
}) {
  return (
    input.isCurrentSourceOwner &&
    input.hasFullLocalTrack &&
    input.activePlaybackSource !== "full-local"
  );
}

function resolveBufferedLocalWarmupDecision(input: {
  currentSource: ProgressivePlaybackSource;
  targetSource: BufferedLocalWarmupTarget;
  ready: boolean;
  fallbackReason: string | null;
  driftMs: number;
  warmupReadyAt: number | null;
  now?: number;
  switchDelayMs?: number;
  maxDriftMs?: number;
}) {
  if (input.currentSource === "full-local") {
    return {
      nextSource: "full-local",
      nextWarmupReadyAt: null,
      clearFallbackReason: false
    } satisfies ProgressiveWarmupDecision;
  }

  const switchDelayMs = input.switchDelayMs ?? getFullLocalStableWindowMs();
  const maxDriftMs = input.maxDriftMs ?? 180;
  const now = input.now ?? Date.now();
  const stableEnough = input.ready && !input.fallbackReason && input.driftMs <= maxDriftMs;

  if (!stableEnough) {
    return {
      nextSource: input.targetSource,
      nextWarmupReadyAt: null,
      clearFallbackReason: false
    } satisfies ProgressiveWarmupDecision;
  }

  if (input.currentSource === input.targetSource) {
    return {
      nextSource: input.targetSource,
      nextWarmupReadyAt: input.warmupReadyAt,
      clearFallbackReason: false
    } satisfies ProgressiveWarmupDecision;
  }

  if (input.warmupReadyAt === null) {
    return {
      nextSource: input.targetSource,
      nextWarmupReadyAt: now,
      clearFallbackReason: false
    } satisfies ProgressiveWarmupDecision;
  }

  if (now - input.warmupReadyAt < switchDelayMs) {
    return {
      nextSource: input.targetSource,
      nextWarmupReadyAt: input.warmupReadyAt,
      clearFallbackReason: false
    } satisfies ProgressiveWarmupDecision;
  }

  return {
    nextSource: input.targetSource,
    nextWarmupReadyAt: input.warmupReadyAt,
    clearFallbackReason: true
  } satisfies ProgressiveWarmupDecision;
}

export function resolveProgressiveWarmupDecision(input: {
  currentSource: ProgressivePlaybackSource;
  engineReady: boolean;
  activationReady: boolean;
  fallbackReason: string | null;
  driftMs: number;
  warmupReadyAt: number | null;
  now?: number;
  switchDelayMs?: number;
  maxDriftMs?: number;
}) {
  return resolveBufferedLocalWarmupDecision({
    currentSource: input.currentSource,
    targetSource: "progressive-local",
    ready: input.engineReady && input.activationReady,
    fallbackReason: input.fallbackReason,
    driftMs: input.driftMs,
    warmupReadyAt: input.warmupReadyAt,
    now: input.now,
    switchDelayMs: input.switchDelayMs,
    maxDriftMs: input.maxDriftMs
  });
}

export function resolveFullLocalWarmupDecision(input: {
  currentSource: ProgressivePlaybackSource;
  localReady: boolean;
  driftMs: number;
  warmupReadyAt: number | null;
  now?: number;
  switchDelayMs?: number;
  maxDriftMs?: number;
}) {
  return resolveBufferedLocalWarmupDecision({
    currentSource: input.currentSource,
    targetSource: "full-local",
    ready: input.localReady,
    fallbackReason: null,
    driftMs: input.driftMs,
    warmupReadyAt: input.warmupReadyAt,
    now: input.now,
    switchDelayMs: input.switchDelayMs,
    maxDriftMs: input.maxDriftMs
  });
}
