"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  pickActiveMediaDiagnostic,
  resolveTransportHealth
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
  getRemoteFirstComfortBufferMs,
  isTakeoverReady,
  shouldEnableRemoteFirstLock,
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
  resolveFullLocalWarmupDecision,
  resolveProgressiveWarmupDecision,
  shouldForceSourceOwnerLocalPlayback
} from "./progressive-source-controller";

type UseProgressiveRuntimeInput = {
  audioRef: RefObject<HTMLAudioElement | null>;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  roomSnapshot: RoomSnapshot | null;
  currentTrack: TrackMeta | null;
  peerId: string;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  uploadedTracks: Record<string, { objectUrl: string }>;
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  setActivePlaybackSource: Dispatch<SetStateAction<ProgressivePlaybackSource>>;
  progressiveFallbackReason: string | null;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
  playbackStartIntent: PlaybackStartIntent | null;
  setPlaybackStartIntent: Dispatch<SetStateAction<PlaybackStartIntent | null>>;
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

const progressiveRuntimeTickIntervalMs = 350;
const progressiveSwitchDelayMs = getFullLocalStableWindowMs();
const fullLocalSwitchDelayMs = getFullLocalStableWindowMs();
const fullLocalMaxDriftMs = 180;
const playbackStartRetryDelayMs = 160;
const maxPlaybackStartRetryAttempts = 18;
const remoteStartupGatePollMs = 120;
const enableDirectProgressiveTakeover = true;
const enableListenerLocalTakeover = true;
const stableRemoteStartupBufferMs = 320;
const constrainedRemoteStartupBufferMs = 480;
const weakRemoteStartupBufferMs = 680;
const maximumAdaptiveStartupBufferMs = 900;
const haveCurrentDataReadyState = 2;
const playbackQualityWindowMs = 30_000;
const stablePlaybackGraceWindowMs = 12_000;
const shortRemoteAudioHoldMs = 260;
const steadyRemoteAudioHoldMs = 420;
const recoveryRemoteAudioHoldMs = 680;
const shadowFallbackMaxDriftMs = 160;
const shadowFallbackWaitingThreshold = 2;
const shadowFallbackRemoteLockWaitingThreshold = 3;
const shadowFallbackStalledThreshold = 1;

export type PlaybackRecoveryStage =
  | "startup-buffering"
  | "steady"
  | "degraded"
  | "shadow-catchup"
  | "audible-local-fallback"
  | "remote-recovery";

export type SchedulerBudgetTier = "critical" | "protected" | "comfort" | "expanded";

export function shouldPollRemoteStartupGate(
  activePlaybackSource: ProgressivePlaybackSource,
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined,
  readyState: number
) {
  return (
    activePlaybackSource === "remote-stream" &&
    playbackStatus === "playing" &&
    readyState < haveCurrentDataReadyState
  );
}

export function resolveAdaptiveStartupBufferMs(input: {
  sourceDiagnostics:
    | Pick<
        PeerDiagnosticsSnapshot,
        | "currentRoundTripTimeMs"
        | "packetLossRate"
        | "jitterMs"
        | "mediaCandidateType"
        | "mediaProtocol"
      >
    | null
    | undefined;
  hasRecentStablePlayback: boolean;
}) {
  const diagnostics = input.sourceDiagnostics;
  if (!diagnostics) {
    return stableRemoteStartupBufferMs;
  }

  const severeWeakLink =
    (typeof diagnostics.currentRoundTripTimeMs === "number" &&
      diagnostics.currentRoundTripTimeMs >= 220) ||
    (typeof diagnostics.packetLossRate === "number" && diagnostics.packetLossRate >= 8) ||
    (typeof diagnostics.jitterMs === "number" && diagnostics.jitterMs >= 45);
  const weakLink =
    severeWeakLink ||
    (typeof diagnostics.currentRoundTripTimeMs === "number" &&
      diagnostics.currentRoundTripTimeMs >= 180) ||
    (typeof diagnostics.packetLossRate === "number" && diagnostics.packetLossRate >= 6) ||
    (typeof diagnostics.jitterMs === "number" && diagnostics.jitterMs >= 30);
  const constrainedTransport =
    diagnostics.mediaCandidateType === "relay" || diagnostics.mediaProtocol === "tcp";

  let startupBufferMs = stableRemoteStartupBufferMs;
  if (severeWeakLink) {
    startupBufferMs = weakRemoteStartupBufferMs + 140;
  } else if (weakLink) {
    startupBufferMs = weakRemoteStartupBufferMs;
  } else if (constrainedTransport) {
    startupBufferMs = constrainedRemoteStartupBufferMs;
  }

  if (input.hasRecentStablePlayback) {
    startupBufferMs = Math.max(260, startupBufferMs - 80);
  }

  return Math.min(maximumAdaptiveStartupBufferMs, startupBufferMs);
}

export function resolveRemoteAudioHoldDurationMs(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  remoteFirstLock: boolean;
  waitingEventsLast30s: number;
  shadowWarmupActive: boolean;
  playbackRecoveryStage?: PlaybackRecoveryStage | null;
}) {
  if (input.activePlaybackSource === "remote-stream") {
    return 0;
  }

  if (input.playbackRecoveryStage === "audible-local-fallback") {
    return recoveryRemoteAudioHoldMs + 120;
  }

  if (
    input.playbackRecoveryStage === "shadow-catchup" ||
    input.playbackRecoveryStage === "remote-recovery"
  ) {
    return recoveryRemoteAudioHoldMs;
  }

  if (input.remoteFirstLock || input.waitingEventsLast30s > 0) {
    return recoveryRemoteAudioHoldMs;
  }

  if (input.shadowWarmupActive) {
    return steadyRemoteAudioHoldMs;
  }

  return shortRemoteAudioHoldMs;
}

export function resolveRemoteStartupGateState(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  readyState: number;
  paused: boolean;
  hasSrcObject: boolean;
  stableSinceMs: number | null;
  startupBufferMs: number;
  now?: number;
  lastWaitingAtMs?: number | null;
}) {
  if (input.activePlaybackSource !== "remote-stream" || input.playbackStatus !== "playing") {
    return {
      shouldPoll: false,
      shouldMute: false,
      nextStableSinceMs: null
    };
  }

  const now = input.now ?? Date.now();
  if (!input.hasSrcObject || input.readyState < haveCurrentDataReadyState || input.paused) {
    return {
      shouldPoll: true,
      shouldMute: false,
      nextStableSinceMs: null
    };
  }

  const waitingRecently =
    typeof input.lastWaitingAtMs === "number" && now - input.lastWaitingAtMs < input.startupBufferMs;
  const nextStableSinceMs =
    waitingRecently || input.stableSinceMs === null ? now : input.stableSinceMs;
  const gateMatured = now - nextStableSinceMs >= input.startupBufferMs;

  return {
    shouldPoll: !gateMatured,
    shouldMute: !gateMatured,
    nextStableSinceMs
  };
}

export function resolveAudioQualityTier(input: {
  targetAudioBitrateKbps: number | null | undefined;
  receiverJitterTargetMs: number | null | undefined;
}) {
  const audioBitrateTier =
    typeof input.targetAudioBitrateKbps === "number"
      ? input.targetAudioBitrateKbps >= 176
        ? "high"
        : input.targetAudioBitrateKbps >= 104
          ? "medium"
          : "low"
      : null;
  const receiverJitterTier =
    typeof input.receiverJitterTargetMs === "number"
      ? input.receiverJitterTargetMs >= 500
        ? "high"
        : input.receiverJitterTargetMs >= 340
          ? "medium"
          : "low"
      : null;

  return {
    audioBitrateTier,
    receiverJitterTier
  } as const;
}

export function shouldEnableAudibleLocalFallback(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  remoteFirstLock: boolean;
  waitingEventsLast30s: number;
  stalledEventsLast30s: number;
  localReady: boolean;
  driftMs: number;
  cooldownMs: number;
}) {
  if (input.activePlaybackSource !== "remote-stream") {
    return false;
  }

  if (!input.localReady || input.cooldownMs > 0 || !Number.isFinite(input.driftMs)) {
    return false;
  }

  if (Math.abs(input.driftMs) > shadowFallbackMaxDriftMs) {
    return false;
  }

  const waitingThreshold = input.remoteFirstLock
    ? shadowFallbackRemoteLockWaitingThreshold
    : shadowFallbackWaitingThreshold;
  return (
    input.stalledEventsLast30s >= shadowFallbackStalledThreshold ||
    input.waitingEventsLast30s >= waitingThreshold
  );
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

  if (input.activePlaybackSource !== "remote-stream") {
    return "remote-recovery" as const;
  }

  if (input.playbackStatus !== "playing" || input.startupGatePending) {
    return "startup-buffering" as const;
  }

  if (input.stalledEventsLast30s > 0 || input.waitingEventsLast30s >= shadowFallbackWaitingThreshold) {
    return input.shadowWarmupActive ? "shadow-catchup" : "degraded";
  }

  if (input.waitingEventsLast30s > 0) {
    return "remote-recovery" as const;
  }

  return "steady" as const;
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
    input.playbackRecoveryStage === "degraded" ||
    input.playbackRecoveryStage === "remote-recovery"
  ) {
    return "protected" as const;
  }

  if (input.activePlaybackSource === "remote-stream") {
    return "comfort" as const;
  }

  return "expanded" as const;
}

export function shouldPreferLocalTakeover(input: {
  remoteFirstLock: boolean;
  progressiveFallbackReason: string | null | undefined;
}) {
  if (input.remoteFirstLock) {
    return false;
  }

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
  remoteFirstLock: boolean;
  remoteFirstLockReason: string | null;
  progressiveFallbackReason: string | null;
  progressiveLocalEligible: boolean;
}) {
  if (
    input.activePlaybackSource === "progressive-local" ||
    input.activePlaybackSource === "full-local"
  ) {
    return "local-primary" as const;
  }

  if (
    input.progressiveFallbackReason ||
    input.mediaConnectedPeersCount <= 0 ||
    (input.remoteFirstLock &&
      input.remoteFirstLockReason !== "cache-outrun-risk" &&
      input.remoteFirstLockReason !== "data-channel-not-ready")
  ) {
    return "emergency-fallback" as const;
  }

  if (
    input.pendingPlaybackIntent ||
    input.mediaConnectedPeersCount <= 0 ||
    input.connectedPeersCount <= 0 ||
    !input.progressiveLocalEligible
  ) {
    return "bootstrap" as const;
  }

  return "segment-catchup" as const;
}

export function useProgressiveRuntime({
  audioRef,
  remoteAudioRef,
  roomSnapshot,
  currentTrack,
  peerId,
  availabilityByTrack,
  uploadedTracks,
  isCurrentSourceOwner,
  activePlaybackSource,
  setActivePlaybackSource,
  progressiveFallbackReason,
  setProgressiveFallbackReason,
  playbackStartIntent,
  setPlaybackStartIntent,
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
  const remoteHoldTimeoutRef = useRef<number | null>(null);
  const remoteStartupBufferTimerRef = useRef<number | null>(null);
  const playbackStartRetryRef = useRef<number | null>(null);
  const activeSourceActivatedAtRef = useRef<number>(Date.now());
  const localTakeoverCooldownUntilRef = useRef<number>(0);
  const remoteStartupReadyAtRef = useRef<number | null>(null);
  const lastStablePlaybackAtRef = useRef<string | null>(null);
  const waitingEventTimestampsRef = useRef<number[]>([]);
  const stalledEventTimestampsRef = useRef<number[]>([]);
  const driftSamplesRef = useRef<Array<{ timestampMs: number; driftMs: number }>>([]);
  const lastRemoteWaitingAtRef = useRef<number | null>(null);
  const continuousPlaybackStartedAtRef = useRef<number | null>(null);
  const continuousPlaybackSegmentsRef = useRef<Array<{ startedAtMs: number; endedAtMs: number }>>([]);
  const playback = roomSnapshot?.room.playback;
  const playbackRevision = playback?.playbackRevision ?? playback?.queueVersion ?? 0;

  const currentBufferedFullLocalTrack = useMemo(
    () => (currentTrack?.id ? uploadedTracks[currentTrack.id] ?? null : null),
    [currentTrack?.id, uploadedTracks]
  );
  const forceSourceOwnerLocalPlayback = useMemo(
    () =>
      shouldForceSourceOwnerLocalPlayback({
        isCurrentSourceOwner,
        activePlaybackSource,
        hasFullLocalTrack: !!currentBufferedFullLocalTrack
      }),
    [activePlaybackSource, currentBufferedFullLocalTrack, isCurrentSourceOwner]
  );
  const currentTrackAvailabilityAnnouncement = useMemo(
    () => (currentTrack?.id ? availabilityByTrack[currentTrack.id]?.[peerId] ?? null : null),
    [availabilityByTrack, currentTrack?.id, peerId]
  );
  const currentProgressiveManifest = useMemo(
    () => buildProgressiveTrackManifest(currentTrack, currentTrackAvailabilityAnnouncement),
    [currentTrack, currentTrackAvailabilityAnnouncement]
  );
  const currentProgressiveEngineType = useMemo(
    () => getProgressiveEngineType(currentProgressiveManifest),
    [currentProgressiveManifest]
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
    enableListenerLocalTakeover &&
    !isCurrentSourceOwner &&
    activePlaybackSource !== "full-local" &&
    !!currentProgressiveManifest &&
    canUseProgressivePlayback() &&
    currentProgressiveEngineType !== "none";
  const canWarmBufferedFullLocal =
    enableListenerLocalTakeover &&
    !isCurrentSourceOwner &&
    activePlaybackSource !== "full-local" &&
    !!currentBufferedFullLocalTrack &&
    currentProgressiveEngineType === "none";
  const pendingPlaybackIntent = isPlaybackStartIntentPending(playbackStartIntent);
  const sourceDiagnostics = useMemo(
    () => pickActiveMediaDiagnostic(peerDiagnostics, roomSnapshot?.room.playback.sourcePeerId ?? null),
    [peerDiagnostics, roomSnapshot?.room.playback.sourcePeerId]
  );
  const sourceTransport = useMemo(
    () => (sourceDiagnostics ? resolveTransportHealth(sourceDiagnostics) : { transportHealth: null, degradedReason: null }),
    [sourceDiagnostics]
  );
  const remoteFirstLockReason = useMemo(() => {
    if (mediaConnectedPeersCount > 0 && connectedPeersCount === 0) {
      return "data-channel-not-ready";
    }

    if (sourceDiagnostics && shouldEnableRemoteFirstLock({ diagnostics: sourceDiagnostics })) {
      if (
        typeof sourceDiagnostics.currentRoundTripTimeMs === "number" &&
        sourceDiagnostics.currentRoundTripTimeMs >= 220
      ) {
        return "high-rtt";
      }
      if (
        typeof sourceDiagnostics.availableOutgoingBitrateKbps === "number" &&
        sourceDiagnostics.availableOutgoingBitrateKbps > 0 &&
        sourceDiagnostics.availableOutgoingBitrateKbps <= 72
      ) {
        return "low-bitrate-headroom";
      }
      if (
        typeof sourceDiagnostics.packetLossRate === "number" &&
        sourceDiagnostics.packetLossRate >= 8
      ) {
        return "high-packet-loss-rate";
      }
      if (typeof sourceDiagnostics.jitterMs === "number" && sourceDiagnostics.jitterMs >= 45) {
        return "high-jitter";
      }
      return "remote-transport-constrained";
    }

    if (progressiveFallbackReason === "buffer-underrun" || progressiveFallbackReason === "stalled") {
      return progressiveFallbackReason;
    }

    if (
      progressiveHealthSnapshot.schedulerPolicy === "outrun-recovery" ||
      (progressiveHealthSnapshot.estimatedFillTimeMs !== null &&
        progressiveHealthSnapshot.remainingPlaybackMs !== null &&
        progressiveHealthSnapshot.remainingPlaybackMs > 0 &&
        progressiveHealthSnapshot.estimatedFillTimeMs >=
          progressiveHealthSnapshot.remainingPlaybackMs)
    ) {
      return "cache-outrun-risk";
    }

    if (sourceTransport.transportHealth === "media-only") {
      return sourceTransport.degradedReason ?? "data-channel-not-ready";
    }

    return null;
  }, [
    connectedPeersCount,
    currentProgressiveManifest,
    currentTrackAvailabilityAnnouncement,
    isProgressiveTakeoverReady,
    mediaConnectedPeersCount,
    progressiveFallbackReason,
    progressiveHealthSnapshot.estimatedFillTimeMs,
    progressiveHealthSnapshot.remainingPlaybackMs,
    progressiveHealthSnapshot.schedulerPolicy,
    sourceDiagnostics,
    sourceTransport.degradedReason,
    sourceTransport.transportHealth
  ]);
  const remoteFirstLock = remoteFirstLockReason !== null;
  const startupBufferMs = useMemo(() => {
    const lastStablePlaybackAt = lastStablePlaybackAtRef.current;
    const hasRecentStablePlayback =
      !!lastStablePlaybackAt &&
      Date.now() - new Date(lastStablePlaybackAt).getTime() <= stablePlaybackGraceWindowMs;
    return resolveAdaptiveStartupBufferMs({
      sourceDiagnostics,
      hasRecentStablePlayback
    });
  }, [sourceDiagnostics, activePlaybackSource, playback?.currentTrackId, playback?.status, playbackRevision]);
  const localTakeoverCooldownMs = useMemo(
    () => Math.max(0, localTakeoverCooldownUntilRef.current - Date.now()),
    [playbackRevision, playback?.currentTrackId, activePlaybackSource, remoteFirstLock]
  );
  const fullLocalReady = !!currentBufferedFullLocalTrack;
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

    if (playback?.status !== "playing") {
      return "playback-paused";
    }

    if (remoteFirstLock) {
      return remoteFirstLockReason ?? "remote-first-lock";
    }

    if (progressiveFallbackReason) {
      return progressiveFallbackReason;
    }

    if (localTakeoverCooldownMs > 0) {
      return "takeover-cooldown";
    }

    if (connectedPeersCount <= 0) {
      return "data-channel-not-ready";
    }

    if (mediaConnectedPeersCount <= 0) {
      return "media-not-ready";
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
    connectedPeersCount,
    currentProgressiveEngineType,
    currentProgressiveManifest,
    isProgressiveTakeoverReady,
    localTakeoverCooldownMs,
    mediaConnectedPeersCount,
    playback?.status,
    progressiveFallbackReason,
    remoteFirstLock,
    remoteFirstLockReason
  ]);
  const progressiveLocalEligible = progressiveLocalBlockedReason === null;
  const fullLocalBlockedReason = useMemo(() => {
    if (!currentBufferedFullLocalTrack) {
      return "track-not-fully-cached";
    }

    return null;
  }, [
    currentBufferedFullLocalTrack
  ]);
  const fullLocalEligible = fullLocalReady && fullLocalBlockedReason === null;
  const transportGovernorMode = useMemo(
    () =>
      resolveTransportGovernorMode({
        activePlaybackSource,
        mediaConnectedPeersCount,
        connectedPeersCount,
        pendingPlaybackIntent,
        remoteFirstLock,
        remoteFirstLockReason,
        progressiveFallbackReason,
        progressiveLocalEligible
      }),
    [
      activePlaybackSource,
      connectedPeersCount,
      mediaConnectedPeersCount,
      pendingPlaybackIntent,
      progressiveFallbackReason,
      progressiveLocalEligible,
      remoteFirstLock,
      remoteFirstLockReason
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
      localAudioPaused: localAudio.paused,
      localAudioMuted: localAudio.muted,
      localAudioVolume: localAudio.volume,
      localAudioReadyState: localAudio.readyState,
      localAudioCurrentSrc: localAudio.currentSrc || null,
      localAudioHasSrcObject: !!localAudio.srcObject
    };
  }, [audioRef, playbackRevision, activePlaybackSource, playback?.currentTrackId, playback?.status]);
  const shadowWarmupActive =
    enableListenerLocalTakeover &&
    !isCurrentSourceOwner &&
    activePlaybackSource === "remote-stream" &&
    (!!currentBufferedFullLocalTrack ||
      (!!currentProgressiveManifest && currentProgressiveEngineType !== "none"));

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
    return Math.min(maximumAdaptiveStartupBufferMs, nextStartupBufferMs);
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
    if (remoteHoldTimeoutRef.current !== null) {
      window.clearTimeout(remoteHoldTimeoutRef.current);
      remoteHoldTimeoutRef.current = null;
    }
    if (remoteStartupBufferTimerRef.current !== null) {
      window.clearTimeout(remoteStartupBufferTimerRef.current);
      remoteStartupBufferTimerRef.current = null;
    }
    if (playbackStartRetryRef.current !== null) {
      window.clearTimeout(playbackStartRetryRef.current);
      playbackStartRetryRef.current = null;
    }
    remoteStartupReadyAtRef.current = null;
    lastRemoteWaitingAtRef.current = null;
    waitingEventTimestampsRef.current = [];
    stalledEventTimestampsRef.current = [];
    driftSamplesRef.current = [];
    continuousPlaybackStartedAtRef.current = null;
    continuousPlaybackSegmentsRef.current = [];
  }, []);

  useEffect(() => destroyProgressiveRuntime, [destroyProgressiveRuntime]);

  useEffect(() => {
    activeSourceActivatedAtRef.current = Date.now();
  }, [activePlaybackSource, playback?.currentTrackId, playbackRevision]);

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
    remoteStartupReadyAtRef.current = null;
    lastRemoteWaitingAtRef.current = null;
    if (remoteHoldTimeoutRef.current !== null) {
      window.clearTimeout(remoteHoldTimeoutRef.current);
      remoteHoldTimeoutRef.current = null;
    }
    if (remoteStartupBufferTimerRef.current !== null) {
      window.clearTimeout(remoteStartupBufferTimerRef.current);
      remoteStartupBufferTimerRef.current = null;
    }
    waitingEventTimestampsRef.current = [];
    stalledEventTimestampsRef.current = [];
    driftSamplesRef.current = [];
    continuousPlaybackStartedAtRef.current = null;
    continuousPlaybackSegmentsRef.current = [];
    setProgressiveFallbackReason(null);
  }, [playback?.currentTrackId, playback?.mediaEpoch, playbackRevision, setProgressiveFallbackReason]);

  const canExitCurrentSource = useCallback(
    (now = Date.now()) =>
      now - activeSourceActivatedAtRef.current >= getMinimumSourceResidenceMs(activePlaybackSource),
    [activePlaybackSource]
  );

  const armLocalTakeoverCooldown = useCallback(() => {
    localTakeoverCooldownUntilRef.current = Date.now() + getLocalTakeoverCooldownMs();
  }, []);

  const isLocalTakeoverAllowed = useCallback(
    (now = Date.now()) =>
      enableListenerLocalTakeover &&
      connectedPeersCount > 0 &&
      now >= localTakeoverCooldownUntilRef.current &&
      mediaConnectedPeersCount > 0,
    [connectedPeersCount, mediaConnectedPeersCount]
  );
  const audibleLocalFallbackActive =
    !isCurrentSourceOwner &&
    (activePlaybackSource === "progressive-local" || activePlaybackSource === "full-local") &&
    (progressiveFallbackReason === "buffer-underrun" ||
      progressiveFallbackReason === "stalled" ||
      progressiveFallbackReason === "seek-outside-buffer");
  const startupGatePending =
    activePlaybackSource === "remote-stream" &&
    playback?.status === "playing" &&
    (remoteStartupReadyAtRef.current === null ||
      playbackQualityMetrics.waitingEventsLast30s > 0 ||
      playbackQualityMetrics.stalledEventsLast30s > 0);
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

  useEffect(() => {
    if (enableListenerLocalTakeover || isCurrentSourceOwner || activePlaybackSource === "remote-stream") {
      return;
    }

    setActivePlaybackSource("remote-stream");
  }, [activePlaybackSource, isCurrentSourceOwner, setActivePlaybackSource]);

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
      const now = Date.now();

      if (
        nextSource === "remote-stream" &&
        activePlaybackSource !== "remote-stream" &&
        !(options?.force || canExitCurrentSource(now))
      ) {
        return false;
      }

      if (
        nextSource !== "remote-stream" &&
        activePlaybackSource === "remote-stream" &&
        !isLocalTakeoverAllowed(now)
      ) {
        return false;
      }

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
      canExitCurrentSource,
      isLocalTakeoverAllowed,
      setActivePlaybackSource,
      setProgressiveFallbackReason
    ]
  );

  const fallbackToRemoteStream = useCallback(
    (reason: string, options?: { force?: boolean }) => {
      transitionPlaybackSource("remote-stream", {
        fallbackReason: reason,
        force: options?.force,
        armCooldown: activePlaybackSource !== "remote-stream"
      });
    },
    [activePlaybackSource, transitionPlaybackSource]
  );

  const clearPlaybackStartRetry = useCallback(() => {
    if (playbackStartRetryRef.current !== null) {
      window.clearTimeout(playbackStartRetryRef.current);
      playbackStartRetryRef.current = null;
    }
  }, []);

  const clearRemoteStartupBufferTimer = useCallback(() => {
    if (remoteStartupBufferTimerRef.current !== null) {
      window.clearTimeout(remoteStartupBufferTimerRef.current);
      remoteStartupBufferTimerRef.current = null;
    }
  }, []);

  const scheduleRemoteStartupGate = useCallback(() => {
    const remoteAudio = remoteAudioRef.current;
    clearRemoteStartupBufferTimer();

    if (!remoteAudio) {
      return;
    }

    if (activePlaybackSource !== "remote-stream" || playback?.status !== "playing") {
      remoteStartupReadyAtRef.current = null;
      remoteAudio.muted = false;
      return;
    }

    const gateState = resolveRemoteStartupGateState({
      activePlaybackSource,
      playbackStatus: playback?.status,
      readyState: remoteAudio.readyState,
      paused: remoteAudio.paused,
      hasSrcObject: !!remoteAudio.srcObject,
      stableSinceMs: remoteStartupReadyAtRef.current,
      startupBufferMs: effectiveStartupBufferMs,
      lastWaitingAtMs: lastRemoteWaitingAtRef.current
    });

    remoteStartupReadyAtRef.current = gateState.nextStableSinceMs;
    remoteAudio.muted = gateState.shouldMute;

    if (gateState.shouldPoll) {
      remoteStartupBufferTimerRef.current = window.setTimeout(() => {
        scheduleRemoteStartupGate();
      }, remoteStartupGatePollMs);
      return;
    }

    if (!remoteAudio.paused) {
      lastStablePlaybackAtRef.current = new Date().toISOString();
      markContinuousPlaybackStarted();
    }
  }, [
    activePlaybackSource,
    clearRemoteStartupBufferTimer,
    effectiveStartupBufferMs,
    markContinuousPlaybackStarted,
    playback?.status,
    remoteAudioRef
  ]);

  const getLocalPlaybackPositionMs = useCallback(() => {
    if (activePlaybackSource !== "progressive-local") {
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
    [markPlaybackStartFailure, playback, playbackStartIntent, updatePlaybackStartIntent]
  );
  const ensurePlaybackStart = useCallback(
    (source: ProgressivePlaybackSource, attempt = 0) => {
      clearPlaybackStartRetry();

      if (playback?.status !== "playing" || activePlaybackSource !== source) {
        return;
      }

      const isRemoteSource = source === "remote-stream";
      const targetElement = isRemoteSource ? remoteAudioRef.current : audioRef.current;
      const blockedMessage = isRemoteSource
        ? "浏览器阻止了远端音频自动播放，请再次点击播放继续。"
        : "浏览器阻止了本地音频自动播放，请手动点击播放恢复。";
      const failureReason = isRemoteSource
        ? "remote-stream-play-blocked"
        : source === "full-local"
          ? "full-local-play-blocked"
          : "progressive-local-play-blocked";
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
      playback?.status,
      playbackStartIntent,
      remoteAudioRef
    ]
  );

  useEffect(() => {
    if (!playback?.currentTrackId || playback.status !== "playing") {
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
    if (playback?.status !== "playing") {
      clearPlaybackStartRetry();
      clearRemoteStartupBufferTimer();
      remoteStartupReadyAtRef.current = null;
    }
  }, [
    clearPlaybackStartRetry,
    clearRemoteStartupBufferTimer,
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
      remoteAudioRef.current?.pause();
      setPlaybackStartIntent(null);
      setMediaConnectionState("idle");
      return;
    }

    const remoteAudio = remoteAudioRef.current;
    const uploaded = uploadedTracks[playback.currentTrackId];
    const shouldWarmBufferedFullLocal =
      !!uploaded &&
      !isCurrentSourceOwner &&
      !progressiveEngineRef.current &&
      !progressivePcmEngineRef.current;
    const expectedSeconds =
      getEffectivePlaybackPositionMs(playback, currentTrack?.durationMs ?? 0, Date.now()) / 1000;

    if ((activePlaybackSource === "full-local" || forceSourceOwnerLocalPlayback) && uploaded) {
      if (remoteAudio) {
        remoteAudio.pause();
        remoteAudio.srcObject = null;
        remoteAudio.load();
      }

      if (audio.srcObject) {
        audio.srcObject = null;
      }
      if (audio.src !== uploaded.objectUrl) {
        audio.src = uploaded.objectUrl;
        audio.load();
      }
      audio.muted = false;

      syncLocalPlaybackWindow(audio, expectedSeconds, playback.status === "playing", {
        softDriftMs: 90,
        hardDriftMs: 720,
        correctionMode: "audible-local-follow"
      });

      if (playback.status === "playing") {
        ensurePlaybackStart("full-local");
        setMediaConnectionState(isCurrentSourceOwner ? "live" : "buffering");
      }

      if (playback.status === "paused") {
        audio.pause();
        audio.playbackRate = 1;
        setMediaConnectionState("idle");
      }
      return;
    }

    if (activePlaybackSource === "progressive-local") {
      const pcmEngine = progressivePcmEngineRef.current;
      if (pcmEngine) {
        audio.muted = false;
        void pcmEngine
          .syncPlayback(expectedSeconds, playback.status === "playing")
          .then((result) => {
            if (playback.status === "playing" && !result.localReady) {
              fallbackToRemoteStream("buffer-underrun", { force: true });
              markPlaybackStartFailure(
                "progressive-local-buffer-underrun",
                "本地缓冲不足，已回退实时音频。"
              );
              return;
            }

            if (playback.status === "playing" && result.localReady) {
              ensurePlaybackStart("progressive-local");
            }
          })
          .catch(() => {
            fallbackToRemoteStream("progressive-init-failed", { force: true });
            markPlaybackStartFailure(
              "progressive-local-init-failed",
              "本地解码初始化失败，已回退实时音频。"
            );
          });
        return;
      }

      audio.muted = false;
      syncLocalPlaybackWindow(audio, expectedSeconds, playback.status === "playing", {
        softDriftMs: 120,
        hardDriftMs: 900,
        correctionMode: "audible-local-follow"
      });

      if (playback.status === "playing") {
        ensurePlaybackStart("progressive-local");
      } else {
        audio.pause();
        audio.playbackRate = 1;
      }

      return;
    }

    if (activePlaybackSource === "remote-stream" && !forceSourceOwnerLocalPlayback) {
      if (!shadowWarmupActive) {
        audio.pause();
        audio.muted = false;
      }
      if (
        !progressiveEngineRef.current &&
        !progressivePcmEngineRef.current &&
        !shouldWarmBufferedFullLocal
      ) {
        if (audio.srcObject) {
          audio.srcObject = null;
        }
        audio.removeAttribute("src");
        audio.load();
      } else if (shouldWarmBufferedFullLocal && uploaded && audio.src !== uploaded.objectUrl) {
        if (audio.srcObject) {
          audio.srcObject = null;
        }
        audio.src = uploaded.objectUrl;
        audio.load();
      }

      if (shadowWarmupActive) {
        audio.muted = true;
      }

      if (remoteAudio) {
        if (playback.status === "playing") {
          scheduleRemoteStartupGate();
          ensurePlaybackStart("remote-stream");
        } else if (playback.status === "paused") {
          remoteAudio.pause();
          remoteAudio.muted = false;
        }
      }
      return;
    }

    if (playback.status === "paused") {
      audio.pause();
      audio.playbackRate = 1;
    }
  }, [
    audioRef,
    remoteAudioRef,
    playback,
    currentTrack?.durationMs,
    uploadedTracks,
    activePlaybackSource,
    forceSourceOwnerLocalPlayback,
    isCurrentSourceOwner,
    setStatusMessage,
    setMediaConnectionState,
    destroyProgressiveRuntime,
    ensurePlaybackStart,
    fallbackToRemoteStream,
    markPlaybackStartFailure,
    scheduleRemoteStartupGate,
    shadowWarmupActive,
    setPlaybackStartIntent
  ]);

  useEffect(() => {
    const localAudio = audioRef.current;
    const remoteAudio = remoteAudioRef.current;

    const handlePlaying = () => {
      setSchedulerMode("normal");
      setBufferHealth("healthy");
      if (activePlaybackSource === "remote-stream") {
        scheduleRemoteStartupGate();
        setMediaConnectionState((current) =>
          current === "idle" && !roomSnapshot?.room.playback.currentTrackId
            ? current
            : remoteStartupReadyAtRef.current !== null && !remoteAudio?.muted
                ? "live"
                : "buffering"
        );
        return;
      }
      markContinuousPlaybackStarted();
      lastStablePlaybackAtRef.current = new Date().toISOString();
      setMediaConnectionState((current) =>
        current === "idle" && !roomSnapshot?.room.playback.currentTrackId ? current : "live"
      );
    };
    const handleWaiting = () => {
      const now = Date.now();
      markContinuousPlaybackInterrupted(now);
      lastRemoteWaitingAtRef.current = now;
      pushQualityEvent(waitingEventTimestampsRef, now);
      remoteStartupReadyAtRef.current = null;
      clearRemoteStartupBufferTimer();
      setSchedulerMode("conservative");
      setBufferHealth("low");
      if (activePlaybackSource === "remote-stream" && !isCurrentSourceOwner) {
        setProgressiveFallbackReason((current) => current ?? "buffer-underrun");
      }
      if (
        activePlaybackSource === "progressive-local" &&
        progressiveHealthSnapshot.aheadBufferedMs < getCriticalBufferThresholdMs() / 2
      ) {
        fallbackToRemoteStream("buffer-underrun");
      }
      if (
        activePlaybackSource === "full-local" &&
        progressiveHealthSnapshot.aheadBufferedMs < getCriticalBufferThresholdMs() / 2
      ) {
        fallbackToRemoteStream("buffer-underrun");
      }
      setMediaConnectionState((current) => (current === "failed" ? current : "buffering"));
    };
    const handleStalled = () => {
      const now = Date.now();
      markContinuousPlaybackInterrupted(now);
      lastRemoteWaitingAtRef.current = now;
      pushQualityEvent(stalledEventTimestampsRef, now);
      remoteStartupReadyAtRef.current = null;
      clearRemoteStartupBufferTimer();
      setSchedulerMode("conservative");
      setBufferHealth("critical");
      if (activePlaybackSource === "remote-stream" && !isCurrentSourceOwner) {
        setProgressiveFallbackReason("stalled");
      }
      if (activePlaybackSource === "progressive-local" || activePlaybackSource === "full-local") {
        fallbackToRemoteStream("stalled", { force: true });
      }
      setMediaConnectionState((current) => (current === "failed" ? current : "buffering"));
    };
    const handlePause = () => {
      markContinuousPlaybackInterrupted();
      remoteStartupReadyAtRef.current = null;
      clearRemoteStartupBufferTimer();
      if (roomSnapshot?.room.playback.status !== "playing") {
        setSchedulerMode(isPageVisible ? "normal" : "idle");
        setBufferHealth("healthy");
      }
    };
    const handleLocalSeeked = () => {
      if (activePlaybackSource !== "progressive-local" || !localAudio || !currentProgressiveManifest) {
        return;
      }

      const soughtPositionMs = Math.round(localAudio.currentTime * 1000);
      if (soughtPositionMs <= progressiveHealthSnapshot.contiguousBufferedMs) {
        return;
      }

      setSchedulerMode("conservative");
      setBufferHealth("critical");
      fallbackToRemoteStream("seek-outside-buffer", { force: true });
    };

    localAudio?.addEventListener("playing", handlePlaying);
    remoteAudio?.addEventListener("playing", handlePlaying);
    localAudio?.addEventListener("waiting", handleWaiting);
    remoteAudio?.addEventListener("waiting", handleWaiting);
    localAudio?.addEventListener("stalled", handleStalled);
    remoteAudio?.addEventListener("stalled", handleStalled);
    localAudio?.addEventListener("pause", handlePause);
    remoteAudio?.addEventListener("pause", handlePause);
    localAudio?.addEventListener("seeked", handleLocalSeeked);

    return () => {
      localAudio?.removeEventListener("playing", handlePlaying);
      remoteAudio?.removeEventListener("playing", handlePlaying);
      localAudio?.removeEventListener("waiting", handleWaiting);
      remoteAudio?.removeEventListener("waiting", handleWaiting);
      localAudio?.removeEventListener("stalled", handleStalled);
      remoteAudio?.removeEventListener("stalled", handleStalled);
      localAudio?.removeEventListener("pause", handlePause);
      remoteAudio?.removeEventListener("pause", handlePause);
      localAudio?.removeEventListener("seeked", handleLocalSeeked);
    };
  }, [
    activePlaybackSource,
    clearRemoteStartupBufferTimer,
    currentProgressiveManifest,
    isPageVisible,
    isCurrentSourceOwner,
    markContinuousPlaybackInterrupted,
    markContinuousPlaybackStarted,
    pushQualityEvent,
    progressiveHealthSnapshot.contiguousBufferedMs,
    progressiveHealthSnapshot.aheadBufferedMs,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status,
    fallbackToRemoteStream,
    scheduleRemoteStartupGate,
    setBufferHealth,
    setMediaConnectionState,
    setProgressiveFallbackReason,
    setSchedulerMode
  ]);

  useEffect(() => {
    const localAudio = audioRef.current;
    const remoteAudio = remoteAudioRef.current;
    const localReadyEvents: Array<keyof HTMLMediaElementEventMap> = [
      "loadedmetadata",
      "canplay",
      "playing"
    ];
    const remoteReadyEvents: Array<keyof HTMLMediaElementEventMap> = [
      "loadedmetadata",
      "canplay",
      "playing"
    ];
    const handleLocalReady = () => {
      if (activePlaybackSource === "full-local" || activePlaybackSource === "progressive-local") {
        ensurePlaybackStart(activePlaybackSource);
      }
    };
    const handleRemoteReady = () => {
      if (activePlaybackSource === "remote-stream") {
        scheduleRemoteStartupGate();
      }
      ensurePlaybackStart("remote-stream");
    };

    for (const eventName of localReadyEvents) {
      localAudio?.addEventListener(eventName, handleLocalReady);
    }
    for (const eventName of remoteReadyEvents) {
      remoteAudio?.addEventListener(eventName, handleRemoteReady);
    }

    return () => {
      for (const eventName of localReadyEvents) {
        localAudio?.removeEventListener(eventName, handleLocalReady);
      }
      for (const eventName of remoteReadyEvents) {
        remoteAudio?.removeEventListener(eventName, handleRemoteReady);
      }
    };
  }, [activePlaybackSource, audioRef, remoteAudioRef, ensurePlaybackStart, scheduleRemoteStartupGate]);

  useEffect(() => {
    const nextPlayback = roomSnapshot?.room.playback;

    if (!nextPlayback?.currentTrackId) {
      setMediaConnectionState("idle");
      return;
    }

    if (isCurrentSourceOwner) {
      return;
    }

    if (activePlaybackSource !== "remote-stream") {
      setMediaConnectionState(nextPlayback.status === "playing" ? "live" : "idle");
      return;
    }

    if (nextPlayback.status === "paused") {
      setMediaConnectionState((current) => (current === "live" ? "buffering" : current));
      return;
    }

    setMediaConnectionState((current) => {
      if (current === "live" || current === "buffering") {
        return current;
      }

      return mediaConnectedPeersCount > 0 ? "buffering" : "connecting";
    });
  }, [
    roomSnapshot?.room.playback,
    isCurrentSourceOwner,
    mediaConnectedPeersCount,
    activePlaybackSource,
    setMediaConnectionState
  ]);

  useEffect(() => {
    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) {
      return;
    }

    if (activePlaybackSource !== "remote-stream" || playback?.status !== "playing") {
      clearRemoteStartupBufferTimer();
      remoteStartupReadyAtRef.current = null;
      remoteAudio.muted = false;
      return;
    }

    scheduleRemoteStartupGate();

    return () => {
      clearRemoteStartupBufferTimer();
    };
  }, [
    activePlaybackSource,
    clearRemoteStartupBufferTimer,
    playback?.status,
    playback?.currentTrackId,
    remoteAudioRef,
    scheduleRemoteStartupGate
  ]);

  useEffect(() => {
    if (playback?.status !== "playing" || !playback.currentTrackId) {
      return;
    }

    const sampleDrift = () => {
      const expectedSeconds =
        getEffectivePlaybackPositionMs(playback, currentTrack?.durationMs ?? 0, Date.now()) / 1000;
      let observedSeconds: number | null = null;

      if (activePlaybackSource === "remote-stream") {
        const remoteAudio = remoteAudioRef.current;
        if (
          remoteAudio &&
          Number.isFinite(remoteAudio.currentTime) &&
          !remoteAudio.paused &&
          remoteAudio.readyState >= haveCurrentDataReadyState
        ) {
          observedSeconds = remoteAudio.currentTime;
        }
      } else if (activePlaybackSource === "progressive-local") {
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
    recordDriftSample,
    remoteAudioRef
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
        ? new ProgressivePcmEngine(audio, peerId, currentProgressiveManifest)
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
        if (!attached) {
          setProgressiveFallbackReason("progressive-init-failed");
          return;
        }

        return engine.sync();
      })
      .catch(() => {
        setProgressiveFallbackReason("progressive-init-failed");
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
      const shadowWarmupReady =
        activePlaybackSource === "remote-stream" ? isProgressiveTakeoverReady(now) : true;
      let engineReady = false;
      let localReady = false;
      let driftMs = Number.POSITIVE_INFINITY;

      if (pcmEngine) {
        const syncResult = await pcmEngine.syncPlayback(expectedSeconds, true);
        if (cancelled) {
          return;
        }

        engineReady = pcmEngine.engineStatus === "ready";
        localReady = syncResult.localReady;
        driftMs = syncResult.driftMs;
        audio.muted = activePlaybackSource !== "progressive-local";
      } else if (mseEngine) {
        engineReady = mseEngine.engineStatus === "ready";
        localReady = engineReady;

        if (engineReady && (activePlaybackSource === "progressive-local" || shadowWarmupReady)) {
          syncLocalPlaybackWindow(audio, expectedSeconds, true, {
            softDriftMs: 120,
            hardDriftMs: 900,
            correctionMode: "shadow-local-catchup"
          });
          audio.muted = activePlaybackSource !== "progressive-local";
          void roomAudioOutput.playElement(audio);
          driftMs = Math.abs(expectedSeconds * 1000 - audio.currentTime * 1000);
        }
      }

      const shouldAttemptTakeover =
        activePlaybackSource !== "remote-stream" ||
        shouldEnableAudibleLocalFallback({
          activePlaybackSource,
          remoteFirstLock,
          waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
          stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
          localReady,
          driftMs,
          cooldownMs: Math.max(0, localTakeoverCooldownUntilRef.current - now)
        });
      const takeoverBlockedReason = shouldAttemptTakeover ? null : progressiveLocalBlockedReason;

      if (
        !engineReady ||
        !localReady ||
        (activePlaybackSource === "remote-stream" && !shadowWarmupReady)
      ) {
        if (pcmEngine) {
          await pcmEngine.syncPlayback(expectedSeconds, false).catch(() => undefined);
          if (cancelled) {
            return;
          }
        } else {
          audio.pause();
        }
        audio.muted = false;
        progressiveWarmupReadyAtRef.current = null;
        return;
      }

      if (
        !enableDirectProgressiveTakeover ||
        !isLocalTakeoverAllowed(now) ||
        activePlaybackSource !== "remote-stream" ||
        !shouldAttemptTakeover
      ) {
        progressiveWarmupReadyAtRef.current = shadowWarmupReady && localReady ? now : null;
        if (
          progressiveFallbackReason &&
          isLocalTakeoverAllowed(now) &&
          playbackRecoveryStage === "steady"
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
      if (warmupDecision.nextSource !== activePlaybackSource) {
        transitionPlaybackSource(warmupDecision.nextSource, {
          clearFallbackReason: warmupDecision.clearFallbackReason
        });
      } else if (warmupDecision.clearFallbackReason) {
        setProgressiveFallbackReason(null);
      }
    };

    if (playbackState.status !== "playing") {
      if (progressivePcmEngineRef.current) {
        void progressivePcmEngineRef.current.syncPlayback(
          getEffectivePlaybackPositionMs(
            playbackState,
            currentProgressiveManifest.durationMs,
            Date.now()
          ) / 1000,
          false
        );
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
    progressiveLocalBlockedReason,
    isProgressiveTakeoverReady,
    isLocalTakeoverAllowed,
    audioRef,
    playbackQualityMetrics.stalledEventsLast30s,
    playbackQualityMetrics.waitingEventsLast30s,
    playbackRecoveryStage,
    remoteFirstLock,
    progressiveFallbackReason,
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
      !canWarmBufferedFullLocal
    ) {
      fullLocalWarmupReadyAtRef.current = null;
      return;
    }

    const syncWarmup = () => {
      if (playbackState.status !== "playing") {
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
          getRemoteFirstComfortBufferMs(
            currentTrack ?? {
              mimeType: null,
              codec: null
            }
          );

      const shouldAttemptFullLocalFallback = shouldEnableAudibleLocalFallback({
        activePlaybackSource,
        remoteFirstLock,
        waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
        stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
        localReady: readyForFullLocal,
        driftMs,
        cooldownMs: Math.max(0, localTakeoverCooldownUntilRef.current - now)
      });

      if (!isLocalTakeoverAllowed(now) || !shouldAttemptFullLocalFallback) {
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
    activePlaybackSource,
    currentTrack?.durationMs,
    fullLocalBlockedReason,
    progressiveHealthSnapshot.aheadBufferedMs,
    isLocalTakeoverAllowed,
    playbackQualityMetrics.stalledEventsLast30s,
    playbackQualityMetrics.waitingEventsLast30s,
    remoteFirstLock,
    audioRef,
    transitionPlaybackSource
  ]);

  useEffect(() => {
    const playbackState = roomSnapshot?.room.playback;
    if (
      !playbackState?.currentTrackId ||
      !currentBufferedFullLocalTrack ||
      currentProgressiveEngineType === "none" ||
      activePlaybackSource !== "progressive-local"
    ) {
      return;
    }

    if (playbackState.status !== "playing") {
      fullLocalWarmupReadyAtRef.current = null;
      return;
    }

    const comfortBufferMs = getRemoteFirstComfortBufferMs(
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

      if (activePlaybackSource === "progressive-local") {
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
    if (activePlaybackSource !== "progressive-local" && activePlaybackSource !== "full-local") {
      if (remoteHoldTimeoutRef.current !== null) {
        window.clearTimeout(remoteHoldTimeoutRef.current);
        remoteHoldTimeoutRef.current = null;
      }
      return;
    }

    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) {
      return;
    }

    remoteAudio.muted = true;
    if (remoteHoldTimeoutRef.current !== null) {
      window.clearTimeout(remoteHoldTimeoutRef.current);
    }

    const remoteHoldMs = resolveRemoteAudioHoldDurationMs({
      activePlaybackSource,
      remoteFirstLock,
      waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
      shadowWarmupActive,
      playbackRecoveryStage
    });

    remoteHoldTimeoutRef.current = window.setTimeout(() => {
      if (activePlaybackSource === "full-local" && !remoteFirstLock) {
        remoteAudio.pause();
      }
      remoteAudio.muted = false;
      remoteHoldTimeoutRef.current = null;
    }, remoteHoldMs);

    return () => {
      if (remoteHoldTimeoutRef.current !== null) {
        window.clearTimeout(remoteHoldTimeoutRef.current);
        remoteHoldTimeoutRef.current = null;
      }
      remoteAudio.muted = false;
    };
  }, [
    activePlaybackSource,
    playbackQualityMetrics.waitingEventsLast30s,
    playbackRecoveryStage,
    remoteFirstLock,
    roomSnapshot?.room.playback.currentTrackId,
    remoteAudioRef,
    shadowWarmupActive
  ]);

  useEffect(() => {
    if (activePlaybackSource !== "progressive-local") {
      return;
    }

    if (progressiveHealthSnapshot.aheadBufferedMs >= getCriticalBufferThresholdMs()) {
      return;
    }

    fallbackToRemoteStream("seek-outside-buffer");
  }, [
    activePlaybackSource,
    progressiveHealthSnapshot.aheadBufferedMs,
    fallbackToRemoteStream
  ]);

  useEffect(() => {
    if (activePlaybackSource !== "remote-stream") {
      return;
    }

    if (
      !progressiveFallbackReason ||
      playbackRecoveryStage !== "steady" ||
      playbackQualityMetrics.waitingEventsLast30s > 0 ||
      playbackQualityMetrics.stalledEventsLast30s > 0
    ) {
      return;
    }

    setProgressiveFallbackReason(null);
  }, [
    activePlaybackSource,
    playbackQualityMetrics.stalledEventsLast30s,
    playbackQualityMetrics.waitingEventsLast30s,
    playbackRecoveryStage,
    progressiveFallbackReason,
    setProgressiveFallbackReason
  ]);

  useEffect(() => {
    const nextCooldownMs = Math.max(0, localTakeoverCooldownUntilRef.current - Date.now());
    const comfortBufferedMs = getRemoteFirstComfortBufferMs(
      currentTrack ?? {
        mimeType: null,
        codec: null
      }
    );
    const qualityTiers = resolveAudioQualityTier({
      targetAudioBitrateKbps: sourceDiagnostics?.targetAudioBitrateKbps ?? null,
      receiverJitterTargetMs: sourceDiagnostics?.receiverJitterTargetMs ?? null
    });
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
          remoteFirstLock,
          remoteFirstLockReason,
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
          startupBufferMs: effectiveStartupBufferMs,
          comfortBufferedMs,
          averageDriftMs: playbackQualityMetrics.averageDriftMs,
          maxDriftMs: playbackQualityMetrics.maxDriftMs,
          waitingEventsLast30s: playbackQualityMetrics.waitingEventsLast30s,
          stalledEventsLast30s: playbackQualityMetrics.stalledEventsLast30s,
          audioBitrateTier: qualityTiers.audioBitrateTier,
          receiverJitterTier: qualityTiers.receiverJitterTier,
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
    fullLocalReady,
    fullLocalEligible,
    fullLocalBlockedReason,
    localAudioDiagnostics,
    sourceOwnerIdentity,
    progressiveLocalEligible,
    progressiveLocalBlockedReason,
    remoteFirstLock,
    remoteFirstLockReason,
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
    sourceDiagnostics?.receiverJitterTargetMs,
    sourceDiagnostics?.targetAudioBitrateKbps,
    pendingPlaybackIntent,
    playbackStartIntent,
    nextQueueTrackPrefetch,
    localTakeoverCooldownMs,
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
