"use client";

import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { PlaybackSnapshot, RoomMediaConnectionState } from "@music-room/shared";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import {
  getCriticalBufferThresholdMs,
  hasActivePlaybackIntent,
  type ProgressiveHealthSnapshot,
  type ProgressivePlaybackSource,
  type ProgressiveTrackManifest
} from "../progressive-playback";
import {
  resolveMediaElementPlaybackRole,
  resolvePausedPlaybackEventAction,
  resolvePlayingPlaybackEventAction,
  resolveSeekedPlaybackEventAction,
  resolveStalledPlaybackEventAction,
  resolveWaitingPlaybackEventAction
} from "./pipeline";

type LocalAudioEventControllerInput = {
  activePlaybackSource: ProgressivePlaybackSource;
  audioRef: RefObject<HTMLAudioElement | null>;
  currentProgressiveManifest: ProgressiveTrackManifest | null;
  isPageVisible: boolean;
  lastStablePlaybackAtRef: MutableRefObject<string | null>;
  markContinuousPlaybackInterrupted: (timestampMs?: number) => void;
  markContinuousPlaybackStarted: (timestampMs?: number) => void;
  playbackRef: MutableRefObject<PlaybackSnapshot | null | undefined>;
  progressiveHealthSnapshot: ProgressiveHealthSnapshot;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  recordStalledEvent: (timestampMs?: number) => void;
  recordWaitingEvent: (timestampMs?: number) => void;
  setBufferHealth: Dispatch<SetStateAction<"healthy" | "low" | "critical">>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
  setSchedulerMode: Dispatch<SetStateAction<"normal" | "conservative" | "idle">>;
  shadowWarmupActive: boolean;
};

export function useLocalAudioEventController({
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
}: LocalAudioEventControllerInput) {
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
        recordWaitingEvent(now);
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
        recordStalledEvent(now);
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
    lastStablePlaybackAtRef,
    markContinuousPlaybackInterrupted,
    markContinuousPlaybackStarted,
    playbackRef,
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.contiguousBufferedMs,
    recordPeerDiagnostic,
    recordStalledEvent,
    recordWaitingEvent,
    setBufferHealth,
    setMediaConnectionState,
    setProgressiveFallbackReason,
    setSchedulerMode,
    shadowWarmupActive
  ]);
}
