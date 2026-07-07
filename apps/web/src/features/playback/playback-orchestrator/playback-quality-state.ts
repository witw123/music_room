"use client";

import { useCallback, useMemo, useRef, type RefObject } from "react";
import {
  appendPlaybackDriftSample,
  appendPlaybackQualityTimestamp,
  resolveContinuousPlaybackInterruption,
  resolveContinuousPlaybackStart,
  resolveContinuousPlaybackWindowMetrics,
  resolveLocalAudioDiagnostics,
  resolvePlaybackQualityMetrics,
  type ContinuousPlaybackSegment,
  type PlaybackDriftSample
} from "./pipeline";

const playbackQualityWindowMs = 30_000;

type PlaybackQualityResetState = {
  waitingEventTimestamps?: readonly number[];
  stalledEventTimestamps?: readonly number[];
  driftSamples?: readonly PlaybackDriftSample[];
  continuousPlaybackStartedAt?: number | null;
  continuousPlaybackSegments?: readonly ContinuousPlaybackSegment[];
};

type PlaybackQualityStateInput = {
  audioRef: RefObject<HTMLAudioElement | null>;
};

export function usePlaybackQualityState({ audioRef }: PlaybackQualityStateInput) {
  const waitingEventTimestampsRef = useRef<number[]>([]);
  const stalledEventTimestampsRef = useRef<number[]>([]);
  const driftSamplesRef = useRef<readonly PlaybackDriftSample[]>([]);
  const continuousPlaybackStartedAtRef = useRef<number | null>(null);
  const continuousPlaybackSegmentsRef = useRef<ContinuousPlaybackSegment[]>([]);

  const localAudioDiagnostics = resolveLocalAudioDiagnostics(audioRef.current);

  const recordQualityEvent = useCallback(
    (targetRef: typeof waitingEventTimestampsRef, timestampMs = Date.now()) => {
      targetRef.current = appendPlaybackQualityTimestamp({
        timestamps: targetRef.current,
        timestampMs,
        windowMs: playbackQualityWindowMs
      });
    },
    []
  );

  const recordWaitingEvent = useCallback(
    (timestampMs = Date.now()) => recordQualityEvent(waitingEventTimestampsRef, timestampMs),
    [recordQualityEvent]
  );

  const recordStalledEvent = useCallback(
    (timestampMs = Date.now()) => recordQualityEvent(stalledEventTimestampsRef, timestampMs),
    [recordQualityEvent]
  );

  const markContinuousPlaybackStarted = useCallback((timestampMs = Date.now()) => {
    continuousPlaybackStartedAtRef.current = resolveContinuousPlaybackStart({
      activeStartedAtMs: continuousPlaybackStartedAtRef.current,
      timestampMs
    });
  }, []);

  const markContinuousPlaybackInterrupted = useCallback((timestampMs = Date.now()) => {
    const nextState = resolveContinuousPlaybackInterruption({
      segments: continuousPlaybackSegmentsRef.current,
      activeStartedAtMs: continuousPlaybackStartedAtRef.current,
      timestampMs,
      windowMs: playbackQualityWindowMs
    });
    continuousPlaybackSegmentsRef.current = [...nextState.segments];
    continuousPlaybackStartedAtRef.current = nextState.activeStartedAtMs;
  }, []);

  const getMaxContinuousPlaybackMsLast30s = useCallback((now = Date.now()) => {
    const nextState = resolveContinuousPlaybackWindowMetrics({
      segments: continuousPlaybackSegmentsRef.current,
      activeStartedAtMs: continuousPlaybackStartedAtRef.current,
      nowMs: now,
      windowMs: playbackQualityWindowMs
    });
    continuousPlaybackSegmentsRef.current = [...nextState.segments];
    return nextState.maxContinuousPlaybackMs;
  }, []);

  const recordDriftSample = useCallback((driftMs: number, timestampMs = Date.now()) => {
    driftSamplesRef.current = appendPlaybackDriftSample({
      samples: driftSamplesRef.current,
      driftMs,
      timestampMs,
      windowMs: playbackQualityWindowMs
    });
  }, []);

  const resetPlaybackQualityState = useCallback((state: PlaybackQualityResetState = {}) => {
    waitingEventTimestampsRef.current = [...(state.waitingEventTimestamps ?? [])];
    stalledEventTimestampsRef.current = [...(state.stalledEventTimestamps ?? [])];
    driftSamplesRef.current = state.driftSamples ?? [];
    continuousPlaybackStartedAtRef.current = state.continuousPlaybackStartedAt ?? null;
    continuousPlaybackSegmentsRef.current = [...(state.continuousPlaybackSegments ?? [])];
  }, []);

  const playbackQualityMetrics = useMemo(() => {
    const now = Date.now();
    return resolvePlaybackQualityMetrics({
      nowMs: now,
      windowMs: playbackQualityWindowMs,
      waitingEventTimestamps: waitingEventTimestampsRef.current,
      stalledEventTimestamps: stalledEventTimestampsRef.current,
      driftSamples: driftSamplesRef.current,
      maxContinuousPlaybackMsLast30s: getMaxContinuousPlaybackMsLast30s(now)
    });
  }, [getMaxContinuousPlaybackMsLast30s]);

  return {
    localAudioDiagnostics,
    markContinuousPlaybackInterrupted,
    markContinuousPlaybackStarted,
    playbackQualityMetrics,
    recordDriftSample,
    recordStalledEvent,
    recordWaitingEvent,
    resetPlaybackQualityState
  };
}
