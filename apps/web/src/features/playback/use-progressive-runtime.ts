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
  resolveProgressiveWarmupDecision
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
const remoteAudioHoldMs = 1_200;
const remoteStartupGatePollMs = 120;
const enableDirectProgressiveTakeover = true;
const stableRemoteStartupBufferMs = 220;
const constrainedRemoteStartupBufferMs = 320;
const weakRemoteStartupBufferMs = 420;

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
  const playback = roomSnapshot?.room.playback;
  const playbackRevision = playback?.playbackRevision ?? playback?.queueVersion ?? 0;

  const currentBufferedFullLocalTrack = useMemo(
    () => (currentTrack?.id ? uploadedTracks[currentTrack.id] ?? null : null),
    [currentTrack?.id, uploadedTracks]
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
    !isCurrentSourceOwner &&
    activePlaybackSource !== "full-local" &&
    !!currentProgressiveManifest &&
    canUseProgressivePlayback() &&
    currentProgressiveEngineType !== "none";
  const canWarmBufferedFullLocal =
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
    if (!sourceDiagnostics) {
      return stableRemoteStartupBufferMs;
    }

    const weakLink =
      (typeof sourceDiagnostics.currentRoundTripTimeMs === "number" &&
        sourceDiagnostics.currentRoundTripTimeMs >= 180) ||
      (typeof sourceDiagnostics.packetLossRate === "number" &&
        sourceDiagnostics.packetLossRate >= 6) ||
      (typeof sourceDiagnostics.jitterMs === "number" && sourceDiagnostics.jitterMs >= 30);

    if (weakLink) {
      return weakRemoteStartupBufferMs;
    }

    if (
      sourceDiagnostics.mediaCandidateType === "relay" ||
      sourceDiagnostics.mediaProtocol === "tcp"
    ) {
      return constrainedRemoteStartupBufferMs;
    }

    return stableRemoteStartupBufferMs;
  }, [sourceDiagnostics]);
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
  }, []);

  useEffect(() => destroyProgressiveRuntime, [destroyProgressiveRuntime]);

  useEffect(() => {
    activeSourceActivatedAtRef.current = Date.now();
  }, [activePlaybackSource, playback?.currentTrackId, playbackRevision]);

  useEffect(() => {
    localTakeoverCooldownUntilRef.current = 0;
  }, [playback?.currentTrackId, playbackRevision]);

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
      !remoteFirstLock &&
      connectedPeersCount > 0 &&
      now >= localTakeoverCooldownUntilRef.current &&
      mediaConnectedPeersCount > 0,
    [connectedPeersCount, mediaConnectedPeersCount, remoteFirstLock]
  );

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

    if (remoteAudio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      remoteStartupReadyAtRef.current = null;
      remoteAudio.muted = true;
      remoteStartupBufferTimerRef.current = window.setTimeout(() => {
        scheduleRemoteStartupGate();
      }, remoteStartupGatePollMs);
      return;
    }

    const readyAt = remoteStartupReadyAtRef.current ?? Date.now();
    remoteStartupReadyAtRef.current = readyAt;
    const elapsedMs = Date.now() - readyAt;

    if (elapsedMs >= startupBufferMs) {
      remoteAudio.muted = false;
      lastStablePlaybackAtRef.current = new Date().toISOString();
      return;
    }

    remoteAudio.muted = true;
    remoteStartupBufferTimerRef.current = window.setTimeout(() => {
      scheduleRemoteStartupGate();
    }, startupBufferMs - elapsedMs);
  }, [
    activePlaybackSource,
    clearRemoteStartupBufferTimer,
    playback?.status,
    remoteAudioRef,
    startupBufferMs
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

    if (activePlaybackSource === "full-local" && uploaded) {
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
        correctionMode: isCurrentSourceOwner ? "muted-warmup" : "seek-only"
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
        correctionMode: "seek-only"
      });

      if (playback.status === "playing") {
        ensurePlaybackStart("progressive-local");
      } else {
        audio.pause();
        audio.playbackRate = 1;
      }

      return;
    }

    if (activePlaybackSource === "remote-stream") {
      if (!shouldWarmBufferedFullLocal) {
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
    isCurrentSourceOwner,
    setStatusMessage,
    setMediaConnectionState,
    destroyProgressiveRuntime,
    ensurePlaybackStart,
    fallbackToRemoteStream,
    markPlaybackStartFailure,
    scheduleRemoteStartupGate,
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
          current === "idle" && !roomSnapshot?.room.playback.currentTrackId ? current : "buffering"
        );
        return;
      }
      lastStablePlaybackAtRef.current = new Date().toISOString();
      setMediaConnectionState((current) =>
        current === "idle" && !roomSnapshot?.room.playback.currentTrackId ? current : "live"
      );
    };
    const handleWaiting = () => {
      remoteStartupReadyAtRef.current = null;
      clearRemoteStartupBufferTimer();
      setSchedulerMode("conservative");
      setBufferHealth("low");
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
      remoteStartupReadyAtRef.current = null;
      clearRemoteStartupBufferTimer();
      setSchedulerMode("conservative");
      setBufferHealth("critical");
      if (activePlaybackSource === "progressive-local" || activePlaybackSource === "full-local") {
        fallbackToRemoteStream("stalled", { force: true });
      }
      setMediaConnectionState((current) => (current === "failed" ? current : "buffering"));
    };
    const handlePause = () => {
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
    progressiveHealthSnapshot.contiguousBufferedMs,
    progressiveHealthSnapshot.aheadBufferedMs,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status,
    fallbackToRemoteStream,
    scheduleRemoteStartupGate,
    setBufferHealth,
    setMediaConnectionState,
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
      const activationReady =
        progressiveLocalBlockedReason === null &&
        (activePlaybackSource === "remote-stream" ? isProgressiveTakeoverReady(now) : true);
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

        if (engineReady && (activePlaybackSource === "progressive-local" || activationReady)) {
          syncLocalPlaybackWindow(audio, expectedSeconds, true, {
            softDriftMs: 120,
            hardDriftMs: 900,
            correctionMode: "muted-warmup"
          });
          audio.muted = activePlaybackSource !== "progressive-local";
          void roomAudioOutput.playElement(audio);
          driftMs = Math.abs(expectedSeconds * 1000 - audio.currentTime * 1000);
        }
      }

      if (
        !engineReady ||
        !localReady ||
        (activePlaybackSource === "remote-stream" && !activationReady)
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
        activePlaybackSource !== "remote-stream"
      ) {
        progressiveWarmupReadyAtRef.current = activationReady && localReady ? now : null;
        if (progressiveFallbackReason && isLocalTakeoverAllowed(now)) {
          setProgressiveFallbackReason(null);
        }
        return;
      }

      const warmupDecision = resolveProgressiveWarmupDecision({
        currentSource: activePlaybackSource,
        engineReady: localReady,
        activationReady,
        fallbackReason: progressiveLocalBlockedReason,
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
        correctionMode: "muted-warmup"
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

      if (!isLocalTakeoverAllowed(now)) {
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

    remoteHoldTimeoutRef.current = window.setTimeout(() => {
      if (activePlaybackSource === "full-local" && !remoteFirstLock) {
        remoteAudio.pause();
      }
      remoteAudio.muted = false;
      remoteHoldTimeoutRef.current = null;
    }, remoteAudioHoldMs);

    return () => {
      if (remoteHoldTimeoutRef.current !== null) {
        window.clearTimeout(remoteHoldTimeoutRef.current);
        remoteHoldTimeoutRef.current = null;
      }
      remoteAudio.muted = false;
    };
  }, [activePlaybackSource, remoteFirstLock, roomSnapshot?.room.playback.currentTrackId, remoteAudioRef]);

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
      remoteFirstLock ||
      !isLocalTakeoverAllowed() ||
      !isProgressiveTakeoverReady()
    ) {
      return;
    }

    setProgressiveFallbackReason(null);
  }, [
    activePlaybackSource,
    progressiveFallbackReason,
    isProgressiveTakeoverReady,
    isLocalTakeoverAllowed,
    remoteFirstLock,
    setProgressiveFallbackReason
  ]);

  useEffect(() => {
    const nextCooldownMs = Math.max(0, localTakeoverCooldownUntilRef.current - Date.now());
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
          startupBufferMs,
          lastStablePlaybackAt: lastStablePlaybackAtRef.current
        }
      })
    });
  }, [
    bufferSafetyMarginMs,
    fullLocalReady,
    fullLocalEligible,
    fullLocalBlockedReason,
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
    startupBufferMs,
    pendingPlaybackIntent,
    playbackStartIntent,
    nextQueueTrackPrefetch,
    localTakeoverCooldownMs,
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
