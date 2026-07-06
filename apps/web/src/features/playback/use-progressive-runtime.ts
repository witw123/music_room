"use client";

import {
  useCallback,
  useMemo,
  useRef
} from "react";
import {
  getFullLocalStableWindowMs
} from "./progressive-playback";
import {
  shouldLatchPcmRuntimeFailure,
  shouldRetryPcmRuntimeAfterFailure
} from "./pcm-runtime-failure";
import {
  usePlaybackRuntimeTickOrchestrator
} from "./playback-orchestrator/use-runtime-tick-orchestrator";
import { usePlaybackStartIntentController } from "./playback-orchestrator/playback-start-intent-controller";
import { useProgressiveDiagnosticsPublisher } from "./playback-orchestrator/progressive-diagnostics-publisher";
import { usePlaybackSchedulerState } from "./playback-orchestrator/playback-scheduler-state";
import { usePlaybackQualityState } from "./playback-orchestrator/playback-quality-state";
import { useLocalAudioPlaybackState } from "./playback-orchestrator/local-audio-playback-state";
import { useLocalAudioEventController } from "./playback-orchestrator/local-audio-event-controller";
import { useLocalPlaybackReadinessController } from "./playback-orchestrator/local-playback-readiness-controller";
import { usePlaybackSourceController } from "./playback-orchestrator/playback-source-controller";
import { usePlaybackRuntimeLifecycleController } from "./playback-orchestrator/playback-runtime-lifecycle-controller";
import { usePlaybackRuntimeInputState } from "./playback-orchestrator/playback-runtime-input-state";
import { usePlaybackRuntimeRefs } from "./playback-orchestrator/playback-runtime-refs";
import { useProgressiveEngineController } from "./playback-orchestrator/progressive-engine-controller";
import { useMainPlaybackController } from "./playback-orchestrator/main-playback-controller";
import { useProgressiveWarmupController } from "./playback-orchestrator/progressive-warmup-controller";
import { useRuntimeTickEffectsController } from "./playback-orchestrator/runtime-tick-effects-controller";
import type {
  FullLocalPlaybackTrack,
  UseProgressiveRuntimeInput,
  UseProgressiveRuntimeResult
} from "./playback-orchestrator/runtime-types";

// Re-exported for backward compatibility with existing import sites/tests.
export { shouldLatchPcmRuntimeFailure, shouldRetryPcmRuntimeAfterFailure };
import {
  resolveFullLocalWarmupDecision,
  resolveProgressiveWarmupDecision
} from "./progressive-source-controller";
import {
  buildCurrentTrackFormatKey,
  buildPlaybackPositionKey,
  buildProgressiveWarmupTimerKey,
  bucketDiagnosticDurationMs,
  getAudibleElementVolume,
  getPcmEngineDiagnosticsKey,
  getSlidingWindowPlayBlockedReason,
  hasSufficientBackingForFullLocalWarmup,
  isRecoverableProgressiveFallbackReason,
  isSlidingWindowPlaybackSource,
  resolveActiveMemberPeerIds,
  resolveAggregatePieceDownloadRateKbps,
  resolveCurrentBufferedFullLocalTrack,
  resolveDriftSampleAction,
  resolveDriftSamplingPreflight,
  resolveFullLocalAudioSourceAction,
  resolveFullLocalPlaybackSelection,
  resolveFullLocalPlaybackActivationAction,
  resolveFullLocalEligibility,
  resolveFullLocalPlaybackSessionState,
  resolveFullLocalBlockedReason,
  resolveFullLocalBufferedWarmupPreflight,
  resolveFullLocalPausedPlaybackAction,
  resolveFullLocalPausedRecoveryAttemptAction,
  resolveFullLocalPausedRecoveryPreflight,
  resolveFullLocalReadyPlaybackResult,
  resolveFullLocalWarmupHoldState,
  resolveFullLocalWarmupMissingTrackAction,
  resolveFullLocalWarmupReadiness,
  resolveFullLocalWarmupTransitionAction,
  resolveFullLocalPausedRecoveryResult,
  resolveBufferingMediaConnectionState,
  resolveFullLocalUpgradeAction,
  resolveForceSourceOwnerLocalPlaybackAction,
  resolveIdleFullLocalUpgradeArmState,
  resolveInactivePlaybackSchedulerMode,
  resolveImmediateFullLocalRecoveryAction,
  resolveMainPlaybackPreflight,
  resolveLocalPlaybackPositionMs,
  resolveMainPausedPlaybackAction,
  resolveMainPlaybackResetIdleAction,
  resolveMediaElementPlaybackRole,
  resolveNextQueueTrackPrefetch,
  resolveObservedPlaybackSeconds,
  resolvePausedPlaybackEventAction,
  resolvePausedPlaybackRecoveryState,
  resolvePlaybackSourceTransitionAction,
  resolvePlaybackSurfaceResetMediaConnectionState,
  resolvePlaybackStartMediaConnectionState,
  resolvePlaybackStartFailureMessage,
  resolvePcmSyncPlaybackOutcome,
  resolveProgressiveEngineAttachFailureAction,
  resolvePlayingPlaybackEventAction,
  resolvePlayingMediaConnectionState,
  resolveSeekedPlaybackEventAction,
  resolvePlaybackSourceAfterLatchedPcmRuntimeFailure,
  resolveSeekedPlaybackPolicy,
  resolveSourceOwnerIdentity,
  resolvePlaybackStartFailureReason,
  resolveSlidingWindowFallbackPlaybackAction,
  resolveSlidingWindowNativeSyncOutcome,
  resolveSlidingWindowNoEngineHoldAction,
  resolveStalledPlaybackEventAction,
  resolveStalledFallbackReason,
  resolveTrackAvailabilityAnnouncement,
  resolveTrackAvailabilityManifestHint,
  resolveWaitingFallbackReason,
  resolveWarmupHoldState,
  resolveWarmupInactivePlaybackAction,
  resolveWarmupMseCatchupAction,
  resolveWarmupPcmAudioStartAction,
  resolveWarmupPcmAudioStartResultAction,
  resolveWarmupPcmSyncMode,
  resolveWarmupPreflight,
  resolveWarmupTakeoverBlockedReason,
  resolveWarmupUnavailableAction,
  resolveWaitingPlaybackEventAction,
  resolveFullLocalUpgradePreflight,
  resolvePlaybackSourceAfterProgressiveRuntimeFailure,
  resolveBufferSafetyMarginMs,
  resolveEffectiveStartupBufferMs,
  resolvePlaybackRecoveryStage,
  resolveAudibleLocalFallbackActive,
  resolveProgressiveDiagnosticSignature,
  resolveProgressiveDiagnosticBuckets,
  resolveFullLocalPlaybackMode,
  resolveProgressiveLocalBlockedReason,
  resolveProgressiveLocalReadinessPreflight,
  resolveSchedulerBufferHealth,
  resolveMaxContinuousPlaybackMs,
  resolveSchedulerBudgetTier,
  resolveTransportGovernorMode,
  shouldAttemptProgressiveLocalPlayback,
  shouldAllowLocalTakeover,
  shouldEnableFullLocalHandoff,
  shouldHoldSlidingWindowPlaybackForEngine,
  shouldPreferImmediateFullLocalRecovery,
  shouldPrepareProgressiveRuntime,
  shouldPrepareProgressiveRuntimeForSource,
  shouldPublishProgressiveDiagnostic,
  resolveSilentSlidingWindowFullLocalRecoveryAction,
  shouldRecoverPausedFullLocalPlayback,
  shouldRecoverSilentSlidingWindowWithFullLocal,
  shouldReportPlaybackStartFailure,
  shouldResetAudioForPlaybackSurfaceChange,
  shouldSkipSecondaryPcmWarmupSync,
  shouldStartPcmSlidingWindowAudioElement,
  shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup,
  shouldWarmFullLocalWithSharedAudioElement,
  type FullLocalPlaybackSessionState,
  type TransportGovernorMode
} from "./playback-orchestrator/pipeline";
export type {
  FullLocalPlaybackTrack,
  UseProgressiveRuntimeInput,
  UseProgressiveRuntimeResult
} from "./playback-orchestrator/runtime-types";

const progressiveSwitchDelayMs = getFullLocalStableWindowMs();
const fullLocalSwitchDelayMs = getFullLocalStableWindowMs();
const fullLocalMaxDriftMs = 180;
const enableTrackCaching = true;
const enableDirectProgressiveTakeover = enableTrackCaching;
const enableListenerLocalTakeover = enableTrackCaching;
const adaptiveStartupBufferMs = 60;
const haveCurrentDataReadyState = 2;
const pcmSlidingWindowPlayRetryIntervalMs = 1_000;

export type {
  FullLocalPlaybackSessionState,
  PlaybackRecoveryStage,
  SchedulerBudgetTier,
  TransportGovernorMode
} from "./playback-orchestrator/pipeline";
export {
  appendPlaybackQualityTimestamp,
  appendPlaybackDriftSample,
  bucketDiagnosticDurationMs,
  getAudibleElementVolume,
  getPcmEngineDiagnosticsKey,
  getSlidingWindowPlayBlockedReason,
  hasSufficientBackingForFullLocalWarmup,
  isSlidingWindowPlaybackSource,
  pruneContinuousPlaybackSegments,
  prunePlaybackQualityTimestamps,
  resolveActiveMemberPeerIds,
  resolveAggregatePieceDownloadRateKbps,
  resolveContinuousPlaybackInterruption,
  resolveContinuousPlaybackStart,
  resolveContinuousPlaybackWindowMetrics,
  resolveCurrentBufferedFullLocalTrack,
  resolveDriftSampleAction,
  resolveDriftSamplingPreflight,
  resolveFullLocalAudioSourceAction,
  resolveFullLocalPlaybackSelection,
  resolveFullLocalPlaybackActivationAction,
  resolveFullLocalEligibility,
  resolveFullLocalPlaybackSessionState,
  resolveFullLocalBlockedReason,
  resolveFullLocalBufferedWarmupPreflight,
  resolveFullLocalPausedPlaybackAction,
  resolveFullLocalPausedRecoveryAttemptAction,
  resolveFullLocalPausedRecoveryPreflight,
  resolveFullLocalWarmupHoldState,
  resolveFullLocalWarmupMissingTrackAction,
  resolveFullLocalWarmupReadiness,
  resolveFullLocalWarmupTransitionAction,
  resolveFullLocalPausedRecoveryResult,
  resolveFullLocalReadyPlaybackResult,
  resolveBufferingMediaConnectionState,
  resolveFullLocalUpgradeAction,
  resolveForceSourceOwnerLocalPlaybackAction,
  resolveIdleFullLocalUpgradeArmState,
  resolveInactivePlaybackSchedulerAction,
  resolveInactivePlaybackSchedulerMode,
  resolveImmediateFullLocalRecoveryAction,
  resolveLocalTakeoverCooldownArmAction,
  resolveLocalTakeoverCooldownResetAction,
  resolveLocalReadyPlaybackAction,
  resolveMainPlaybackPreflight,
  resolveLocalAudioDiagnostics,
  resolveLocalPlaybackReady,
  resolveLocalPlaybackPositionMs,
  resolveListenerMediaConnectionState,
  resolveMainPausedPlaybackAction,
  resolveMainPlaybackResetIdleAction,
  resolveMediaElementPlaybackRole,
  resolveNextQueueTrackPrefetch,
  resolveObservedPlaybackSeconds,
  resolvePausedPlaybackEventAction,
  resolvePausedPlaybackRecoveryState,
  resolvePlaybackSourceTransitionAction,
  resolvePlaybackSurfaceResetAction,
  resolvePlaybackSurfaceResetMediaConnectionState,
  resolvePlaybackStartMediaConnectionState,
  resolvePlaybackStartFailureIntentAction,
  resolvePlaybackStartFailureMessage,
  resolvePlaybackStartIntentTimeoutPreflight,
  resolvePlaybackStartIntentTimeoutResult,
  resolvePlaybackStartRetryClearAction,
  resolvePlaybackStartRetryPreflight,
  resolvePlaybackStartRetryResult,
  resolvePlaybackTimelineResetAction,
  resolvePcmRuntimeFailureAction,
  resolvePcmRuntimeFailureResetAction,
  resolvePcmSyncPlaybackOutcome,
  resolveProgressiveEngineSetupPreflight,
  resolveProgressiveEngineAttachErrorAction,
  resolveProgressiveEngineAttachFailureAction,
  resolveProgressiveEngineAttachResultAction,
  resolveProgressiveEngineAttachSuccessFallbackReason,
  resolvePlayingPlaybackEventAction,
  resolvePlayingMediaConnectionState,
  resolveSeekedPlaybackEventAction,
  resolvePlaybackSourceAfterLatchedPcmRuntimeFailure,
  resolveSeekedPlaybackPolicy,
  resolveSourceOwnerIdentity,
  resolvePlaybackStartFailureReason,
  resolveSlidingWindowFallbackPlaybackAction,
  resolveSlidingWindowLowBufferFallbackReason,
  resolveSlidingWindowNativeSyncOutcome,
  resolveSlidingWindowNoEngineHoldAction,
  resolveStalledPlaybackEventAction,
  resolveStalledFallbackReason,
  resolveTrackAvailabilityAnnouncement,
  resolveTrackAvailabilityManifestHint,
  resolveWaitingFallbackReason,
  resolveWarmupHoldState,
  resolveWarmupInactivePlaybackAction,
  resolveWarmupMseCatchupAction,
  resolveWarmupPcmAudioStartAction,
  resolveWarmupPcmAudioStartResultAction,
  resolveWarmupPcmSyncMode,
  resolveWarmupPreflight,
  resolveWarmupTakeoverBlockedReason,
  resolveWarmupUnavailableAction,
  resolveWaitingPlaybackEventAction,
  resolveFullLocalUpgradePreflight,
  resolvePlaybackSourceAfterProgressiveRuntimeFailure,
  resolveBufferSafetyMarginMs,
  resolveEffectiveStartupBufferMs,
  resolvePlaybackQualityMetrics,
  resolvePlaybackRecoveryStage,
  resolveAudibleLocalFallbackActive,
  resolveProgressiveDiagnosticSignature,
  resolveProgressiveDiagnosticBuckets,
  resolveFullLocalPlaybackMode,
  resolveProgressiveLocalBlockedReason,
  resolveProgressiveLocalReadinessPreflight,
  resolveSchedulerBufferHealth,
  resolveMaxContinuousPlaybackMs,
  resolveSchedulerBudgetTier,
  resolveTransportGovernorMode,
  shouldAttemptProgressiveLocalPlayback,
  shouldAllowLocalTakeover,
  shouldEnableFullLocalHandoff,
  shouldHoldSlidingWindowPlaybackForEngine,
  shouldPreferLocalTakeover,
  shouldPreferImmediateFullLocalRecovery,
  shouldPrepareProgressiveRuntime,
  shouldPrepareProgressiveRuntimeForSource,
  shouldPublishProgressiveDiagnostic,
  resolveSilentSlidingWindowFullLocalRecoveryAction,
  shouldRecoverPausedFullLocalPlayback,
  shouldRecoverSilentSlidingWindowWithFullLocal,
  shouldReportPlaybackStartFailure,
  shouldResetAudioForPlaybackSurfaceChange,
  shouldSkipSecondaryPcmWarmupSync,
  shouldStartListenerProgressivePlayback,
  shouldStartPcmSlidingWindowAudioElement,
  shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup,
  shouldUsePcmEngineForFullLocal,
  shouldWarmFullLocalWithSharedAudioElement
} from "./playback-orchestrator/pipeline";

export function useProgressiveRuntime({
  audioRef,
  roomSnapshot,
  currentTrack,
  peerId,
  availabilityByTrack,
  uploadedTracks,
  fullLocalPlaybackTracks,
  isCurrentSourceOwner,
  activePlaybackSource,
  setActivePlaybackSource,
  progressiveFallbackReason,
  setProgressiveFallbackReason,
  playbackStartIntent,
  setPlaybackStartIntent,
  audioUnlocked,
  roomRecoveryState,
  isPageVisible,
  volume,
  connectedPeersCount,
  mediaConnectedPeersCount,
  peerDiagnostics,
  recordPeerDiagnostic,
  setStatusMessage,
  setSchedulerMode,
  setBufferHealth,
  setMediaConnectionState
}: UseProgressiveRuntimeInput): UseProgressiveRuntimeResult {
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
  } = usePlaybackRuntimeRefs();
  const {
    syncProgressiveWarmupRef,
    recoverPausedFullLocalPlaybackRef,
    sampleDriftRef,
    syncFullLocalBufferedWarmupRef,
    syncUpgradeRef
  } = usePlaybackRuntimeTickOrchestrator();
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
    currentTrackAvailableChunksKey,
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
  } = usePlaybackRuntimeInputState({
    activePlaybackSource,
    availabilityByTrack,
    currentTrack,
    fullLocalPlaybackTracks,
    isCurrentSourceOwner,
    pcmRuntimeFailureRef,
    peerDiagnostics,
    peerId,
    playbackStartIntent,
    progressiveFallbackReason,
    roomSnapshot,
    trackCachingEnabled: enableTrackCaching,
    uploadedTracks
  });
  const { setAudioPaused } = useLocalAudioPlaybackState({
    audioRef,
    playbackCurrentTrackId
  });
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
    setPlaybackStartIntent,
    setStatusMessage,
    recordPeerDiagnostic
  });
  const startupBufferMs = adaptiveStartupBufferMs;
  const localTakeoverCooldownMs = useMemo(
    () => Math.max(0, localTakeoverCooldownUntilRef.current - Date.now()),
    []
  );
  const bufferSafetyMarginMs = useMemo(
    () =>
      resolveBufferSafetyMarginMs({
        aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
        estimatedFillTimeMs: progressiveHealthSnapshot.estimatedFillTimeMs
      }),
    [
      progressiveHealthSnapshot.aheadBufferedMs,
      progressiveHealthSnapshot.estimatedFillTimeMs
    ]
  );
  const progressiveLocalReadinessPreflight = resolveProgressiveLocalReadinessPreflight({
    hasManifest: !!currentProgressiveManifest,
    isCurrentSourceOwner,
    activePlaybackSource,
    playbackStatus,
    engineType: currentProgressiveEngineType,
    startupReady: progressiveHealthSnapshot.startupReady,
    hasFullLocalTrack: canUseFullLocalForPlaybackSession,
    progressiveFallbackReason,
    localTakeoverCooldownMs,
    connectedPeersCount,
    aggregatePieceDownloadRateKbps
  });
  const progressiveLocalBlockedReason =
    progressiveLocalReadinessPreflight.blockedReason ??
    (progressiveLocalReadinessPreflight.shouldProbeTakeoverReady
      ? resolveProgressiveLocalBlockedReason({
          hasManifest: true,
          isCurrentSourceOwner,
          activePlaybackSource,
          playbackStatus,
          engineType: currentProgressiveEngineType,
          startupReady: progressiveHealthSnapshot.startupReady,
          hasFullLocalTrack: canUseFullLocalForPlaybackSession,
          progressiveFallbackReason,
          localTakeoverCooldownMs,
          connectedPeersCount,
          aggregatePieceDownloadRateKbps,
          progressiveTakeoverReady: isProgressiveTakeoverReady()
        })
      : null);
  const progressiveLocalEligible = progressiveLocalBlockedReason === null;
  const transportGovernorMode = useMemo(
    () =>
      resolveTransportGovernorMode({
        activePlaybackSource,
        mediaConnectedPeersCount,
        connectedPeersCount,
        pendingPlaybackIntent,
        progressiveFallbackReason,
        progressiveLocalEligible
      }),
    [
      activePlaybackSource,
      connectedPeersCount,
      mediaConnectedPeersCount,
      pendingPlaybackIntent,
      progressiveFallbackReason,
      progressiveLocalEligible
    ]
  );
  const nextQueueTrackPrefetch = useMemo(() => {
    return resolveNextQueueTrackPrefetch({
      queue: roomSnapshot?.queue,
      currentQueueItemId: roomSnapshot?.room.playback.currentQueueItemId,
      currentTrackId: currentTrack?.id,
      tracks: roomSnapshot?.tracks,
      availabilityByTrack,
      peerId
    });
  }, [
    roomSnapshot?.queue,
    roomSnapshot?.room.playback.currentQueueItemId,
    roomSnapshot?.tracks,
    currentTrack?.id,
    availabilityByTrack,
    peerId
  ]);
  const sourceOwnerIdentity = useMemo(
    () =>
      resolveSourceOwnerIdentity({
        members: roomSnapshot?.room.members,
        peerId,
        playbackSourceSessionId: roomSnapshot?.room.playback.sourceSessionId,
        playbackSourcePeerId: roomSnapshot?.room.playback.sourcePeerId,
        isSourceOwner: isCurrentSourceOwner
      }),
    [
      isCurrentSourceOwner,
      peerId,
      roomSnapshot?.room.members,
      roomSnapshot?.room.playback.sourcePeerId,
      roomSnapshot?.room.playback.sourceSessionId
    ]
  );
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
  const pcmEngineDiagnostics = progressivePcmEngineRef.current?.getSnapshot() ?? null;
  const pcmEngineDiagnosticsKey = getPcmEngineDiagnosticsKey(pcmEngineDiagnostics);
  const shadowWarmupActive = false;
  const effectiveStartupBufferMs = useMemo(
    () =>
      resolveEffectiveStartupBufferMs({
        baseStartupBufferMs: startupBufferMs,
        waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
        stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s
      }),
    [
      playbackQualityMetrics.stalledEventsLast30s,
      playbackQualityMetrics.waitingEventsLast30s,
      startupBufferMs
    ]
  );

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

  const immediateFullLocalRecoveryEligible =
    shouldPreferImmediateFullLocalRecovery({
      isCurrentSourceOwner,
      audioUnlocked,
      hasBufferedFullLocalTrack: canUseFullLocalForPlaybackSession,
      fullLocalRecoveryActive: roomRecoveryState.fullLocalRecoveryActive,
      recoveryPhase: roomRecoveryState.phase,
      recoveryMode: roomRecoveryState.mode,
      playbackStatus
    });

  const isLocalTakeoverAllowed = useCallback(
    (now = Date.now()) =>
      shouldAllowLocalTakeover({
        listenerLocalTakeoverEnabled: enableListenerLocalTakeover,
        nowMs: now,
        cooldownUntilMs: localTakeoverCooldownUntilRef.current,
        immediateFullLocalRecoveryEligible,
        canUseFullLocalForPlaybackSession,
        connectedPeersCount
      }),
    [canUseFullLocalForPlaybackSession, connectedPeersCount, immediateFullLocalRecoveryEligible]
  );
  const isLocalTakeoverAllowedRef = useRef(isLocalTakeoverAllowed);
  isLocalTakeoverAllowedRef.current = isLocalTakeoverAllowed;
  const audibleLocalFallbackActive = resolveAudibleLocalFallbackActive({
    isCurrentSourceOwner,
    activePlaybackSource,
    progressiveFallbackReason
  });
  const startupGatePending = false;
  const playbackRecoveryStage = useMemo(
    () =>
      resolvePlaybackRecoveryStage({
        activePlaybackSource,
        playbackStatus,
        startupGatePending,
        waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
        stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
        shadowWarmupActive,
        audibleLocalFallbackActive
      }),
    [
      activePlaybackSource,
      audibleLocalFallbackActive,
      playbackStatus,
      playbackQualityMetrics.stalledEventsLast30s,
      playbackQualityMetrics.waitingEventsLast30s,
      shadowWarmupActive,
      startupGatePending
    ]
  );
  const progressiveWarmupTimerKey = buildProgressiveWarmupTimerKey({
    playbackCurrentTrackId,
    playbackStatus,
    playbackMediaEpoch,
    currentTrackFormatKey,
    progressiveManifestKey: currentProgressiveManifestKey,
    activePlaybackSource,
    canUseFullLocalForPlaybackSession,
    progressiveEngineType: currentProgressiveEngineType,
    progressiveStartupReady: progressiveHealthSnapshot.startupReady,
    startupBufferMs,
    progressiveLocalBlockedReason,
    isCurrentSourceOwner,
    playbackRecoveryStage,
    progressiveFallbackReason,
    stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
    waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s
  });
  const progressiveWarmupRuntimeRef = useRef({
    activePlaybackSource,
    canUseFullLocalForPlaybackSession,
    currentProgressiveEngineType,
    progressiveStartupReady: progressiveHealthSnapshot.startupReady,
    startupBufferMs,
    progressiveLocalBlockedReason,
    isCurrentSourceOwner,
    playbackRecoveryStage,
    progressiveFallbackReason
  });
  progressiveWarmupRuntimeRef.current = {
    activePlaybackSource,
    canUseFullLocalForPlaybackSession,
    currentProgressiveEngineType,
    progressiveStartupReady: progressiveHealthSnapshot.startupReady,
    startupBufferMs,
    progressiveLocalBlockedReason,
    isCurrentSourceOwner,
    playbackRecoveryStage,
    progressiveFallbackReason
  };
  const schedulerBudgetTier = useMemo(
    () =>
      resolveSchedulerBudgetTier({
        bufferHealth: resolveSchedulerBufferHealth({
          stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
          waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s
        }),
        activePlaybackSource,
        playbackRecoveryStage
      }),
    [
      activePlaybackSource,
      playbackQualityMetrics.stalledEventsLast30s,
      playbackQualityMetrics.waitingEventsLast30s,
      playbackRecoveryStage
    ]
  );
  const fullLocalBlockedReason = useMemo(
    () =>
      resolveFullLocalBlockedReason({
        hasBufferedFullLocalTrack: !!currentBufferedFullLocalTrack,
        canUseFullLocalForPlaybackSession,
        isCurrentSourceOwner,
        listenerLocalTakeoverEnabled: enableListenerLocalTakeover,
        activePlaybackSource,
        startupGatePending,
        fullLocalRecoveryActive: roomRecoveryState.fullLocalRecoveryActive
      }),
    [
      activePlaybackSource,
      canUseFullLocalForPlaybackSession,
      currentBufferedFullLocalTrackObjectUrl,
      isCurrentSourceOwner,
      roomRecoveryState.fullLocalRecoveryActive,
      startupGatePending
    ]
  );
  const fullLocalEligible = resolveFullLocalEligibility({
    fullLocalReady,
    fullLocalBlockedReason
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

    const pcmEngine = progressivePcmEngineRef.current;
    if (!pcmEngine) {
      return null;
    }

    return resolveLocalPlaybackPositionMs({
      activePlaybackSource,
      currentTimeSeconds: pcmEngine.getCurrentTimeSeconds()
    });
  }, [activePlaybackSource]);

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
    audioUnlocked,
    canUseFullLocalForPlaybackSession,
    canWarmBufferedFullLocal,
    currentBufferedFullLocalTrackObjectUrl,
    currentBufferedFullLocalTrackRef,
    currentProgressiveEngineType,
    currentTrackFormatKey,
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
    playbackQualityStalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
    playbackQualityWaitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
    playbackRecoveryStage,
    playbackRef,
    playbackStatus,
    progressiveAheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
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
    currentTrackAvailableChunksKey,
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
    directProgressiveTakeoverEnabled: enableDirectProgressiveTakeover,
    isLocalTakeoverAllowedRef,
    lastPcmSlidingWindowPlayAttemptAtRef,
    markPcmRuntimeFailureRef,
    pcmLastBlockedReasonRef,
    pcmSlidingWindowPlayRetryIntervalMs,
    playbackRef,
    progressiveEngineRef,
    progressivePcmEngineRef,
    progressiveSwitchDelayMs,
    progressiveWarmupReadyAtRef,
    progressiveWarmupRuntimeRef,
    setMediaConnectionState,
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
