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
  getMinimumSourceResidenceMs,
  getProgressiveEngineType,
  getProgressiveTrackManifestKey,
  getStartupWindowMs,
  hasActivePlaybackIntent,
  isTakeoverReady,
  type ProgressiveEngineType,
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
import { ProgressivePcmEngine, type ProgressivePcmEngineSnapshot } from "./progressive-pcm-engine";
import { roomAudioOutput } from "./room-audio-output";
import {
  resolveFullLocalWarmupDecision,
  resolveProgressiveWarmupDecision,
  shouldForceSourceOwnerLocalPlayback
} from "./progressive-source-controller";
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
  transportGovernorMode: "bootstrap" | "segment-catchup" | "local-primary" | "emergency-fallback";
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
const enableListenerShadowWarmup = false;
const enableListenerLocalTakeover = enableTrackCaching;
const adaptiveStartupBufferMs = 60;
const haveCurrentDataReadyState = 2;
const playbackQualityWindowMs = 30_000;
const stablePlaybackGraceWindowMs = 12_000;
const shadowFallbackMaxDriftMs = 160;
const shadowFallbackWaitingThreshold = 2;
const shadowFallbackStalledThreshold = 1;
const fullLocalPausedRecoveryIntervalMs = 500;

export type PlaybackRecoveryStage =
  | "startup-buffering"
  | "steady"
  | "degraded"
  | "shadow-catchup"
  | "audible-local-fallback";

export type MediaElementPlaybackRole =
  | "audible-local"
  | "shadow-local"
  | "inactive";

export type SchedulerBudgetTier = "critical" | "protected" | "comfort" | "expanded";

export type FullLocalPlaybackSessionState = {
  key: string | null;
  availableInSession: boolean;
};

function isSlidingWindowPlaybackSource(source: ProgressivePlaybackSource) {
  return source === "progressive-local" || source === "lossless-local";
}

export function shouldHoldSlidingWindowPlaybackForEngine(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  hasPcmEngine: boolean;
  hasMseEngine: boolean;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  return (
    isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
    hasActiveIntent &&
    !input.hasPcmEngine &&
    !input.hasMseEngine
  );
}

export function shouldLatchPcmRuntimeFailure(reason: string | null | undefined) {
  return (
    reason === "engine-failed" ||
    reason === "decoder-unavailable" ||
    reason === "decoder-config-failed" ||
    reason === "encoded-audio-chunk-unavailable" ||
    reason === "decoder-flush-failed" ||
    reason === "cache-read-failed" ||
    reason === "wav-decode-failed"
  );
}

export function shouldRetryPcmRuntimeAfterFailure(input: {
  currentTrackId: string | null | undefined;
  failureTrackId: string | null | undefined;
  failureReason: string | null | undefined;
}) {
  if (!input.currentTrackId || !input.failureTrackId) {
    return true;
  }

  return (
    input.currentTrackId !== input.failureTrackId ||
    !shouldLatchPcmRuntimeFailure(input.failureReason)
  );
}

export function shouldResetAudioForPlaybackSurfaceChange(input: {
  previousPlaybackSurfaceKey: string | null | undefined;
  nextPlaybackSurfaceKey: string | null | undefined;
}) {
  return (
    !!input.previousPlaybackSurfaceKey &&
    input.previousPlaybackSurfaceKey !== input.nextPlaybackSurfaceKey
  );
}

function getSlidingWindowPlayBlockedReason(source: ProgressivePlaybackSource) {
  return source === "lossless-local"
    ? "lossless-local-play-blocked"
    : "progressive-local-play-blocked";
}

export function resolvePlaybackSourceAfterProgressiveRuntimeFailure(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  hasProgressiveRuntimeFailure: boolean;
}) {
  if (
    input.hasProgressiveRuntimeFailure &&
    input.activePlaybackSource === "lossless-local"
  ) {
    return "progressive-local" satisfies ProgressivePlaybackSource;
  }

  return input.activePlaybackSource;
}

export function resolveFullLocalPlaybackSessionState(input: {
  currentSession: FullLocalPlaybackSessionState;
  playbackSurfaceKey: string | null;
  hasBufferedFullLocalTrack: boolean;
}): FullLocalPlaybackSessionState {
  if (input.currentSession.key !== input.playbackSurfaceKey) {
    return {
      key: input.playbackSurfaceKey,
      availableInSession: input.hasBufferedFullLocalTrack
    };
  }

  return {
    key: input.playbackSurfaceKey,
    availableInSession:
      input.currentSession.availableInSession || input.hasBufferedFullLocalTrack
  };
}

export function shouldPreferImmediateFullLocalRecovery(input: {
  isCurrentSourceOwner: boolean;
  audioUnlocked: boolean;
  hasBufferedFullLocalTrack: boolean;
  fullLocalRecoveryActive: boolean;
  recoveryPhase:
    | "joining"
    | "resyncing"
    | "bootstrapping-data"
    | "playing-local-fallback"
    | "steady";
  recoveryMode: "late-join" | "rejoin" | "steady";
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
}) {
  return (
    !input.isCurrentSourceOwner &&
    input.audioUnlocked &&
    input.hasBufferedFullLocalTrack &&
    input.fullLocalRecoveryActive &&
    input.recoveryPhase !== "steady" &&
    input.playbackStatus === "playing"
  );
}

export function shouldEnableFullLocalHandoff(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackRecoveryStage: PlaybackRecoveryStage;
  startupGatePending: boolean;
  localReady: boolean;
  driftMs: number;
  cooldownMs: number;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
    input.activePlaybackSource !== "full-local"
  ) {
    return false;
  }

  if (!input.localReady || input.cooldownMs > 0 || !Number.isFinite(input.driftMs)) {
    return false;
  }

  if (Math.abs(input.driftMs) > fullLocalMaxDriftMs) {
    return false;
  }

  if (input.activePlaybackSource === "full-local") {
    return true;
  }

  if (input.startupGatePending) {
    return false;
  }

  return input.playbackRecoveryStage !== "startup-buffering";
}

export function shouldRecoverPausedFullLocalPlayback(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  audioUnlocked: boolean;
  localAudioPaused: boolean | null | undefined;
  localAudioReadyState: number | null | undefined;
  localAudioHasSrc: boolean;
  localAudioHasSrcObject: boolean;
}) {
  if (
    input.activePlaybackSource !== "full-local" ||
    input.playbackStatus !== "playing" ||
    !input.currentTrackId ||
    input.localAudioPaused !== true
  ) {
    return false;
  }

  return (
    input.localAudioHasSrcObject ||
    input.localAudioHasSrc ||
    (typeof input.localAudioReadyState === "number" &&
      input.localAudioReadyState >= haveCurrentDataReadyState) ||
    input.audioUnlocked
  );
}

export function shouldPrepareProgressiveRuntimeForSource(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
}) {
  return (
    input.progressiveEngineType !== "none" &&
    input.activePlaybackSource !== "full-local"
  );
}

export function shouldSkipSecondaryPcmWarmupSync(input: {
  engineType: ProgressiveEngineType;
  engineReady: boolean;
  localReady: boolean;
}) {
  return input.engineType === "pcm" && (!input.engineReady || !input.localReady);
}

export function shouldStartListenerProgressivePlayback(input: {
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  engineType: ProgressiveEngineType;
  startupReady: boolean;
  hasFullLocalTrack: boolean;
  progressiveFallbackReason: string | null | undefined;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  if (
    input.isCurrentSourceOwner ||
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    !hasActiveIntent ||
    input.engineType === "none" ||
    input.progressiveFallbackReason === "progressive-init-failed"
  ) {
    return false;
  }

  return input.startupReady;
}

function isRecoverableProgressiveFallbackReason(reason: string | null | undefined) {
  return reason === "buffer-underrun" || reason === "stalled" || reason === "seek-outside-buffer";
}

export function shouldAttemptProgressiveLocalPlayback(input: {
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  engineType: ProgressiveEngineType;
  startupReady: boolean;
  hasFullLocalTrack: boolean;
  progressiveFallbackReason: string | null | undefined;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    !hasActiveIntent ||
    input.engineType === "none" ||
    input.progressiveFallbackReason === "progressive-init-failed"
  ) {
    return false;
  }

  if (input.isCurrentSourceOwner) {
    return true;
  }

  return shouldStartListenerProgressivePlayback(input);
}

export function shouldUsePcmEngineForFullLocal(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  forceSourceOwnerLocalPlayback: boolean;
  sourceOwnerHasLocalTrack: boolean;
  hasFullLocalTrack: boolean;
  progressiveEngineType: ProgressiveEngineType;
}) {
  const wantsFullLocalPlayback =
    input.activePlaybackSource === "full-local" ||
    input.forceSourceOwnerLocalPlayback ||
    input.sourceOwnerHasLocalTrack;

  return (
    wantsFullLocalPlayback &&
    !input.hasFullLocalTrack &&
    input.progressiveEngineType === "pcm"
  );
}

export function getAudibleElementVolume(userVolume: number) {
  if (!Number.isFinite(userVolume) || userVolume <= 0) {
    return 0.72;
  }

  return Math.min(1, userVolume);
}

export function getPcmEngineDiagnosticsKey(
  snapshot: ProgressivePcmEngineSnapshot | null | undefined
) {
  if (!snapshot) {
    return "none";
  }

  return [
    snapshot.status,
    snapshot.audioContextState ?? "none",
    snapshot.hasOutputStream ? "stream" : "no-stream",
    snapshot.directOutputConnected ? "direct" : "no-direct",
    snapshot.contiguousChunkCount,
    snapshot.contiguousByteLength,
    snapshot.decodedSegmentCount,
    snapshot.scheduledSegmentCount,
    snapshot.decodedPacketCount,
    snapshot.decoderFlushAttemptCount,
    snapshot.decoderFlushCount,
    snapshot.lastDecodedAtMs ?? "none",
    snapshot.lastDecodeError ?? "none",
    snapshot.decodedPeak,
    snapshot.decodedRms,
    snapshot.decodedNonZeroSampleCount,
    snapshot.bufferedAheadMs,
    snapshot.playoutState
  ].join("|");
}

function resolvePcmRuntimeFailureReason(input: {
  blockedReason: string | null | undefined;
  lastDecodeError: string | null | undefined;
}) {
  if (input.blockedReason === "engine-failed" && input.lastDecodeError) {
    return input.lastDecodeError;
  }

  return input.blockedReason ?? input.lastDecodeError ?? null;
}

export function resolvePlaybackRecoveryStage(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  startupGatePending: boolean;
  waitingEventsLast30s: number;
  stalledEventsLast30s: number;
  shadowWarmupActive: boolean;
  audibleLocalFallbackActive: boolean;
}) {
  if (input.audibleLocalFallbackActive) {
    return "audible-local-fallback" as const;
  }

  if (input.playbackStatus !== "playing" || input.startupGatePending) {
    return "startup-buffering" as const;
  }

  if (input.stalledEventsLast30s > 0 || input.waitingEventsLast30s > 0) {
    return "degraded" as const;
  }

  return "steady" as const;
}

export function resolveMediaElementPlaybackRole(input: {
  target: "local" | "remote";
  activePlaybackSource: ProgressivePlaybackSource;
  shadowWarmupActive: boolean;
}) {
  if (input.target === "local") {
    return "audible-local" as const;
  }

  return "inactive" as const;
}

export function resolveSchedulerBudgetTier(input: {
  bufferHealth: "healthy" | "low" | "critical";
  activePlaybackSource: ProgressivePlaybackSource;
  playbackRecoveryStage: PlaybackRecoveryStage;
}) {
  if (input.bufferHealth === "critical" || input.playbackRecoveryStage === "audible-local-fallback") {
    return "critical" as const;
  }

  if (
    input.playbackRecoveryStage === "startup-buffering" ||
    input.playbackRecoveryStage === "degraded"
  ) {
    return "protected" as const;
  }

  return "expanded" as const;
}

export function shouldPreferLocalTakeover(input: {
  progressiveFallbackReason: string | null | undefined;
}) {
  return (
    input.progressiveFallbackReason === "buffer-underrun" ||
    input.progressiveFallbackReason === "stalled" ||
    input.progressiveFallbackReason === "seek-outside-buffer"
  );
}

function resolveTransportGovernorMode(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  mediaConnectedPeersCount: number;
  connectedPeersCount: number;
  pendingPlaybackIntent: boolean;
  progressiveFallbackReason: string | null;
  progressiveLocalEligible: boolean;
}) {
  if (
    isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    input.activePlaybackSource === "full-local"
  ) {
    return "local-primary" as const;
  }

  if (
    input.progressiveFallbackReason ||
    input.pendingPlaybackIntent ||
    input.connectedPeersCount <= 0 ||
    !input.progressiveLocalEligible
  ) {
    return "bootstrap" as const;
  }

  return "segment-catchup" as const;
}

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
  const activeSourceActivatedAtRef = useRef<number>(Date.now());
  const localTakeoverCooldownUntilRef = useRef<number>(0);
  const lastStablePlaybackAtRef = useRef<string | null>(null);
  const waitingEventTimestampsRef = useRef<number[]>([]);
  const stalledEventTimestampsRef = useRef<number[]>([]);
  const driftSamplesRef = useRef<Array<{ timestampMs: number; driftMs: number }>>([]);
  const continuousPlaybackStartedAtRef = useRef<number | null>(null);
  const [audioPaused, setAudioPaused] = useState<boolean | null>(null);
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
  const playback = roomSnapshot?.room.playback;
  const playbackRevision = playback?.playbackRevision ?? playback?.queueVersion ?? 0;
  const playbackSurfaceKey = useMemo(() => resolvePlaybackSurfaceKey(playback), [playback]);
  const playbackTimelineKey = useMemo(() => resolvePlaybackTimelineKey(playback), [playback]);

  const currentBufferedFullLocalTrack = useMemo(
    () =>
      currentTrack?.id
        ? fullLocalPlaybackTracks[currentTrack.id] ?? uploadedTracks[currentTrack.id] ?? null
        : null,
    [currentTrack?.id, fullLocalPlaybackTracks, uploadedTracks]
  );
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
    [activePlaybackSource, currentBufferedFullLocalTrack, isCurrentSourceOwner]
  );
  const activeMemberPeerIds = useMemo(
    () =>
      new Set(
        roomSnapshot?.room.members
          .map((member) => member.peerId)
          .filter((memberPeerId): memberPeerId is string => !!memberPeerId) ?? []
      ),
    [roomSnapshot?.room.members]
  );
  const currentTrackAvailabilityAnnouncement = useMemo(
    () => (currentTrack?.id ? availabilityByTrack[currentTrack.id]?.[peerId] ?? null : null),
    [availabilityByTrack, currentTrack?.id, peerId]
  );
  const currentTrackAvailabilityManifestHint = useMemo(() => {
    if (!currentTrack?.id || !roomSnapshot) {
      return currentTrackAvailabilityAnnouncement;
    }

    return (
      selectCanonicalTrackAvailabilityAnnouncement(
        Object.values(availabilityByTrack[currentTrack.id] ?? {}).filter(
          (announcement) =>
            announcement.roomId === roomSnapshot.room.id &&
            activeMemberPeerIds.has(announcement.ownerPeerId)
        )
      ) ?? currentTrackAvailabilityAnnouncement
    );
  }, [
    activeMemberPeerIds,
    availabilityByTrack,
    currentTrack?.id,
    currentTrackAvailabilityAnnouncement,
    roomSnapshot
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
  const aggregatePieceDownloadRateKbps = useMemo(() => {
    const values = peerDiagnostics
      .filter((snapshot) => activeMemberPeerIds.has(snapshot.peerId))
      .map((snapshot) => snapshot.pieceDownloadRateKbps)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    if (values.length === 0) {
      return null;
    }

    return Math.round(values.reduce((sum, value) => sum + value, 0));
  }, [activeMemberPeerIds, peerDiagnostics]);
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
      playback,
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
        availableChunks: currentTrackAvailabilityAnnouncement?.availableChunks ?? [],
        playbackPositionMs: getEffectivePlaybackPositionMs(
          playback,
          currentProgressiveManifest.durationMs,
          now
        )
      });
    },
    [currentProgressiveManifest, currentTrackAvailabilityAnnouncement?.availableChunks, playback]
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
  const canWarmBufferedFullLocal =
    !isCurrentSourceOwner &&
    activePlaybackSource !== "full-local" &&
    canUseFullLocalForPlaybackSession;
  const pendingPlaybackIntent = isPlaybackStartIntentPending(playbackStartIntent);
  const startupBufferMs = adaptiveStartupBufferMs;
  const localTakeoverCooldownMs = useMemo(
    () => Math.max(0, localTakeoverCooldownUntilRef.current - Date.now()),
    [playbackRevision, playback?.currentTrackId, activePlaybackSource]
  );
  const fullLocalReady = canUseFullLocalForPlaybackSession;
  const bufferSafetyMarginMs = useMemo(() => {
    if (progressiveHealthSnapshot.estimatedFillTimeMs === null) {
      return null;
    }

    return progressiveHealthSnapshot.aheadBufferedMs - progressiveHealthSnapshot.estimatedFillTimeMs;
  }, [
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.estimatedFillTimeMs
  ]);
  const progressiveLocalBlockedReason = useMemo(() => {
    if (!currentProgressiveManifest || currentProgressiveEngineType === "none") {
      return "progressive-engine-unavailable";
    }

    if (!hasActivePlaybackIntent(playback)) {
      return "playback-paused";
    }

    if (
      progressiveFallbackReason &&
      !isRecoverableProgressiveFallbackReason(progressiveFallbackReason)
    ) {
      return progressiveFallbackReason;
    }

    if (
      shouldAttemptProgressiveLocalPlayback({
        isCurrentSourceOwner,
        activePlaybackSource,
        playbackStatus: playback?.status,
        engineType: currentProgressiveEngineType,
        startupReady: progressiveHealthSnapshot.startupReady,
        hasFullLocalTrack: canUseFullLocalForPlaybackSession,
        progressiveFallbackReason
      })
    ) {
      return null;
    }

    if (localTakeoverCooldownMs > 0) {
      return "takeover-cooldown";
    }

    if (connectedPeersCount <= 0) {
      return "data-channel-not-ready";
    }

    if (
      aggregatePieceDownloadRateKbps === null ||
      !Number.isFinite(aggregatePieceDownloadRateKbps) ||
      aggregatePieceDownloadRateKbps <= 0
    ) {
      return "piece-download-not-ready";
    }

    if (!isProgressiveTakeoverReady()) {
      return "local-prefix-not-ready";
    }

    return null;
  }, [
    aggregatePieceDownloadRateKbps,
    activePlaybackSource,
    canUseFullLocalForPlaybackSession,
    connectedPeersCount,
    currentProgressiveEngineType,
    currentProgressiveManifest,
    isCurrentSourceOwner,
    isProgressiveTakeoverReady,
    localTakeoverCooldownMs,
    playback?.status,
    progressiveHealthSnapshot.startupReady,
    progressiveFallbackReason
  ]);
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
    if (!roomSnapshot?.queue.length) {
      return null;
    }

    const currentQueueIndex = roomSnapshot.room.playback.currentQueueItemId
      ? roomSnapshot.queue.findIndex(
          (item) => item.id === roomSnapshot.room.playback.currentQueueItemId
        )
      : currentTrack
        ? roomSnapshot.queue.findIndex((item) => item.trackId === currentTrack.id)
        : -1;
    const nextQueueItem =
      currentQueueIndex >= 0 ? roomSnapshot.queue[currentQueueIndex + 1] ?? null : null;
    if (!nextQueueItem) {
      return null;
    }

    const nextTrack = roomSnapshot.tracks.find((track) => track.id === nextQueueItem.trackId) ?? null;
    if (!nextTrack) {
      return null;
    }

    const localAvailability = availabilityByTrack[nextTrack.id]?.[peerId] ?? null;
    const bufferedChunks = localAvailability?.availableChunks.length ?? 0;
    const totalChunks = localAvailability?.totalChunks ?? 0;

    return `${nextTrack.title} ${bufferedChunks}/${totalChunks}`;
  }, [
    roomSnapshot?.queue,
    roomSnapshot?.room.playback.currentQueueItemId,
    roomSnapshot?.tracks,
    currentTrack,
    availabilityByTrack,
    peerId
  ]);
  const sourceOwnerIdentity = useMemo(
    () => ({
      currentSessionUserId:
        roomSnapshot?.room.members.find((member) => member.peerId === peerId)?.id ?? null,
      playbackSourceSessionId: roomSnapshot?.room.playback.sourceSessionId ?? null,
      currentPeerId: peerId || null,
      playbackSourcePeerId: roomSnapshot?.room.playback.sourcePeerId ?? null,
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
    const localAudio = audioRef.current;
    if (!localAudio) {
      return {
        localAudioPaused: null,
        localAudioMuted: null,
        localAudioVolume: null,
        localAudioReadyState: null,
        localAudioCurrentSrc: null,
        localAudioHasSrcObject: null
      };
    }

    return {
      localAudioPaused: audioPaused,
      localAudioMuted: localAudio.muted,
      localAudioVolume: localAudio.volume,
      localAudioReadyState: localAudio.readyState,
      localAudioCurrentSrc: localAudio.currentSrc || null,
      localAudioHasSrcObject: !!localAudio.srcObject
    };
  }, [audioRef, audioPaused, playbackRevision, activePlaybackSource, playback?.currentTrackId, playback?.status]);
  const pcmEngineDiagnostics = progressivePcmEngineRef.current?.getSnapshot() ?? null;
  const pcmEngineDiagnosticsKey = getPcmEngineDiagnosticsKey(pcmEngineDiagnostics);
  const shadowWarmupActive = false;

  const pruneWindow = useCallback(
    (timestamps: number[], now = Date.now()) =>
      timestamps.filter((timestampMs) => now - timestampMs <= playbackQualityWindowMs),
    []
  );

  const pushQualityEvent = useCallback(
    (targetRef: typeof waitingEventTimestampsRef, timestampMs = Date.now()) => {
      targetRef.current = pruneWindow([...targetRef.current, timestampMs], timestampMs);
    },
    [pruneWindow]
  );
  const pruneContinuitySegments = useCallback(
    (
      segments: Array<{ startedAtMs: number; endedAtMs: number }>,
      now = Date.now()
    ) => segments.filter((segment) => segment.endedAtMs >= now - playbackQualityWindowMs),
    []
  );
  const markContinuousPlaybackStarted = useCallback((timestampMs = Date.now()) => {
    if (continuousPlaybackStartedAtRef.current === null) {
      continuousPlaybackStartedAtRef.current = timestampMs;
    }
  }, []);
  const markContinuousPlaybackInterrupted = useCallback(
    (timestampMs = Date.now()) => {
      if (continuousPlaybackStartedAtRef.current === null) {
        return;
      }

      continuousPlaybackSegmentsRef.current = pruneContinuitySegments(
        [
          ...continuousPlaybackSegmentsRef.current,
          {
            startedAtMs: continuousPlaybackStartedAtRef.current,
            endedAtMs: timestampMs
          }
        ],
        timestampMs
      );
      continuousPlaybackStartedAtRef.current = null;
    },
    [pruneContinuitySegments]
  );
  const getMaxContinuousPlaybackMsLast30s = useCallback(
    (now = Date.now()) => {
      const windowStart = now - playbackQualityWindowMs;
      const segments = pruneContinuitySegments(continuousPlaybackSegmentsRef.current, now);
      continuousPlaybackSegmentsRef.current = segments;
      let maxDurationMs = 0;

      for (const segment of segments) {
        const startedAtMs = Math.max(segment.startedAtMs, windowStart);
        const endedAtMs = Math.min(segment.endedAtMs, now);
        if (endedAtMs > startedAtMs) {
          maxDurationMs = Math.max(maxDurationMs, endedAtMs - startedAtMs);
        }
      }

      if (continuousPlaybackStartedAtRef.current !== null) {
        maxDurationMs = Math.max(
          maxDurationMs,
          now - Math.max(continuousPlaybackStartedAtRef.current, windowStart)
        );
      }

      return maxDurationMs;
    },
    [pruneContinuitySegments]
  );

  const recordDriftSample = useCallback(
    (driftMs: number, timestampMs = Date.now()) => {
      if (!Number.isFinite(driftMs)) {
        return;
      }

      driftSamplesRef.current = [
        ...driftSamplesRef.current,
        {
          timestampMs,
          driftMs: Math.abs(driftMs)
        }
      ].filter((sample) => timestampMs - sample.timestampMs <= playbackQualityWindowMs);
    },
    []
  );

  const playbackQualityMetrics = useMemo(() => {
    const now = Date.now();
    const waitingEvents = pruneWindow(waitingEventTimestampsRef.current, now);
    const stalledEvents = pruneWindow(stalledEventTimestampsRef.current, now);
    const driftSamples = driftSamplesRef.current.filter(
      (sample) => now - sample.timestampMs <= playbackQualityWindowMs
    );
    const averageDriftMs =
      driftSamples.length > 0
        ? Math.round(
            driftSamples.reduce((sum, sample) => sum + sample.driftMs, 0) / driftSamples.length
          )
        : null;
    const maxDriftMs =
      driftSamples.length > 0
        ? Math.round(
            driftSamples.reduce((max, sample) => Math.max(max, sample.driftMs), 0)
          )
        : null;

      return {
        waitingEventsLast30s: waitingEvents.length,
        stalledEventsLast30s: stalledEvents.length,
        averageDriftMs,
        maxDriftMs,
        maxContinuousPlaybackMsLast30s: getMaxContinuousPlaybackMsLast30s(now)
      };
  }, [
    activePlaybackSource,
    getMaxContinuousPlaybackMsLast30s,
    playback?.currentTrackId,
    playback?.status,
    playbackRevision,
    pruneWindow
  ]);
  const effectiveStartupBufferMs = useMemo(() => {
    let nextStartupBufferMs = startupBufferMs;
    if (playbackQualityMetrics.stalledEventsLast30s > 0) {
      nextStartupBufferMs += 220;
    } else if (playbackQualityMetrics.waitingEventsLast30s >= 2) {
      nextStartupBufferMs += 140;
    } else if (playbackQualityMetrics.waitingEventsLast30s > 0) {
      nextStartupBufferMs += 80;
    }
    return nextStartupBufferMs;
  }, [
    playbackQualityMetrics.stalledEventsLast30s,
    playbackQualityMetrics.waitingEventsLast30s,
    startupBufferMs
  ]);

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
    setMediaConnectionState(hasActivePlaybackIntent(playback) ? "buffering" : "idle");
  }, [audioRef, destroyProgressiveRuntime, playback, playbackSurfaceKey, setMediaConnectionState]);

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
        const nextSource = canUseFullLocalForPlaybackSession
          ? "full-local"
          : resolvePlaybackSourceAfterProgressiveRuntimeFailure({
              activePlaybackSource,
              hasProgressiveRuntimeFailure: true
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
      enableListenerLocalTakeover &&
      now >= localTakeoverCooldownUntilRef.current &&
      (immediateFullLocalRecoveryEligible ||
        canUseFullLocalForPlaybackSession ||
        connectedPeersCount > 0),
    [canUseFullLocalForPlaybackSession, connectedPeersCount, immediateFullLocalRecoveryEligible]
  );
  const audibleLocalFallbackActive =
    !isCurrentSourceOwner &&
    (isSlidingWindowPlaybackSource(activePlaybackSource) || activePlaybackSource === "full-local") &&
    (progressiveFallbackReason === "buffer-underrun" ||
      progressiveFallbackReason === "stalled" ||
      progressiveFallbackReason === "seek-outside-buffer");
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
  const fullLocalBlockedReason = useMemo(() => {
    if (!currentBufferedFullLocalTrack) {
      return "track-not-fully-cached";
    }

    if (!canUseFullLocalForPlaybackSession) {
      return "full-local-not-available-at-playback-start";
    }

    if (
      !isCurrentSourceOwner &&
      !enableListenerLocalTakeover &&
      activePlaybackSource !== "full-local"
    ) {
      return "listener-handoff-disabled";
    }

    if (startupGatePending && !roomRecoveryState.fullLocalRecoveryActive) {
      return "cache-recovery-window";
    }

    return null;
  }, [
    canUseFullLocalForPlaybackSession,
    currentBufferedFullLocalTrack,
    activePlaybackSource,
    isCurrentSourceOwner,
    roomRecoveryState.fullLocalRecoveryActive,
    startupGatePending
  ]);
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
    currentBufferedFullLocalTrack,
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
      isLocalTakeoverAllowed,
      setActivePlaybackSource,
      setProgressiveFallbackReason
    ]
  );

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

    const currentTimeSeconds = pcmEngine.getCurrentTimeSeconds();
    return Number.isFinite(currentTimeSeconds) ? Math.round(currentTimeSeconds * 1000) : null;
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

        const matchedIntent = doesPlaybackMatchStartIntent(playbackStartIntent, playback);
        markPlaybackStartFailure(
          failureReason,
          matchedIntent ? "当前点击未能激活音频，请再次点击播放" : blockedMessage
        );
        return false;
      }

      if (doesPlaybackMatchStartIntent(playbackStartIntent, playback)) {
        updatePlaybackStartIntent((current) => consumePlaybackStartIntent(current, source));
      }

      return true;
    },
    [
      markPlaybackStartFailure,
      playback,
      playbackStartIntent,
      recordPeerDiagnostic,
      updatePlaybackStartIntent
    ]
  );
  const ensurePlaybackStart = useCallback(
    (source: ProgressivePlaybackSource, attempt = 0) => {
      clearPlaybackStartRetry();

      if (!hasActivePlaybackIntent(playback) || activePlaybackSource !== source) {
        return;
      }

      const targetElement = audioRef.current;
      const blockedMessage = "浏览器阻止了本地音频自动播放，请手动点击播放恢复。";
      const failureReason = source === "full-local"
        ? "full-local-play-blocked"
        : getSlidingWindowPlayBlockedReason(source);
      const pendingIntent =
        !!playbackStartIntent && isPlaybackStartIntentPending(playbackStartIntent);

      void attemptPlaybackStart(targetElement, source, blockedMessage, failureReason, {
        reportFailure: pendingIntent || attempt >= maxPlaybackStartRetryAttempts
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
      isCurrentSourceOwner,
      playback?.status,
      playbackStartIntent
    ]
  );

  useEffect(() => {
    if (!playback?.currentTrackId || !hasActivePlaybackIntent(playback)) {
      setSchedulerMode(isPageVisible ? "normal" : "idle");
    }
  }, [isPageVisible, playback?.currentTrackId, playback?.status, setSchedulerMode]);

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
    if (!hasActivePlaybackIntent(playback)) {
      clearPlaybackStartRetry();
    }
  }, [
    clearPlaybackStartRetry,
    playback?.status,
    playback?.currentTrackId,
    playback?.mediaEpoch
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!playback?.currentTrackId) {
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
      fullLocalPlaybackTracks[playback.currentTrackId] ??
      uploadedTracks[playback.currentTrackId] ??
      null;
    const sourceOwnerHasLocalTrack = isCurrentSourceOwner && !!uploaded;
    const shouldWarmBufferedFullLocal =
      !!uploaded &&
      !isCurrentSourceOwner &&
      !progressiveEngineRef.current &&
      !progressivePcmEngineRef.current;
    const expectedSeconds =
      getEffectivePlaybackPositionMs(playback, currentTrack?.durationMs ?? 0, Date.now()) / 1000;
    const shouldPlayPlayback = hasActivePlaybackIntent(playback);
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

      if (playback.status === "paused") {
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
          playbackStatus: playback.status,
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

    if (playback.status === "paused") {
      audio.pause();
      audio.playbackRate = 1;
    }
  }, [
    audioRef,
    playback,
    currentTrack?.durationMs,
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
    setActivePlaybackSource,
    setProgressiveFallbackReason,
    setPlaybackStartIntent,
    progressiveHealthSnapshot.startupReady,
    startupBufferMs
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
        current === "idle" && !roomSnapshot?.room.playback.currentTrackId ? current : "live"
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
        summary: `本地音频暂停 role=${role} source=${activePlaybackSource} status=${roomSnapshot?.room.playback.status ?? "unknown"}`,
        recordEvent: false
      });
      if (!hasActivePlaybackIntent(roomSnapshot?.room.playback)) {
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
    currentProgressiveManifest,
    isPageVisible,
    isCurrentSourceOwner,
    markContinuousPlaybackInterrupted,
    markContinuousPlaybackStarted,
    pushQualityEvent,
    recordPeerDiagnostic,
    progressiveHealthSnapshot.contiguousBufferedMs,
    progressiveHealthSnapshot.aheadBufferedMs,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status,
    setBufferHealth,
    setMediaConnectionState,
    setProgressiveFallbackReason,
    setSchedulerMode
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
        hasActivePlaybackIntent(roomSnapshot?.room.playback) &&
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
    roomSnapshot?.room.playback.status,
    setMediaConnectionState,
    volume
  ]);

  useEffect(() => {
    const playbackState = roomSnapshot?.room.playback;
    const audio = audioRef.current;
    if (!playbackState?.currentTrackId || !audio || activePlaybackSource !== "full-local") {
      return;
    }

    let cancelled = false;
    let recoveryInFlight = false;
    const recoverPausedFullLocalPlayback = () => {
      if (cancelled || recoveryInFlight) {
        return;
      }

      if (
        !shouldRecoverPausedFullLocalPlayback({
          activePlaybackSource,
          playbackStatus: playbackState.status,
          currentTrackId: playbackState.currentTrackId,
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
        getEffectivePlaybackPositionMs(playbackState, currentTrack?.durationMs ?? 0, Date.now()) /
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
    currentTrack?.durationMs,
    recordPeerDiagnostic,
    roomSnapshot?.room.playback,
    setMediaConnectionState,
    volume
  ]);

  useEffect(() => {
    const nextPlayback = roomSnapshot?.room.playback;

    if (!nextPlayback?.currentTrackId) {
      setMediaConnectionState("idle");
      return;
    }

    if (isCurrentSourceOwner) {
      return;
    }

    const localAudio = audioRef.current;
    const localPlaybackReady =
      !!localAudio &&
      !localAudio.paused &&
      (localAudio.readyState >= haveCurrentDataReadyState ||
        !!localAudio.srcObject ||
        !!localAudio.currentSrc);
    setMediaConnectionState(
      hasActivePlaybackIntent(nextPlayback) ? (localPlaybackReady ? "live" : "buffering") : "idle"
    );
  }, [
    audioRef,
    roomSnapshot?.room.playback,
    isCurrentSourceOwner,
    mediaConnectedPeersCount,
    activePlaybackSource,
    setMediaConnectionState
  ]);

  useEffect(() => {
    if (!playback?.currentTrackId || !hasActivePlaybackIntent(playback)) {
      return;
    }

    const sampleDrift = () => {
      const expectedSeconds =
        getEffectivePlaybackPositionMs(playback, currentTrack?.durationMs ?? 0, Date.now()) / 1000;
      let observedSeconds: number | null = null;

      if (isSlidingWindowPlaybackSource(activePlaybackSource)) {
        const localProgressMs = getLocalPlaybackPositionMs();
        if (typeof localProgressMs === "number") {
          observedSeconds = localProgressMs / 1000;
        } else if (audioRef.current && Number.isFinite(audioRef.current.currentTime) && !audioRef.current.paused) {
          observedSeconds = audioRef.current.currentTime;
        }
      } else if (audioRef.current && Number.isFinite(audioRef.current.currentTime) && !audioRef.current.paused) {
        observedSeconds = audioRef.current.currentTime;
      }

      if (observedSeconds === null) {
        return;
      }

      recordDriftSample((expectedSeconds - observedSeconds) * 1000);
    };

    sampleDrift();
    const timerId = window.setInterval(sampleDrift, progressiveRuntimeTickIntervalMs);
    return () => window.clearInterval(timerId);
  }, [
    activePlaybackSource,
    audioRef,
    currentTrack?.durationMs,
    getLocalPlaybackPositionMs,
    playback,
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
        return engine.sync();
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
    const playbackState = roomSnapshot?.room.playback;
    const audio = audioRef.current;

    if (
      !playbackState?.currentTrackId ||
      !audio ||
      (!progressiveEngineRef.current && !progressivePcmEngineRef.current) ||
      !currentProgressiveManifest ||
      activePlaybackSource === "full-local"
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

      const expectedSeconds =
        getEffectivePlaybackPositionMs(
          playbackState,
          currentProgressiveManifest.durationMs,
          Date.now()
        ) / 1000;
      const now = Date.now();
      const shadowWarmupReady = true;
      let engineReady = false;
      let localReady = false;
      let driftMs = Number.POSITIVE_INFINITY;

      if (pcmEngine) {
        const syncResult = await pcmEngine.syncPlayback(expectedSeconds, true);
        pcmLastBlockedReasonRef.current = syncResult.blockedReason;
        markPcmRuntimeFailure(
          resolvePcmRuntimeFailureReason({
            blockedReason: syncResult.blockedReason,
            lastDecodeError: pcmEngine.getSnapshot().lastDecodeError
          })
        );
        if (cancelled) {
          return;
        }

        engineReady = pcmEngine.engineStatus === "ready";
        localReady = syncResult.localReady;
        driftMs = syncResult.driftMs;
        audio.muted = !isSlidingWindowPlaybackSource(activePlaybackSource);
      } else if (mseEngine) {
        await mseEngine.sync();
        engineReady = mseEngine.engineStatus === "ready";
        localReady = mseEngine.isPlaybackReady(expectedSeconds, startupBufferMs);

        if (localReady && (isSlidingWindowPlaybackSource(activePlaybackSource) || shadowWarmupReady)) {
          syncLocalPlaybackWindow(audio, expectedSeconds, true, {
            softDriftMs: 120,
            hardDriftMs: 900,
            correctionMode: "shadow-local-catchup"
          });
          audio.muted = !isSlidingWindowPlaybackSource(activePlaybackSource);
          void roomAudioOutput.playElement(audio);
          driftMs = Math.abs(expectedSeconds * 1000 - audio.currentTime * 1000);
        }
      }

      const shouldAttemptTakeover = shouldAttemptProgressiveLocalPlayback({
        isCurrentSourceOwner,
        activePlaybackSource,
        playbackStatus: playbackState.status,
        engineType: currentProgressiveEngineType,
        startupReady: progressiveHealthSnapshot.startupReady,
        hasFullLocalTrack: canUseFullLocalForPlaybackSession,
        progressiveFallbackReason
      });
      const takeoverBlockedReason = shouldAttemptTakeover ? null : progressiveLocalBlockedReason;

      if (
        !engineReady ||
        !localReady
      ) {
        if (
          pcmEngine &&
          !shouldSkipSecondaryPcmWarmupSync({
            engineType: currentProgressiveEngineType,
            engineReady,
            localReady
          })
        ) {
          const syncResult = await pcmEngine.syncPlayback(expectedSeconds, false).catch(() => null);
          pcmLastBlockedReasonRef.current = syncResult?.blockedReason ?? null;
          markPcmRuntimeFailure(
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
        !isLocalTakeoverAllowed(now) ||
        !shouldAttemptTakeover
      ) {
        progressiveWarmupReadyAtRef.current = shadowWarmupReady && localReady ? now : null;
        if (
          progressiveFallbackReason &&
          isLocalTakeoverAllowed(now) &&
          (playbackRecoveryStage === "steady" || shouldAttemptTakeover)
        ) {
          setProgressiveFallbackReason(null);
        }
        return;
      }

      const warmupDecision = resolveProgressiveWarmupDecision({
        currentSource: activePlaybackSource,
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
              currentProgressiveManifest.durationMs,
              Date.now()
            ) / 1000,
            false
          )
          .then((result) => {
            pcmLastBlockedReasonRef.current = result.blockedReason;
            markPcmRuntimeFailure(
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
    roomSnapshot?.room.playback,
    currentProgressiveManifest,
    activePlaybackSource,
    progressiveHealthSnapshot.startupReady,
    startupBufferMs,
    progressiveLocalBlockedReason,
    isProgressiveTakeoverReady,
    isLocalTakeoverAllowed,
    audioRef,
    playbackQualityMetrics.stalledEventsLast30s,
    playbackQualityMetrics.waitingEventsLast30s,
    playbackRecoveryStage,
    progressiveFallbackReason,
    markPcmRuntimeFailure,
    transitionPlaybackSource,
    setProgressiveFallbackReason
  ]);

  useEffect(() => {
    const playbackState = roomSnapshot?.room.playback;
    const audio = audioRef.current;
    if (
      !playbackState?.currentTrackId ||
      !audio ||
      !currentBufferedFullLocalTrack ||
      !canWarmBufferedFullLocal ||
      currentProgressiveEngineType === "pcm"
    ) {
      fullLocalWarmupReadyAtRef.current = null;
      return;
    }

    const syncWarmup = () => {
      if (!hasActivePlaybackIntent(playbackState)) {
        audio.pause();
        audio.muted = false;
        fullLocalWarmupReadyAtRef.current = null;
        return;
      }

      if (audio.srcObject) {
        audio.srcObject = null;
      }
      if (audio.src !== currentBufferedFullLocalTrack.objectUrl) {
        audio.src = currentBufferedFullLocalTrack.objectUrl;
        audio.load();
      }

      const expectedSeconds =
        getEffectivePlaybackPositionMs(playbackState, currentTrack?.durationMs ?? 0, Date.now()) /
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
        progressiveHealthSnapshot.aheadBufferedMs >=
          getStartupWindowMs(
            currentTrack ?? {
              mimeType: null,
              codec: null
            }
          );

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
    roomSnapshot?.room.playback,
    currentBufferedFullLocalTrack?.objectUrl,
    canWarmBufferedFullLocal,
    currentProgressiveEngineType,
    activePlaybackSource,
    currentTrack?.durationMs,
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
    const playbackState = roomSnapshot?.room.playback;
    if (
      !playbackState?.currentTrackId ||
      !currentBufferedFullLocalTrack ||
      currentProgressiveEngineType === "none" ||
      !isSlidingWindowPlaybackSource(activePlaybackSource)
    ) {
      return;
    }

    if (!hasActivePlaybackIntent(playbackState)) {
      fullLocalWarmupReadyAtRef.current = null;
      return;
    }

    const comfortBufferMs = getStartupWindowMs(
      currentTrack ?? {
        mimeType: null,
        codec: null
      }
    );

    const syncUpgrade = () => {
      const now = Date.now();
      const readyForFullLocal =
        fullLocalBlockedReason === null &&
        isLocalTakeoverAllowed(now) &&
        progressiveHealthSnapshot.aheadBufferedMs >= comfortBufferMs;

      if (!readyForFullLocal) {
        fullLocalWarmupReadyAtRef.current = null;
        return;
      }

      if (fullLocalWarmupReadyAtRef.current === null) {
        fullLocalWarmupReadyAtRef.current = now;
        return;
      }

      if (now - fullLocalWarmupReadyAtRef.current < fullLocalSwitchDelayMs) {
        return;
      }

      if (isSlidingWindowPlaybackSource(activePlaybackSource)) {
        transitionPlaybackSource("full-local");
      }
    };

    syncUpgrade();
    const timerId = window.setInterval(syncUpgrade, progressiveRuntimeTickIntervalMs);
    return () => window.clearInterval(timerId);
  }, [
    roomSnapshot?.room.playback,
    currentBufferedFullLocalTrack,
    currentProgressiveEngineType,
    activePlaybackSource,
    currentTrack,
    fullLocalBlockedReason,
    isLocalTakeoverAllowed,
    progressiveHealthSnapshot.aheadBufferedMs,
    transitionPlaybackSource
  ]);

  useEffect(() => {
    if (!isSlidingWindowPlaybackSource(activePlaybackSource)) {
      return;
    }

    if (!hasActivePlaybackIntent(playback) || !progressiveHealthSnapshot.startupReady) {
      return;
    }

    if (progressiveHealthSnapshot.aheadBufferedMs >= getCriticalBufferThresholdMs()) {
      return;
    }

    setProgressiveFallbackReason("seek-outside-buffer");
  }, [
    activePlaybackSource,
    playback?.currentTrackId,
    playback?.status,
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.startupReady,
    setProgressiveFallbackReason
  ]);

  useEffect(() => {
    const nextCooldownMs = Math.max(0, localTakeoverCooldownUntilRef.current - Date.now());
    const comfortBufferedMs = getStartupWindowMs(
      currentTrack ?? {
        mimeType: null,
        codec: null
      }
    );
    const latestPcmEngineDiagnostics = progressivePcmEngineRef.current?.getSnapshot() ?? null;
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
          pcmHasOutputStream: latestPcmEngineDiagnostics?.hasOutputStream ?? null,
          pcmDirectOutputConnected: latestPcmEngineDiagnostics?.directOutputConnected ?? null,
          pcmContiguousChunkCount: latestPcmEngineDiagnostics?.contiguousChunkCount ?? null,
          pcmContiguousByteLength: latestPcmEngineDiagnostics?.contiguousByteLength ?? null,
          pcmDecodedSegmentCount: latestPcmEngineDiagnostics?.decodedSegmentCount ?? null,
          pcmScheduledSegmentCount: latestPcmEngineDiagnostics?.scheduledSegmentCount ?? null,
          pcmDecodedPacketCount: latestPcmEngineDiagnostics?.decodedPacketCount ?? null,
          pcmDecoderFlushAttemptCount: latestPcmEngineDiagnostics?.decoderFlushAttemptCount ?? null,
          pcmDecoderFlushCount: latestPcmEngineDiagnostics?.decoderFlushCount ?? null,
          pcmLastDecodedAtMs: latestPcmEngineDiagnostics?.lastDecodedAtMs ?? null,
          pcmLastDecodeError: latestPcmEngineDiagnostics?.lastDecodeError ?? null,
          pcmDecodedPeak: latestPcmEngineDiagnostics?.decodedPeak ?? null,
          pcmDecodedRms: latestPcmEngineDiagnostics?.decodedRms ?? null,
          pcmDecodedNonZeroSampleCount: latestPcmEngineDiagnostics?.decodedNonZeroSampleCount ?? null,
          pcmBufferedAheadMs: latestPcmEngineDiagnostics?.bufferedAheadMs ?? null,
          pcmPlayoutState: latestPcmEngineDiagnostics?.playoutState ?? null,
          pcmLastBlockedReason: pcmLastBlockedReasonRef.current,
          startupBufferMs: effectiveStartupBufferMs,
          comfortBufferedMs,
          averageDriftMs: playbackQualityMetrics.averageDriftMs,
          maxDriftMs: playbackQualityMetrics.maxDriftMs,
          waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
          stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
          shadowWarmupActive,
          playbackRecoveryStage,
          audibleLocalFallbackActive,
          maxContinuousPlaybackMsLast30s: playbackQualityMetrics.maxContinuousPlaybackMsLast30s,
          schedulerBudgetTier,
          lastStablePlaybackAt: lastStablePlaybackAtRef.current
        }
      })
    });
  }, [
    currentTrack,
    bufferSafetyMarginMs,
    playbackQualityMetrics,
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
    progressiveHealthSnapshot.engineType,
    progressiveHealthSnapshot.contiguousBufferedMs,
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.schedulerPolicy,
    progressiveHealthSnapshot.startupReady,
    progressiveHealthSnapshot.fallbackReason,
    progressiveHealthSnapshot.estimatedFillTimeMs,
    progressiveHealthSnapshot.remainingPlaybackMs,
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
