"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import type { PlaybackSnapshot, RoomMediaConnectionState } from "@music-room/shared";
import type { ProgressiveMseEngine } from "../progressive-mse-engine";
import type { ProgressivePcmEngine } from "../progressive-pcm-engine";
import {
  getLocalTakeoverCooldownMs,
  hasActivePlaybackIntent,
  type ProgressivePlaybackSource,
  type ProgressiveTrackManifest
} from "../progressive-playback";
import { isSlidingWindowPlaybackSource } from "./pipeline";
import {
  resolveLocalTakeoverCooldownArmAction,
  resolveLocalTakeoverCooldownResetAction,
  resolvePlaybackSurfaceResetAction,
  resolvePlaybackTimelineResetAction,
  resolvePcmRuntimeFailureAction,
  resolvePcmRuntimeFailureResetAction,
  type ContinuousPlaybackSegment,
  type PlaybackDriftSample
} from "./pipeline";
import { shouldLatchPcmRuntimeFailure } from "../pcm-runtime-failure";

type PcmRuntimeFailure = { trackId: string; reason: string };

type ResetPlaybackQualityState = (state?: {
  waitingEventTimestamps?: readonly number[];
  stalledEventTimestamps?: readonly number[];
  driftSamples?: readonly PlaybackDriftSample[];
  continuousPlaybackStartedAt?: number | null;
  continuousPlaybackSegments?: readonly ContinuousPlaybackSegment[];
}) => void;

type PlaybackRuntimeLifecycleControllerInput = {
  activePlaybackSource: ProgressivePlaybackSource;
  activeSourceActivatedAtRef: MutableRefObject<number>;
  audioRef: RefObject<HTMLAudioElement | null>;
  canUseFullLocalForPlaybackSession: boolean;
  clearPlaybackStartRetry: () => void;
  currentProgressiveManifest: ProgressiveTrackManifest | null;
  fullLocalWarmupReadyAtRef: MutableRefObject<number | null>;
  lastPcmSlidingWindowPlayAttemptAtRef: MutableRefObject<number | null>;
  localTakeoverCooldownUntilRef: MutableRefObject<number>;
  pcmLastBlockedReasonRef: MutableRefObject<string | null>;
  pcmRuntimeFailureRef: MutableRefObject<PcmRuntimeFailure | null>;
  playbackCurrentTrackId: string | null;
  playbackMediaEpoch: number | null;
  playbackRef: MutableRefObject<PlaybackSnapshot | null | undefined>;
  playbackRevision: number | null | undefined;
  playbackStatus: PlaybackSnapshot["status"] | null | undefined;
  playbackSurfaceKey: string | null;
  previousPlaybackSurfaceKeyRef: MutableRefObject<string | null>;
  progressiveEngineRef: MutableRefObject<ProgressiveMseEngine | null>;
  progressivePcmEngineRef: MutableRefObject<ProgressivePcmEngine | null>;
  progressiveWarmupReadyAtRef: MutableRefObject<number | null>;
  resetPlaybackQualityState: ResetPlaybackQualityState;
  setActivePlaybackSource: Dispatch<SetStateAction<ProgressivePlaybackSource>>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
};

export function usePlaybackRuntimeLifecycleController({
  activePlaybackSource,
  activeSourceActivatedAtRef,
  audioRef,
  canUseFullLocalForPlaybackSession,
  clearPlaybackStartRetry,
  currentProgressiveManifest,
  fullLocalWarmupReadyAtRef,
  lastPcmSlidingWindowPlayAttemptAtRef,
  localTakeoverCooldownUntilRef,
  pcmLastBlockedReasonRef,
  pcmRuntimeFailureRef,
  playbackCurrentTrackId,
  playbackMediaEpoch,
  playbackRef,
  playbackRevision,
  playbackStatus,
  playbackSurfaceKey,
  previousPlaybackSurfaceKeyRef,
  progressiveEngineRef,
  progressivePcmEngineRef,
  progressiveWarmupReadyAtRef,
  resetPlaybackQualityState,
  setActivePlaybackSource,
  setMediaConnectionState,
  setProgressiveFallbackReason
}: PlaybackRuntimeLifecycleControllerInput) {
  const destroyProgressiveRuntime = useCallback(() => {
    progressiveEngineRef.current?.destroy();
    progressiveEngineRef.current = null;
    progressivePcmEngineRef.current?.destroy();
    progressivePcmEngineRef.current = null;
    progressiveWarmupReadyAtRef.current = null;
    fullLocalWarmupReadyAtRef.current = null;
    pcmRuntimeFailureRef.current = null;
    clearPlaybackStartRetry();
    lastPcmSlidingWindowPlayAttemptAtRef.current = null;
    resetPlaybackQualityState();
  }, [
    clearPlaybackStartRetry,
    fullLocalWarmupReadyAtRef,
    lastPcmSlidingWindowPlayAttemptAtRef,
    pcmRuntimeFailureRef,
    progressiveEngineRef,
    progressivePcmEngineRef,
    progressiveWarmupReadyAtRef,
    resetPlaybackQualityState
  ]);

  useEffect(() => destroyProgressiveRuntime, [destroyProgressiveRuntime]);

  useEffect(() => {
    const previousPlaybackSurfaceKey = previousPlaybackSurfaceKeyRef.current;
    previousPlaybackSurfaceKeyRef.current = playbackSurfaceKey;
    const audio = audioRef.current;
    const resetAction = resolvePlaybackSurfaceResetAction({
      previousPlaybackSurfaceKey,
      nextPlaybackSurfaceKey: playbackSurfaceKey,
      hasAudio: !!audio,
      playbackHasActiveIntent: hasActivePlaybackIntent(playbackRef.current)
    });
    if (!resetAction) {
      return;
    }

    if (resetAction.shouldDestroyRuntime) {
      destroyProgressiveRuntime();
    }
    if (resetAction.shouldClearPcmLastBlockedReason) {
      pcmLastBlockedReasonRef.current = null;
    }
    if (!audio || !resetAction.shouldResetAudioElement) {
      return;
    }

    // For sliding-window playback (PCM/MSE) the element was primed during
    // a user gesture and must stay playing across surface changes (track
    // switch, format change).  Pausing here would require a fresh user
    // gesture for the next play(), which we won't have.  Clear the stale
    // srcObject without pausing so the upcoming engine can attach cleanly.
    if (isSlidingWindowPlaybackSource(activePlaybackSource)) {
      audio.srcObject = null;
    } else {
      audio.pause();
      audio.srcObject = null;
      audio.removeAttribute("src");
      audio.load();
    }
    if (resetAction.mediaConnectionState !== null) {
      setMediaConnectionState(resetAction.mediaConnectionState);
    }
  }, [
    audioRef,
    destroyProgressiveRuntime,
    pcmLastBlockedReasonRef,
    playbackCurrentTrackId,
    playbackRef,
    playbackStatus,
    playbackSurfaceKey,
    previousPlaybackSurfaceKeyRef,
    setMediaConnectionState
  ]);

  useEffect(() => {
    activeSourceActivatedAtRef.current = Date.now();
  }, [activePlaybackSource, activeSourceActivatedAtRef, playbackCurrentTrackId, playbackRevision]);

  const markPcmRuntimeFailure = useCallback(
    (reason: string | null | undefined) => {
      const failureAction = resolvePcmRuntimeFailureAction({
        currentManifestTrackId: currentProgressiveManifest?.trackId,
        reason,
        shouldLatchFailure: shouldLatchPcmRuntimeFailure(reason),
        activePlaybackSource,
        canUseFullLocalForPlaybackSession
      });
      if (!failureAction) {
        return;
      }

      pcmRuntimeFailureRef.current = failureAction.latchedFailure;
      if (failureAction.shouldDestroyPcmEngine) {
        progressivePcmEngineRef.current?.destroy();
        progressivePcmEngineRef.current = null;
      }
      setProgressiveFallbackReason(failureAction.fallbackReason);
      if (failureAction.nextSource !== activePlaybackSource) {
        setActivePlaybackSource(failureAction.nextSource);
      }
    },
    [
      activePlaybackSource,
      canUseFullLocalForPlaybackSession,
      currentProgressiveManifest?.trackId,
      pcmRuntimeFailureRef,
      progressivePcmEngineRef,
      setActivePlaybackSource,
      setProgressiveFallbackReason
    ]
  );
  const markPcmRuntimeFailureRef = useRef(markPcmRuntimeFailure);
  markPcmRuntimeFailureRef.current = markPcmRuntimeFailure;

  useEffect(() => {
    const cooldownAction = resolveLocalTakeoverCooldownResetAction();
    localTakeoverCooldownUntilRef.current = cooldownAction.nextCooldownUntilMs;
  }, [localTakeoverCooldownUntilRef, playbackCurrentTrackId, playbackRevision]);

  useEffect(() => {
    const resetAction = resolvePlaybackTimelineResetAction();
    progressiveWarmupReadyAtRef.current = resetAction.nextProgressiveWarmupReadyAt;
    fullLocalWarmupReadyAtRef.current = resetAction.nextFullLocalWarmupReadyAt;
    resetPlaybackQualityState({
      waitingEventTimestamps: resetAction.nextWaitingEventTimestamps,
      stalledEventTimestamps: resetAction.nextStalledEventTimestamps,
      driftSamples: resetAction.nextDriftSamples,
      continuousPlaybackStartedAt: resetAction.nextContinuousPlaybackStartedAt,
      continuousPlaybackSegments: resetAction.nextContinuousPlaybackSegments
    });
    lastPcmSlidingWindowPlayAttemptAtRef.current =
      resetAction.nextPcmSlidingWindowPlayAttemptAt;
    if (resetAction.shouldClearFallbackReason) {
      setProgressiveFallbackReason(null);
    }
  }, [
    fullLocalWarmupReadyAtRef,
    lastPcmSlidingWindowPlayAttemptAtRef,
    playbackMediaEpoch,
    playbackCurrentTrackId,
    playbackRevision,
    progressiveWarmupReadyAtRef,
    resetPlaybackQualityState,
    setProgressiveFallbackReason
  ]);

  const armLocalTakeoverCooldown = useCallback(() => {
    const cooldownAction = resolveLocalTakeoverCooldownArmAction({
      nowMs: Date.now(),
      cooldownMs: getLocalTakeoverCooldownMs()
    });
    localTakeoverCooldownUntilRef.current = cooldownAction.nextCooldownUntilMs;
  }, [localTakeoverCooldownUntilRef]);

  useEffect(() => {
    if (
      resolvePcmRuntimeFailureResetAction({
        hasLatchedFailure: !!pcmRuntimeFailureRef.current,
        latchedTrackId: pcmRuntimeFailureRef.current?.trackId ?? null,
        currentManifestTrackId: currentProgressiveManifest?.trackId ?? null
      })
    ) {
      pcmRuntimeFailureRef.current = null;
    }
  }, [currentProgressiveManifest?.trackId, pcmRuntimeFailureRef]);

  return {
    armLocalTakeoverCooldown,
    destroyProgressiveRuntime,
    markPcmRuntimeFailure,
    markPcmRuntimeFailureRef
  };
}
