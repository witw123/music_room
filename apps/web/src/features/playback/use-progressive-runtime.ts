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
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackAvailabilityAnnouncement,
  TrackMeta
} from "@music-room/shared";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { syncLocalPlaybackWindow } from "./playback-sync";
import {
  buildProgressiveHealthSnapshot,
  buildProgressiveTrackManifest,
  canUseProgressivePlayback,
  getCriticalBufferThresholdMs,
  getEffectivePlaybackPositionMs,
  getProgressiveEngineType,
  isTakeoverReady,
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
  mediaConnectedPeersCount: number;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  setStatusMessage: (value: string) => void;
  setSchedulerMode: Dispatch<SetStateAction<"normal" | "conservative" | "idle">>;
  setBufferHealth: Dispatch<SetStateAction<"healthy" | "low" | "critical">>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
};

type UseProgressiveRuntimeResult = {
  progressiveSchedulerPolicy:
    | "startup"
    | "steady"
    | "catchup"
    | "pause-fill"
    | "background"
    | null;
  getLocalPlaybackPositionMs: () => number | null;
  destroyProgressiveRuntime: () => void;
};

const progressiveRuntimeTickIntervalMs = 1_000;
const progressiveSwitchDelayMs = 900;
const fullLocalSwitchDelayMs = 700;
const fullLocalMaxDriftMs = 220;
const playbackStartRetryDelayMs = 500;
const maxPlaybackStartRetryAttempts = 6;

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
  mediaConnectedPeersCount,
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
  const playbackStartRetryRef = useRef<number | null>(null);
  const playback = roomSnapshot?.room.playback;

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
  const progressiveHealthSnapshot = useMemo(
    () =>
      buildProgressiveHealthSnapshot({
        playback,
        activeSource: activePlaybackSource,
        manifest: currentProgressiveManifest,
        localAvailability: currentTrackAvailabilityAnnouncement,
        fallbackReason: progressiveFallbackReason
      }),
    [
      playback,
      activePlaybackSource,
      currentProgressiveManifest,
      currentTrackAvailabilityAnnouncement,
      progressiveFallbackReason
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
    activePlaybackSource !== "progressive-local" &&
    !!currentBufferedFullLocalTrack &&
    currentProgressiveEngineType === "none";
  const pendingPlaybackIntent = isPlaybackStartIntentPending(playbackStartIntent);
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
    if (playbackStartRetryRef.current !== null) {
      window.clearTimeout(playbackStartRetryRef.current);
      playbackStartRetryRef.current = null;
    }
  }, []);

  useEffect(() => destroyProgressiveRuntime, [destroyProgressiveRuntime]);

  const clearPlaybackStartRetry = useCallback(() => {
    if (playbackStartRetryRef.current !== null) {
      window.clearTimeout(playbackStartRetryRef.current);
      playbackStartRetryRef.current = null;
    }
  }, []);

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
    }
  }, [clearPlaybackStartRetry, playback?.status, playback?.currentTrackId, playback?.mediaEpoch]);

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
        allowRateCorrection: !isCurrentSourceOwner
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
              setProgressiveFallbackReason("buffer-underrun");
              setActivePlaybackSource("remote-stream");
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
            setProgressiveFallbackReason("progressive-init-failed");
            setActivePlaybackSource("remote-stream");
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
        hardDriftMs: 900
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
        remoteAudio.muted = false;
        if (playback.status === "playing") {
          ensurePlaybackStart("remote-stream");
        } else if (playback.status === "paused") {
          remoteAudio.pause();
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
    setProgressiveFallbackReason,
    setActivePlaybackSource,
    destroyProgressiveRuntime,
    ensurePlaybackStart,
    markPlaybackStartFailure,
    setPlaybackStartIntent
  ]);

  useEffect(() => {
    const localAudio = audioRef.current;
    const remoteAudio = remoteAudioRef.current;

    const handlePlaying = () => {
      setSchedulerMode("normal");
      setBufferHealth("healthy");
      setMediaConnectionState((current) =>
        current === "idle" && !roomSnapshot?.room.playback.currentTrackId ? current : "live"
      );
    };
    const handleWaiting = () => {
      setSchedulerMode("conservative");
      setBufferHealth("low");
      if (activePlaybackSource === "progressive-local") {
        setProgressiveFallbackReason("buffer-underrun");
        setActivePlaybackSource("remote-stream");
      }
      setMediaConnectionState((current) => (current === "failed" ? current : "buffering"));
    };
    const handleStalled = () => {
      setSchedulerMode("conservative");
      setBufferHealth("critical");
      if (activePlaybackSource === "progressive-local") {
        setProgressiveFallbackReason("stalled");
        setActivePlaybackSource("remote-stream");
      }
      setMediaConnectionState((current) => (current === "failed" ? current : "buffering"));
    };
    const handlePause = () => {
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
      setProgressiveFallbackReason("seek-outside-buffer");
      setActivePlaybackSource("remote-stream");
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
    currentProgressiveManifest,
    isPageVisible,
    progressiveHealthSnapshot.contiguousBufferedMs,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status,
    setBufferHealth,
    setMediaConnectionState,
    setProgressiveFallbackReason,
    setActivePlaybackSource,
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
  }, [activePlaybackSource, audioRef, remoteAudioRef, ensurePlaybackStart]);

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
          setActivePlaybackSource("remote-stream");
          return;
        }

        return engine.sync();
      })
      .catch(() => {
        setProgressiveFallbackReason("progressive-init-failed");
        setActivePlaybackSource("remote-stream");
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
    setProgressiveFallbackReason,
    setActivePlaybackSource
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
      const activationReady =
        progressiveHealthSnapshot.fallbackReason === null &&
        (activePlaybackSource === "remote-stream" ? isProgressiveTakeoverReady() : true);
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
            hardDriftMs: 900
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

      const warmupDecision = resolveProgressiveWarmupDecision({
        currentSource: activePlaybackSource,
        engineReady: localReady,
        activationReady,
        fallbackReason: progressiveHealthSnapshot.fallbackReason,
        driftMs,
        warmupReadyAt: progressiveWarmupReadyAtRef.current,
        now: Date.now(),
        switchDelayMs: progressiveSwitchDelayMs
      });
      progressiveWarmupReadyAtRef.current = warmupDecision.nextWarmupReadyAt;
      if (warmupDecision.clearFallbackReason) {
        setProgressiveFallbackReason(null);
      }
      if (warmupDecision.nextSource !== activePlaybackSource) {
        setActivePlaybackSource(warmupDecision.nextSource);
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
    progressiveHealthSnapshot.fallbackReason,
    isProgressiveTakeoverReady,
    audioRef,
    setActivePlaybackSource,
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
        hardDriftMs: 900
      });
      audio.muted = true;
      void roomAudioOutput.playElement(audio);

      const localReady = audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const driftMs = Math.abs(expectedSeconds * 1000 - audio.currentTime * 1000);
      const warmupDecision = resolveFullLocalWarmupDecision({
        currentSource: activePlaybackSource,
        localReady,
        driftMs,
        warmupReadyAt: fullLocalWarmupReadyAtRef.current,
        now: Date.now(),
        switchDelayMs: fullLocalSwitchDelayMs,
        maxDriftMs: fullLocalMaxDriftMs
      });
      fullLocalWarmupReadyAtRef.current = warmupDecision.nextWarmupReadyAt;
      if (warmupDecision.nextSource !== activePlaybackSource) {
        setActivePlaybackSource(warmupDecision.nextSource);
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
    audioRef,
    setActivePlaybackSource
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
      remoteAudio.pause();
      remoteAudio.muted = false;
      remoteHoldTimeoutRef.current = null;
    }, 1_000);

    return () => {
      if (remoteHoldTimeoutRef.current !== null) {
        window.clearTimeout(remoteHoldTimeoutRef.current);
        remoteHoldTimeoutRef.current = null;
      }
      remoteAudio.muted = false;
    };
  }, [activePlaybackSource, roomSnapshot?.room.playback.currentTrackId, remoteAudioRef]);

  useEffect(() => {
    if (activePlaybackSource !== "progressive-local") {
      return;
    }

    if (progressiveHealthSnapshot.aheadBufferedMs >= getCriticalBufferThresholdMs()) {
      return;
    }

    setProgressiveFallbackReason("seek-outside-buffer");
    setActivePlaybackSource("remote-stream");
  }, [
    activePlaybackSource,
    progressiveHealthSnapshot.aheadBufferedMs,
    setProgressiveFallbackReason,
    setActivePlaybackSource
  ]);

  useEffect(() => {
    if (activePlaybackSource !== "remote-stream") {
      return;
    }

    if (!progressiveFallbackReason || !isProgressiveTakeoverReady()) {
      return;
    }

    setProgressiveFallbackReason(null);
  }, [
    activePlaybackSource,
    progressiveFallbackReason,
    isProgressiveTakeoverReady,
    setProgressiveFallbackReason
  ]);

  useEffect(() => {
    recordPeerDiagnostic({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "progressive-status",
      summary: `播放源 ${progressiveHealthSnapshot.activeSource} / 策略 ${progressiveHealthSnapshot.schedulerPolicy}`,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          activeSource: progressiveHealthSnapshot.activeSource,
          engineType: progressiveHealthSnapshot.engineType,
          contiguousBufferedMs: progressiveHealthSnapshot.contiguousBufferedMs,
          aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
          schedulerPolicy: progressiveHealthSnapshot.schedulerPolicy,
          startupReady: progressiveHealthSnapshot.startupReady,
          fallbackReason: progressiveHealthSnapshot.fallbackReason,
          pendingPlaybackIntent: pendingPlaybackIntent
            ? getPlaybackStartIntentLabel(playbackStartIntent)
            : null,
          intentMatchedSource: playbackStartIntent?.matchedSource ?? null,
          lastPlayStartFailure: playbackStartIntent?.lastFailure ?? null,
          nextQueueTrackPrefetch
        }
      })
    });
  }, [
    progressiveHealthSnapshot.activeSource,
    progressiveHealthSnapshot.engineType,
    progressiveHealthSnapshot.contiguousBufferedMs,
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.schedulerPolicy,
    progressiveHealthSnapshot.startupReady,
    progressiveHealthSnapshot.fallbackReason,
    pendingPlaybackIntent,
    playbackStartIntent,
    nextQueueTrackPrefetch,
    recordPeerDiagnostic
  ]);

  return {
    progressiveSchedulerPolicy,
    getLocalPlaybackPositionMs,
    destroyProgressiveRuntime
  };
}
