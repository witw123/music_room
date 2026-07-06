"use client";

import {
  useCallback,
  useMemo,
  useRef,
  type MutableRefObject
} from "react";
import type {
  RoomSnapshot,
  TrackAvailabilityAnnouncement,
  TrackMeta
} from "@music-room/shared";
import {
  type ProgressiveEngineType,
  type ProgressiveHealthSnapshot,
  type ProgressivePlaybackSource
} from "../progressive-playback";
import {
  buildProgressiveWarmupTimerKey,
  resolveAudibleLocalFallbackActive,
  resolveBufferSafetyMarginMs,
  resolveEffectiveStartupBufferMs,
  resolveFullLocalBlockedReason,
  resolveFullLocalEligibility,
  resolveNextQueueTrackPrefetch,
  resolvePlaybackRecoveryStage,
  resolveProgressiveLocalBlockedReason,
  resolveProgressiveLocalReadinessPreflight,
  resolveSchedulerBufferHealth,
  resolveSchedulerBudgetTier,
  resolveSourceOwnerIdentity,
  resolveTransportGovernorMode,
  shouldAllowLocalTakeover,
  shouldPreferImmediateFullLocalRecovery,
  type PlaybackRecoveryStage
} from "./pipeline";

type PlaybackQualityMetrics = {
  stalledEventsLast30s: number;
  waitingEventsLast30s: number;
};

type RoomRecoveryState = {
  phase:
    | "joining"
    | "resyncing"
    | "bootstrapping-data"
    | "playing-local-fallback"
    | "steady";
  mode: "late-join" | "rejoin" | "steady";
  fullLocalRecoveryActive: boolean;
};

type PlaybackRuntimePolicyStateInput = {
  activePlaybackSource: ProgressivePlaybackSource;
  aggregatePieceDownloadRateKbps: number | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  canUseFullLocalForPlaybackSession: boolean;
  connectedPeersCount: number;
  currentProgressiveEngineType: ProgressiveEngineType;
  currentProgressiveManifestKey: string;
  currentTrack: TrackMeta | null;
  currentTrackFormatKey: string;
  fullLocalReady: boolean;
  hasBufferedFullLocalTrack: boolean;
  hasProgressiveManifest: boolean;
  isCurrentSourceOwner: boolean;
  isProgressiveTakeoverReady: () => boolean;
  listenerLocalTakeoverEnabled: boolean;
  localTakeoverCooldownUntilRef: MutableRefObject<number>;
  mediaConnectedPeersCount: number;
  peerId: string;
  pendingPlaybackIntent: boolean;
  playbackCurrentTrackId: string | null;
  playbackMediaEpoch: number | null;
  playbackQualityMetrics: PlaybackQualityMetrics;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  progressiveFallbackReason: string | null;
  progressiveHealthSnapshot: ProgressiveHealthSnapshot;
  recoveryAudioUnlocked: boolean;
  roomRecoveryState: RoomRecoveryState;
  roomSnapshot: RoomSnapshot | null;
  startupBufferMs: number;
};

export function usePlaybackRuntimePolicyState({
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
  hasBufferedFullLocalTrack,
  hasProgressiveManifest,
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
  recoveryAudioUnlocked,
  roomRecoveryState,
  roomSnapshot,
  startupBufferMs
}: PlaybackRuntimePolicyStateInput) {
  const localTakeoverCooldownMs = useMemo(
    () => Math.max(0, localTakeoverCooldownUntilRef.current - Date.now()),
    [localTakeoverCooldownUntilRef]
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
    hasManifest: hasProgressiveManifest,
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
  const immediateFullLocalRecoveryEligible =
    shouldPreferImmediateFullLocalRecovery({
      isCurrentSourceOwner,
      audioUnlocked: recoveryAudioUnlocked,
      hasBufferedFullLocalTrack: canUseFullLocalForPlaybackSession,
      fullLocalRecoveryActive: roomRecoveryState.fullLocalRecoveryActive,
      recoveryPhase: roomRecoveryState.phase,
      recoveryMode: roomRecoveryState.mode,
      playbackStatus
    });
  const isLocalTakeoverAllowed = useCallback(
    (now = Date.now()) =>
      shouldAllowLocalTakeover({
        listenerLocalTakeoverEnabled,
        nowMs: now,
        cooldownUntilMs: localTakeoverCooldownUntilRef.current,
        immediateFullLocalRecoveryEligible,
        canUseFullLocalForPlaybackSession,
        connectedPeersCount
      }),
    [
      canUseFullLocalForPlaybackSession,
      connectedPeersCount,
      immediateFullLocalRecoveryEligible,
      listenerLocalTakeoverEnabled,
      localTakeoverCooldownUntilRef
    ]
  );
  const isLocalTakeoverAllowedRef = useRef(isLocalTakeoverAllowed);
  isLocalTakeoverAllowedRef.current = isLocalTakeoverAllowed;
  const audibleLocalFallbackActive = resolveAudibleLocalFallbackActive({
    isCurrentSourceOwner,
    activePlaybackSource,
    progressiveFallbackReason
  });
  const startupGatePending = false;
  const shadowWarmupActive = false;
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
    playbackStatus: playbackStatus ?? null,
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
        hasBufferedFullLocalTrack,
        canUseFullLocalForPlaybackSession,
        isCurrentSourceOwner,
        listenerLocalTakeoverEnabled,
        activePlaybackSource,
        startupGatePending,
        fullLocalRecoveryActive: roomRecoveryState.fullLocalRecoveryActive
      }),
    [
      activePlaybackSource,
      canUseFullLocalForPlaybackSession,
      hasBufferedFullLocalTrack,
      isCurrentSourceOwner,
      listenerLocalTakeoverEnabled,
      roomRecoveryState.fullLocalRecoveryActive,
      startupGatePending
    ]
  );
  const fullLocalEligible = resolveFullLocalEligibility({
    fullLocalReady,
    fullLocalBlockedReason
  });

  return {
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
    playbackRecoveryStage: playbackRecoveryStage as PlaybackRecoveryStage,
    progressiveLocalBlockedReason,
    progressiveLocalEligible,
    progressiveWarmupRuntimeRef,
    progressiveWarmupTimerKey,
    schedulerBudgetTier,
    shadowWarmupActive,
    sourceOwnerIdentity,
    startupGatePending,
    transportGovernorMode
  };
}
