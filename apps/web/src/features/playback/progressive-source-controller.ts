import type { ProgressivePlaybackSource } from "./progressive-playback";

export type ProgressiveWarmupDecision = {
  nextSource: ProgressivePlaybackSource;
  nextWarmupReadyAt: number | null;
  clearFallbackReason: boolean;
};

export function getInitialProgressivePlaybackSource(hasFullLocalTrack: boolean) {
  return hasFullLocalTrack ? "full-local" : ("remote-stream" satisfies ProgressivePlaybackSource);
}

export function resolveProgressiveWarmupDecision(input: {
  currentSource: ProgressivePlaybackSource;
  engineReady: boolean;
  startupReady: boolean;
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

  const switchDelayMs = input.switchDelayMs ?? 2_000;
  const maxDriftMs = input.maxDriftMs ?? 250;
  const now = input.now ?? Date.now();
  const stableEnough =
    input.engineReady &&
    input.startupReady &&
    !input.fallbackReason &&
    input.driftMs <= maxDriftMs;

  if (!stableEnough) {
    return {
      nextSource:
        input.currentSource === "progressive-local" ? "progressive-local" : "remote-stream",
      nextWarmupReadyAt: null,
      clearFallbackReason: false
    } satisfies ProgressiveWarmupDecision;
  }

  if (input.currentSource === "progressive-local") {
    return {
      nextSource: "progressive-local",
      nextWarmupReadyAt: input.warmupReadyAt,
      clearFallbackReason: false
    } satisfies ProgressiveWarmupDecision;
  }

  if (input.warmupReadyAt === null) {
    return {
      nextSource: "remote-stream",
      nextWarmupReadyAt: now,
      clearFallbackReason: false
    } satisfies ProgressiveWarmupDecision;
  }

  if (now - input.warmupReadyAt < switchDelayMs) {
    return {
      nextSource: "remote-stream",
      nextWarmupReadyAt: input.warmupReadyAt,
      clearFallbackReason: false
    } satisfies ProgressiveWarmupDecision;
  }

  return {
    nextSource: "progressive-local",
    nextWarmupReadyAt: input.warmupReadyAt,
    clearFallbackReason: true
  } satisfies ProgressiveWarmupDecision;
}
