"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef
} from "react";
import { syncLocalPlaybackWindow } from "./playback-sync";
import {
  buildProgressiveHealthSnapshot,
  buildProgressiveTrackManifest,
  canUseProgressivePlayback,
  getFullLocalStableWindowMs,
  getLocalTakeoverCooldownMs,
  getCriticalBufferThresholdMs,
  getEffectivePlaybackPositionMs,
  getProgressiveEngineType,
  getProgressiveTrackManifestKey,
  getStartupWindowMs,
  hasActivePlaybackIntent,
  isTakeoverReady,
  type ProgressiveTrackManifest,
  type ProgressivePlaybackSource
} from "./progressive-playback";
import { isPlaybackStartIntentPending } from "./playback-start-intent";
import { ProgressiveMseEngine } from "./progressive-mse-engine";
import { ProgressivePcmEngine } from "./progressive-pcm-engine";
import { roomAudioOutput } from "./room-audio-output";
import {
  resolvePcmRuntimeFailureReason,
  shouldLatchPcmRuntimeFailure,
  shouldRetryPcmRuntimeAfterFailure
} from "./pcm-runtime-failure";
import {
  noopPlaybackRuntimeTick,
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
import type {
  FullLocalPlaybackTrack,
  UseProgressiveRuntimeInput,
  UseProgressiveRuntimeResult
} from "./playback-orchestrator/runtime-types";

// Re-exported for backward compatibility with existing import sites/tests.
export { shouldLatchPcmRuntimeFailure, shouldRetryPcmRuntimeAfterFailure };
import {
  resolveFullLocalWarmupDecision,
  resolveProgressiveWarmupDecision,
  shouldForceSourceOwnerLocalPlayback
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
  resolveLocalTakeoverCooldownArmAction,
  resolveLocalTakeoverCooldownResetAction,
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
  resolvePlaybackSurfaceResetAction,
  resolvePlaybackSurfaceResetMediaConnectionState,
  resolvePlaybackStartMediaConnectionState,
  resolvePlaybackStartFailureMessage,
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
import {
  resolvePlaybackSurfaceKey,
  resolvePlaybackTimelineKey
} from "@/features/room/hooks/room-playback-topology";

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
  const progressiveEngineRef = useRef<ProgressiveMseEngine | null>(null);
  const progressivePcmEngineRef = useRef<ProgressivePcmEngine | null>(null);
  const progressiveWarmupReadyAtRef = useRef<number | null>(null);
  const fullLocalWarmupReadyAtRef = useRef<number | null>(null);
  const pcmLastBlockedReasonRef = useRef<string | null>(null);
  const pcmRuntimeFailureRef = useRef<{ trackId: string; reason: string } | null>(null);
  const previousPlaybackSurfaceKeyRef = useRef<string | null>(null);
  const lastPcmSlidingWindowPlayAttemptAtRef = useRef<number | null>(null);
  const {
    syncProgressiveWarmupRef,
    recoverPausedFullLocalPlaybackRef,
    sampleDriftRef,
    syncFullLocalBufferedWarmupRef,
    syncUpgradeRef
  } = usePlaybackRuntimeTickOrchestrator();
  const activeSourceActivatedAtRef = useRef<number>(Date.now());
  const localTakeoverCooldownUntilRef = useRef<number>(0);
  const lastStablePlaybackAtRef = useRef<string | null>(null);
  const fullLocalPlaybackSessionRef = useRef<FullLocalPlaybackSessionState>({
    key: null,
    availableInSession: false
  });
  const currentProgressiveManifestRef = useRef<{
    key: string;
    manifest: ProgressiveTrackManifest | null;
  }>({
    key: "none",
    manifest: null
  });
  const roomId = roomSnapshot?.room.id ?? null;
  const playback = roomSnapshot?.room.playback;
  const playbackRevision = playback?.playbackRevision ?? playback?.queueVersion ?? 0;
  const playbackCurrentTrackId = playback?.currentTrackId ?? null;
  const playbackStatus = playback?.status ?? null;
  const playbackMediaEpoch = playback?.mediaEpoch ?? null;
  const playbackSourceSessionId = playback?.sourceSessionId ?? null;
  const playbackSourcePeerId = playback?.sourcePeerId ?? null;
  const playbackPositionKey = buildPlaybackPositionKey(playback);
  const playbackSurfaceKey = useMemo(
    () => resolvePlaybackSurfaceKey(playback),
    [
      playbackCurrentTrackId,
      playbackMediaEpoch,
      playbackSourcePeerId,
      playbackSourceSessionId
    ]
  );
  const playbackTimelineKey = useMemo(
    () => resolvePlaybackTimelineKey(playback),
    [playbackCurrentTrackId, playbackMediaEpoch, playbackRevision]
  );

  const currentBufferedFullLocalTrack = useMemo(
    () =>
      resolveCurrentBufferedFullLocalTrack({
        currentTrackId: currentTrack?.id,
        fullLocalPlaybackTracks,
        uploadedTracks
      }),
    [currentTrack?.id, fullLocalPlaybackTracks, uploadedTracks]
  );
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const currentTrackRef = useRef(currentTrack);
  currentTrackRef.current = currentTrack;
  const currentBufferedFullLocalTrackRef = useRef(currentBufferedFullLocalTrack);
  currentBufferedFullLocalTrackRef.current = currentBufferedFullLocalTrack;
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
  const currentTrackDurationMs = currentTrack?.durationMs ?? null;
  const currentTrackFormatKey = buildCurrentTrackFormatKey(currentTrack);
  const currentBufferedFullLocalTrackObjectUrl =
    currentBufferedFullLocalTrack?.objectUrl ?? null;
  fullLocalPlaybackSessionRef.current = resolveFullLocalPlaybackSessionState({
    currentSession: fullLocalPlaybackSessionRef.current,
    playbackSurfaceKey,
    hasBufferedFullLocalTrack: !!currentBufferedFullLocalTrack
  });
  const canUseFullLocalForPlaybackSession =
    fullLocalPlaybackSessionRef.current.availableInSession && !!currentBufferedFullLocalTrack;
  const forceSourceOwnerLocalPlayback = useMemo(
    () =>
      shouldForceSourceOwnerLocalPlayback({
        isCurrentSourceOwner,
        activePlaybackSource,
        hasFullLocalTrack: !!currentBufferedFullLocalTrack
      }),
    [activePlaybackSource, currentBufferedFullLocalTrackObjectUrl, isCurrentSourceOwner]
  );
  const activeMemberPeerIds = useMemo(
    () => resolveActiveMemberPeerIds(roomSnapshot?.room.members),
    [roomSnapshot?.room.members]
  );
  const currentTrackAvailabilityAnnouncement = useMemo(
    () =>
      resolveTrackAvailabilityAnnouncement({
        currentTrackId: currentTrack?.id,
        availabilityByTrack,
        peerId
      }),
    [availabilityByTrack, currentTrack?.id, peerId]
  );
  const currentTrackAvailableChunksRef = useRef<number[]>([]);
  currentTrackAvailableChunksRef.current =
    currentTrackAvailabilityAnnouncement?.availableChunks ?? [];
  const currentTrackAvailabilityManifestHint = useMemo(
    () =>
      resolveTrackAvailabilityManifestHint({
        currentTrackId: currentTrack?.id,
        roomId,
        availabilityByTrack,
        activeMemberPeerIds,
        fallbackAnnouncement: currentTrackAvailabilityAnnouncement
      }),
    [
      activeMemberPeerIds,
      availabilityByTrack,
      currentTrack?.id,
      currentTrackAvailabilityAnnouncement,
      roomId
    ]
  );
  const currentProgressiveManifestKey = getProgressiveTrackManifestKey(
    currentTrack,
    currentTrackAvailabilityAnnouncement,
    currentTrackAvailabilityManifestHint
  );
  const nextCurrentProgressiveManifest = buildProgressiveTrackManifest(
    currentTrack,
    currentTrackAvailabilityAnnouncement,
    currentTrackAvailabilityManifestHint
  );
  if (currentProgressiveManifestRef.current.key !== currentProgressiveManifestKey) {
    currentProgressiveManifestRef.current = {
      key: currentProgressiveManifestKey,
      manifest: nextCurrentProgressiveManifest
    };
  }
  const currentProgressiveManifest = currentProgressiveManifestRef.current.manifest;
  const currentProgressiveEngineType = useMemo(
    () => getProgressiveEngineType(currentProgressiveManifest),
    [currentProgressiveManifest]
  );
  const aggregatePieceDownloadRateKbps = useMemo(
    () =>
      resolveAggregatePieceDownloadRateKbps({
        activeMemberPeerIds,
        peerDiagnostics
      }),
    [activeMemberPeerIds, peerDiagnostics]
  );
  const progressiveHealthSnapshot = useMemo(
    () =>
      buildProgressiveHealthSnapshot({
        playback,
        activeSource: activePlaybackSource,
        manifest: currentProgressiveManifest,
        localAvailability: currentTrackAvailabilityAnnouncement,
        fallbackReason: progressiveFallbackReason,
        currentPieceDownloadRateKbps: aggregatePieceDownloadRateKbps
      }),
    [
      playbackPositionKey,
      activePlaybackSource,
      currentProgressiveManifest,
      currentTrackAvailabilityAnnouncement,
      progressiveFallbackReason,
      aggregatePieceDownloadRateKbps
    ]
  );
  const progressiveSchedulerPolicy = progressiveHealthSnapshot.schedulerPolicy;
  const isProgressiveTakeoverReady = useCallback(
    (now = Date.now()) => {
      if (!currentProgressiveManifest) {
        return false;
      }

      return isTakeoverReady({
        manifest: currentProgressiveManifest,
        availableChunks: currentTrackAvailableChunksRef.current,
        playbackPositionMs: getEffectivePlaybackPositionMs(
          playbackRef.current,
          currentProgressiveManifest.durationMs,
          now
        )
      });
    },
    [currentProgressiveManifest]
  );
  const canPrepareProgressiveLocal = shouldPrepareProgressiveRuntime({
    trackCachingEnabled: enableTrackCaching,
    hasProgressiveManifest: !!currentProgressiveManifest,
    progressivePlaybackSupported: canUseProgressivePlayback(),
    shouldRetryAfterRuntimeFailure: shouldRetryPcmRuntimeAfterFailure({
      currentTrackId: currentProgressiveManifest?.trackId,
      failureTrackId: pcmRuntimeFailureRef.current?.trackId,
      failureReason: pcmRuntimeFailureRef.current?.reason
    }),
    activePlaybackSource,
    progressiveEngineType: currentProgressiveEngineType
  });
  const canWarmBufferedFullLocal = shouldWarmFullLocalWithSharedAudioElement({
    activePlaybackSource,
    progressiveEngineType: currentProgressiveEngineType,
    canUseFullLocalForPlaybackSession,
    isCurrentSourceOwner
  });
  const pendingPlaybackIntent = isPlaybackStartIntentPending(playbackStartIntent);
  const startupBufferMs = adaptiveStartupBufferMs;
  const localTakeoverCooldownMs = useMemo(
    () => Math.max(0, localTakeoverCooldownUntilRef.current - Date.now()),
    []
  );
  const fullLocalReady = canUseFullLocalForPlaybackSession;
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
    playbackStatus: playback?.status,
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
          playbackStatus: playback?.status,
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
  }, [clearPlaybackStartRetry, resetPlaybackQualityState]);

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

    audio.pause();
    audio.srcObject = null;
    audio.removeAttribute("src");
    audio.load();
    if (resetAction.mediaConnectionState !== null) {
      setMediaConnectionState(resetAction.mediaConnectionState);
    }
  }, [
    audioRef,
    destroyProgressiveRuntime,
    playbackCurrentTrackId,
    playbackStatus,
    playbackSurfaceKey,
    setMediaConnectionState
  ]);

  useEffect(() => {
    activeSourceActivatedAtRef.current = Date.now();
  }, [activePlaybackSource, playback?.currentTrackId, playbackRevision]);

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
      setActivePlaybackSource,
      setProgressiveFallbackReason
    ]
  );
  const markPcmRuntimeFailureRef = useRef(markPcmRuntimeFailure);
  markPcmRuntimeFailureRef.current = markPcmRuntimeFailure;

  useEffect(() => {
    const cooldownAction = resolveLocalTakeoverCooldownResetAction();
    localTakeoverCooldownUntilRef.current = cooldownAction.nextCooldownUntilMs;
  }, [playback?.currentTrackId, playbackRevision]);

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
    playback?.currentTrackId,
    playback?.mediaEpoch,
    playbackRevision,
    resetPlaybackQualityState,
    setProgressiveFallbackReason
  ]);

  const armLocalTakeoverCooldown = useCallback(() => {
    const cooldownAction = resolveLocalTakeoverCooldownArmAction({
      nowMs: Date.now(),
      cooldownMs: getLocalTakeoverCooldownMs()
    });
    localTakeoverCooldownUntilRef.current = cooldownAction.nextCooldownUntilMs;
  }, []);

  const immediateFullLocalRecoveryEligible =
    shouldPreferImmediateFullLocalRecovery({
      isCurrentSourceOwner,
      audioUnlocked,
      hasBufferedFullLocalTrack: canUseFullLocalForPlaybackSession,
      fullLocalRecoveryActive: roomRecoveryState.fullLocalRecoveryActive,
      recoveryPhase: roomRecoveryState.phase,
      recoveryMode: roomRecoveryState.mode,
      playbackStatus: playback?.status
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
        playbackStatus: playback?.status,
        startupGatePending,
        waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
        stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
        shadowWarmupActive,
        audibleLocalFallbackActive
      }),
    [
      activePlaybackSource,
      audibleLocalFallbackActive,
      playback?.status,
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
  }, [currentProgressiveManifest?.trackId]);

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

  useEffect(() => {
    const audio = audioRef.current;
    const playbackState = playbackRef.current;
    const currentTrackId = playbackState?.currentTrackId ?? null;
    const mainPlaybackPreflight = resolveMainPlaybackPreflight({
      hasAudio: !!audio,
      currentTrackId
    });
    if (mainPlaybackPreflight === "skip") {
      return;
    }

    if (!audio) {
      return;
    }

    const resetIdleAction = resolveMainPlaybackResetIdleAction(mainPlaybackPreflight);
    if (resetIdleAction) {
      if (resetIdleAction.shouldDestroyRuntime) {
        destroyProgressiveRuntime();
      }
      if (resetIdleAction.shouldPauseAudio) {
        audio.pause();
      }
      if (resetIdleAction.shouldClearAudioSource) {
        audio.srcObject = null;
        audio.removeAttribute("src");
        audio.load();
      }
      if (resetIdleAction.shouldClearPlaybackStartIntent) {
        setPlaybackStartIntent(null);
      }
      setMediaConnectionState(resetIdleAction.mediaConnectionState);
      return;
    }

    if (!playbackState || !currentTrackId) {
      return;
    }

    const uploaded =
      fullLocalPlaybackTracks[currentTrackId] ??
      uploadedTracks[currentTrackId] ??
      null;
    const sourceOwnerHasLocalTrack = isCurrentSourceOwner && !!uploaded;
    const expectedSeconds =
      getEffectivePlaybackPositionMs(playbackState, currentTrackDurationMs ?? 0, Date.now()) /
      1000;
    const shouldPlayPlayback = hasActivePlaybackIntent(playbackState);
    const wantsFullLocalPlayback = resolveFullLocalPlaybackSelection({
      activePlaybackSource,
      forceSourceOwnerLocalPlayback,
      sourceOwnerHasLocalTrack,
      hasUploadedTrack: !!uploaded
    });
    if (wantsFullLocalPlayback && uploaded) {
      const audioSourceAction = resolveFullLocalAudioSourceAction({
        hasSrcObject: !!audio.srcObject,
        currentSrc: audio.src,
        nextSrc: uploaded.objectUrl
      });
      if (audioSourceAction.shouldClearSrcObject) {
        audio.srcObject = null;
      }
      if (audioSourceAction.shouldAssignSource) {
        audio.src = uploaded.objectUrl;
      }
      if (audioSourceAction.shouldLoadSource) {
        audio.load();
      }
      audio.muted = false;
      audio.volume = getAudibleElementVolume(volume);

      syncLocalPlaybackWindow(audio, expectedSeconds, shouldPlayPlayback, {
        softDriftMs: 90,
        hardDriftMs: 720,
        correctionMode: "audible-local-follow"
      });

      const activationAction = resolveFullLocalPlaybackActivationAction({
        shouldPlayPlayback,
        activePlaybackSource
      });
      if (activationAction) {
        if (activationAction.shouldSetSourceToFullLocal) {
          setActivePlaybackSource("full-local");
        }
        if (activationAction.shouldClearFallbackReason) {
          setProgressiveFallbackReason(null);
        }
        if (activationAction.shouldAttemptPlaybackStart) {
          void attemptPlaybackStart(
            audio,
            "full-local",
            "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
            "full-local-play-blocked",
            { reportFailure: true }
          ).then((ok) => {
            setMediaConnectionState(resolvePlaybackStartMediaConnectionState(ok));
          });
        }
      }

      const pausedPlaybackAction = resolveFullLocalPausedPlaybackAction(playbackState.status);
      if (pausedPlaybackAction) {
        audio.pause();
        if (pausedPlaybackAction.shouldResetPlaybackRate) {
          audio.playbackRate = 1;
        }
        setMediaConnectionState(pausedPlaybackAction.mediaConnectionState);
      }
      return;
    }

    if (isSlidingWindowPlaybackSource(activePlaybackSource)) {
      const pcmEngine = progressivePcmEngineRef.current;
      if (pcmEngine) {
        audio.muted = false;
        void pcmEngine
          .syncPlayback(expectedSeconds, shouldPlayPlayback)
          .then((result) => {
            pcmLastBlockedReasonRef.current = result.blockedReason;
            const pcmFailureReason = resolvePcmRuntimeFailureReason({
              blockedReason: result.blockedReason,
              lastDecodeError: pcmEngine.getSnapshot().lastDecodeError
            });
            markPcmRuntimeFailure(pcmFailureReason);
            const playbackOutcome = resolvePcmSyncPlaybackOutcome({
              shouldPlayPlayback,
              localReady: result.localReady,
              shouldLatchFailure: shouldLatchPcmRuntimeFailure(pcmFailureReason)
            });
            if (!playbackOutcome) {
              return;
            }
            if (playbackOutcome.mediaConnectionState) {
              setMediaConnectionState(playbackOutcome.mediaConnectionState);
            }
            const fallbackReason = playbackOutcome.progressiveFallbackReason;
            if (fallbackReason !== undefined) {
              setProgressiveFallbackReason(fallbackReason);
            }
            if (playbackOutcome.playbackStartFailureKind) {
              markPlaybackStartFailure(
                `${activePlaybackSource}-${playbackOutcome.playbackStartFailureKind}`,
                playbackOutcome.playbackStartFailureKind === "init-failed"
                  ? "本地解码初始化失败，请等待完整缓存后播放。"
                  : "本地缓冲不足，正在缓存播放所需片段。"
              );
              return;
            }
            if (playbackOutcome.shouldEnsurePlaybackStart) {
              ensurePlaybackStart(activePlaybackSource);
            }
          })
          .catch(() => {
            setProgressiveFallbackReason("progressive-init-failed");
            setMediaConnectionState("buffering");
            markPlaybackStartFailure(
              `${activePlaybackSource}-init-failed`,
              "本地解码初始化失败，请等待完整缓存后播放。"
            );
          });
        return;
      }

      audio.muted = false;
      const mseEngine = progressiveEngineRef.current;
      if (mseEngine) {
        void mseEngine.sync().then(() => {
          const localReady = mseEngine.isPlaybackReady(expectedSeconds, startupBufferMs);
          const playbackOutcome = resolveSlidingWindowNativeSyncOutcome({
            shouldPlayPlayback,
            localReady
          });
          if (playbackOutcome.mediaConnectionState) {
            setMediaConnectionState(playbackOutcome.mediaConnectionState);
          }
          const fallbackReason = playbackOutcome.progressiveFallbackReason;
          if (fallbackReason !== undefined) {
            setProgressiveFallbackReason(fallbackReason);
          }
          if (playbackOutcome.playbackStartFailureKind) {
            markPlaybackStartFailure(
              `${activePlaybackSource}-${playbackOutcome.playbackStartFailureKind}`,
              "本地缓冲不足，正在缓存播放所需片段。"
            );
            return;
          }

          syncLocalPlaybackWindow(audio, expectedSeconds, shouldPlayPlayback, {
            softDriftMs: 120,
            hardDriftMs: 900,
            correctionMode: "audible-local-follow"
          });

          if (playbackOutcome.shouldEnsurePlaybackStart) {
            ensurePlaybackStart(activePlaybackSource);
          } else if (playbackOutcome.shouldPausePlayback) {
            audio.pause();
            audio.playbackRate = 1;
          }
        });
        return;
      }

      const noEngineHoldAction = resolveSlidingWindowNoEngineHoldAction({
        activePlaybackSource,
        playbackStatus: playbackState.status,
        hasPcmEngine: false,
        hasMseEngine: false,
        localAudioHasSource: !!(audio.srcObject || audio.src || audio.getAttribute("src"))
      });
      if (noEngineHoldAction.shouldHold) {
        if (noEngineHoldAction.shouldPauseAudio) {
          audio.pause();
          audio.muted = false;
          audio.playbackRate = 1;
        }
        if (noEngineHoldAction.shouldClearAudioSource) {
          audio.srcObject = null;
          audio.removeAttribute("src");
          audio.load();
        }
        if (noEngineHoldAction.mediaConnectionState) {
          setMediaConnectionState(noEngineHoldAction.mediaConnectionState);
        }
        return;
      }

      syncLocalPlaybackWindow(audio, expectedSeconds, shouldPlayPlayback, {
        softDriftMs: 120,
        hardDriftMs: 900,
        correctionMode: "audible-local-follow"
      });

      const fallbackPlaybackAction = resolveSlidingWindowFallbackPlaybackAction({
        shouldPlayPlayback,
        startupReady: progressiveHealthSnapshot.startupReady
      });
      if (fallbackPlaybackAction.shouldClearFallbackReason) {
        setProgressiveFallbackReason(null);
      }
      if (fallbackPlaybackAction.shouldEnsurePlaybackStart) {
        ensurePlaybackStart(activePlaybackSource);
      } else if (fallbackPlaybackAction.shouldPausePlayback) {
        audio.pause();
        audio.playbackRate = 1;
      }

      return;
    }

    const pausedPlaybackAction = resolveMainPausedPlaybackAction(playbackState.status);
    if (pausedPlaybackAction) {
      if (pausedPlaybackAction.shouldPausePlayback) {
        audio.pause();
      }
      if (pausedPlaybackAction.shouldResetPlaybackRate) {
        audio.playbackRate = 1;
      }
    }
  }, [
    audioRef,
    playbackPositionKey,
    currentTrackDurationMs,
    uploadedTracks,
    fullLocalPlaybackTracks,
    activePlaybackSource,
    forceSourceOwnerLocalPlayback,
    isCurrentSourceOwner,
    currentProgressiveEngineType,
    setStatusMessage,
    setMediaConnectionState,
    destroyProgressiveRuntime,
    attemptPlaybackStart,
    ensurePlaybackStart,
    markPlaybackStartFailure,
    markPcmRuntimeFailure,
    setActivePlaybackSource,
    setProgressiveFallbackReason,
    setPlaybackStartIntent,
    progressiveHealthSnapshot.startupReady,
    startupBufferMs,
    volume
  ]);

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

  useEffect(() => {
    const playbackState = playbackRef.current;
    const samplingPreflight = resolveDriftSamplingPreflight({
      currentTrackId: playbackCurrentTrackId,
      hasPlaybackState: !!playbackState,
      playbackHasActiveIntent: hasActivePlaybackIntent(playbackState)
    });
    if (!samplingPreflight) {
      recoverPausedFullLocalPlaybackRef.current = noopPlaybackRuntimeTick;
      sampleDriftRef.current = noopPlaybackRuntimeTick;
      syncFullLocalBufferedWarmupRef.current = noopPlaybackRuntimeTick;
      syncUpgradeRef.current = noopPlaybackRuntimeTick;
      return;
    }

    let runtimeTickCancelled = false;
    let fullLocalPausedRecoveryInFlight = false;

    const recoverPausedFullLocalPlayback = () => {
      const latestPlayback = playbackRef.current;
      const latestTrack = currentTrackRef.current;
      const audio = audioRef.current;
      const recoveryPreflight = resolveFullLocalPausedRecoveryPreflight({
        currentTrackId: latestPlayback?.currentTrackId ?? null,
        hasPlaybackState: !!latestPlayback,
        hasAudio: !!audio,
        activePlaybackSource
      });
      if (!recoveryPreflight || !audio) {
        return;
      }

      const shouldRecover = shouldRecoverPausedFullLocalPlayback({
        activePlaybackSource,
        playbackStatus: latestPlayback?.status ?? "paused",
        currentTrackId: latestPlayback?.currentTrackId ?? null,
        audioUnlocked,
        localAudioPaused: audio.paused,
        localAudioReadyState: audio.readyState,
        localAudioHasSrc: !!audio.currentSrc || !!audio.getAttribute("src"),
        localAudioHasSrcObject: !!audio.srcObject
      });
      const attemptRecovery = resolveFullLocalPausedRecoveryAttemptAction({
        cancelled: runtimeTickCancelled,
        recoveryInFlight: fullLocalPausedRecoveryInFlight,
        shouldRecover
      });
      if (!attemptRecovery) {
        return;
      }

      const expectedSeconds =
        getEffectivePlaybackPositionMs(latestPlayback, latestTrack?.durationMs ?? 0, Date.now()) /
        1000;
      syncLocalPlaybackWindow(audio, expectedSeconds, true, {
        softDriftMs: 90,
        hardDriftMs: 720,
        correctionMode: "audible-local-follow"
      });
      audio.muted = false;
      audio.volume = getAudibleElementVolume(volume);
      fullLocalPausedRecoveryInFlight = true;
      void attemptPlaybackStart(
        audio,
        "full-local",
        "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
        "full-local-paused-recovery",
        { reportFailure: false }
      )
        .then((ok) => {
          if (runtimeTickCancelled) {
            return;
          }

          const recoveryResult = resolveFullLocalPausedRecoveryResult(ok);
          setMediaConnectionState(recoveryResult.mediaConnectionState);
          recordPeerDiagnostic({
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: recoveryResult.diagnosticEvent,
            summary: recoveryResult.diagnosticSummary,
            recordEvent: recoveryResult.recordEvent
          });
        })
        .finally(() => {
          fullLocalPausedRecoveryInFlight = false;
        });
    };

    const sampleDrift = () => {
      const latestPlayback = playbackRef.current;
      const latestTrack = currentTrackRef.current;
      const latestSamplingPreflight = resolveDriftSamplingPreflight({
        currentTrackId: latestPlayback?.currentTrackId ?? null,
        hasPlaybackState: !!latestPlayback,
        playbackHasActiveIntent: hasActivePlaybackIntent(latestPlayback)
      });
      if (!latestSamplingPreflight) {
        return;
      }

      const expectedSeconds =
        getEffectivePlaybackPositionMs(
          latestPlayback,
          latestTrack?.durationMs ?? 0,
          Date.now()
        ) / 1000;
      const audio = audioRef.current;
      const observedSeconds = resolveObservedPlaybackSeconds({
        activePlaybackSource,
        localPlaybackPositionMs: getLocalPlaybackPositionMs(),
        audioCurrentTimeSeconds: audio?.currentTime ?? null,
        audioPaused: audio?.paused ?? true
      });

      const sampleAction = resolveDriftSampleAction({
        expectedSeconds,
        observedSeconds
      });
      if (!sampleAction) {
        return;
      }

      recordDriftSample(sampleAction.driftMs);
    };

    const syncUpgrade = () => {
      const playbackState = playbackRef.current;
      const upgradePreflight = resolveFullLocalUpgradePreflight({
        currentTrackId: playbackState?.currentTrackId ?? null,
        hasPlaybackState: !!playbackState,
        hasBufferedFullLocalObjectUrl: !!currentBufferedFullLocalTrackObjectUrl,
        canWarmBufferedFullLocal,
        activePlaybackSource,
        playbackHasActiveIntent: hasActivePlaybackIntent(playbackState)
      });
      if (!upgradePreflight.shouldRun) {
        fullLocalWarmupReadyAtRef.current = null;
        return;
      }

      const comfortBufferMs = getStartupWindowMs(
        currentTrackRef.current ?? {
          mimeType: null,
          codec: null
        }
      );
      const now = Date.now();
      const localTakeoverAllowed = isLocalTakeoverAllowed(now);
      const shouldUpgrade = shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup({
        activePlaybackSource,
        progressiveEngineType: currentProgressiveEngineType,
        canUseFullLocalForPlaybackSession,
        fullLocalBlockedReason,
        localTakeoverAllowed,
        aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
        comfortBufferMs,
        warmupReadyAt: fullLocalWarmupReadyAtRef.current,
        now,
        switchDelayMs: fullLocalSwitchDelayMs
      });

      if (shouldUpgrade) {
        transitionPlaybackSource("full-local");
        return;
      }

      const canArmIdleFullLocalUpgrade = resolveIdleFullLocalUpgradeArmState({
        progressiveEngineType: currentProgressiveEngineType,
        canUseFullLocalForPlaybackSession,
        fullLocalBlockedReason,
        localTakeoverAllowed,
        aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
        comfortBufferMs
      });
      const upgradeAction = resolveFullLocalUpgradeAction({
        shouldUpgrade,
        canArmIdleFullLocalUpgrade,
        currentWarmupReadyAt: fullLocalWarmupReadyAtRef.current,
        now
      });
      if (upgradeAction.kind === "transition") {
        transitionPlaybackSource(upgradeAction.nextSource);
        return;
      }
      if (upgradeAction.kind === "set-warmup-ready-at") {
        fullLocalWarmupReadyAtRef.current = upgradeAction.nextWarmupReadyAt;
      }
    };

    const syncFullLocalBufferedWarmup = () => {
      const playbackState = playbackRef.current;
      const audio = audioRef.current;
      const warmupPreflight = resolveFullLocalBufferedWarmupPreflight({
        currentTrackId: playbackState?.currentTrackId ?? null,
        hasPlaybackState: !!playbackState,
        hasAudio: !!audio,
        hasBufferedFullLocalObjectUrl: !!currentBufferedFullLocalTrackObjectUrl,
        canWarmBufferedFullLocal
      });
      if (!warmupPreflight.shouldRun) {
        fullLocalWarmupReadyAtRef.current = null;
        return;
      }
      if (!audio) {
        return;
      }

      const latestPlayback = playbackRef.current;
      const latestTrack = currentTrackRef.current;
      const latestBufferedFullLocalTrack = currentBufferedFullLocalTrackRef.current;
      const missingTrackAction = resolveFullLocalWarmupMissingTrackAction({
        hasBufferedFullLocalTrack: !!latestBufferedFullLocalTrack,
        playbackHasActiveIntent: hasActivePlaybackIntent(latestPlayback)
      });
      if (missingTrackAction) {
        if (missingTrackAction.shouldPauseAudio) {
          audio.pause();
          audio.muted = false;
        }
        if (missingTrackAction.shouldResetWarmupReadyAt) {
          fullLocalWarmupReadyAtRef.current = null;
        }
        return;
      }
      if (!latestBufferedFullLocalTrack) {
        return;
      }

      const audioSourceAction = resolveFullLocalAudioSourceAction({
        hasSrcObject: !!audio.srcObject,
        currentSrc: audio.src,
        nextSrc: latestBufferedFullLocalTrack.objectUrl
      });
      if (audioSourceAction.shouldClearSrcObject) {
        audio.srcObject = null;
      }
      if (audioSourceAction.shouldAssignSource) {
        audio.src = latestBufferedFullLocalTrack.objectUrl;
      }
      if (audioSourceAction.shouldLoadSource) {
        audio.load();
      }

      const expectedSeconds =
        getEffectivePlaybackPositionMs(latestPlayback, latestTrack?.durationMs ?? 0, Date.now()) /
        1000;
      syncLocalPlaybackWindow(audio, expectedSeconds, true, {
        softDriftMs: 120,
        hardDriftMs: 900,
        correctionMode: "shadow-local-catchup"
      });
      audio.muted = true;
      void roomAudioOutput.playElement(audio);

      const localReady = audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const driftMs = Math.abs(expectedSeconds * 1000 - audio.currentTime * 1000);
      const now = Date.now();
      const readyForFullLocal = resolveFullLocalWarmupReadiness({
        localReady,
        driftMs,
        maxDriftMs: fullLocalMaxDriftMs,
        fullLocalBlockedReason,
        progressiveEngineType: currentProgressiveEngineType,
        aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
        requiredAheadMs: getStartupWindowMs(
          latestTrack ?? {
            mimeType: null,
            codec: null
          }
        )
      });

      const shouldAttemptFullLocalHandoff = shouldEnableFullLocalHandoff({
        activePlaybackSource,
        playbackRecoveryStage,
        startupGatePending,
        localReady: readyForFullLocal,
        driftMs,
        cooldownMs: Math.max(0, localTakeoverCooldownUntilRef.current - now)
      });

      const holdState = resolveFullLocalWarmupHoldState({
        localTakeoverAllowed: isLocalTakeoverAllowed(now),
        shouldAttemptFullLocalHandoff,
        readyForFullLocal,
        nowMs: now
      });
      if (holdState.shouldHold) {
        fullLocalWarmupReadyAtRef.current = holdState.nextWarmupReadyAt;
        return;
      }

      const warmupDecision = resolveFullLocalWarmupDecision({
        currentSource: activePlaybackSource,
        localReady: readyForFullLocal,
        driftMs,
        warmupReadyAt: fullLocalWarmupReadyAtRef.current,
        now,
        switchDelayMs: fullLocalSwitchDelayMs,
        maxDriftMs: fullLocalMaxDriftMs
      });
      const transitionAction = resolveFullLocalWarmupTransitionAction({
        currentSource: activePlaybackSource,
        nextSource: warmupDecision.nextSource,
        nextWarmupReadyAt: warmupDecision.nextWarmupReadyAt,
        clearFallbackReason: warmupDecision.clearFallbackReason
      });
      fullLocalWarmupReadyAtRef.current = transitionAction.nextWarmupReadyAt;
      if (transitionAction.transition) {
        transitionPlaybackSource(transitionAction.transition.nextSource, {
          clearFallbackReason: transitionAction.transition.clearFallbackReason
        });
      }
    };

    recoverPausedFullLocalPlaybackRef.current = recoverPausedFullLocalPlayback;
    sampleDriftRef.current = sampleDrift;
    syncFullLocalBufferedWarmupRef.current = syncFullLocalBufferedWarmup;
    syncUpgradeRef.current = syncUpgrade;
    recoverPausedFullLocalPlayback();
    sampleDrift();
    syncFullLocalBufferedWarmup();
    syncUpgrade();
    return () => {
      runtimeTickCancelled = true;
      if (recoverPausedFullLocalPlaybackRef.current === recoverPausedFullLocalPlayback) {
        recoverPausedFullLocalPlaybackRef.current = noopPlaybackRuntimeTick;
      }
      if (sampleDriftRef.current === sampleDrift) {
        sampleDriftRef.current = noopPlaybackRuntimeTick;
      }
      if (syncFullLocalBufferedWarmupRef.current === syncFullLocalBufferedWarmup) {
        syncFullLocalBufferedWarmupRef.current = noopPlaybackRuntimeTick;
      }
      if (syncUpgradeRef.current === syncUpgrade) {
        syncUpgradeRef.current = noopPlaybackRuntimeTick;
      }
    };
  }, [
    activePlaybackSource,
    attemptPlaybackStart,
    audioRef,
    audioUnlocked,
    canUseFullLocalForPlaybackSession,
    canWarmBufferedFullLocal,
    currentBufferedFullLocalTrackObjectUrl,
    currentProgressiveEngineType,
    currentTrackDurationMs,
    currentTrackFormatKey,
    fullLocalBlockedReason,
    getLocalPlaybackPositionMs,
    isLocalTakeoverAllowed,
    playbackCurrentTrackId,
    playbackMediaEpoch,
    playbackStatus,
    playbackQualityMetrics.stalledEventsLast30s,
    playbackQualityMetrics.waitingEventsLast30s,
    playbackRecoveryStage,
    progressiveHealthSnapshot.aheadBufferedMs,
    recordDriftSample,
    recordPeerDiagnostic,
    setMediaConnectionState,
    startupGatePending,
    transitionPlaybackSource,
    volume
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    const setupPreflight = resolveProgressiveEngineSetupPreflight({
      hasAudio: !!audio,
      canPrepareProgressiveLocal,
      hasManifest: !!currentProgressiveManifest
    });
    if (setupPreflight === "skip") {
      return;
    }

    progressiveEngineRef.current?.destroy();
    progressiveEngineRef.current = null;
    progressivePcmEngineRef.current?.destroy();
    progressivePcmEngineRef.current = null;
    if (setupPreflight === "destroy-existing" || !audio || !currentProgressiveManifest) {
      return;
    }

    const engine =
      currentProgressiveEngineType === "pcm"
        ? new ProgressivePcmEngine(
            audio,
            peerId,
            currentProgressiveManifest,
            () => roomAudioOutput.getSharedAudioContext()
          )
        : new ProgressiveMseEngine(audio, peerId, currentProgressiveManifest);

    if (engine instanceof ProgressivePcmEngine) {
      progressivePcmEngineRef.current = engine;
      engine.setVolume(volume);
    } else {
      progressiveEngineRef.current = engine;
    }

    void engine
      .attach()
      .then((attached) => {
        const attachAction = resolveProgressiveEngineAttachResultAction({
          isCurrentEngine:
            progressiveEngineRef.current === engine || progressivePcmEngineRef.current === engine,
          attached,
          isPcmEngine: engine instanceof ProgressivePcmEngine
        });
        if (!attachAction) {
          return;
        }

        if (attachAction.kind === "failure") {
          if (attachAction.failureAction === "pcm-runtime-failure") {
            markPcmRuntimeFailure("engine-failed");
          } else {
            setProgressiveFallbackReason(attachAction.failureAction);
          }
          return;
        }

        setProgressiveFallbackReason(resolveProgressiveEngineAttachSuccessFallbackReason);
        if (attachAction.shouldSyncEngine) {
          void engine.sync();
        }
        return undefined;
      })
      .catch(() => {
        const attachAction = resolveProgressiveEngineAttachErrorAction({
          isCurrentEngine:
            progressiveEngineRef.current === engine || progressivePcmEngineRef.current === engine,
          isPcmEngine: engine instanceof ProgressivePcmEngine
        });
        if (!attachAction) {
          return;
        }

        if (attachAction.failureAction === "pcm-runtime-failure") {
          markPcmRuntimeFailure("engine-failed");
        } else {
          setProgressiveFallbackReason(attachAction.failureAction);
        }
      });

    return () => {
      if (progressiveEngineRef.current === engine) {
        progressiveEngineRef.current = null;
      }
      if (progressivePcmEngineRef.current === engine) {
        progressivePcmEngineRef.current = null;
      }
      engine.destroy();
    };
  }, [
    audioRef,
    canPrepareProgressiveLocal,
    currentProgressiveManifest,
    currentProgressiveEngineType,
    peerId,
    volume,
    markPcmRuntimeFailure,
    setProgressiveFallbackReason
  ]);

  useEffect(() => {
    if (!currentProgressiveManifest) {
      return;
    }

    void progressiveEngineRef.current?.sync();
    void progressivePcmEngineRef.current?.sync();
  }, [currentProgressiveManifest, currentTrackAvailabilityAnnouncement?.availableChunks]);

  useEffect(() => {
    progressivePcmEngineRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const playbackState = playbackRef.current;
    const audio = audioRef.current;
    const manifestState = currentProgressiveManifestRef.current.manifest;
    const warmupState = progressiveWarmupRuntimeRef.current;

    const warmupPreflight = resolveWarmupPreflight({
      currentTrackId: playbackState?.currentTrackId ?? null,
      hasAudio: !!audio,
      hasProgressiveEngine: !!progressiveEngineRef.current || !!progressivePcmEngineRef.current,
      hasManifest: !!manifestState,
      activePlaybackSource: warmupState.activePlaybackSource
    });
    if (!warmupPreflight.shouldRun || !audio || !manifestState || !playbackState?.currentTrackId) {
      progressiveWarmupReadyAtRef.current = null;
      return;
    }

    let cancelled = false;

    const syncWarmup = async () => {
      const mseEngine = progressiveEngineRef.current;
      const pcmEngine = progressivePcmEngineRef.current;
      if (cancelled || (!mseEngine && !pcmEngine)) {
        return;
      }

      const latestPlayback = playbackRef.current;
      if (!latestPlayback?.currentTrackId) {
        return;
      }
      const latestManifest = currentProgressiveManifestRef.current.manifest;
      if (!latestManifest) {
        progressiveWarmupReadyAtRef.current = null;
        return;
      }
      const latestWarmupState = progressiveWarmupRuntimeRef.current;

      const expectedSeconds =
        getEffectivePlaybackPositionMs(
          latestPlayback,
          latestManifest.durationMs,
          Date.now()
        ) / 1000;
      const now = Date.now();
      const shadowWarmupReady = true;
      let engineReady = false;
      let localReady = false;
      let driftMs = Number.POSITIVE_INFINITY;

      if (pcmEngine) {
        // The main playback effect already drives pcmEngine.syncPlayback every
        // tick for sliding-window sources. Driving it a second time from this
        // warmup loop means two independent 150ms timers reset the playback
        // anchor and stop/reschedule segments against each other, which is heard
        // as overlapping/doubled audio and eventually corrupts the timeline
        // until playback stalls. In that case only read a snapshot here; never
        // issue a competing syncPlayback.
        const pcmSyncMode = resolveWarmupPcmSyncMode(latestWarmupState.activePlaybackSource);
        const syncResult =
          pcmSyncMode === "snapshot-only"
            ? null
            : await pcmEngine.syncPlayback(expectedSeconds, true);
        if (syncResult) {
          pcmLastBlockedReasonRef.current = syncResult.blockedReason;
          markPcmRuntimeFailureRef.current(
            resolvePcmRuntimeFailureReason({
              blockedReason: syncResult.blockedReason,
              lastDecodeError: pcmEngine.getSnapshot().lastDecodeError
            })
          );
        }
        if (cancelled) {
          return;
        }

        engineReady = pcmEngine.engineStatus === "ready";
        // When the main effect owns playback (sliding-window), read readiness
        // from a snapshot instead of the (skipped) competing syncPlayback.
        localReady = syncResult
          ? syncResult.localReady
          : pcmEngine.getSnapshot().bufferedAheadMs > 0;
        driftMs = syncResult ? syncResult.driftMs : 0;
        audio.muted = !isSlidingWindowPlaybackSource(latestWarmupState.activePlaybackSource);
        const pcmAudioStartAction = resolveWarmupPcmAudioStartAction({
          hasSyncResult: !!syncResult,
          shouldStartAudioElement: shouldStartPcmSlidingWindowAudioElement({
            activePlaybackSource: latestWarmupState.activePlaybackSource,
            playbackStatus: latestPlayback.status,
            localReady,
            audioPaused: audio.paused,
            lastAttemptAtMs: lastPcmSlidingWindowPlayAttemptAtRef.current,
            nowMs: now,
            retryIntervalMs: pcmSlidingWindowPlayRetryIntervalMs
          }),
          nowMs: now
        });
        if (pcmAudioStartAction) {
          lastPcmSlidingWindowPlayAttemptAtRef.current = pcmAudioStartAction.lastAttemptAtMs;
          void attemptPlaybackStartRef.current(
            audio,
            latestWarmupState.activePlaybackSource,
            "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
            getSlidingWindowPlayBlockedReason(latestWarmupState.activePlaybackSource),
            { reportFailure: false }
          ).then((ok) => {
            const startResultAction = resolveWarmupPcmAudioStartResultAction({
              cancelled,
              playbackStarted: ok
            });
            if (!startResultAction) {
              return;
            }
            if (startResultAction.shouldClearFallbackReason) {
              setProgressiveFallbackReason(null);
            }
            setMediaConnectionState(startResultAction.mediaConnectionState);
          });
        }
      } else if (mseEngine) {
        await mseEngine.sync();
        engineReady = mseEngine.engineStatus === "ready";
        localReady = mseEngine.isPlaybackReady(expectedSeconds, latestWarmupState.startupBufferMs);

        const mseCatchupAction = resolveWarmupMseCatchupAction({
          localReady,
          activePlaybackSource: latestWarmupState.activePlaybackSource,
          shadowWarmupReady
        });
        if (mseCatchupAction.shouldCatchup) {
          syncLocalPlaybackWindow(audio, expectedSeconds, true, {
            softDriftMs: 120,
            hardDriftMs: 900,
            correctionMode: "shadow-local-catchup"
          });
          if (mseCatchupAction.shouldMuteAudio !== null) {
            audio.muted = mseCatchupAction.shouldMuteAudio;
          }
          if (mseCatchupAction.shouldPlayElement) {
            void roomAudioOutput.playElement(audio);
          }
          driftMs = Math.abs(expectedSeconds * 1000 - audio.currentTime * 1000);
        }
      }

      const shouldAttemptTakeover = shouldAttemptProgressiveLocalPlayback({
        isCurrentSourceOwner: latestWarmupState.isCurrentSourceOwner,
        activePlaybackSource: latestWarmupState.activePlaybackSource,
        playbackStatus: latestPlayback.status,
        engineType: latestWarmupState.currentProgressiveEngineType,
        startupReady: latestWarmupState.progressiveStartupReady,
        hasFullLocalTrack: latestWarmupState.canUseFullLocalForPlaybackSession,
        progressiveFallbackReason: latestWarmupState.progressiveFallbackReason
      });
      const takeoverBlockedReason = resolveWarmupTakeoverBlockedReason({
        shouldAttemptTakeover,
        progressiveLocalBlockedReason: latestWarmupState.progressiveLocalBlockedReason
      });

      const unavailableAction = resolveWarmupUnavailableAction({
        engineType: latestWarmupState.currentProgressiveEngineType,
        engineReady,
        localReady,
        hasPcmEngine: !!pcmEngine
      });
      if (unavailableAction) {
        if (pcmEngine && unavailableAction.shouldRunSecondaryPcmSync) {
          const syncResult = await pcmEngine.syncPlayback(expectedSeconds, false).catch(() => null);
          pcmLastBlockedReasonRef.current = syncResult?.blockedReason ?? null;
          markPcmRuntimeFailureRef.current(
            resolvePcmRuntimeFailureReason({
              blockedReason: syncResult?.blockedReason,
              lastDecodeError: pcmEngine.getSnapshot().lastDecodeError
            })
          );
          if (cancelled) {
            return;
          }
        } else if (unavailableAction.shouldPauseAudio) {
          audio.pause();
        }
        audio.muted = false;
        progressiveWarmupReadyAtRef.current = null;
        return;
      }

      const localTakeoverAllowed = isLocalTakeoverAllowedRef.current(now);
      const holdState = resolveWarmupHoldState({
        directProgressiveTakeoverEnabled: enableDirectProgressiveTakeover,
        localTakeoverAllowed,
        shouldAttemptTakeover,
        shadowWarmupReady,
        localReady,
        progressiveFallbackReason: latestWarmupState.progressiveFallbackReason,
        playbackRecoveryStage: latestWarmupState.playbackRecoveryStage,
        nowMs: now
      });
      if (holdState.shouldHold) {
        progressiveWarmupReadyAtRef.current = holdState.nextWarmupReadyAt;
        if (holdState.shouldClearFallbackReason) {
          setProgressiveFallbackReason(null);
        }
        return;
      }

      const warmupDecision = resolveProgressiveWarmupDecision({
        currentSource: latestWarmupState.activePlaybackSource,
        engineReady: localReady,
        activationReady: takeoverBlockedReason === null && shadowWarmupReady,
        fallbackReason: takeoverBlockedReason,
        driftMs,
        warmupReadyAt: progressiveWarmupReadyAtRef.current,
        now,
        switchDelayMs: progressiveSwitchDelayMs
      });
      progressiveWarmupReadyAtRef.current = warmupDecision.nextWarmupReadyAt;
      if (warmupDecision.clearFallbackReason) {
        setProgressiveFallbackReason(null);
      }
    };

    const inactiveAction = resolveWarmupInactivePlaybackAction({
      playbackHasActiveIntent: hasActivePlaybackIntent(playbackState),
      hasPcmEngine: !!progressivePcmEngineRef.current
    });
    if (inactiveAction) {
      if (inactiveAction.shouldSyncPcmPlayback && progressivePcmEngineRef.current) {
        void progressivePcmEngineRef.current
          .syncPlayback(
            getEffectivePlaybackPositionMs(
              playbackState,
              manifestState.durationMs,
              Date.now()
            ) / 1000,
            false
          )
          .then((result) => {
            pcmLastBlockedReasonRef.current = result.blockedReason;
            markPcmRuntimeFailureRef.current(
              resolvePcmRuntimeFailureReason({
                blockedReason: result.blockedReason,
                lastDecodeError: progressivePcmEngineRef.current?.getSnapshot().lastDecodeError
              })
            );
          });
      }
      if (inactiveAction.shouldPauseAudio) {
        audio.pause();
        audio.muted = false;
      }
      if (inactiveAction.shouldResetWarmupReadyAt) {
        progressiveWarmupReadyAtRef.current = null;
      }
      return;
    }

    syncProgressiveWarmupRef.current = () => {
      void syncWarmup();
    };
    syncProgressiveWarmupRef.current();

    return () => {
      cancelled = true;
      if (syncProgressiveWarmupRef.current) {
        syncProgressiveWarmupRef.current = noopPlaybackRuntimeTick;
      }
    };
  }, [
    progressiveWarmupTimerKey,
    audioRef,
    setMediaConnectionState,
    setProgressiveFallbackReason
  ]);

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
