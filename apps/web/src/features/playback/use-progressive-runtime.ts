"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from "react";
import type {
  PeerDiagnosticsSnapshot,
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackAvailabilityAnnouncement,
  TrackMeta
} from "@music-room/shared";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
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
  type ProgressiveSchedulerPolicy,
  type ProgressivePlaybackSource
} from "./progressive-playback";
import {
  consumePlaybackStartIntent,
  doesPlaybackMatchStartIntent,
  failPlaybackStartIntent,
  getPlaybackStartIntentLabel,
  isPlaybackStartIntentPending,
  type PlaybackStartIntent
} from "./playback-start-intent";
import { ProgressiveMseEngine } from "./progressive-mse-engine";
import { ProgressivePcmEngine } from "./progressive-pcm-engine";
import { roomAudioOutput } from "./room-audio-output";
import {
  resolvePcmRuntimeFailureReason,
  shouldLatchPcmRuntimeFailure,
  shouldRetryPcmRuntimeAfterFailure
} from "./pcm-runtime-failure";
import { PlaybackOrchestrator } from "./playback-orchestrator/orchestrator";

// Re-exported for backward compatibility with existing import sites/tests.
export { shouldLatchPcmRuntimeFailure, shouldRetryPcmRuntimeAfterFailure };
import {
  resolveFullLocalWarmupDecision,
  resolveProgressiveWarmupDecision,
  shouldForceSourceOwnerLocalPlayback
} from "./progressive-source-controller";
import {
  appendPlaybackQualityTimestamp,
  buildCurrentTrackFormatKey,
  buildPlaybackPositionKey,
  buildProgressiveWarmupTimerKey,
  appendPlaybackDriftSample,
  bucketDiagnosticDurationMs,
  getAudibleElementVolume,
  getPcmEngineDiagnosticsKey,
  getSlidingWindowPlayBlockedReason,
  hasSufficientBackingForFullLocalWarmup,
  isRecoverableProgressiveFallbackReason,
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
  type PlaybackDriftSample,
  type TransportGovernorMode
} from "./playback-orchestrator/pipeline";
import {
  resolvePlaybackSurfaceKey,
  resolvePlaybackTimelineKey
} from "@/features/room/hooks/room-playback-topology";
import type { UploadedTrack } from "@/features/upload/audio-utils";

export type FullLocalPlaybackTrack = Pick<UploadedTrack, "file" | "objectUrl">;

type RuntimeTickState = {
  lastDriftSampleAtMs: number;
  lastPausedRecoveryAtMs: number;
};

type RuntimeTickEffect =
  | "recover-paused-full-local"
  | "sync-progressive-warmup"
  | "sync-full-local-warmup"
  | "sync-upgrade"
  | "sample-drift";

type RuntimeTickOrchestrator = PlaybackOrchestrator<
  RuntimeTickState,
  null,
  null,
  RuntimeTickEffect,
  null,
  number
>;

const noopRuntimeTick = () => undefined;

type UseProgressiveRuntimeInput = {
  audioRef: RefObject<HTMLAudioElement | null>;
  roomSnapshot: RoomSnapshot | null;
  currentTrack: TrackMeta | null;
  peerId: string;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  uploadedTracks: Record<string, UploadedTrack>;
  fullLocalPlaybackTracks: Record<string, FullLocalPlaybackTrack>;
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  setActivePlaybackSource: Dispatch<SetStateAction<ProgressivePlaybackSource>>;
  progressiveFallbackReason: string | null;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
  playbackStartIntent: PlaybackStartIntent | null;
  setPlaybackStartIntent: Dispatch<SetStateAction<PlaybackStartIntent | null>>;
  audioUnlocked: boolean;
  roomRecoveryState: {
    phase:
      | "joining"
      | "resyncing"
      | "bootstrapping-data"
      | "playing-local-fallback"
      | "steady";
    mode: "late-join" | "rejoin" | "steady";
    generation: number | null;
    bootstrapStartedAt: string | null;
    bootstrapSourcePeerId: string | null;
    pendingSnapshot: boolean;
    pendingData: boolean;
    pendingMedia: boolean;
    listenerBootstrapAttempts: number | null;
    fullLocalRecoveryActive: boolean;
  };
  isPageVisible: boolean;
  volume: number;
  connectedPeersCount: number;
  mediaConnectedPeersCount: number;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  setStatusMessage: (value: string) => void;
  setSchedulerMode: Dispatch<SetStateAction<"normal" | "conservative" | "idle">>;
  setBufferHealth: Dispatch<SetStateAction<"healthy" | "low" | "critical">>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
};

type UseProgressiveRuntimeResult = {
  progressiveSchedulerPolicy: ProgressiveSchedulerPolicy | null;
  transportGovernorMode: TransportGovernorMode;
  getLocalPlaybackPositionMs: () => number | null;
  destroyProgressiveRuntime: () => void;
};

const progressiveRuntimeTickIntervalMs = 150;
const progressiveSwitchDelayMs = getFullLocalStableWindowMs();
const fullLocalSwitchDelayMs = getFullLocalStableWindowMs();
const fullLocalMaxDriftMs = 180;
const playbackStartRetryDelayMs = 160;
const maxPlaybackStartRetryAttempts = 18;
const enableTrackCaching = true;
const enableDirectProgressiveTakeover = enableTrackCaching;
const enableListenerLocalTakeover = enableTrackCaching;
const adaptiveStartupBufferMs = 60;
const haveCurrentDataReadyState = 2;
const playbackQualityWindowMs = 30_000;
const playbackDriftSampleIntervalMs = 1_000;
const fullLocalPausedRecoveryIntervalMs = 500;
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
  const playbackStartRetryRef = useRef<number | null>(null);
  const lastPcmSlidingWindowPlayAttemptAtRef = useRef<number | null>(null);
  const syncProgressiveWarmupRef = useRef<() => void>(noopRuntimeTick);
  const recoverPausedFullLocalPlaybackRef = useRef<() => void>(noopRuntimeTick);
  const sampleDriftRef = useRef<() => void>(noopRuntimeTick);
  const syncFullLocalBufferedWarmupRef = useRef<() => void>(noopRuntimeTick);
  const syncUpgradeRef = useRef<() => void>(noopRuntimeTick);
  const [runtimeTickOrchestratorRef] = useState<{ current: RuntimeTickOrchestrator }>(() => {
    const initialRuntimeTickAtMs = Date.now();
    const runtimeTickOrchestrator = new PlaybackOrchestrator({
      initialState: {
        lastDriftSampleAtMs: initialRuntimeTickAtMs,
        lastPausedRecoveryAtMs: initialRuntimeTickAtMs
      },
      initialInput: null,
      initialSnapshot: null,
      tickMs: progressiveRuntimeTickIntervalMs,
      getEngineSnapshot: () => null,
      reduceTick: ({ state, nowMs }) => {
        const shouldSampleDrift =
          nowMs - state.lastDriftSampleAtMs >= playbackDriftSampleIntervalMs;
        const shouldRecoverPausedFullLocal =
          nowMs - state.lastPausedRecoveryAtMs >= fullLocalPausedRecoveryIntervalMs;
        return {
          nextState: {
            lastDriftSampleAtMs: shouldSampleDrift ? nowMs : state.lastDriftSampleAtMs,
            lastPausedRecoveryAtMs: shouldRecoverPausedFullLocal
              ? nowMs
              : state.lastPausedRecoveryAtMs
          },
          effects: [
            ...(shouldRecoverPausedFullLocal ? (["recover-paused-full-local"] as const) : []),
            "sync-progressive-warmup",
            "sync-full-local-warmup",
            "sync-upgrade",
            ...(shouldSampleDrift ? (["sample-drift"] as const) : [])
          ] as const
        };
      },
      runEffect: (effect) => {
        if (effect === "sync-progressive-warmup") {
          syncProgressiveWarmupRef.current();
          return;
        }
        if (effect === "recover-paused-full-local") {
          recoverPausedFullLocalPlaybackRef.current();
          return;
        }
        if (effect === "sample-drift") {
          sampleDriftRef.current();
          return;
        }
        if (effect === "sync-full-local-warmup") {
          syncFullLocalBufferedWarmupRef.current();
          return;
        }
        syncUpgradeRef.current();
      },
      buildSnapshot: () => null,
      scheduler: {
        setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
        clearInterval: (timerId) => window.clearInterval(timerId)
      }
    });
    return { current: runtimeTickOrchestrator };
  });
  const subscribeRuntimeOrchestrator = useCallback(
    (listener: () => void) => runtimeTickOrchestratorRef.current.subscribe(listener),
    [runtimeTickOrchestratorRef]
  );
  const getRuntimeOrchestratorSnapshot = useCallback(
    () => runtimeTickOrchestratorRef.current.getSnapshot(),
    [runtimeTickOrchestratorRef]
  );
  const runtimeOrchestratorSnapshot = useSyncExternalStore(
    subscribeRuntimeOrchestrator,
    getRuntimeOrchestratorSnapshot,
    getRuntimeOrchestratorSnapshot
  );
  void runtimeOrchestratorSnapshot;
  const lastProgressiveDiagnosticSignatureRef = useRef<string | null>(null);
  const activeSourceActivatedAtRef = useRef<number>(Date.now());
  const localTakeoverCooldownUntilRef = useRef<number>(0);
  const lastStablePlaybackAtRef = useRef<string | null>(null);
  const waitingEventTimestampsRef = useRef<number[]>([]);
  const stalledEventTimestampsRef = useRef<number[]>([]);
  const driftSamplesRef = useRef<readonly PlaybackDriftSample[]>([]);
  const continuousPlaybackStartedAtRef = useRef<number | null>(null);
  const [, setAudioPaused] = useState<boolean | null>(null);
  const continuousPlaybackSegmentsRef = useRef<Array<{ startedAtMs: number; endedAtMs: number }>>([]);
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
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      setAudioPaused(null);
      return;
    }

    const handlePlay = () => setAudioPaused(false);
    const handlePause = () => setAudioPaused(true);
    setAudioPaused(audio.paused);

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [audioRef, playback?.currentTrackId]);

  const localAudioDiagnostics = useMemo(() => {
    return resolveLocalAudioDiagnostics(audioRef.current);
  }, [audioRef]);
  const pcmEngineDiagnostics = progressivePcmEngineRef.current?.getSnapshot() ?? null;
  const pcmEngineDiagnosticsKey = getPcmEngineDiagnosticsKey(pcmEngineDiagnostics);
  const shadowWarmupActive = false;

  const pushQualityEvent = useCallback(
    (targetRef: typeof waitingEventTimestampsRef, timestampMs = Date.now()) => {
      targetRef.current = appendPlaybackQualityTimestamp({
        timestamps: targetRef.current,
        timestampMs,
        windowMs: playbackQualityWindowMs
      });
    },
    []
  );
  const markContinuousPlaybackStarted = useCallback((timestampMs = Date.now()) => {
    continuousPlaybackStartedAtRef.current = resolveContinuousPlaybackStart({
      activeStartedAtMs: continuousPlaybackStartedAtRef.current,
      timestampMs
    });
  }, []);
  const markContinuousPlaybackInterrupted = useCallback(
    (timestampMs = Date.now()) => {
      const nextState = resolveContinuousPlaybackInterruption({
        segments: continuousPlaybackSegmentsRef.current,
        activeStartedAtMs: continuousPlaybackStartedAtRef.current,
        timestampMs,
        windowMs: playbackQualityWindowMs
      });
      continuousPlaybackSegmentsRef.current = nextState.segments;
      continuousPlaybackStartedAtRef.current = nextState.activeStartedAtMs;
    },
    []
  );
  const getMaxContinuousPlaybackMsLast30s = useCallback(
    (now = Date.now()) => {
      const nextState = resolveContinuousPlaybackWindowMetrics({
        segments: continuousPlaybackSegmentsRef.current,
        activeStartedAtMs: continuousPlaybackStartedAtRef.current,
        nowMs: now,
        windowMs: playbackQualityWindowMs
      });
      continuousPlaybackSegmentsRef.current = nextState.segments;
      return nextState.maxContinuousPlaybackMs;
    },
    []
  );

  const recordDriftSample = useCallback(
    (driftMs: number, timestampMs = Date.now()) => {
      driftSamplesRef.current = appendPlaybackDriftSample({
        samples: driftSamplesRef.current,
      driftMs,
      timestampMs,
      windowMs: playbackQualityWindowMs
      });
    },
    []
  );

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
    if (playbackStartRetryRef.current !== null) {
      window.clearTimeout(playbackStartRetryRef.current);
      playbackStartRetryRef.current = null;
    }
    lastPcmSlidingWindowPlayAttemptAtRef.current = null;
    waitingEventTimestampsRef.current = [];
    stalledEventTimestampsRef.current = [];
    driftSamplesRef.current = [];
    continuousPlaybackStartedAtRef.current = null;
    continuousPlaybackSegmentsRef.current = [];
  }, []);

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
    const forceLocalAction =
      resolveForceSourceOwnerLocalPlaybackAction(forceSourceOwnerLocalPlayback);
    if (!forceLocalAction) {
      return;
    }

    setActivePlaybackSource(forceLocalAction.nextSource);
  }, [forceSourceOwnerLocalPlayback, setActivePlaybackSource]);

  useEffect(() => {
    const cooldownAction = resolveLocalTakeoverCooldownResetAction();
    localTakeoverCooldownUntilRef.current = cooldownAction.nextCooldownUntilMs;
  }, [playback?.currentTrackId, playbackRevision]);

  useEffect(() => {
    const resetAction = resolvePlaybackTimelineResetAction();
    progressiveWarmupReadyAtRef.current = resetAction.nextProgressiveWarmupReadyAt;
    fullLocalWarmupReadyAtRef.current = resetAction.nextFullLocalWarmupReadyAt;
    waitingEventTimestampsRef.current = resetAction.nextWaitingEventTimestamps;
    stalledEventTimestampsRef.current = resetAction.nextStalledEventTimestamps;
    driftSamplesRef.current = resetAction.nextDriftSamples;
    continuousPlaybackStartedAtRef.current = resetAction.nextContinuousPlaybackStartedAt;
    continuousPlaybackSegmentsRef.current = resetAction.nextContinuousPlaybackSegments;
    lastPcmSlidingWindowPlayAttemptAtRef.current =
      resetAction.nextPcmSlidingWindowPlayAttemptAt;
    if (resetAction.shouldClearFallbackReason) {
      setProgressiveFallbackReason(null);
    }
  }, [playback?.currentTrackId, playback?.mediaEpoch, playbackRevision, setProgressiveFallbackReason]);

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

  useEffect(() => {
    const recoveryAction = resolveImmediateFullLocalRecoveryAction({
      immediateFullLocalRecoveryEligible,
      activePlaybackSource,
      hasBufferedFullLocalTrack: !!currentBufferedFullLocalTrack
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
    currentBufferedFullLocalTrackObjectUrl,
    immediateFullLocalRecoveryEligible,
    setActivePlaybackSource,
    setProgressiveFallbackReason
  ]);

  const transitionPlaybackSource = useCallback(
    (
      nextSource: ProgressivePlaybackSource,
      options?: {
        fallbackReason?: string | null;
        clearFallbackReason?: boolean;
        force?: boolean;
        armCooldown?: boolean;
      }
    ) => {
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
        playbackStatus: playback?.status,
        canUseFullLocalForPlaybackSession,
        fullLocalBlockedReason,
        slidingWindowStartupReady: progressiveHealthSnapshot.startupReady,
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
  }, [
    activePlaybackSource,
    audioRef,
    canUseFullLocalForPlaybackSession,
    fullLocalBlockedReason,
    localAudioDiagnostics,
    pcmEngineDiagnosticsKey,
    playback?.status,
    progressiveHealthSnapshot.startupReady,
    setMediaConnectionState,
    transitionPlaybackSource
  ]);

  const clearPlaybackStartRetry = useCallback(() => {
    if (playbackStartRetryRef.current !== null) {
      window.clearTimeout(playbackStartRetryRef.current);
      playbackStartRetryRef.current = null;
    }
  }, []);

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

  const updatePlaybackStartIntent = useCallback(
    (updater: (current: PlaybackStartIntent) => PlaybackStartIntent) => {
      setPlaybackStartIntent((current) => (current ? updater(current) : current));
    },
    [setPlaybackStartIntent]
  );

  const markPlaybackStartFailure = useCallback(
    (failure: string, fallbackMessage: string) => {
      if (!playbackStartIntent || !isPlaybackStartIntentPending(playbackStartIntent)) {
        return;
      }

      updatePlaybackStartIntent((current) => failPlaybackStartIntent(current, failure));
      setStatusMessage(fallbackMessage);
    },
    [playbackStartIntent, setStatusMessage, updatePlaybackStartIntent]
  );

  const attemptPlaybackStart = useCallback(
    async (
      element: HTMLAudioElement | null,
      source: ProgressivePlaybackSource,
      blockedMessage: string,
      failureReason: string,
      options?: {
        reportFailure?: boolean;
      }
    ) => {
      if (!element) {
        return false;
      }

      const playResult = await roomAudioOutput.playElement(element);
      if (!playResult.ok) {
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "local-play-start-failed",
          level: "warning",
          summary: `${failureReason}: ${playResult.error ?? "play() failed"}`,
          recordEvent: false,
          update: (snapshot) => ({
            ...snapshot,
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              lastPlayStartFailure: failureReason
            }
          })
        });
        const matchedIntent = doesPlaybackMatchStartIntent(
          playbackStartIntent,
          playbackRef.current
        );
        const failureIntentAction = resolvePlaybackStartFailureIntentAction({
          reportFailure: options?.reportFailure !== false,
          intentMatchesPlayback: matchedIntent,
          blockedMessage
        });
        if (failureIntentAction.shouldMarkFailure && failureIntentAction.statusMessage) {
          markPlaybackStartFailure(failureReason, failureIntentAction.statusMessage);
        }
        return false;
      }

      if (doesPlaybackMatchStartIntent(playbackStartIntent, playbackRef.current)) {
        updatePlaybackStartIntent((current) => consumePlaybackStartIntent(current, source));
      }
      setAudioPaused(false);

      return true;
    },
    [
      markPlaybackStartFailure,
      playbackStartIntent,
      recordPeerDiagnostic,
      updatePlaybackStartIntent
    ]
  );
  const attemptPlaybackStartRef = useRef(attemptPlaybackStart);
  attemptPlaybackStartRef.current = attemptPlaybackStart;
  const ensurePlaybackStart = useCallback(
    (source: ProgressivePlaybackSource, attempt = 0) => {
      clearPlaybackStartRetry();

      const pendingIntent =
        !!playbackStartIntent && isPlaybackStartIntentPending(playbackStartIntent);
      const retryPreflight = resolvePlaybackStartRetryPreflight({
        playbackHasActiveIntent: hasActivePlaybackIntent(playbackRef.current),
        activePlaybackSource,
        requestedSource: source,
        pendingIntent,
        attempt,
        maxRetryAttempts: maxPlaybackStartRetryAttempts
      });
      if (!retryPreflight) {
        return;
      }

      const targetElement = audioRef.current;
      const blockedMessage = "浏览器阻止了本地音频自动播放，请手动点击播放恢复。";
      void attemptPlaybackStart(targetElement, source, blockedMessage, retryPreflight.failureReason, {
        reportFailure: retryPreflight.reportFailure
      }).then((ok) => {
        const retryResult = resolvePlaybackStartRetryResult({
          playbackStarted: ok,
          attempt,
          maxRetryAttempts: maxPlaybackStartRetryAttempts
        });
        if (retryResult.shouldClearRetry) {
          clearPlaybackStartRetry();
        }

        if (!retryResult.shouldScheduleRetry) {
          return;
        }

        playbackStartRetryRef.current = window.setTimeout(() => {
          ensurePlaybackStart(source, attempt + 1);
        }, playbackStartRetryDelayMs);
      });
    },
    [
      activePlaybackSource,
      attemptPlaybackStart,
      audioRef,
      clearPlaybackStartRetry,
      playbackStartIntent
    ]
  );

  useEffect(() => {
    const schedulerAction = resolveInactivePlaybackSchedulerAction({
      currentTrackId: playbackCurrentTrackId,
      playbackStatus,
      isPageVisible
    });
    if (schedulerAction) {
      setSchedulerMode(schedulerAction.schedulerMode);
    }
  }, [isPageVisible, playbackCurrentTrackId, playbackStatus, setSchedulerMode]);

  useEffect(() => {
    const timeoutPreflight = resolvePlaybackStartIntentTimeoutPreflight({
      hasIntent: !!playbackStartIntent,
      intentPending: isPlaybackStartIntentPending(playbackStartIntent),
      expiresAtMs: playbackStartIntent?.expiresAt ?? 0,
      nowMs: Date.now()
    });
    if (!timeoutPreflight || !playbackStartIntent) {
      return;
    }

    const timerId = window.setTimeout(() => {
      setPlaybackStartIntent((current) => {
        const timeoutResult = resolvePlaybackStartIntentTimeoutResult({
          hasCurrentIntent: !!current,
          currentIntentId: current?.id ?? null,
          targetIntentId: playbackStartIntent.id,
          currentIntentPending: isPlaybackStartIntentPending(current)
        });
        if (timeoutResult === "keep") {
          return current;
        }

        if (!current) {
          return current;
        }

        return failPlaybackStartIntent(current, "intent-timeout");
      });
      setStatusMessage("当前点击未能激活音频，请再次点击播放");
    }, timeoutPreflight.timeoutMs);

    return () => window.clearTimeout(timerId);
  }, [playbackStartIntent, setPlaybackStartIntent, setStatusMessage]);

  useEffect(() => {
    if (resolvePlaybackStartRetryClearAction(hasActivePlaybackIntent(playbackRef.current))) {
      clearPlaybackStartRetry();
    }
  }, [
    clearPlaybackStartRetry,
    playbackCurrentTrackId,
    playbackStatus
  ]);

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

  useEffect(() => {
    const localAudio = audioRef.current;
    const resolveEventRole = (target: EventTarget | null) => {
      if (target === localAudio) {
        return resolveMediaElementPlaybackRole({
          target: "local",
          activePlaybackSource,
          shadowWarmupActive
        });
      }

      return "inactive" as const;
    };
    const handlePlaying = (event: Event) => {
      const role = resolveEventRole(event.currentTarget);
      const nowIso = new Date().toISOString();
      const playingAction = resolvePlayingPlaybackEventAction({
        role,
        currentMediaConnectionState: "live",
        currentTrackId: playbackRef.current?.currentTrackId ?? null,
        nowIso
      });
      if (!playingAction) {
        return;
      }

      setSchedulerMode(playingAction.schedulerMode);
      setBufferHealth(playingAction.bufferHealth);
      if (playingAction.shouldMarkContinuousPlaybackStarted) {
        markContinuousPlaybackStarted();
      }
      lastStablePlaybackAtRef.current = playingAction.nextStablePlaybackAt;
      setMediaConnectionState((current) => {
        const nextAction = resolvePlayingPlaybackEventAction({
          role,
          currentMediaConnectionState: current,
          currentTrackId: playbackRef.current?.currentTrackId ?? null,
          nowIso
        });
        return nextAction?.mediaConnectionState ?? current;
      });
    };
    const handleWaiting = (event: Event) => {
      const role = resolveEventRole(event.currentTarget);
      const waitingAction = resolveWaitingPlaybackEventAction({
        role,
        activePlaybackSource,
        aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
        criticalBufferThresholdMs: getCriticalBufferThresholdMs()
      });
      if (!waitingAction) {
        return;
      }

      const now = Date.now();
      if (waitingAction.shouldMarkContinuousPlaybackInterrupted) {
        markContinuousPlaybackInterrupted(now);
      }
      if (waitingAction.qualityEvent === "waiting") {
        pushQualityEvent(waitingEventTimestampsRef, now);
      }
      setSchedulerMode(waitingAction.schedulerMode);
      setBufferHealth(waitingAction.bufferHealth);
      if (waitingAction.fallbackReason) {
        setProgressiveFallbackReason(waitingAction.fallbackReason);
      }
      setMediaConnectionState((current) => {
        const nextAction = resolveWaitingPlaybackEventAction({
          role,
          activePlaybackSource,
          aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
          criticalBufferThresholdMs: getCriticalBufferThresholdMs(),
          currentMediaConnectionState: current
        });
        return nextAction?.mediaConnectionState ?? current;
      });
    };
    const handleStalled = (event: Event) => {
      const role = resolveEventRole(event.currentTarget);
      const stalledAction = resolveStalledPlaybackEventAction(role);
      if (!stalledAction) {
        return;
      }

      const now = Date.now();
      if (stalledAction.shouldMarkContinuousPlaybackInterrupted) {
        markContinuousPlaybackInterrupted(now);
      }
      if (stalledAction.qualityEvent === "stalled") {
        pushQualityEvent(stalledEventTimestampsRef, now);
      }
      setSchedulerMode(stalledAction.schedulerMode);
      setBufferHealth(stalledAction.bufferHealth);
      if (stalledAction.fallbackReason) {
        setProgressiveFallbackReason(stalledAction.fallbackReason);
      }
      setMediaConnectionState((current) => {
        const nextAction = resolveStalledPlaybackEventAction(role, current);
        return nextAction?.mediaConnectionState ?? current;
      });
    };
    const handlePause = (event: Event) => {
      const role = resolveEventRole(event.currentTarget);
      const pauseAction = resolvePausedPlaybackEventAction({
        role,
        playbackHasActiveIntent: hasActivePlaybackIntent(playbackRef.current),
        isPageVisible,
        activePlaybackSource,
        playbackStatus: playbackRef.current?.status
      });
      if (!pauseAction) {
        return;
      }

      if (pauseAction.shouldMarkContinuousPlaybackInterrupted) {
        markContinuousPlaybackInterrupted();
      }
      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: pauseAction.diagnosticEvent,
        summary: pauseAction.diagnosticSummary,
        recordEvent: pauseAction.recordEvent
      });
      if (pauseAction.schedulerMode !== undefined && pauseAction.bufferHealth !== undefined) {
        setSchedulerMode(pauseAction.schedulerMode);
        setBufferHealth(pauseAction.bufferHealth);
      }
    };
    const handleLocalSeeked = () => {
      const seekAction = resolveSeekedPlaybackEventAction({
        hasAudio: !!localAudio,
        activePlaybackSource,
        hasProgressiveManifest: !!currentProgressiveManifest,
        soughtPositionMs: Math.round((localAudio?.currentTime ?? 0) * 1000),
        contiguousBufferedMs: progressiveHealthSnapshot.contiguousBufferedMs
      });
      if (!seekAction) {
        return;
      }

      setSchedulerMode(seekAction.schedulerMode);
      setBufferHealth(seekAction.bufferHealth);
      setProgressiveFallbackReason(seekAction.fallbackReason);
    };

    localAudio?.addEventListener("playing", handlePlaying);
    localAudio?.addEventListener("waiting", handleWaiting);
    localAudio?.addEventListener("stalled", handleStalled);
    localAudio?.addEventListener("pause", handlePause);
    localAudio?.addEventListener("seeked", handleLocalSeeked);

    return () => {
      localAudio?.removeEventListener("playing", handlePlaying);
      localAudio?.removeEventListener("waiting", handleWaiting);
      localAudio?.removeEventListener("stalled", handleStalled);
      localAudio?.removeEventListener("pause", handlePause);
      localAudio?.removeEventListener("seeked", handleLocalSeeked);
    };
  }, [
    activePlaybackSource,
    audioRef,
    currentProgressiveManifest,
    isPageVisible,
    isCurrentSourceOwner,
    markContinuousPlaybackInterrupted,
    markContinuousPlaybackStarted,
    pushQualityEvent,
    recordPeerDiagnostic,
    progressiveHealthSnapshot.contiguousBufferedMs,
    progressiveHealthSnapshot.aheadBufferedMs,
    setBufferHealth,
    setMediaConnectionState,
    setProgressiveFallbackReason,
    setSchedulerMode,
    shadowWarmupActive
  ]);

  useEffect(() => {
    const localAudio = audioRef.current;
    const localReadyEvents: Array<keyof HTMLMediaElementEventMap> = [
      "loadedmetadata",
      "canplay",
      "playing"
    ];
    const handleLocalReady = () => {
      const localReadyAction = resolveLocalReadyPlaybackAction({
        activePlaybackSource,
        playbackHasActiveIntent: hasActivePlaybackIntent(playbackRef.current),
        localAudioPaused: !!localAudio?.paused
      });
      if (localReadyAction.shouldEnsurePlaybackStart) {
        ensurePlaybackStart(activePlaybackSource);
      }
      if (localReadyAction.shouldAttemptFullLocalPlayback && localAudio) {
        localAudio.muted = false;
        localAudio.volume = getAudibleElementVolume(volume);
        void attemptPlaybackStart(
          localAudio,
          "full-local",
          "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
          "full-local-play-blocked",
          { reportFailure: true }
        ).then((ok) => {
          const readyPlaybackResult = resolveFullLocalReadyPlaybackResult(ok);
          setMediaConnectionState(readyPlaybackResult.mediaConnectionState);
          recordPeerDiagnostic({
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: readyPlaybackResult.diagnosticEvent,
            summary: readyPlaybackResult.diagnosticSummary,
            recordEvent: readyPlaybackResult.recordEvent
          });
        });
      }
    };
    for (const eventName of localReadyEvents) {
      localAudio?.addEventListener(eventName, handleLocalReady);
    }

    return () => {
      for (const eventName of localReadyEvents) {
        localAudio?.removeEventListener(eventName, handleLocalReady);
      }
    };
  }, [
    activePlaybackSource,
    audioRef,
    attemptPlaybackStart,
    ensurePlaybackStart,
    recordPeerDiagnostic,
    setMediaConnectionState,
    volume
  ]);

  useEffect(() => {
    const nextPlayback = playbackRef.current;

    const localAudio = audioRef.current;
    const localPlaybackReady = resolveLocalPlaybackReady({
      hasAudio: !!localAudio,
      localAudioPaused: localAudio?.paused ?? true,
      localAudioReadyState: localAudio?.readyState ?? 0,
      localAudioHasSrcObject: !!localAudio?.srcObject,
      localAudioHasCurrentSrc: !!localAudio?.currentSrc
    });
    const nextMediaConnectionState = resolveListenerMediaConnectionState({
      currentTrackId: nextPlayback?.currentTrackId ?? null,
      isCurrentSourceOwner,
      playbackHasActiveIntent: hasActivePlaybackIntent(nextPlayback),
      localPlaybackReady
    });
    if (nextMediaConnectionState !== null) {
      setMediaConnectionState(nextMediaConnectionState);
    }
  }, [
    audioRef,
    playbackCurrentTrackId,
    playbackStatus,
    isCurrentSourceOwner,
    mediaConnectedPeersCount,
    activePlaybackSource,
    setMediaConnectionState
  ]);

  useEffect(() => {
    const playbackState = playbackRef.current;
    const samplingPreflight = resolveDriftSamplingPreflight({
      currentTrackId: playbackCurrentTrackId,
      hasPlaybackState: !!playbackState,
      playbackHasActiveIntent: hasActivePlaybackIntent(playbackState)
    });
    if (!samplingPreflight) {
      recoverPausedFullLocalPlaybackRef.current = noopRuntimeTick;
      sampleDriftRef.current = noopRuntimeTick;
      syncFullLocalBufferedWarmupRef.current = noopRuntimeTick;
      syncUpgradeRef.current = noopRuntimeTick;
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
        recoverPausedFullLocalPlaybackRef.current = noopRuntimeTick;
      }
      if (sampleDriftRef.current === sampleDrift) {
        sampleDriftRef.current = noopRuntimeTick;
      }
      if (syncFullLocalBufferedWarmupRef.current === syncFullLocalBufferedWarmup) {
        syncFullLocalBufferedWarmupRef.current = noopRuntimeTick;
      }
      if (syncUpgradeRef.current === syncUpgrade) {
        syncUpgradeRef.current = noopRuntimeTick;
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
    runtimeTickOrchestratorRef.current.mount();
    return () => {
      runtimeTickOrchestratorRef.current.unmount();
    };
  }, [runtimeTickOrchestratorRef]);

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
        syncProgressiveWarmupRef.current = () => undefined;
      }
    };
  }, [
    progressiveWarmupTimerKey,
    audioRef,
    setMediaConnectionState,
    setProgressiveFallbackReason
  ]);

  useEffect(() => {
    const fallbackReason = resolveSlidingWindowLowBufferFallbackReason({
      activePlaybackSource,
      playbackHasActiveIntent: hasActivePlaybackIntent(playbackRef.current),
      startupReady: progressiveHealthSnapshot.startupReady,
      aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
      criticalBufferThresholdMs: getCriticalBufferThresholdMs()
    });
    if (fallbackReason) {
      setProgressiveFallbackReason(fallbackReason);
    }
  }, [
    activePlaybackSource,
    playbackCurrentTrackId,
    playbackStatus,
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.startupReady,
    setProgressiveFallbackReason
  ]);

  const diagnosticBuckets = useMemo(
    () =>
      resolveProgressiveDiagnosticBuckets({
        contiguousBufferedMs: progressiveHealthSnapshot.contiguousBufferedMs,
        aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
        estimatedFillTimeMs: progressiveHealthSnapshot.estimatedFillTimeMs,
        remainingPlaybackMs: progressiveHealthSnapshot.remainingPlaybackMs,
        bufferSafetyMarginMs
      }),
    [
      bufferSafetyMarginMs,
      progressiveHealthSnapshot.aheadBufferedMs,
      progressiveHealthSnapshot.contiguousBufferedMs,
      progressiveHealthSnapshot.estimatedFillTimeMs,
      progressiveHealthSnapshot.remainingPlaybackMs
    ]
  );

  useEffect(() => {
    const nextCooldownMs = Math.max(0, localTakeoverCooldownUntilRef.current - Date.now());
    const comfortBufferedMs = getStartupWindowMs(
      currentTrackRef.current ?? {
        mimeType: null,
        codec: null
      }
    );
    const latestPcmEngineDiagnostics = progressivePcmEngineRef.current?.getSnapshot() ?? null;
    const progressiveDiagnosticSignature = resolveProgressiveDiagnosticSignature({
      activeSource: progressiveHealthSnapshot.activeSource,
      playbackSurfaceKey,
      playbackTimelineKey,
      recoveryPhase: roomRecoveryState.phase,
      recoveryMode: roomRecoveryState.mode,
      recoveryGeneration: roomRecoveryState.generation,
      fullLocalRecoveryActive:
        roomRecoveryState.fullLocalRecoveryActive || immediateFullLocalRecoveryEligible,
      transportGovernorMode,
      engineType: progressiveHealthSnapshot.engineType,
      contiguousBufferedMs: diagnosticBuckets.contiguousBufferedMs,
      aheadBufferedMs: diagnosticBuckets.aheadBufferedMs,
      schedulerPolicy: progressiveHealthSnapshot.schedulerPolicy,
      startupReady: progressiveHealthSnapshot.startupReady,
      fallbackReason: progressiveHealthSnapshot.fallbackReason,
      estimatedFillTimeMs: diagnosticBuckets.estimatedFillTimeMs,
      remainingPlaybackMs: diagnosticBuckets.remainingPlaybackMs,
      bufferSafetyMarginMs: diagnosticBuckets.bufferSafetyMarginMs,
      playbackStartIntentLabel: pendingPlaybackIntent
        ? getPlaybackStartIntentLabel(playbackStartIntent)
        : null,
      intentMatchedSource: playbackStartIntent?.matchedSource,
      lastPlayStartFailure: playbackStartIntent?.lastFailure,
      nextQueueTrackPrefetch,
      localTakeoverCooldownActive: nextCooldownMs > 0,
      progressiveLocalEligible,
      progressiveLocalBlockedReason,
      fullLocalReady,
      fullLocalEligible,
      fullLocalBlockedReason,
      currentSessionUserId: sourceOwnerIdentity.currentSessionUserId,
      playbackSourceSessionId: sourceOwnerIdentity.playbackSourceSessionId,
      currentPeerId: sourceOwnerIdentity.currentPeerId,
      playbackSourcePeerId: sourceOwnerIdentity.playbackSourcePeerId,
      isSourceOwner: sourceOwnerIdentity.isSourceOwner,
      localAudioPaused: localAudioDiagnostics.localAudioPaused,
      localAudioMuted: localAudioDiagnostics.localAudioMuted,
      localAudioVolume: localAudioDiagnostics.localAudioVolume,
      localAudioReadyState: localAudioDiagnostics.localAudioReadyState,
      localAudioCurrentSrc: localAudioDiagnostics.localAudioCurrentSrc,
      localAudioHasSrcObject: localAudioDiagnostics.localAudioHasSrcObject,
      pcmEngineStatus: latestPcmEngineDiagnostics?.status,
      pcmAudioContextState: latestPcmEngineDiagnostics?.audioContextState,
      pcmDirectOutputConnected: latestPcmEngineDiagnostics?.directOutputConnected,
      pcmLastDecodeError: latestPcmEngineDiagnostics?.lastDecodeError,
      pcmDecodedSegmentCount: latestPcmEngineDiagnostics?.decodedSegmentCount,
      pcmScheduledSegmentCount: latestPcmEngineDiagnostics?.scheduledSegmentCount,
      pcmLastBlockedReason: pcmLastBlockedReasonRef.current,
      startupBufferMs: effectiveStartupBufferMs,
      comfortBufferedMs,
      waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
      stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
      shadowWarmupActive,
      playbackRecoveryStage,
      audibleLocalFallbackActive,
      schedulerBudgetTier,
      lastStablePlaybackAt: lastStablePlaybackAtRef.current
    });
    if (
      !shouldPublishProgressiveDiagnostic({
        previousSignature: lastProgressiveDiagnosticSignatureRef.current,
        nextSignature: progressiveDiagnosticSignature
      })
    ) {
      return;
    }
    lastProgressiveDiagnosticSignatureRef.current = progressiveDiagnosticSignature;
    recordPeerDiagnostic({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "progressive-status",
      summary: `播放源 ${progressiveHealthSnapshot.activeSource} / 策略 ${progressiveHealthSnapshot.schedulerPolicy}`,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          ...(
            snapshot.progressivePlaybackStatus ??
            createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
          ),
          activeSource: progressiveHealthSnapshot.activeSource,
          playbackSurfaceKey,
          playbackTimelineKey,
          recoveryPhase: roomRecoveryState.phase,
          recoveryMode: roomRecoveryState.mode,
          recoveryGeneration: roomRecoveryState.generation,
          bootstrapSourcePeerId: roomRecoveryState.bootstrapSourcePeerId,
          bootstrapStartedAt: roomRecoveryState.bootstrapStartedAt,
          pendingSnapshot: roomRecoveryState.pendingSnapshot,
          pendingData: roomRecoveryState.pendingData,
          pendingMedia: roomRecoveryState.pendingMedia,
          listenerBootstrapAttempts: roomRecoveryState.listenerBootstrapAttempts,
          fullLocalRecoveryActive:
            roomRecoveryState.fullLocalRecoveryActive || immediateFullLocalRecoveryEligible,
          transportGovernorMode,
          engineType: progressiveHealthSnapshot.engineType,
          contiguousBufferedMs: progressiveHealthSnapshot.contiguousBufferedMs,
          aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
          schedulerPolicy: progressiveHealthSnapshot.schedulerPolicy,
          startupReady: progressiveHealthSnapshot.startupReady,
          fallbackReason: progressiveHealthSnapshot.fallbackReason,
          estimatedFillTimeMs: progressiveHealthSnapshot.estimatedFillTimeMs,
          remainingPlaybackMs: progressiveHealthSnapshot.remainingPlaybackMs,
          bufferSafetyMarginMs,
          pendingPlaybackIntent: pendingPlaybackIntent
            ? getPlaybackStartIntentLabel(playbackStartIntent)
            : null,
          intentMatchedSource: playbackStartIntent?.matchedSource ?? null,
          lastPlayStartFailure: playbackStartIntent?.lastFailure ?? null,
          nextQueueTrackPrefetch,
          localTakeoverCooldownMs: nextCooldownMs > 0 ? nextCooldownMs : null,
          progressiveLocalEligible,
          progressiveLocalBlockedReason,
          fullLocalReady,
          fullLocalEligible,
          fullLocalBlockedReason,
          currentSessionUserId: sourceOwnerIdentity.currentSessionUserId,
          playbackSourceSessionId: sourceOwnerIdentity.playbackSourceSessionId,
          currentPeerId: sourceOwnerIdentity.currentPeerId,
          playbackSourcePeerId: sourceOwnerIdentity.playbackSourcePeerId,
          isSourceOwner: sourceOwnerIdentity.isSourceOwner,
          localAudioPaused: localAudioDiagnostics.localAudioPaused,
          localAudioMuted: localAudioDiagnostics.localAudioMuted,
          localAudioVolume: localAudioDiagnostics.localAudioVolume,
          localAudioReadyState: localAudioDiagnostics.localAudioReadyState,
          localAudioCurrentSrc: localAudioDiagnostics.localAudioCurrentSrc,
          localAudioHasSrcObject: localAudioDiagnostics.localAudioHasSrcObject,
          fullLocalPlaybackMode: resolveFullLocalPlaybackMode({
            activeSource: progressiveHealthSnapshot.activeSource,
            localAudioHasSrcObject: localAudioDiagnostics.localAudioHasSrcObject,
            localAudioCurrentSrc: localAudioDiagnostics.localAudioCurrentSrc
          }),
          pcmEngineStatus: latestPcmEngineDiagnostics?.status ?? null,
          pcmAudioContextState: latestPcmEngineDiagnostics?.audioContextState ?? null,
          pcmHasOutputStream: null,
          pcmDirectOutputConnected: latestPcmEngineDiagnostics?.directOutputConnected ?? null,
          pcmContiguousChunkCount: null,
          pcmContiguousByteLength: null,
          pcmDecodedSegmentCount: latestPcmEngineDiagnostics?.decodedSegmentCount ?? null,
          pcmScheduledSegmentCount: latestPcmEngineDiagnostics?.scheduledSegmentCount ?? null,
          pcmDecodedPacketCount: null,
          pcmDecoderFlushAttemptCount: null,
          pcmDecoderFlushCount: null,
          pcmLastDecodedAtMs: null,
          pcmLastDecodeError: latestPcmEngineDiagnostics?.lastDecodeError ?? null,
          pcmDecodedPeak: null,
          pcmDecodedRms: null,
          pcmDecodedNonZeroSampleCount: null,
          pcmBufferedAheadMs: null,
          pcmPlayoutState: null,
          pcmLastBlockedReason: pcmLastBlockedReasonRef.current,
          startupBufferMs: effectiveStartupBufferMs,
          comfortBufferedMs,
          averageDriftMs: null,
          maxDriftMs: null,
          waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
          stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
          shadowWarmupActive,
          playbackRecoveryStage,
          audibleLocalFallbackActive,
          maxContinuousPlaybackMsLast30s: null,
          schedulerBudgetTier,
          lastStablePlaybackAt: lastStablePlaybackAtRef.current
        }
      })
    });
  }, [
    currentTrackFormatKey,
    bufferSafetyMarginMs,
    diagnosticBuckets,
    playbackQualityMetrics.stalledEventsLast30s,
    playbackQualityMetrics.waitingEventsLast30s,
    playbackSurfaceKey,
    playbackTimelineKey,
    fullLocalReady,
    fullLocalEligible,
    fullLocalBlockedReason,
    immediateFullLocalRecoveryEligible,
    localAudioDiagnostics,
    pcmEngineDiagnosticsKey,
    sourceOwnerIdentity,
    progressiveLocalEligible,
    progressiveLocalBlockedReason,
    progressiveHealthSnapshot.activeSource,
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.engineType,
    progressiveHealthSnapshot.contiguousBufferedMs,
    progressiveHealthSnapshot.estimatedFillTimeMs,
    progressiveHealthSnapshot.remainingPlaybackMs,
    progressiveHealthSnapshot.schedulerPolicy,
    progressiveHealthSnapshot.startupReady,
    progressiveHealthSnapshot.fallbackReason,
    effectiveStartupBufferMs,
    playbackRecoveryStage,
    audibleLocalFallbackActive,
    shadowWarmupActive,
    pendingPlaybackIntent,
    playbackStartIntent,
    nextQueueTrackPrefetch,
    localTakeoverCooldownMs,
    roomRecoveryState.bootstrapSourcePeerId,
    roomRecoveryState.bootstrapStartedAt,
    roomRecoveryState.fullLocalRecoveryActive,
    roomRecoveryState.generation,
    roomRecoveryState.listenerBootstrapAttempts,
    roomRecoveryState.mode,
    roomRecoveryState.pendingData,
    roomRecoveryState.pendingMedia,
    roomRecoveryState.pendingSnapshot,
    roomRecoveryState.phase,
    schedulerBudgetTier,
    transportGovernorMode,
    recordPeerDiagnostic
  ]);

  return {
    progressiveSchedulerPolicy,
    transportGovernorMode,
    getLocalPlaybackPositionMs,
    destroyProgressiveRuntime
  };
}
