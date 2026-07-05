"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import {
  selectCanonicalTrackAvailabilityAnnouncement
} from "@/features/p2p";
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
  resolveFullLocalPlaybackSessionState,
  resolveFullLocalBlockedReason,
  resolveLocalAudioDiagnostics,
  resolveLocalPlaybackPositionMs,
  resolveListenerMediaConnectionState,
  resolveMediaElementPlaybackRole,
  resolveNextQueueTrackPrefetch,
  resolveObservedPlaybackSeconds,
  resolvePlaybackSourceAfterLatchedPcmRuntimeFailure,
  resolveSourceOwnerIdentity,
  resolvePlaybackStartFailureReason,
  resolveTrackAvailabilityAnnouncement,
  resolvePlaybackSourceAfterProgressiveRuntimeFailure,
  resolveBufferSafetyMarginMs,
  resolveEffectiveStartupBufferMs,
  resolvePlaybackQualityMetrics,
  resolvePlaybackRecoveryStage,
  resolveAudibleLocalFallbackActive,
  resolveProgressiveDiagnosticSignature,
  resolveProgressiveLocalBlockedReason,
  resolveMaxContinuousPlaybackMs,
  resolveSchedulerBudgetTier,
  resolveTransportGovernorMode,
  shouldAttemptProgressiveLocalPlayback,
  shouldAllowLocalTakeover,
  shouldEnableFullLocalHandoff,
  shouldHoldSlidingWindowPlaybackForEngine,
  shouldPreferImmediateFullLocalRecovery,
  shouldPrepareProgressiveRuntimeForSource,
  shouldPublishProgressiveDiagnostic,
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
  resolveFullLocalPlaybackSessionState,
  resolveFullLocalBlockedReason,
  resolveLocalAudioDiagnostics,
  resolveLocalPlaybackPositionMs,
  resolveListenerMediaConnectionState,
  resolveMediaElementPlaybackRole,
  resolveNextQueueTrackPrefetch,
  resolveObservedPlaybackSeconds,
  resolvePlaybackSourceAfterLatchedPcmRuntimeFailure,
  resolveSourceOwnerIdentity,
  resolvePlaybackStartFailureReason,
  resolveTrackAvailabilityAnnouncement,
  resolvePlaybackSourceAfterProgressiveRuntimeFailure,
  resolveBufferSafetyMarginMs,
  resolveEffectiveStartupBufferMs,
  resolvePlaybackQualityMetrics,
  resolvePlaybackRecoveryStage,
  resolveAudibleLocalFallbackActive,
  resolveProgressiveDiagnosticSignature,
  resolveProgressiveLocalBlockedReason,
  resolveMaxContinuousPlaybackMs,
  resolveSchedulerBudgetTier,
  resolveTransportGovernorMode,
  shouldAttemptProgressiveLocalPlayback,
  shouldAllowLocalTakeover,
  shouldEnableFullLocalHandoff,
  shouldHoldSlidingWindowPlaybackForEngine,
  shouldPreferLocalTakeover,
  shouldPreferImmediateFullLocalRecovery,
  shouldPrepareProgressiveRuntimeForSource,
  shouldPublishProgressiveDiagnostic,
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
  const currentTrackAvailabilityManifestHint = useMemo(() => {
    if (!currentTrack?.id || !roomId) {
      return currentTrackAvailabilityAnnouncement;
    }

    return (
      selectCanonicalTrackAvailabilityAnnouncement(
        Object.values(availabilityByTrack[currentTrack.id] ?? {}).filter(
          (announcement) =>
            announcement.roomId === roomId &&
            activeMemberPeerIds.has(announcement.ownerPeerId)
        )
      ) ?? currentTrackAvailabilityAnnouncement
    );
  }, [
    activeMemberPeerIds,
    availabilityByTrack,
    currentTrack?.id,
    currentTrackAvailabilityAnnouncement,
    roomId
  ]);
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
  const canPrepareProgressiveLocal =
    enableTrackCaching &&
    !!currentProgressiveManifest &&
    canUseProgressivePlayback() &&
    shouldRetryPcmRuntimeAfterFailure({
      currentTrackId: currentProgressiveManifest.trackId,
      failureTrackId: pcmRuntimeFailureRef.current?.trackId,
      failureReason: pcmRuntimeFailureRef.current?.reason
    }) &&
    shouldPrepareProgressiveRuntimeForSource({
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
  const progressiveLocalBlockedReason = (() => {
    const shouldAttemptPlayback = shouldAttemptProgressiveLocalPlayback({
      isCurrentSourceOwner,
      activePlaybackSource,
      playbackStatus: playback?.status,
      engineType: currentProgressiveEngineType,
      startupReady: progressiveHealthSnapshot.startupReady,
      hasFullLocalTrack: canUseFullLocalForPlaybackSession,
      progressiveFallbackReason
    });
    const staticBlockedReason = resolveProgressiveLocalBlockedReason({
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
      aggregatePieceDownloadRateKbps,
      progressiveTakeoverReady: true
    });
    if (staticBlockedReason !== null) {
      return staticBlockedReason;
    }
    if (shouldAttemptPlayback) {
      return null;
    }

    return resolveProgressiveLocalBlockedReason({
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
    });
  })();
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
    if (
      !shouldResetAudioForPlaybackSurfaceChange({
        previousPlaybackSurfaceKey,
        nextPlaybackSurfaceKey: playbackSurfaceKey
      })
    ) {
      return;
    }

    const audio = audioRef.current;
    destroyProgressiveRuntime();
    pcmLastBlockedReasonRef.current = null;
    if (!audio) {
      return;
    }

    audio.pause();
    audio.srcObject = null;
    audio.removeAttribute("src");
    audio.load();
    setMediaConnectionState(hasActivePlaybackIntent(playbackRef.current) ? "buffering" : "idle");
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
      if (!currentProgressiveManifest?.trackId || !reason) {
        return;
      }

      if (shouldLatchPcmRuntimeFailure(reason)) {
        pcmRuntimeFailureRef.current = {
          trackId: currentProgressiveManifest.trackId,
          reason
        };
        progressivePcmEngineRef.current?.destroy();
        progressivePcmEngineRef.current = null;
        setProgressiveFallbackReason("progressive-init-failed");
        const nextSource = resolvePlaybackSourceAfterLatchedPcmRuntimeFailure({
          activePlaybackSource,
          canUseFullLocalForPlaybackSession
        });
        if (nextSource !== activePlaybackSource) {
          setActivePlaybackSource(nextSource);
        }
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
    if (!forceSourceOwnerLocalPlayback) {
      return;
    }

    setActivePlaybackSource("full-local");
  }, [forceSourceOwnerLocalPlayback, setActivePlaybackSource]);

  useEffect(() => {
    localTakeoverCooldownUntilRef.current = 0;
  }, [playback?.currentTrackId, playbackRevision]);

  useEffect(() => {
    progressiveWarmupReadyAtRef.current = null;
    fullLocalWarmupReadyAtRef.current = null;
    waitingEventTimestampsRef.current = [];
    stalledEventTimestampsRef.current = [];
    driftSamplesRef.current = [];
    continuousPlaybackStartedAtRef.current = null;
    continuousPlaybackSegmentsRef.current = [];
    lastPcmSlidingWindowPlayAttemptAtRef.current = null;
    setProgressiveFallbackReason(null);
  }, [playback?.currentTrackId, playback?.mediaEpoch, playbackRevision, setProgressiveFallbackReason]);

  const armLocalTakeoverCooldown = useCallback(() => {
    localTakeoverCooldownUntilRef.current = Date.now() + getLocalTakeoverCooldownMs();
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
        bufferHealth:
          playbackQualityMetrics.stalledEventsLast30s > 0
            ? "critical"
            : playbackQualityMetrics.waitingEventsLast30s > 0
              ? "low"
              : "healthy",
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
  const fullLocalEligible = fullLocalReady && fullLocalBlockedReason === null;

  useEffect(() => {
    if (
      !immediateFullLocalRecoveryEligible ||
      activePlaybackSource === "full-local" ||
      !currentBufferedFullLocalTrack
    ) {
      return;
    }

    setActivePlaybackSource("full-local");
    setProgressiveFallbackReason(null);
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
      if (options?.armCooldown) {
        armLocalTakeoverCooldown();
      }

      if (options?.clearFallbackReason) {
        setProgressiveFallbackReason(null);
      } else if (typeof options?.fallbackReason === "string") {
        setProgressiveFallbackReason(options.fallbackReason);
      }

      if (nextSource !== activePlaybackSource) {
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
    if (
      !shouldRecoverSilentSlidingWindowWithFullLocal({
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
    ) {
      return;
    }

    transitionPlaybackSource("full-local", { clearFallbackReason: true });
    setMediaConnectionState("buffering");
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
      pcmRuntimeFailureRef.current &&
      pcmRuntimeFailureRef.current.trackId !== currentProgressiveManifest?.trackId
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
        if (options?.reportFailure === false) {
          return false;
        }

        const matchedIntent = doesPlaybackMatchStartIntent(
          playbackStartIntent,
          playbackRef.current
        );
        markPlaybackStartFailure(
          failureReason,
          matchedIntent ? "当前点击未能激活音频，请再次点击播放" : blockedMessage
        );
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

      if (!hasActivePlaybackIntent(playbackRef.current) || activePlaybackSource !== source) {
        return;
      }

      const targetElement = audioRef.current;
      const blockedMessage = "浏览器阻止了本地音频自动播放，请手动点击播放恢复。";
      const failureReason = resolvePlaybackStartFailureReason(source);
      const pendingIntent =
        !!playbackStartIntent && isPlaybackStartIntentPending(playbackStartIntent);

      void attemptPlaybackStart(targetElement, source, blockedMessage, failureReason, {
        reportFailure: shouldReportPlaybackStartFailure({
          pendingIntent,
          attempt,
          maxRetryAttempts: maxPlaybackStartRetryAttempts
        })
      }).then((ok) => {
        if (ok) {
          clearPlaybackStartRetry();
          return;
        }

        if (attempt >= maxPlaybackStartRetryAttempts) {
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
    if (!playbackCurrentTrackId || playbackStatus === "paused" || playbackStatus === null) {
      setSchedulerMode(isPageVisible ? "normal" : "idle");
    }
  }, [isPageVisible, playbackCurrentTrackId, playbackStatus, setSchedulerMode]);

  useEffect(() => {
    if (!playbackStartIntent || !isPlaybackStartIntentPending(playbackStartIntent)) {
      return;
    }

    const timeoutMs = Math.max(0, playbackStartIntent.expiresAt - Date.now());
    const timerId = window.setTimeout(() => {
      setPlaybackStartIntent((current) => {
        if (!current || current.id !== playbackStartIntent.id) {
          return current;
        }

        if (!isPlaybackStartIntentPending(current)) {
          return current;
        }

        return failPlaybackStartIntent(current, "intent-timeout");
      });
      setStatusMessage("当前点击未能激活音频，请再次点击播放");
    }, timeoutMs);

    return () => window.clearTimeout(timerId);
  }, [playbackStartIntent, setPlaybackStartIntent, setStatusMessage]);

  useEffect(() => {
    if (!hasActivePlaybackIntent(playbackRef.current)) {
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
    if (!audio) {
      return;
    }

    if (!playbackState?.currentTrackId) {
      destroyProgressiveRuntime();
      audio.pause();
      audio.srcObject = null;
      audio.removeAttribute("src");
      audio.load();
      setPlaybackStartIntent(null);
      setMediaConnectionState("idle");
      return;
    }

    const uploaded =
      fullLocalPlaybackTracks[playbackState.currentTrackId] ??
      uploadedTracks[playbackState.currentTrackId] ??
      null;
    const sourceOwnerHasLocalTrack = isCurrentSourceOwner && !!uploaded;
    const expectedSeconds =
      getEffectivePlaybackPositionMs(playbackState, currentTrackDurationMs ?? 0, Date.now()) /
      1000;
    const shouldPlayPlayback = hasActivePlaybackIntent(playbackState);
    const wantsFullLocalPlayback =
      activePlaybackSource === "full-local" ||
      forceSourceOwnerLocalPlayback ||
      sourceOwnerHasLocalTrack;
    if (wantsFullLocalPlayback && uploaded) {
      const hadSrcObject = !!audio.srcObject;
      if (audio.srcObject) {
        audio.srcObject = null;
      }
      if (audio.src !== uploaded.objectUrl || hadSrcObject) {
        audio.src = uploaded.objectUrl;
        audio.load();
      }
      audio.muted = false;
      audio.volume = getAudibleElementVolume(volume);

      syncLocalPlaybackWindow(audio, expectedSeconds, shouldPlayPlayback, {
        softDriftMs: 90,
        hardDriftMs: 720,
        correctionMode: "audible-local-follow"
      });

      if (shouldPlayPlayback) {
        if (activePlaybackSource !== "full-local") {
          setActivePlaybackSource("full-local");
          setProgressiveFallbackReason(null);
        }
        void attemptPlaybackStart(
          audio,
          "full-local",
          "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
          "full-local-play-blocked",
          { reportFailure: true }
        ).then((ok) => {
          setMediaConnectionState(ok ? "live" : "buffering");
        });
      }

      if (playbackState.status === "paused") {
        audio.pause();
        audio.playbackRate = 1;
        setMediaConnectionState("idle");
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
            if (shouldLatchPcmRuntimeFailure(pcmFailureReason)) {
              setMediaConnectionState("buffering");
              markPlaybackStartFailure(
                `${activePlaybackSource}-init-failed`,
                "本地解码初始化失败，请等待完整缓存后播放。"
              );
              return;
            }
            if (shouldPlayPlayback && !result.localReady) {
              setProgressiveFallbackReason("buffer-underrun");
              setMediaConnectionState("buffering");
              markPlaybackStartFailure(
                `${activePlaybackSource}-buffer-underrun`,
                "本地缓冲不足，正在缓存播放所需片段。"
              );
              return;
            }

            if (shouldPlayPlayback && result.localReady) {
              setProgressiveFallbackReason(null);
              setMediaConnectionState("live");
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
          if (shouldPlayPlayback && !localReady) {
            setMediaConnectionState("buffering");
            markPlaybackStartFailure(
              `${activePlaybackSource}-buffer-underrun`,
              "本地缓冲不足，正在缓存播放所需片段。"
            );
            return;
          }

          syncLocalPlaybackWindow(audio, expectedSeconds, shouldPlayPlayback, {
            softDriftMs: 120,
            hardDriftMs: 900,
            correctionMode: "audible-local-follow"
          });

          if (shouldPlayPlayback) {
            setProgressiveFallbackReason(null);
            setMediaConnectionState("live");
            ensurePlaybackStart(activePlaybackSource);
          } else {
            audio.pause();
            audio.playbackRate = 1;
          }
        });
        return;
      }

      if (
        shouldHoldSlidingWindowPlaybackForEngine({
          activePlaybackSource,
          playbackStatus: playbackState.status,
          hasPcmEngine: false,
          hasMseEngine: false
        })
      ) {
        audio.pause();
        audio.muted = false;
        audio.playbackRate = 1;
        if (audio.srcObject || audio.src || audio.getAttribute("src")) {
          audio.srcObject = null;
          audio.removeAttribute("src");
          audio.load();
        }
        setMediaConnectionState("buffering");
        return;
      }

      syncLocalPlaybackWindow(audio, expectedSeconds, shouldPlayPlayback, {
        softDriftMs: 120,
        hardDriftMs: 900,
        correctionMode: "audible-local-follow"
      });

      if (shouldPlayPlayback) {
        if (progressiveHealthSnapshot.startupReady) {
          setProgressiveFallbackReason(null);
        }
        ensurePlaybackStart(activePlaybackSource);
      } else {
        audio.pause();
        audio.playbackRate = 1;
      }

      return;
    }

    if (playbackState.status === "paused") {
      audio.pause();
      audio.playbackRate = 1;
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
      if (role === "inactive") {
        return;
      }

      setSchedulerMode("normal");
      setBufferHealth("healthy");
      markContinuousPlaybackStarted();
      lastStablePlaybackAtRef.current = new Date().toISOString();
      setMediaConnectionState((current) =>
        current === "idle" && !playbackRef.current?.currentTrackId ? current : "live"
      );
    };
    const handleWaiting = (event: Event) => {
      const role = resolveEventRole(event.currentTarget);
      if (role === "inactive") {
        return;
      }

      const now = Date.now();
      markContinuousPlaybackInterrupted(now);
      pushQualityEvent(waitingEventTimestampsRef, now);
      setSchedulerMode("conservative");
      setBufferHealth("low");
      if (
        role === "audible-local" &&
        isSlidingWindowPlaybackSource(activePlaybackSource) &&
        progressiveHealthSnapshot.aheadBufferedMs < getCriticalBufferThresholdMs() / 2
      ) {
        setProgressiveFallbackReason("buffer-underrun");
      }
      if (
        role === "audible-local" &&
        activePlaybackSource === "full-local" &&
        progressiveHealthSnapshot.aheadBufferedMs < getCriticalBufferThresholdMs() / 2
      ) {
        setProgressiveFallbackReason("buffer-underrun");
      }
      setMediaConnectionState((current) => (current === "failed" ? current : "buffering"));
    };
    const handleStalled = (event: Event) => {
      const role = resolveEventRole(event.currentTarget);
      if (role === "inactive") {
        return;
      }

      const now = Date.now();
      markContinuousPlaybackInterrupted(now);
      pushQualityEvent(stalledEventTimestampsRef, now);
      setSchedulerMode("conservative");
      setBufferHealth("critical");
      if (role === "audible-local") {
        setProgressiveFallbackReason("stalled");
      }
      setMediaConnectionState((current) => (current === "failed" ? current : "buffering"));
    };
    const handlePause = (event: Event) => {
      const role = resolveEventRole(event.currentTarget);
      if (role === "inactive") {
        return;
      }

      markContinuousPlaybackInterrupted();
      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "local-audio-pause",
        summary: `本地音频暂停 role=${role} source=${activePlaybackSource} status=${playbackRef.current?.status ?? "unknown"}`,
        recordEvent: false
      });
      if (!hasActivePlaybackIntent(playbackRef.current)) {
        setSchedulerMode(isPageVisible ? "normal" : "idle");
        setBufferHealth("healthy");
      }
    };
    const handleLocalSeeked = () => {
      if (!isSlidingWindowPlaybackSource(activePlaybackSource) || !localAudio || !currentProgressiveManifest) {
        return;
      }

      const soughtPositionMs = Math.round(localAudio.currentTime * 1000);
      if (soughtPositionMs <= progressiveHealthSnapshot.contiguousBufferedMs) {
        return;
      }

      setSchedulerMode("conservative");
      setBufferHealth("critical");
      setProgressiveFallbackReason("seek-outside-buffer");
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
      if (activePlaybackSource === "full-local" || isSlidingWindowPlaybackSource(activePlaybackSource)) {
        ensurePlaybackStart(activePlaybackSource);
      }
      if (
        activePlaybackSource === "full-local" &&
        hasActivePlaybackIntent(playbackRef.current) &&
        localAudio?.paused
      ) {
        localAudio.muted = false;
        localAudio.volume = getAudibleElementVolume(volume);
        void attemptPlaybackStart(
          localAudio,
          "full-local",
          "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
          "full-local-play-blocked",
          { reportFailure: true }
        ).then((ok) => {
          setMediaConnectionState(ok ? "live" : "buffering");
          recordPeerDiagnostic({
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: ok ? "full-local-ready-played" : "full-local-ready-play-failed",
            summary: ok
              ? "本地完整缓存 ready 后已启动播放"
              : "本地完整缓存 ready 后播放启动失败",
            recordEvent: !ok
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
    const playbackState = playbackRef.current;
    const audio = audioRef.current;
    if (!playbackCurrentTrackId || !playbackState || !audio || activePlaybackSource !== "full-local") {
      return;
    }

    let cancelled = false;
    let recoveryInFlight = false;
    const recoverPausedFullLocalPlayback = () => {
      const latestPlayback = playbackRef.current;
      const latestTrack = currentTrackRef.current;
      if (cancelled || recoveryInFlight) {
        return;
      }

      if (
        !shouldRecoverPausedFullLocalPlayback({
          activePlaybackSource,
          playbackStatus: latestPlayback?.status ?? "paused",
          currentTrackId: latestPlayback?.currentTrackId ?? null,
          audioUnlocked,
          localAudioPaused: audio.paused,
          localAudioReadyState: audio.readyState,
          localAudioHasSrc: !!audio.currentSrc || !!audio.getAttribute("src"),
          localAudioHasSrcObject: !!audio.srcObject
        })
      ) {
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
      recoveryInFlight = true;
      void attemptPlaybackStart(
        audio,
        "full-local",
        "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
        "full-local-paused-recovery",
        { reportFailure: false }
      )
        .then((ok) => {
          if (cancelled) {
            return;
          }

          setMediaConnectionState(ok ? "live" : "buffering");
          if (ok) {
            recordPeerDiagnostic({
              peerId: "system",
              channelKind: "system",
              direction: "local",
              event: "full-local-paused-recovered",
              summary: "已自动恢复本地完整缓存播放",
              recordEvent: false
            });
          } else {
            recordPeerDiagnostic({
              peerId: "system",
              channelKind: "system",
              direction: "local",
              event: "full-local-paused-recovery-failed",
              summary: "本地完整缓存自动恢复播放失败",
              recordEvent: true
            });
          }
        })
        .finally(() => {
          recoveryInFlight = false;
        });
    };

    recoverPausedFullLocalPlayback();
    const timerId = window.setInterval(
      recoverPausedFullLocalPlayback,
      fullLocalPausedRecoveryIntervalMs
    );
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [
    activePlaybackSource,
    audioRef,
    audioUnlocked,
    attemptPlaybackStart,
    currentTrackDurationMs,
    playbackCurrentTrackId,
    playbackMediaEpoch,
    playbackStatus,
    recordPeerDiagnostic,
    setMediaConnectionState,
    volume
  ]);

  useEffect(() => {
    const nextPlayback = playbackRef.current;

    const localAudio = audioRef.current;
    const localPlaybackReady =
      !!localAudio &&
      !localAudio.paused &&
      (localAudio.readyState >= haveCurrentDataReadyState ||
        !!localAudio.srcObject ||
        !!localAudio.currentSrc);
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
    if (!playbackCurrentTrackId || !playbackState || !hasActivePlaybackIntent(playbackState)) {
      return;
    }

    const sampleDrift = () => {
      const latestPlayback = playbackRef.current;
      const latestTrack = currentTrackRef.current;
      if (!latestPlayback?.currentTrackId || !hasActivePlaybackIntent(latestPlayback)) {
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

      if (observedSeconds === null) {
        return;
      }

      recordDriftSample((expectedSeconds - observedSeconds) * 1000);
    };

    sampleDrift();
    const timerId = window.setInterval(sampleDrift, playbackDriftSampleIntervalMs);
    return () => window.clearInterval(timerId);
  }, [
    activePlaybackSource,
    audioRef,
    getLocalPlaybackPositionMs,
    playbackCurrentTrackId,
    playbackMediaEpoch,
    playbackStatus,
    recordDriftSample
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!canPrepareProgressiveLocal || !currentProgressiveManifest) {
      progressiveEngineRef.current?.destroy();
      progressiveEngineRef.current = null;
      progressivePcmEngineRef.current?.destroy();
      progressivePcmEngineRef.current = null;
      return;
    }

    progressiveEngineRef.current?.destroy();
    progressiveEngineRef.current = null;
    progressivePcmEngineRef.current?.destroy();
    progressivePcmEngineRef.current = null;

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
        const isCurrentEngine =
          progressiveEngineRef.current === engine || progressivePcmEngineRef.current === engine;
        if (!isCurrentEngine) {
          return;
        }

        if (!attached) {
          if (engine instanceof ProgressivePcmEngine) {
            markPcmRuntimeFailure("engine-failed");
          } else {
            setProgressiveFallbackReason("progressive-init-failed");
          }
          return;
        }

        setProgressiveFallbackReason((current) =>
          current === "progressive-init-failed" ? null : current
        );
        void engine.sync();
        return undefined;
      })
      .catch(() => {
        const isCurrentEngine =
          progressiveEngineRef.current === engine || progressivePcmEngineRef.current === engine;
        if (!isCurrentEngine) {
          return;
        }

        if (engine instanceof ProgressivePcmEngine) {
          markPcmRuntimeFailure("engine-failed");
        } else {
          setProgressiveFallbackReason("progressive-init-failed");
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

    if (
      !playbackState?.currentTrackId ||
      !audio ||
      (!progressiveEngineRef.current && !progressivePcmEngineRef.current) ||
      !manifestState ||
      warmupState.activePlaybackSource === "full-local"
    ) {
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
        const drivesPcmFromMainEffect = isSlidingWindowPlaybackSource(
          latestWarmupState.activePlaybackSource
        );
        const syncResult = drivesPcmFromMainEffect
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
        if (
          syncResult &&
          shouldStartPcmSlidingWindowAudioElement({
            activePlaybackSource: latestWarmupState.activePlaybackSource,
            playbackStatus: latestPlayback.status,
            localReady,
            audioPaused: audio.paused,
            lastAttemptAtMs: lastPcmSlidingWindowPlayAttemptAtRef.current,
            nowMs: now,
            retryIntervalMs: pcmSlidingWindowPlayRetryIntervalMs
          })
        ) {
          lastPcmSlidingWindowPlayAttemptAtRef.current = now;
          void attemptPlaybackStartRef.current(
            audio,
            latestWarmupState.activePlaybackSource,
            "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
            getSlidingWindowPlayBlockedReason(latestWarmupState.activePlaybackSource),
            { reportFailure: false }
          ).then((ok) => {
            if (cancelled || !ok) {
              return;
            }
            setProgressiveFallbackReason(null);
            setMediaConnectionState("live");
          });
        }
      } else if (mseEngine) {
        await mseEngine.sync();
        engineReady = mseEngine.engineStatus === "ready";
        localReady = mseEngine.isPlaybackReady(expectedSeconds, latestWarmupState.startupBufferMs);

        if (
          localReady &&
          (isSlidingWindowPlaybackSource(latestWarmupState.activePlaybackSource) ||
            shadowWarmupReady)
        ) {
          syncLocalPlaybackWindow(audio, expectedSeconds, true, {
            softDriftMs: 120,
            hardDriftMs: 900,
            correctionMode: "shadow-local-catchup"
          });
          audio.muted = !isSlidingWindowPlaybackSource(latestWarmupState.activePlaybackSource);
          void roomAudioOutput.playElement(audio);
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
      const takeoverBlockedReason = shouldAttemptTakeover
        ? null
        : latestWarmupState.progressiveLocalBlockedReason;

      if (
        !engineReady ||
        !localReady
      ) {
        if (
          pcmEngine &&
          !shouldSkipSecondaryPcmWarmupSync({
            engineType: latestWarmupState.currentProgressiveEngineType,
            engineReady,
            localReady
          })
        ) {
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
        } else if (!pcmEngine) {
          audio.pause();
        }
        audio.muted = false;
        progressiveWarmupReadyAtRef.current = null;
        return;
      }

      if (
        !enableDirectProgressiveTakeover ||
        !isLocalTakeoverAllowedRef.current(now) ||
        !shouldAttemptTakeover
      ) {
        progressiveWarmupReadyAtRef.current = shadowWarmupReady && localReady ? now : null;
        if (
          latestWarmupState.progressiveFallbackReason &&
          isLocalTakeoverAllowedRef.current(now) &&
          (latestWarmupState.playbackRecoveryStage === "steady" || shouldAttemptTakeover)
        ) {
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

    if (!hasActivePlaybackIntent(playbackState)) {
      if (progressivePcmEngineRef.current) {
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
      audio.pause();
      audio.muted = false;
      progressiveWarmupReadyAtRef.current = null;
      return;
    }

    void syncWarmup();
    const timerId = window.setInterval(() => {
      void syncWarmup();
    }, progressiveRuntimeTickIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [
    progressiveWarmupTimerKey,
    audioRef,
    setMediaConnectionState,
    setProgressiveFallbackReason
  ]);

  useEffect(() => {
    const playbackState = playbackRef.current;
    const audio = audioRef.current;
    if (
      !playbackCurrentTrackId ||
      !playbackState ||
      !audio ||
      !currentBufferedFullLocalTrackObjectUrl ||
      !canWarmBufferedFullLocal
    ) {
      fullLocalWarmupReadyAtRef.current = null;
      return;
    }

    const syncWarmup = () => {
      const latestPlayback = playbackRef.current;
      const latestTrack = currentTrackRef.current;
      const latestBufferedFullLocalTrack = currentBufferedFullLocalTrackRef.current;
      if (!latestBufferedFullLocalTrack || !hasActivePlaybackIntent(latestPlayback)) {
        audio.pause();
        audio.muted = false;
        fullLocalWarmupReadyAtRef.current = null;
        return;
      }

      if (audio.srcObject) {
        audio.srcObject = null;
      }
      if (audio.src !== latestBufferedFullLocalTrack.objectUrl) {
        audio.src = latestBufferedFullLocalTrack.objectUrl;
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
      const readyForFullLocal =
        localReady &&
        driftMs <= fullLocalMaxDriftMs &&
        fullLocalBlockedReason === null &&
        hasSufficientBackingForFullLocalWarmup({
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

      if (!isLocalTakeoverAllowed(now) || !shouldAttemptFullLocalHandoff) {
        fullLocalWarmupReadyAtRef.current = readyForFullLocal ? now : null;
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
      fullLocalWarmupReadyAtRef.current = warmupDecision.nextWarmupReadyAt;
      if (warmupDecision.nextSource !== activePlaybackSource) {
        transitionPlaybackSource(warmupDecision.nextSource, {
          clearFallbackReason: warmupDecision.clearFallbackReason
        });
      }
    };

    syncWarmup();
    const timerId = window.setInterval(syncWarmup, progressiveRuntimeTickIntervalMs);
    return () => window.clearInterval(timerId);
  }, [
    playbackCurrentTrackId,
    playbackMediaEpoch,
    playbackStatus,
    currentBufferedFullLocalTrackObjectUrl,
    canWarmBufferedFullLocal,
    currentProgressiveEngineType,
    activePlaybackSource,
    currentTrackFormatKey,
    fullLocalBlockedReason,
    progressiveHealthSnapshot.aheadBufferedMs,
    isLocalTakeoverAllowed,
    playbackQualityMetrics.stalledEventsLast30s,
    playbackQualityMetrics.waitingEventsLast30s,
    playbackRecoveryStage,
    startupGatePending,
    audioRef,
    transitionPlaybackSource
  ]);

  useEffect(() => {
    const playbackState = playbackRef.current;
    if (
      !playbackCurrentTrackId ||
      !playbackState ||
      !currentBufferedFullLocalTrackObjectUrl ||
      !canWarmBufferedFullLocal ||
      !isSlidingWindowPlaybackSource(activePlaybackSource)
    ) {
      fullLocalWarmupReadyAtRef.current = null;
      return;
    }

    if (!hasActivePlaybackIntent(playbackState)) {
      fullLocalWarmupReadyAtRef.current = null;
      return;
    }

    const comfortBufferMs = getStartupWindowMs(
      currentTrackRef.current ?? {
        mimeType: null,
        codec: null
      }
    );

    const syncUpgrade = () => {
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

      const canArmIdleFullLocalUpgrade =
        currentProgressiveEngineType === "none" &&
        canUseFullLocalForPlaybackSession &&
        fullLocalBlockedReason === null &&
        localTakeoverAllowed &&
        hasSufficientBackingForFullLocalWarmup({
          progressiveEngineType: currentProgressiveEngineType,
          aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
          requiredAheadMs: comfortBufferMs
        });
      if (!canArmIdleFullLocalUpgrade) {
        fullLocalWarmupReadyAtRef.current = null;
        return;
      }

      if (fullLocalWarmupReadyAtRef.current === null) {
        fullLocalWarmupReadyAtRef.current = now;
      }
    };

    syncUpgrade();
    const timerId = window.setInterval(syncUpgrade, progressiveRuntimeTickIntervalMs);
    return () => window.clearInterval(timerId);
  }, [
    playbackCurrentTrackId,
    playbackMediaEpoch,
    playbackStatus,
    currentBufferedFullLocalTrackObjectUrl,
    canWarmBufferedFullLocal,
    currentProgressiveEngineType,
    activePlaybackSource,
    currentTrackFormatKey,
    canUseFullLocalForPlaybackSession,
    fullLocalBlockedReason,
    isLocalTakeoverAllowed,
    progressiveHealthSnapshot.aheadBufferedMs,
    transitionPlaybackSource
  ]);

  useEffect(() => {
    if (!isSlidingWindowPlaybackSource(activePlaybackSource)) {
      return;
    }

    if (!hasActivePlaybackIntent(playbackRef.current) || !progressiveHealthSnapshot.startupReady) {
      return;
    }

    if (progressiveHealthSnapshot.aheadBufferedMs >= getCriticalBufferThresholdMs()) {
      return;
    }

    setProgressiveFallbackReason("seek-outside-buffer");
  }, [
    activePlaybackSource,
    playbackCurrentTrackId,
    playbackStatus,
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.startupReady,
    setProgressiveFallbackReason
  ]);

  const diagnosticContiguousBufferedMs = bucketDiagnosticDurationMs(
    progressiveHealthSnapshot.contiguousBufferedMs,
    1_000
  );
  const diagnosticAheadBufferedMs = bucketDiagnosticDurationMs(
    progressiveHealthSnapshot.aheadBufferedMs,
    1_000
  );
  const diagnosticEstimatedFillTimeMs = bucketDiagnosticDurationMs(
    progressiveHealthSnapshot.estimatedFillTimeMs,
    2_000
  );
  const diagnosticRemainingPlaybackMs = bucketDiagnosticDurationMs(
    progressiveHealthSnapshot.remainingPlaybackMs,
    5_000
  );
  const diagnosticBufferSafetyMarginMs = bucketDiagnosticDurationMs(
    bufferSafetyMarginMs,
    1_000
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
      contiguousBufferedMs: diagnosticContiguousBufferedMs,
      aheadBufferedMs: diagnosticAheadBufferedMs,
      schedulerPolicy: progressiveHealthSnapshot.schedulerPolicy,
      startupReady: progressiveHealthSnapshot.startupReady,
      fallbackReason: progressiveHealthSnapshot.fallbackReason,
      estimatedFillTimeMs: diagnosticEstimatedFillTimeMs,
      remainingPlaybackMs: diagnosticRemainingPlaybackMs,
      bufferSafetyMarginMs: diagnosticBufferSafetyMarginMs,
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
          fullLocalPlaybackMode:
            progressiveHealthSnapshot.activeSource === "full-local"
              ? localAudioDiagnostics.localAudioHasSrcObject
                ? "pcm-engine"
                : localAudioDiagnostics.localAudioCurrentSrc
                  ? "native-blob"
                  : "none"
              : null,
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
    diagnosticAheadBufferedMs,
    diagnosticBufferSafetyMarginMs,
    diagnosticContiguousBufferedMs,
    diagnosticEstimatedFillTimeMs,
    diagnosticRemainingPlaybackMs,
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
