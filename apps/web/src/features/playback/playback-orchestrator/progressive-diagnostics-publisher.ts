"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { TrackMeta } from "@music-room/shared";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import {
  getPlaybackStartIntentLabel,
  type PlaybackStartIntent
} from "../playback-start-intent";
import {
  getStartupWindowMs,
  type ProgressiveHealthSnapshot
} from "../progressive-playback";
import type { ProgressivePcmEngine } from "../progressive-pcm-engine";
import type { UseProgressiveRuntimeInput } from "./runtime-types";
import {
  resolveFullLocalPlaybackMode,
  resolveProgressiveDiagnosticBuckets,
  resolveProgressiveDiagnosticSignature,
  shouldPublishProgressiveDiagnostic,
  type PlaybackRecoveryStage,
  type SchedulerBudgetTier,
  type TransportGovernorMode
} from "./pipeline";
import type {
  resolveLocalAudioDiagnostics,
  resolvePlaybackQualityMetrics,
  resolveSourceOwnerIdentity
} from "./pipeline";

type ProgressiveDiagnosticsPublisherInput = {
  audibleLocalFallbackActive: boolean;
  bufferSafetyMarginMs: number | null;
  currentTrackFormatKey: string;
  currentTrackRef: MutableRefObject<TrackMeta | null>;
  effectiveStartupBufferMs: number;
  fullLocalBlockedReason: string | null;
  fullLocalEligible: boolean;
  fullLocalReady: boolean;
  immediateFullLocalRecoveryEligible: boolean;
  lastStablePlaybackAtRef: MutableRefObject<string | null>;
  localAudioDiagnostics: ReturnType<typeof resolveLocalAudioDiagnostics>;
  localTakeoverCooldownMs: number | null;
  localTakeoverCooldownUntilRef: MutableRefObject<number>;
  nextQueueTrackPrefetch: string | null;
  pcmEngineDiagnosticsKey: string;
  pcmLastBlockedReasonRef: MutableRefObject<string | null>;
  playbackQualityMetrics: ReturnType<typeof resolvePlaybackQualityMetrics>;
  playbackRecoveryStage: PlaybackRecoveryStage;
  playbackStartIntent: PlaybackStartIntent | null;
  playbackSurfaceKey: string | null;
  playbackTimelineKey: string | null;
  pendingPlaybackIntent: boolean;
  progressiveHealthSnapshot: ProgressiveHealthSnapshot;
  progressiveLocalBlockedReason: string | null;
  progressiveLocalEligible: boolean;
  progressivePcmEngineRef: MutableRefObject<ProgressivePcmEngine | null>;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  roomRecoveryState: UseProgressiveRuntimeInput["roomRecoveryState"];
  schedulerBudgetTier: SchedulerBudgetTier;
  shadowWarmupActive: boolean;
  sourceOwnerIdentity: ReturnType<typeof resolveSourceOwnerIdentity>;
  transportGovernorMode: TransportGovernorMode;
};

export function useProgressiveDiagnosticsPublisher({
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
}: ProgressiveDiagnosticsPublisherInput) {
  const lastProgressiveDiagnosticSignatureRef = useRef<string | null>(null);
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
}
