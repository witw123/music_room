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
import { selectCanonicalTrackAvailabilityAnnouncement } from "@/features/p2p";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { enableTrackCaching } from "@/features/cache/cache-policy";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import { syncLocalPlaybackWindow } from "./playback-sync";
import {
  buildProgressiveHealthSnapshot,
  buildProgressiveTrackManifest,
  getCriticalBufferThresholdMs,
  getEffectivePlaybackPositionMs,
  getProgressiveEngineType,
  type ProgressivePlaybackSource,
  type ProgressiveSchedulerPolicy
} from "./progressive-playback";
import { ProgressiveMseEngine } from "./progressive-mse-engine";
import { ProgressivePcmEngine } from "./progressive-pcm-engine";
import { roomAudioOutput } from "./room-audio-output";

export type FullLocalPlaybackTrack = Pick<UploadedTrack, "file" | "objectUrl">;

type UseProgressiveRuntimeInput = {
  audioRef: RefObject<HTMLAudioElement | null>;
  roomSnapshot: RoomSnapshot | null;
  currentTrack: TrackMeta | null;
  peerId: string;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  fullLocalPlaybackTracks: Record<string, FullLocalPlaybackTrack>;
  activePlaybackSource: ProgressivePlaybackSource;
  setActivePlaybackSource: Dispatch<SetStateAction<ProgressivePlaybackSource>>;
  progressiveFallbackReason: string | null;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
  volume: number;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  setStatusMessage: (value: string) => void;
  setSchedulerMode: Dispatch<SetStateAction<"normal" | "conservative" | "idle">>;
  setBufferHealth: Dispatch<SetStateAction<"healthy" | "low" | "critical">>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  mediaConnectedPeersCount?: number;
};

type UseProgressiveRuntimeResult = {
  progressiveSchedulerPolicy: ProgressiveSchedulerPolicy | null;
  transportGovernorMode: "bootstrap" | "segment-catchup" | "local-primary" | "emergency-fallback";
  getLocalPlaybackPositionMs: () => number | null;
  destroyProgressiveRuntime: () => void;
};

const progressiveRuntimeTickIntervalMs = 150;

export function resolvePureCacheBufferHealth(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  startupReady: boolean;
  aheadBufferedMs: number;
  fallbackReason: string | null;
}) {
  if (input.activePlaybackSource === "full-local") {
    return "healthy" as const;
  }

  if (input.fallbackReason || !input.startupReady) {
    return "critical" as const;
  }

  return input.aheadBufferedMs < getCriticalBufferThresholdMs() ? "low" : "healthy";
}

export function resolvePureCacheMediaConnectionState(input: {
  hasTrack: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  startupReady: boolean;
  fallbackReason: string | null;
}) {
  if (!input.hasTrack) {
    return "idle" as const;
  }

  if (input.activePlaybackSource === "full-local") {
    return "live" as const;
  }

  return input.startupReady && !input.fallbackReason ? ("live" as const) : ("buffering" as const);
}

function resolveNextLocalSource(input: {
  currentTrackId: string | null;
  hasFullLocalTrack: boolean;
}) {
  if (!input.currentTrackId) {
    return "progressive-local" satisfies ProgressivePlaybackSource;
  }

  return input.hasFullLocalTrack
    ? ("full-local" satisfies ProgressivePlaybackSource)
    : ("progressive-local" satisfies ProgressivePlaybackSource);
}

export function useProgressiveRuntime(input: UseProgressiveRuntimeInput): UseProgressiveRuntimeResult {
  const progressiveEngineRef = useRef<ProgressiveMseEngine | null>(null);
  const progressivePcmEngineRef = useRef<ProgressivePcmEngine | null>(null);

  const playback = input.roomSnapshot?.room.playback ?? null;
  const currentTrackId = playback?.currentTrackId ?? null;
  const currentBufferedFullLocalTrack =
    currentTrackId ? input.fullLocalPlaybackTracks[currentTrackId] ?? null : null;

  const currentTrackAvailabilityAnnouncement = useMemo(() => {
    if (!currentTrackId) {
      return null;
    }

    return selectCanonicalTrackAvailabilityAnnouncement(
      Object.values(input.availabilityByTrack[currentTrackId] ?? {})
    );
  }, [input.availabilityByTrack, currentTrackId]);

  const currentProgressiveManifest = useMemo(
    () => buildProgressiveTrackManifest(input.currentTrack, currentTrackAvailabilityAnnouncement),
    [currentTrackAvailabilityAnnouncement, input.currentTrack]
  );
  const currentProgressiveEngineType = useMemo(
    () => getProgressiveEngineType(currentProgressiveManifest),
    [currentProgressiveManifest]
  );
  const progressiveHealthSnapshot = useMemo(
    () =>
      buildProgressiveHealthSnapshot({
        playback,
        activeSource: input.activePlaybackSource,
        manifest: currentProgressiveManifest,
        localAvailability: currentTrackAvailabilityAnnouncement,
        fallbackReason: input.progressiveFallbackReason,
        currentPieceDownloadRateKbps: null
      }),
    [
      currentProgressiveManifest,
      currentTrackAvailabilityAnnouncement,
      input.activePlaybackSource,
      input.peerDiagnostics,
      input.peerId,
      input.progressiveFallbackReason,
      playback
    ]
  );
  const progressiveSchedulerPolicy = progressiveHealthSnapshot.schedulerPolicy;

  const destroyProgressiveRuntime = useCallback(() => {
    progressiveEngineRef.current?.destroy();
    progressiveEngineRef.current = null;
    progressivePcmEngineRef.current?.destroy();
    progressivePcmEngineRef.current = null;
  }, []);

  useEffect(() => destroyProgressiveRuntime, [destroyProgressiveRuntime]);

  useEffect(() => {
    const nextSource = resolveNextLocalSource({
      currentTrackId,
      hasFullLocalTrack: !!currentBufferedFullLocalTrack
    });
    input.setActivePlaybackSource((current) => (current === nextSource ? current : nextSource));
  }, [currentBufferedFullLocalTrack, currentTrackId, input.setActivePlaybackSource]);

  useEffect(() => {
    const nextHealth = resolvePureCacheBufferHealth({
      activePlaybackSource: input.activePlaybackSource,
      startupReady: progressiveHealthSnapshot.startupReady,
      aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
      fallbackReason: progressiveHealthSnapshot.fallbackReason
    });
    input.setBufferHealth(nextHealth);
    input.setSchedulerMode(playback?.currentTrackId ? "normal" : "idle");
    input.setMediaConnectionState(
      resolvePureCacheMediaConnectionState({
        hasTrack: !!playback?.currentTrackId,
        activePlaybackSource: input.activePlaybackSource,
        startupReady: progressiveHealthSnapshot.startupReady,
        fallbackReason: progressiveHealthSnapshot.fallbackReason
      })
    );
  }, [
    input.activePlaybackSource,
    input.setBufferHealth,
    input.setMediaConnectionState,
    input.setSchedulerMode,
    playback?.currentTrackId,
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.fallbackReason,
    progressiveHealthSnapshot.startupReady
  ]);

  useEffect(() => {
    if (
      input.activePlaybackSource !== "progressive-local" ||
      progressiveHealthSnapshot.startupReady ||
      !currentTrackId
    ) {
      return;
    }

    input.setProgressiveFallbackReason("startup-buffering");
  }, [
    currentTrackId,
    input.activePlaybackSource,
    input.setProgressiveFallbackReason,
    progressiveHealthSnapshot.startupReady
  ]);

  useEffect(() => {
    if (
      input.progressiveFallbackReason &&
      input.activePlaybackSource === "progressive-local" &&
      progressiveHealthSnapshot.startupReady
    ) {
      input.setProgressiveFallbackReason(null);
    }
  }, [
    input.activePlaybackSource,
    input.progressiveFallbackReason,
    input.setProgressiveFallbackReason,
    progressiveHealthSnapshot.startupReady
  ]);

  useEffect(() => {
    const audio = input.audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = input.volume;
    progressivePcmEngineRef.current?.setVolume(input.volume);
  }, [input.audioRef, input.volume]);

  useEffect(() => {
    const audio = input.audioRef.current;
    if (!audio) {
      return;
    }

    if (input.activePlaybackSource !== "full-local" || !currentBufferedFullLocalTrack || !playback) {
      return;
    }

    destroyProgressiveRuntime();
    if (audio.srcObject) {
      audio.srcObject = null;
    }
    if (audio.src !== currentBufferedFullLocalTrack.objectUrl) {
      audio.src = currentBufferedFullLocalTrack.objectUrl;
      audio.load();
    }

    const sync = () => {
      if (playback.status !== "playing") {
        audio.pause();
        return;
      }

      const expectedSeconds =
        getEffectivePlaybackPositionMs(playback, input.currentTrack?.durationMs ?? 0, Date.now()) /
        1000;
      syncLocalPlaybackWindow(audio, expectedSeconds, true, {
        softDriftMs: 120,
        hardDriftMs: 900,
        correctionMode: "audible-local-follow"
      });
      audio.muted = false;
      void roomAudioOutput.playElement(audio);
    };

    sync();
    const timerId = window.setInterval(sync, progressiveRuntimeTickIntervalMs);
    return () => window.clearInterval(timerId);
  }, [
    currentBufferedFullLocalTrack,
    destroyProgressiveRuntime,
    input.activePlaybackSource,
    input.audioRef,
    input.currentTrack?.durationMs,
    playback
  ]);

  useEffect(() => {
    const audio = input.audioRef.current;
    if (
      !audio ||
      input.activePlaybackSource !== "progressive-local" ||
      !currentProgressiveManifest ||
      !playback ||
      !enableTrackCaching
    ) {
      destroyProgressiveRuntime();
      return;
    }

    const existingEngine =
      currentProgressiveEngineType === "pcm"
        ? progressivePcmEngineRef.current
        : progressiveEngineRef.current;
    if (existingEngine) {
      return;
    }

    progressiveEngineRef.current?.destroy();
    progressiveEngineRef.current = null;
    progressivePcmEngineRef.current?.destroy();
    progressivePcmEngineRef.current = null;

    const engine =
      currentProgressiveEngineType === "pcm"
        ? new ProgressivePcmEngine(audio, input.peerId, currentProgressiveManifest)
        : new ProgressiveMseEngine(audio, input.peerId, currentProgressiveManifest);

    if (engine instanceof ProgressivePcmEngine) {
      progressivePcmEngineRef.current = engine;
      engine.setVolume(input.volume);
    } else {
      progressiveEngineRef.current = engine;
    }

    let disposed = false;
    void engine.attach().then((attached) => {
      if (disposed || !attached) {
        input.setProgressiveFallbackReason("progressive-init-failed");
        return;
      }
      void engine.sync();
    });

    return () => {
      disposed = true;
      if (progressiveEngineRef.current === engine) {
        progressiveEngineRef.current = null;
      }
      if (progressivePcmEngineRef.current === engine) {
        progressivePcmEngineRef.current = null;
      }
      engine.destroy();
    };
  }, [
    currentProgressiveEngineType,
    currentProgressiveManifest,
    destroyProgressiveRuntime,
    input.activePlaybackSource,
    input.audioRef,
    input.peerId,
    input.setProgressiveFallbackReason,
    input.volume,
    playback
  ]);

  useEffect(() => {
    if (!currentProgressiveManifest) {
      return;
    }

    void progressiveEngineRef.current?.sync();
    void progressivePcmEngineRef.current?.sync();
  }, [currentProgressiveManifest, currentTrackAvailabilityAnnouncement?.availableChunks]);

  useEffect(() => {
    const audio = input.audioRef.current;
    if (!audio || input.activePlaybackSource !== "progressive-local" || !playback) {
      return;
    }

    let cancelled = false;
    const sync = async () => {
      if (cancelled) {
        return;
      }

      if (playback.status !== "playing") {
        if (progressivePcmEngineRef.current) {
          await progressivePcmEngineRef.current.syncPlayback(
            getEffectivePlaybackPositionMs(playback, currentProgressiveManifest?.durationMs ?? 0, Date.now()) /
              1000,
            false
          );
        } else {
          audio.pause();
        }
        return;
      }

      const expectedSeconds =
        getEffectivePlaybackPositionMs(playback, currentProgressiveManifest?.durationMs ?? 0, Date.now()) /
        1000;
      const pcmEngine = progressivePcmEngineRef.current;
      if (pcmEngine) {
        const result = await pcmEngine.syncPlayback(expectedSeconds, true);
        if (!result.localReady) {
          input.setProgressiveFallbackReason("startup-buffering");
        }
        return;
      }

      if (progressiveEngineRef.current?.ready) {
        syncLocalPlaybackWindow(audio, expectedSeconds, true, {
          softDriftMs: 120,
          hardDriftMs: 900,
          correctionMode: "audible-local-follow"
        });
        audio.muted = false;
        void roomAudioOutput.playElement(audio);
      }
    };

    void sync();
    const timerId = window.setInterval(() => {
      void sync();
    }, progressiveRuntimeTickIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [
    currentProgressiveManifest?.durationMs,
    input.activePlaybackSource,
    input.audioRef,
    input.setProgressiveFallbackReason,
    playback
  ]);

  useEffect(() => {
    input.recordPeerDiagnostic({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "progressive-status",
      summary: `播放源 ${progressiveHealthSnapshot.activeSource} / 策略 ${progressiveHealthSnapshot.schedulerPolicy}`,
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          ...(
            snapshot.progressivePlaybackStatus ??
            createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
          ),
          activeSource: progressiveHealthSnapshot.activeSource,
          engineType: progressiveHealthSnapshot.engineType,
          contiguousBufferedMs: progressiveHealthSnapshot.contiguousBufferedMs,
          aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
          schedulerPolicy: progressiveHealthSnapshot.schedulerPolicy,
          startupReady: progressiveHealthSnapshot.startupReady,
          fallbackReason: progressiveHealthSnapshot.fallbackReason,
          estimatedFillTimeMs: progressiveHealthSnapshot.estimatedFillTimeMs,
          remainingPlaybackMs: progressiveHealthSnapshot.remainingPlaybackMs
        }
      })
    });
  }, [input.recordPeerDiagnostic, progressiveHealthSnapshot]);

  const getLocalPlaybackPositionMs = useCallback(() => {
    const pcmPosition = progressivePcmEngineRef.current?.getCurrentTimeSeconds();
    if (typeof pcmPosition === "number" && Number.isFinite(pcmPosition)) {
      return Math.max(0, Math.round(pcmPosition * 1000));
    }

    const audio = input.audioRef.current;
    if (audio && Number.isFinite(audio.currentTime) && audio.currentTime >= 0) {
      return Math.round(audio.currentTime * 1000);
    }

    return playback && input.currentTrack
      ? getEffectivePlaybackPositionMs(playback, input.currentTrack.durationMs)
      : null;
  }, [input.audioRef, input.currentTrack, playback]);

  return {
    progressiveSchedulerPolicy,
    transportGovernorMode: "local-primary",
    getLocalPlaybackPositionMs,
    destroyProgressiveRuntime
  };
}
