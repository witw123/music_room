"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getPcmEngineDiagnosticsKey,
  isSlidingWindowPlaybackSource,
  resolveLocalPlaybackClockSeconds,
  resolveLocalPlaybackPositionMs,
  resolvePcmOutputAudible
} from "./pipeline";
import type {
  FullLocalPlaybackTrack,
  UseProgressiveRuntimeInput,
  UseProgressiveRuntimeResult
} from "./runtime-types";
import type { usePlaybackRuntimeInputState } from "./playback-runtime-input-state";
import { usePlaybackRuntimePolicyState } from "./playback-runtime-policy-state";
import type { usePlaybackRuntimeRefs } from "./playback-runtime-refs";
import type { usePlaybackRuntimeTickOrchestrator } from "./use-runtime-tick-orchestrator";
import { usePlaybackStartIntentController } from "./playback-start-intent-controller";
import { useProgressiveDiagnosticsPublisher } from "./progressive-diagnostics-publisher";
import { usePlaybackSchedulerState } from "./playback-scheduler-state";
import { usePlaybackQualityState } from "./playback-quality-state";
import { useLocalAudioPlaybackState } from "./local-audio-playback-state";
import { useLocalAudioEventController } from "./local-audio-event-controller";
import { useLocalPlaybackReadinessController } from "./local-playback-readiness-controller";
import { usePlaybackSourceController } from "./playback-source-controller";
import { usePlaybackRuntimeLifecycleController } from "./playback-runtime-lifecycle-controller";
import { useProgressiveEngineController } from "./progressive-engine-controller";
import { useMainPlaybackController } from "./main-playback-controller";
import { useProgressiveWarmupController } from "./progressive-warmup-controller";
import { useRuntimeTickEffectsController } from "./runtime-tick-effects-controller";
import { roomAudioOutput } from "../room-audio-output";

type PlaybackRuntimeInputState = ReturnType<typeof usePlaybackRuntimeInputState>;
type PlaybackRuntimeRefs = ReturnType<typeof usePlaybackRuntimeRefs>;
type PlaybackRuntimeTickRefs = ReturnType<typeof usePlaybackRuntimeTickOrchestrator>;

type PlaybackRuntimeControllerStackInput = {
  activePlaybackSource: UseProgressiveRuntimeInput["activePlaybackSource"];
  audioRef: UseProgressiveRuntimeInput["audioRef"];
  audioUnlocked: boolean;
  availabilityByTrack: UseProgressiveRuntimeInput["availabilityByTrack"];
  connectedPeersCount: number;
  currentTrack: UseProgressiveRuntimeInput["currentTrack"];
  directProgressiveTakeoverEnabled: boolean;
  fullLocalMaxDriftMs: number;
  fullLocalPlaybackTracks: Record<string, FullLocalPlaybackTrack>;
  fullLocalSwitchDelayMs: number;
  inputState: PlaybackRuntimeInputState;
  isCurrentSourceOwner: boolean;
  isPageVisible: boolean;
  listenerLocalTakeoverEnabled: boolean;
  mediaConnectedPeersCount: number;
  pcmSlidingWindowPlayRetryIntervalMs: number;
  peerId: string;
  playbackStartIntent: UseProgressiveRuntimeInput["playbackStartIntent"];
  progressiveFallbackReason: string | null;
  progressiveSwitchDelayMs: number;
  recordPeerDiagnostic: UseProgressiveRuntimeInput["recordPeerDiagnostic"];
  refs: PlaybackRuntimeRefs;
  roomRecoveryState: UseProgressiveRuntimeInput["roomRecoveryState"];
  roomSnapshot: UseProgressiveRuntimeInput["roomSnapshot"];
  setActivePlaybackSource: UseProgressiveRuntimeInput["setActivePlaybackSource"];
  setAudioUnlocked: UseProgressiveRuntimeInput["setAudioUnlocked"];
  setBufferHealth: UseProgressiveRuntimeInput["setBufferHealth"];
  setMediaConnectionState: UseProgressiveRuntimeInput["setMediaConnectionState"];
  setPlaybackStartIntent: UseProgressiveRuntimeInput["setPlaybackStartIntent"];
  setProgressiveFallbackReason: UseProgressiveRuntimeInput["setProgressiveFallbackReason"];
  setSchedulerMode: UseProgressiveRuntimeInput["setSchedulerMode"];
  setStatusMessage: UseProgressiveRuntimeInput["setStatusMessage"];
  startupBufferMs: number;
  tickRefs: PlaybackRuntimeTickRefs;
  uploadedTracks: UseProgressiveRuntimeInput["uploadedTracks"];
  volume: number;
};

export function usePlaybackRuntimeControllerStack({
  activePlaybackSource,
  audioRef,
  audioUnlocked,
  availabilityByTrack,
  connectedPeersCount,
  currentTrack,
  directProgressiveTakeoverEnabled,
  fullLocalMaxDriftMs,
  fullLocalPlaybackTracks,
  fullLocalSwitchDelayMs,
  inputState,
  isCurrentSourceOwner,
  isPageVisible,
  listenerLocalTakeoverEnabled,
  mediaConnectedPeersCount,
  pcmSlidingWindowPlayRetryIntervalMs,
  peerId,
  playbackStartIntent,
  progressiveFallbackReason,
  progressiveSwitchDelayMs,
  recordPeerDiagnostic,
  refs,
  roomRecoveryState,
  roomSnapshot,
  setActivePlaybackSource,
  setAudioUnlocked,
  setBufferHealth,
  setMediaConnectionState,
  setPlaybackStartIntent,
  setProgressiveFallbackReason,
  setSchedulerMode,
  setStatusMessage,
  startupBufferMs,
  tickRefs,
  uploadedTracks,
  volume
}: PlaybackRuntimeControllerStackInput): UseProgressiveRuntimeResult {
  const {
    activeSourceActivatedAtRef,
    fullLocalWarmupReadyAtRef,
    lastPcmSlidingWindowPlayAttemptAtRef,
    lastStablePlaybackAtRef,
    localTakeoverCooldownUntilRef,
    pcmLastBlockedReasonRef,
    pcmRuntimeFailureRef,
    previousPlaybackSurfaceKeyRef,
    progressiveEngineRef,
    progressivePcmEngineRef,
    progressiveWarmupReadyAtRef
  } = refs;
  const {
    recoverPausedFullLocalPlaybackRef,
    sampleDriftRef,
    syncFullLocalBufferedWarmupRef,
    syncProgressiveWarmupRef,
    syncUpgradeRef
  } = tickRefs;
  const {
    aggregatePieceDownloadRateKbps,
    canPrepareProgressiveLocal,
    canUseFullLocalForPlaybackSession,
    canWarmBufferedFullLocal,
    currentBufferedFullLocalTrack,
    currentBufferedFullLocalTrackObjectUrl,
    currentBufferedFullLocalTrackRef,
    currentProgressiveEngineType,
    currentProgressiveManifest,
    currentProgressiveManifestKey,
    currentProgressiveManifestRef,
    currentTrackDurationMs,
    currentTrackFormatKey,
    currentTrackRef,
    forceSourceOwnerLocalPlayback,
    fullLocalReady,
    isProgressiveTakeoverReady,
    playbackCurrentTrackId,
    playbackMediaEpoch,
    playbackPositionKey,
    playbackRef,
    playbackRevision,
    playbackStatus,
    playbackSurfaceKey,
    playbackTimelineKey,
    pendingPlaybackIntent,
    progressiveHealthSnapshot,
    progressiveSchedulerPolicy
  } = inputState;

  const { setAudioPaused } = useLocalAudioPlaybackState({
    audioRef,
    playbackCurrentTrackId
  });
  const effectiveAudioUnlocked = audioUnlocked || roomAudioOutput.isAudioContextReady();
  const {
    attemptPlaybackStart,
    attemptPlaybackStartRef,
    clearPlaybackStartRetry,
    ensurePlaybackStart,
    markPlaybackStartFailure
  } = usePlaybackStartIntentController({
    activePlaybackSource,
    audioRef,
    playbackCurrentTrackId,
    playbackStatus,
    playbackRef,
    playbackStartIntent,
    setAudioPaused,
    setAudioUnlocked,
    setPlaybackStartIntent,
    setStatusMessage,
    recordPeerDiagnostic
  });
  const {
    localAudioDiagnostics,
    markContinuousPlaybackInterrupted,
    markContinuousPlaybackStarted,
    playbackQualityMetrics,
    recordDriftSample,
    recordStalledEvent,
    recordWaitingEvent,
    resetPlaybackQualityState
  } = usePlaybackQualityState({ audioRef });
  const [pcmDiagnosticsPulse, setPcmDiagnosticsPulse] = useState(0);
  useEffect(() => {
    if (
      currentProgressiveEngineType !== "pcm" ||
      !isSlidingWindowPlaybackSource(activePlaybackSource) ||
      (playbackStatus !== "playing" && playbackStatus !== "buffering")
    ) {
      return;
    }

    const timerId = window.setInterval(() => {
      setPcmDiagnosticsPulse((current) => current + 1);
    }, 500);
    return () => {
      window.clearInterval(timerId);
    };
  }, [activePlaybackSource, currentProgressiveEngineType, playbackStatus]);
  void pcmDiagnosticsPulse;
  const pcmEngineDiagnostics = progressivePcmEngineRef.current?.getSnapshot() ?? null;
  const pcmEngineDiagnosticsKey = getPcmEngineDiagnosticsKey(pcmEngineDiagnostics);
  const pcmOutputAudible = resolvePcmOutputAudible({
    pcmAudioContextState: pcmEngineDiagnostics?.audioContextState ?? null,
    pcmDirectOutputConnected: pcmEngineDiagnostics?.directOutputConnected ?? null,
    pcmDecodedSegmentCount: pcmEngineDiagnostics?.decodedSegmentCount ?? null,
    pcmScheduledSegmentCount: pcmEngineDiagnostics?.scheduledSegmentCount ?? null,
    localAudioHasSrcObject: !!audioRef.current?.srcObject,
    localAudioPaused: audioRef.current?.paused ?? null,
    localAudioMuted: audioRef.current?.muted ?? null,
    localAudioVolume: audioRef.current?.volume ?? null
  });
  const {
    audibleLocalFallbackActive,
    bufferSafetyMarginMs,
    effectiveStartupBufferMs,
    fullLocalBlockedReason,
    fullLocalEligible,
    immediateFullLocalRecoveryEligible,
    isLocalTakeoverAllowed,
    isLocalTakeoverAllowedRef,
    localTakeoverCooldownMs,
    nextQueueTrackPrefetch,
    playbackRecoveryStage,
    progressiveLocalBlockedReason,
    progressiveLocalEligible,
    progressiveWarmupRuntimeRef,
    progressiveWarmupTimerKey,
    schedulerBudgetTier,
    shadowWarmupActive,
    sourceOwnerIdentity,
    startupGatePending,
    transportGovernorMode
  } = usePlaybackRuntimePolicyState({
    activePlaybackSource,
    aggregatePieceDownloadRateKbps,
    availabilityByTrack,
    canUseFullLocalForPlaybackSession,
    connectedPeersCount,
    currentProgressiveEngineType,
    currentProgressiveManifestKey,
    currentTrack,
    currentTrackFormatKey,
    fullLocalReady,
    hasBufferedFullLocalTrack: !!currentBufferedFullLocalTrack,
    hasProgressiveManifest: !!currentProgressiveManifest,
    isCurrentSourceOwner,
    isProgressiveTakeoverReady,
    listenerLocalTakeoverEnabled,
    localTakeoverCooldownUntilRef,
    mediaConnectedPeersCount,
    peerId,
    pendingPlaybackIntent,
    playbackCurrentTrackId,
    playbackMediaEpoch,
    playbackQualityMetrics,
    playbackStatus,
    progressiveFallbackReason,
    progressiveHealthSnapshot,
    recoveryAudioUnlocked: effectiveAudioUnlocked,
    roomRecoveryState,
    roomSnapshot,
    startupBufferMs
  });

  const {
    armLocalTakeoverCooldown,
    destroyProgressiveRuntime,
    markPcmRuntimeFailure,
    markPcmRuntimeFailureRef
  } = usePlaybackRuntimeLifecycleController({
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
  });

  const { transitionPlaybackSource } = usePlaybackSourceController({
    activePlaybackSource,
    armLocalTakeoverCooldown,
    audioRef,
    canUseFullLocalForPlaybackSession,
    forceSourceOwnerLocalPlayback,
    fullLocalBlockedReason,
    hasBufferedFullLocalTrack: !!currentBufferedFullLocalTrack,
    immediateFullLocalRecoveryEligible,
    localAudioDiagnostics,
    pcmEngineDiagnosticsKey,
    playbackStatus,
    progressivePcmEngineRef,
    progressiveStartupReady: progressiveHealthSnapshot.startupReady,
    setActivePlaybackSource,
    setMediaConnectionState,
    setProgressiveFallbackReason
  });

  const getLocalPlaybackPositionMs = useCallback(() => {
    if (!isSlidingWindowPlaybackSource(activePlaybackSource) && activePlaybackSource !== "full-local") {
      return null;
    }

    return resolveLocalPlaybackPositionMs({
      activePlaybackSource,
      currentTimeSeconds: resolveLocalPlaybackClockSeconds({
        activePlaybackSource,
        pcmCurrentTimeSeconds:
          progressivePcmEngineRef.current?.getCurrentTimeSeconds() ?? null,
        audioCurrentTimeSeconds: audioRef.current?.currentTime ?? null
      })
    });
  }, [activePlaybackSource, audioRef, progressivePcmEngineRef]);

  useMainPlaybackController({
    activePlaybackSource,
    attemptPlaybackStart,
    audioRef,
    currentProgressiveEngineType,
    currentTrackDurationMs,
    destroyProgressiveRuntime,
    ensurePlaybackStart,
    forceSourceOwnerLocalPlayback,
    fullLocalPlaybackTracks,
    isCurrentSourceOwner,
    markPlaybackStartFailure,
    markPcmRuntimeFailure,
    pcmLastBlockedReasonRef,
    playbackPositionKey,
    playbackRef,
    progressiveEngineRef,
    progressivePcmEngineRef,
    progressiveStartupReady: progressiveHealthSnapshot.startupReady,
    setActivePlaybackSource,
    setMediaConnectionState,
    setPlaybackStartIntent,
    setProgressiveFallbackReason,
    setStatusMessage,
    startupBufferMs,
    uploadedTracks,
    volume
  });

  useLocalAudioEventController({
    activePlaybackSource,
    audioRef,
    currentProgressiveManifest,
    isPageVisible,
    lastStablePlaybackAtRef,
    markContinuousPlaybackInterrupted,
    markContinuousPlaybackStarted,
    pcmOutputAudible,
    playbackRef,
    progressiveHealthSnapshot,
    recordPeerDiagnostic,
    recordStalledEvent,
    recordWaitingEvent,
    setBufferHealth,
    setMediaConnectionState,
    setProgressiveFallbackReason,
    setSchedulerMode,
    shadowWarmupActive
  });

  useLocalPlaybackReadinessController({
    activePlaybackSource,
    attemptPlaybackStart,
    audioRef,
    ensurePlaybackStart,
    isCurrentSourceOwner,
    mediaConnectedPeersCount,
    playbackCurrentTrackId,
    playbackRef,
    playbackStatus,
    recordPeerDiagnostic,
    setMediaConnectionState,
    volume
  });

  useRuntimeTickEffectsController({
    activePlaybackSource,
    attemptPlaybackStart,
    audioRef,
    audioUnlocked: effectiveAudioUnlocked,
    canUseFullLocalForPlaybackSession,
    canWarmBufferedFullLocal,
    currentBufferedFullLocalTrackObjectUrl,
    currentBufferedFullLocalTrackRef,
    currentProgressiveEngineType,
    currentTrackRef,
    fullLocalBlockedReason,
    fullLocalMaxDriftMs,
    fullLocalSwitchDelayMs,
    fullLocalWarmupReadyAtRef,
    getLocalPlaybackPositionMs,
    isLocalTakeoverAllowed,
    localTakeoverCooldownUntilRef,
    playbackCurrentTrackId,
    playbackMediaEpoch,
    playbackRecoveryStage,
    playbackRef,
    playbackStatus,
    progressiveAheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
    progressivePcmEngineRef,
    recoverPausedFullLocalPlaybackRef,
    recordDriftSample,
    recordPeerDiagnostic,
    sampleDriftRef,
    setMediaConnectionState,
    startupGatePending,
    syncFullLocalBufferedWarmupRef,
    syncUpgradeRef,
    transitionPlaybackSource,
    volume
  });

  useProgressiveEngineController({
    audioRef,
    canPrepareProgressiveLocal,
    currentProgressiveEngineType,
    currentProgressiveManifest,
    markPcmRuntimeFailure,
    peerId,
    progressiveEngineRef,
    progressivePcmEngineRef,
    setProgressiveFallbackReason,
    volume
  });

  useProgressiveWarmupController({
    attemptPlaybackStartRef,
    progressiveWarmupTimerKey,
    audioRef,
    currentProgressiveManifestRef,
    directProgressiveTakeoverEnabled,
    isLocalTakeoverAllowedRef,
    lastPcmSlidingWindowPlayAttemptAtRef,
    markPcmRuntimeFailureRef,
    pcmLastBlockedReasonRef,
    pcmSlidingWindowPlayRetryIntervalMs,
    playbackRef,
    playbackStartIntent,
    progressiveEngineRef,
    progressivePcmEngineRef,
    progressiveSwitchDelayMs,
    progressiveWarmupReadyAtRef,
    progressiveWarmupRuntimeRef,
    setMediaConnectionState,
    setPlaybackStartIntent,
    setProgressiveFallbackReason,
    syncProgressiveWarmupRef
  });

  usePlaybackSchedulerState({
    activePlaybackSource,
    isPageVisible,
    playbackCurrentTrackId,
    playbackRef,
    playbackStatus,
    progressiveHealthSnapshot,
    setProgressiveFallbackReason,
    setSchedulerMode
  });

  useProgressiveDiagnosticsPublisher({
    audibleLocalFallbackActive,
    bufferSafetyMarginMs,
    currentTrackFormatKey,
    currentTrackRef,
    effectiveStartupBufferMs,
    fullLocalBlockedReason,
    fullLocalEligible,
    fullLocalReady,
    immediateFullLocalRecoveryEligible,
    lastStablePlaybackAtRef,
    localAudioDiagnostics,
    localTakeoverCooldownMs,
    localTakeoverCooldownUntilRef,
    nextQueueTrackPrefetch,
    pcmEngineDiagnosticsKey,
    pcmLastBlockedReasonRef,
    playbackQualityMetrics,
    playbackRecoveryStage,
    playbackStartIntent,
    playbackSurfaceKey,
    playbackTimelineKey,
    pendingPlaybackIntent,
    progressiveHealthSnapshot,
    progressiveLocalBlockedReason,
    progressiveLocalEligible,
    progressivePcmEngineRef,
    recordPeerDiagnostic,
    roomRecoveryState,
    schedulerBudgetTier,
    shadowWarmupActive,
    sourceOwnerIdentity,
    transportGovernorMode
  });

  return {
    progressiveSchedulerPolicy,
    transportGovernorMode,
    getLocalPlaybackPositionMs,
    destroyProgressiveRuntime
  };
}
