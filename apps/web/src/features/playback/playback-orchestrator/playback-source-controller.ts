"use client";

import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import type { PlaybackSnapshot, RoomMediaConnectionState } from "@music-room/shared";
import type { ProgressivePcmEngine } from "../progressive-pcm-engine";
import type { ProgressivePlaybackSource } from "../progressive-playback";
import {
  resolveForceSourceOwnerLocalPlaybackAction,
  resolveImmediateFullLocalRecoveryAction,
  resolvePlaybackSourceTransitionAction,
  resolveSilentSlidingWindowFullLocalRecoveryAction,
  shouldRecoverSilentSlidingWindowWithFullLocal
} from "./pipeline";

type LocalAudioDiagnostics = {
  localAudioPaused: boolean | null;
  localAudioMuted: boolean | null;
  localAudioVolume: number | null;
  localAudioReadyState: number | null;
};

type TransitionPlaybackSourceOptions = {
  fallbackReason?: string | null;
  clearFallbackReason?: boolean;
  force?: boolean;
  armCooldown?: boolean;
};

type PlaybackSourceControllerInput = {
  activePlaybackSource: ProgressivePlaybackSource;
  armLocalTakeoverCooldown: () => void;
  audioRef: RefObject<HTMLAudioElement | null>;
  canUseFullLocalForPlaybackSession: boolean;
  forceSourceOwnerLocalPlayback: boolean;
  fullLocalBlockedReason: string | null;
  hasBufferedFullLocalTrack: boolean;
  immediateFullLocalRecoveryEligible: boolean;
  localAudioDiagnostics: LocalAudioDiagnostics;
  pcmEngineDiagnosticsKey: string;
  playbackStatus: PlaybackSnapshot["status"] | null | undefined;
  progressivePcmEngineRef: MutableRefObject<ProgressivePcmEngine | null>;
  progressiveStartupReady: boolean;
  setActivePlaybackSource: Dispatch<SetStateAction<ProgressivePlaybackSource>>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
};

export function usePlaybackSourceController({
  activePlaybackSource,
  armLocalTakeoverCooldown,
  audioRef,
  canUseFullLocalForPlaybackSession,
  forceSourceOwnerLocalPlayback,
  fullLocalBlockedReason,
  hasBufferedFullLocalTrack,
  immediateFullLocalRecoveryEligible,
  localAudioDiagnostics,
  pcmEngineDiagnosticsKey,
  playbackStatus,
  progressivePcmEngineRef,
  progressiveStartupReady,
  setActivePlaybackSource,
  setMediaConnectionState,
  setProgressiveFallbackReason
}: PlaybackSourceControllerInput) {
  useEffect(() => {
    const forceLocalAction =
      resolveForceSourceOwnerLocalPlaybackAction(forceSourceOwnerLocalPlayback);
    if (!forceLocalAction) {
      return;
    }

    setActivePlaybackSource(forceLocalAction.nextSource);
  }, [forceSourceOwnerLocalPlayback, setActivePlaybackSource]);

  useEffect(() => {
    const recoveryAction = resolveImmediateFullLocalRecoveryAction({
      immediateFullLocalRecoveryEligible,
      activePlaybackSource,
      hasBufferedFullLocalTrack
    });
    if (!recoveryAction) {
      return;
    }

    setActivePlaybackSource(recoveryAction.nextSource);
    if (recoveryAction.clearFallbackReason) {
      setProgressiveFallbackReason(null);
    }
  }, [
    activePlaybackSource,
    hasBufferedFullLocalTrack,
    immediateFullLocalRecoveryEligible,
    setActivePlaybackSource,
    setProgressiveFallbackReason
  ]);

  const transitionPlaybackSource = useCallback(
    (nextSource: ProgressivePlaybackSource, options?: TransitionPlaybackSourceOptions) => {
      const transitionAction = resolvePlaybackSourceTransitionAction({
        currentSource: activePlaybackSource,
        nextSource,
        fallbackReason: options?.fallbackReason,
        clearFallbackReason: options?.clearFallbackReason,
        armCooldown: options?.armCooldown
      });

      if (transitionAction.shouldArmCooldown) {
        armLocalTakeoverCooldown();
      }

      if (transitionAction.shouldClearFallbackReason) {
        setProgressiveFallbackReason(null);
      } else if (typeof transitionAction.fallbackReason === "string") {
        setProgressiveFallbackReason(transitionAction.fallbackReason);
      }

      if (transitionAction.shouldSetSource) {
        setActivePlaybackSource(nextSource);
      }

      return true;
    },
    [
      activePlaybackSource,
      armLocalTakeoverCooldown,
      setActivePlaybackSource,
      setProgressiveFallbackReason
    ]
  );

  useEffect(() => {
    const audio = audioRef.current;
    const latestPcmDiagnostics = progressivePcmEngineRef.current?.getSnapshot() ?? null;
    const recoveryAction = resolveSilentSlidingWindowFullLocalRecoveryAction(
      shouldRecoverSilentSlidingWindowWithFullLocal({
        activePlaybackSource,
        playbackStatus,
        canUseFullLocalForPlaybackSession,
        fullLocalBlockedReason,
        slidingWindowStartupReady: progressiveStartupReady,
        localAudioPaused: audio?.paused ?? localAudioDiagnostics.localAudioPaused,
        localAudioMuted: audio?.muted ?? localAudioDiagnostics.localAudioMuted,
        localAudioVolume: audio?.volume ?? localAudioDiagnostics.localAudioVolume,
        localAudioReadyState: audio?.readyState ?? localAudioDiagnostics.localAudioReadyState,
        localAudioHasSrc: !!(audio?.currentSrc || audio?.getAttribute("src")),
        localAudioHasSrcObject: !!audio?.srcObject,
        pcmAudioContextState: latestPcmDiagnostics?.audioContextState ?? null,
        pcmDirectOutputConnected: latestPcmDiagnostics?.directOutputConnected ?? null,
        pcmDecodedSegmentCount: latestPcmDiagnostics?.decodedSegmentCount ?? null,
        pcmScheduledSegmentCount: latestPcmDiagnostics?.scheduledSegmentCount ?? null
      })
    );
    if (!recoveryAction) {
      return;
    }

    transitionPlaybackSource(recoveryAction.nextSource, {
      clearFallbackReason: recoveryAction.clearFallbackReason
    });
    setMediaConnectionState(recoveryAction.mediaConnectionState);
    void pcmEngineDiagnosticsKey;
  }, [
    activePlaybackSource,
    audioRef,
    canUseFullLocalForPlaybackSession,
    fullLocalBlockedReason,
    localAudioDiagnostics,
    pcmEngineDiagnosticsKey,
    playbackStatus,
    progressivePcmEngineRef,
    progressiveStartupReady,
    setMediaConnectionState,
    transitionPlaybackSource
  ]);

  return { transitionPlaybackSource };
}
