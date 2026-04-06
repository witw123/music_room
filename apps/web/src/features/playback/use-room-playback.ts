"use client";

import { useEffect, useMemo, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import type { PlaybackSnapshot, TrackMeta } from "@music-room/shared";
import { shouldReplacePlaybackSnapshot } from "@/lib/music-room-ui";
import type { ProgressivePlaybackSource } from "./progressive-playback";

const playbackProgressPollIntervalMs = 120;
const playingProgressCommitThresholdMs = 120;
const idleProgressCommitThresholdMs = 200;
const displayClockIgnoreDriftMs = 120;
const displayClockSmoothDriftMs = 360;
const displayClockHardSnapDriftMs = 720;
const displayClockRoomNudgeFactor = 0.2;
const displayClockTransitionWindowMs = 260;
const displayClockHardSnapSamples = 2;

export type DisplayClockSource = "remote-audible" | "local-audible" | "room-fallback";

type UseRoomPlaybackOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  playback: PlaybackSnapshot | null | undefined;
  tracks: TrackMeta[];
  shouldUseLocalAudio: boolean;
  activePlaybackSource?: ProgressivePlaybackSource;
  getLocalPlaybackPositionMs?: () => number | null;
};

type AudibleClockSample = {
  progressMs: number;
  source: DisplayClockSource;
};

type DisplayClockTransitionState = {
  source: DisplayClockSource;
  anchorDisplayMs: number;
  anchorAudibleMs: number;
  anchorAtMs: number;
  hardDriftSamples: number;
};

function clampProgressMs(progressMs: number, durationMs: number) {
  return durationMs > 0
    ? Math.min(Math.max(0, progressMs), durationMs)
    : Math.max(0, progressMs);
}

export function resolveAudibleClockSample(input: {
  activePlaybackSource?: ProgressivePlaybackSource;
  shouldUseLocalAudio: boolean;
  localAudioCurrentTimeSeconds?: number | null;
  localAudioPaused?: boolean | null;
  remoteAudioCurrentTimeSeconds?: number | null;
  remoteAudioPaused?: boolean | null;
  localPlaybackPositionMs?: number | null;
}): AudibleClockSample | null {
  const shouldReadLocalClock =
    input.activePlaybackSource !== undefined
      ? input.activePlaybackSource !== "remote-stream"
      : input.shouldUseLocalAudio;

  if (shouldReadLocalClock) {
    if (
      typeof input.localPlaybackPositionMs === "number" &&
      Number.isFinite(input.localPlaybackPositionMs)
    ) {
      return {
        progressMs: Math.max(0, Math.round(input.localPlaybackPositionMs)),
        source: "local-audible"
      };
    }

    if (
      typeof input.localAudioCurrentTimeSeconds === "number" &&
      Number.isFinite(input.localAudioCurrentTimeSeconds) &&
      input.localAudioCurrentTimeSeconds >= 0 &&
      input.localAudioPaused === false
    ) {
      return {
        progressMs: Math.floor(input.localAudioCurrentTimeSeconds * 1000),
        source: "local-audible"
      };
    }

    return null;
  }

  if (
    typeof input.remoteAudioCurrentTimeSeconds === "number" &&
    Number.isFinite(input.remoteAudioCurrentTimeSeconds) &&
    input.remoteAudioCurrentTimeSeconds >= 0 &&
    input.remoteAudioPaused === false
  ) {
    return {
      progressMs: Math.floor(input.remoteAudioCurrentTimeSeconds * 1000),
      source: "remote-audible"
    };
  }

  return null;
}

export function resolveDisplayClockProgress(input: {
  audibleClockSample: AudibleClockSample | null;
  roomClockMs: number;
  durationMs: number;
  previousDisplayMs: number;
  previousSource: DisplayClockSource;
  transitionState: DisplayClockTransitionState;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const roomClockMs = clampProgressMs(input.roomClockMs, input.durationMs);

  if (!input.audibleClockSample) {
    return {
      progressMs: roomClockMs,
      source: "room-fallback" as const,
      displayDriftMs: 0,
      transitionState: {
        source: "room-fallback" as const,
        anchorDisplayMs: roomClockMs,
        anchorAudibleMs: roomClockMs,
        anchorAtMs: now,
        hardDriftSamples: 0
      }
    };
  }

  let nextTransitionState = input.transitionState;
  const audibleProgressMs = clampProgressMs(input.audibleClockSample.progressMs, input.durationMs);
  const sourceChanged = input.previousSource !== input.audibleClockSample.source;

  if (sourceChanged) {
    nextTransitionState = {
      source: input.audibleClockSample.source,
      anchorDisplayMs: clampProgressMs(input.previousDisplayMs, input.durationMs),
      anchorAudibleMs: audibleProgressMs,
      anchorAtMs: now,
      hardDriftSamples: 0
    };
  }

  const transitionElapsedMs = Math.max(0, now - nextTransitionState.anchorAtMs);
  const transitionRatio = Math.min(1, transitionElapsedMs / displayClockTransitionWindowMs);
  const anchoredAudibleMs =
    nextTransitionState.anchorDisplayMs +
    (audibleProgressMs - nextTransitionState.anchorAudibleMs);
  let nextProgressMs =
    anchoredAudibleMs + (audibleProgressMs - anchoredAudibleMs) * transitionRatio;
  const roomDriftMs = roomClockMs - nextProgressMs;
  const absoluteRoomDriftMs = Math.abs(roomDriftMs);

  if (absoluteRoomDriftMs < displayClockIgnoreDriftMs) {
    nextTransitionState = {
      ...nextTransitionState,
      hardDriftSamples: 0
    };
  } else if (absoluteRoomDriftMs < displayClockSmoothDriftMs) {
    nextProgressMs += roomDriftMs * displayClockRoomNudgeFactor;
    nextTransitionState = {
      ...nextTransitionState,
      hardDriftSamples: 0
    };
  } else if (absoluteRoomDriftMs >= displayClockHardSnapDriftMs) {
    const hardDriftSamples = nextTransitionState.hardDriftSamples + 1;
    if (hardDriftSamples >= displayClockHardSnapSamples) {
      nextProgressMs = audibleProgressMs;
      nextTransitionState = {
        source: input.audibleClockSample.source,
        anchorDisplayMs: audibleProgressMs,
        anchorAudibleMs: audibleProgressMs,
        anchorAtMs: now,
        hardDriftSamples: 0
      };
    } else {
      nextTransitionState = {
        ...nextTransitionState,
        hardDriftSamples
      };
    }
  }

  const boundedProgressMs = clampProgressMs(Math.round(nextProgressMs), input.durationMs);
  return {
    progressMs: boundedProgressMs,
    source: input.audibleClockSample.source,
    displayDriftMs: Math.round(roomClockMs - boundedProgressMs),
    transitionState: nextTransitionState
  };
}

export function useRoomPlayback(options: UseRoomPlaybackOptions) {
  const {
    audioRef,
    remoteAudioRef,
    playback,
    tracks,
    shouldUseLocalAudio,
    activePlaybackSource,
    getLocalPlaybackPositionMs
  } = options;
  const [progressMs, setProgressMs] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [volume, setVolume] = useState(0.72);
  const [displayClockSource, setDisplayClockSource] = useState<DisplayClockSource>("room-fallback");
  const [displayDriftMs, setDisplayDriftMs] = useState(0);
  const [acceptedPlayback, setAcceptedPlayback] = useState<PlaybackSnapshot | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(
    typeof document === "undefined" ? true : !document.hidden
  );
  const progressPollTimerRef = useRef<number | null>(null);
  const lastCommittedProgressRef = useRef(0);
  const displayClockTransitionRef = useRef<DisplayClockTransitionState>({
    source: "room-fallback",
    anchorDisplayMs: 0,
    anchorAudibleMs: 0,
    anchorAtMs: 0,
    hardDriftSamples: 0
  });

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!playback) {
      setAcceptedPlayback(null);
      return;
    }

    setAcceptedPlayback((current) =>
      shouldReplacePlaybackSnapshot(current, playback) ? playback : current
    );
  }, [playback]);

  const progressTrack = useMemo(() => {
    if (!acceptedPlayback?.currentTrackId) {
      return null;
    }

    return tracks.find((item) => item.id === acceptedPlayback.currentTrackId) ?? null;
  }, [acceptedPlayback?.currentTrackId, tracks]);

  useEffect(() => {
    const localAudio = audioRef.current;
    const remoteAudio = remoteAudioRef.current;

    if (!acceptedPlayback || !progressTrack) {
      setProgressMs(0);
      setDisplayClockSource("room-fallback");
      setDisplayDriftMs(0);
      displayClockTransitionRef.current = {
        source: "room-fallback",
        anchorDisplayMs: 0,
        anchorAudibleMs: 0,
        anchorAtMs: Date.now(),
        hardDriftSamples: 0
      };
      return;
    }

    const commitProgress = (nextProgressMs: number, nextSource: DisplayClockSource, nextDriftMs: number) => {
      const normalizedProgressMs = clampProgressMs(nextProgressMs, progressTrack.durationMs);
      const thresholdMs =
        acceptedPlayback.status === "playing"
          ? playingProgressCommitThresholdMs
          : idleProgressCommitThresholdMs;

      setDisplayClockSource((current) => (current === nextSource ? current : nextSource));
      setDisplayDriftMs((current) => (current === nextDriftMs ? current : nextDriftMs));

      if (
        Math.abs(normalizedProgressMs - lastCommittedProgressRef.current) < thresholdMs &&
        nextSource === displayClockTransitionRef.current.source
      ) {
        return;
      }

      lastCommittedProgressRef.current = normalizedProgressMs;
      setProgressMs(normalizedProgressMs);
    };

    const tick = () => {
      const roomClockMs = getPlaybackEffectivePositionMs(acceptedPlayback, progressTrack.durationMs);
      const audibleClockSample =
        acceptedPlayback.status === "playing"
          ? resolveAudibleClockSample({
              activePlaybackSource,
              shouldUseLocalAudio,
              localAudioCurrentTimeSeconds: localAudio?.currentTime ?? null,
              localAudioPaused: localAudio?.paused ?? null,
              remoteAudioCurrentTimeSeconds: remoteAudio?.currentTime ?? null,
              remoteAudioPaused: remoteAudio?.paused ?? null,
              localPlaybackPositionMs:
                typeof getLocalPlaybackPositionMs === "function" ? getLocalPlaybackPositionMs() : null
            })
          : null;
      const nextDisplayClock = resolveDisplayClockProgress({
        audibleClockSample,
        roomClockMs,
        durationMs: progressTrack.durationMs,
        previousDisplayMs: lastCommittedProgressRef.current,
        previousSource: displayClockTransitionRef.current.source,
        transitionState: displayClockTransitionRef.current,
        now: Date.now()
      });

      displayClockTransitionRef.current = nextDisplayClock.transitionState;

      if (seekDraft === null || nextDisplayClock.source !== "room-fallback") {
        commitProgress(
          nextDisplayClock.progressMs,
          nextDisplayClock.source,
          nextDisplayClock.displayDriftMs
        );
      }
    };

    const pollProgress = () => {
      tick();
      progressPollTimerRef.current = window.setTimeout(
        pollProgress,
        playbackProgressPollIntervalMs
      );
    };

    tick();

    if (acceptedPlayback.status === "playing" && seekDraft === null && isPageVisible) {
      progressPollTimerRef.current = window.setTimeout(
        pollProgress,
        playbackProgressPollIntervalMs
      );
    }

    return () => {
      if (progressPollTimerRef.current !== null) {
        window.clearTimeout(progressPollTimerRef.current);
        progressPollTimerRef.current = null;
      }
    };
  }, [
    audioRef,
    remoteAudioRef,
    acceptedPlayback?.status,
    acceptedPlayback?.currentTrackId,
    acceptedPlayback?.positionMs,
    acceptedPlayback?.startedAt,
    acceptedPlayback?.mediaEpoch,
    progressTrack?.durationMs,
    shouldUseLocalAudio,
    activePlaybackSource,
    getLocalPlaybackPositionMs,
    seekDraft,
    isPageVisible
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = volume;
  }, [audioRef, volume]);

  useEffect(() => {
    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) {
      return;
    }

    remoteAudio.volume = volume;
  }, [remoteAudioRef, volume]);

  function syncProgressFromAudio(event?: SyntheticEvent<HTMLAudioElement>) {
    if (!acceptedPlayback || !progressTrack) {
      return;
    }

    const selectedAudio = shouldUseLocalAudio ? audioRef.current : remoteAudioRef.current;
    const eventAudio = event?.currentTarget ?? null;
    const preferredAudio = eventAudio === selectedAudio ? eventAudio : selectedAudio;
    const localAudio = audioRef.current;
    const remoteAudio = remoteAudioRef.current;
    const audibleClockSample =
      acceptedPlayback.status === "playing"
        ? resolveAudibleClockSample({
            activePlaybackSource,
            shouldUseLocalAudio,
            localAudioCurrentTimeSeconds:
              shouldUseLocalAudio && preferredAudio ? preferredAudio.currentTime : localAudio?.currentTime ?? null,
            localAudioPaused:
              shouldUseLocalAudio && preferredAudio ? preferredAudio.paused : localAudio?.paused ?? null,
            remoteAudioCurrentTimeSeconds:
              !shouldUseLocalAudio && preferredAudio ? preferredAudio.currentTime : remoteAudio?.currentTime ?? null,
            remoteAudioPaused:
              !shouldUseLocalAudio && preferredAudio ? preferredAudio.paused : remoteAudio?.paused ?? null,
            localPlaybackPositionMs:
              typeof getLocalPlaybackPositionMs === "function" ? getLocalPlaybackPositionMs() : null
          })
        : null;
    const nextDisplayClock = resolveDisplayClockProgress({
      audibleClockSample,
      roomClockMs: getPlaybackEffectivePositionMs(acceptedPlayback, progressTrack.durationMs),
      durationMs: progressTrack.durationMs,
      previousDisplayMs: lastCommittedProgressRef.current,
      previousSource: displayClockTransitionRef.current.source,
      transitionState: displayClockTransitionRef.current,
      now: Date.now()
    });
    displayClockTransitionRef.current = nextDisplayClock.transitionState;
    setDisplayClockSource((current) =>
      current === nextDisplayClock.source ? current : nextDisplayClock.source
    );
    setDisplayDriftMs((current) =>
      current === nextDisplayClock.displayDriftMs ? current : nextDisplayClock.displayDriftMs
    );
    if (
      Math.abs(nextDisplayClock.progressMs - lastCommittedProgressRef.current) <
      playingProgressCommitThresholdMs &&
      nextDisplayClock.source === displayClockTransitionRef.current.source
    ) {
      return;
    }
    lastCommittedProgressRef.current = nextDisplayClock.progressMs;
    setProgressMs(nextDisplayClock.progressMs);
  }

  function syncDurationFromAudio(event?: SyntheticEvent<HTMLAudioElement>) {
    if (progressTrack?.durationMs && progressTrack.durationMs > 0) {
      setAudioDurationMs(progressTrack.durationMs);
      return;
    }

    const audio =
      event?.currentTarget ?? (shouldUseLocalAudio ? audioRef.current : remoteAudioRef.current);
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      if (progressTrack?.durationMs) {
        setAudioDurationMs(progressTrack.durationMs);
      }
      return;
    }

    setAudioDurationMs(Math.round(audio.duration * 1000));
  }

  useEffect(() => {
    const trackChanged = progressTrack?.id !== acceptedPlayback?.currentTrackId;
    if (trackChanged) {
      setSeekDraft(null);
    }

    if (seekDraft === null) {
      const nextProgressMs =
        progressTrack && acceptedPlayback
          ? getPlaybackEffectivePositionMs(acceptedPlayback, progressTrack.durationMs)
          : 0;
      setProgressMs(nextProgressMs);
      setDisplayClockSource("room-fallback");
      setDisplayDriftMs(0);
      lastCommittedProgressRef.current = nextProgressMs;
      displayClockTransitionRef.current = {
        source: "room-fallback",
        anchorDisplayMs: nextProgressMs,
        anchorAudibleMs: nextProgressMs,
        anchorAtMs: Date.now(),
        hardDriftSamples: 0
      };
    }
    setAudioDurationMs(progressTrack?.durationMs ?? 0);
  }, [
    progressTrack?.id,
    progressTrack?.durationMs,
    acceptedPlayback,
    seekDraft,
    setSeekDraft
  ]);

  return {
    progressTrack,
    progressMs,
    setProgressMs,
    seekDraft,
    setSeekDraft,
    audioDurationMs,
    setAudioDurationMs,
    volume,
    setVolume,
    displayClockSource,
    displayDriftMs,
    syncProgressFromAudio,
    syncDurationFromAudio
  };
}

export function getPlaybackEffectivePositionMs(
  playback: PlaybackSnapshot | null | undefined,
  durationMs: number,
  now = Date.now()
) {
  if (!playback) {
    return 0;
  }

  if (playback.status !== "playing" || !playback.startedAt) {
    return durationMs > 0 ? Math.min(playback.positionMs, durationMs) : playback.positionMs;
  }

  const elapsed = Math.max(0, now - new Date(playback.startedAt).getTime());
  const nextPositionMs = playback.positionMs + elapsed;
  return durationMs > 0 ? Math.min(nextPositionMs, durationMs) : nextPositionMs;
}
