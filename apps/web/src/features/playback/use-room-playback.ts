"use client";

import { useEffect, useMemo, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import type { PlaybackSnapshot, TrackMeta } from "@music-room/shared";
import { shouldReplacePlaybackSnapshot } from "@/lib/music-room-ui";
import type { ProgressivePlaybackSource } from "./progressive-playback";

const playbackProgressPollIntervalMs = 120;
const playingProgressCommitThresholdMs = 80;
const idleProgressCommitThresholdMs = 120;
const displayClockHardSnapDriftMs = 1_500;
const displayClockTransitionWindowMs = 260;
const displayClockHardSnapSamples = 2;
const remoteAudibleAnchorResetDriftMs = 3_500;
const remoteAudibleAnchorBacktrackToleranceSeconds = 0.25;
const monotonicProgressBacktrackToleranceMs = 180;
const audibleClockMissingGraceMs = 1_200;

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

type AudibleClockAnchorState = {
  source: DisplayClockSource;
  sessionKey: string;
  anchorRoomClockMs: number;
  anchorMediaTimeSeconds: number;
};

type DisplayClockTransitionState = {
  source: DisplayClockSource;
  anchorDisplayMs: number;
  anchorAudibleMs: number;
  anchorAtMs: number;
  hardDriftSamples: number;
};

type AudibleClockContinuityState = {
  sample: AudibleClockSample;
  observedAtMs: number;
};

function clampProgressMs(progressMs: number, durationMs: number) {
  return durationMs > 0
    ? Math.min(Math.max(0, progressMs), durationMs)
    : Math.max(0, progressMs);
}

export function resolveAudibleClockSample(input: {
  activePlaybackSource?: ProgressivePlaybackSource;
  shouldUseLocalAudio: boolean;
  playbackSessionKey?: string;
  roomClockMs?: number;
  localAudioCurrentTimeSeconds?: number | null;
  localAudioPaused?: boolean | null;
  remoteAudioCurrentTimeSeconds?: number | null;
  remoteAudioPaused?: boolean | null;
  localPlaybackPositionMs?: number | null;
  previousAnchor?: AudibleClockAnchorState | null;
}): { sample: AudibleClockSample | null; nextAnchor: AudibleClockAnchorState | null } {
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
        sample: {
          progressMs: Math.max(0, Math.round(input.localPlaybackPositionMs)),
          source: "local-audible"
        },
        nextAnchor: null
      };
    }

    if (
      typeof input.localAudioCurrentTimeSeconds === "number" &&
      Number.isFinite(input.localAudioCurrentTimeSeconds) &&
      input.localAudioCurrentTimeSeconds >= 0 &&
      input.localAudioPaused === false
    ) {
      return {
        sample: {
          progressMs: Math.floor(input.localAudioCurrentTimeSeconds * 1000),
          source: "local-audible"
        },
        nextAnchor: null
      };
    }

    return {
      sample: null,
      nextAnchor: null
    };
  }

  if (
    typeof input.remoteAudioCurrentTimeSeconds === "number" &&
    Number.isFinite(input.remoteAudioCurrentTimeSeconds) &&
    input.remoteAudioCurrentTimeSeconds >= 0 &&
    input.remoteAudioPaused === false &&
    typeof input.roomClockMs === "number" &&
    Number.isFinite(input.roomClockMs)
  ) {
    const sessionKey = input.playbackSessionKey ?? "remote-stream";
    const currentMediaTimeSeconds = input.remoteAudioCurrentTimeSeconds;
    const previousAnchor = input.previousAnchor;
    const anchoredProgressMs =
      previousAnchor &&
      previousAnchor.source === "remote-audible" &&
      previousAnchor.sessionKey === sessionKey
        ? previousAnchor.anchorRoomClockMs +
          (currentMediaTimeSeconds - previousAnchor.anchorMediaTimeSeconds) * 1000
        : null;
    const shouldResetAnchor =
      !previousAnchor ||
      previousAnchor.source !== "remote-audible" ||
      previousAnchor.sessionKey !== sessionKey ||
      currentMediaTimeSeconds + remoteAudibleAnchorBacktrackToleranceSeconds <
        previousAnchor.anchorMediaTimeSeconds ||
      anchoredProgressMs === null ||
      Math.abs(anchoredProgressMs - input.roomClockMs) > remoteAudibleAnchorResetDriftMs;
    const nextAnchor = shouldResetAnchor
      ? {
          source: "remote-audible" as const,
          sessionKey,
          anchorRoomClockMs: Math.max(0, Math.round(input.roomClockMs)),
          anchorMediaTimeSeconds: currentMediaTimeSeconds
        }
      : previousAnchor;

    return {
      sample: {
        progressMs: shouldResetAnchor
          ? Math.max(0, Math.round(input.roomClockMs))
          : Math.max(0, Math.round(anchoredProgressMs ?? input.roomClockMs)),
        source: "remote-audible"
      },
      nextAnchor
    };
  }

  return {
    sample: null,
    nextAnchor: null
  };
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

  if (absoluteRoomDriftMs >= displayClockHardSnapDriftMs) {
    const hardDriftSamples = nextTransitionState.hardDriftSamples + 1;
    if (hardDriftSamples >= displayClockHardSnapSamples) {
      nextProgressMs = roomClockMs;
      nextTransitionState = {
        source: input.audibleClockSample.source,
        anchorDisplayMs: roomClockMs,
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
  } else {
    nextTransitionState = {
      ...nextTransitionState,
      hardDriftSamples: 0
    };
  }

  const boundedProgressMs = clampProgressMs(Math.round(nextProgressMs), input.durationMs);
  return {
    progressMs: boundedProgressMs,
    source: input.audibleClockSample.source,
    displayDriftMs: Math.round(roomClockMs - boundedProgressMs),
    transitionState: nextTransitionState
  };
}

export function resolveAudibleClockContinuitySample(input: {
  audibleClockSample: AudibleClockSample | null;
  previousContinuity: AudibleClockContinuityState | null;
  playbackStatus: PlaybackSnapshot["status"] | null | undefined;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  if (input.audibleClockSample) {
    return {
      sample: input.audibleClockSample,
      continuityState: {
        sample: input.audibleClockSample,
        observedAtMs: now
      } satisfies AudibleClockContinuityState
    };
  }

  if (
    input.playbackStatus === "playing" &&
    input.previousContinuity &&
    now - input.previousContinuity.observedAtMs <= audibleClockMissingGraceMs
  ) {
    return {
      sample: {
        source: input.previousContinuity.sample.source,
        progressMs:
          input.previousContinuity.sample.progressMs +
          Math.max(0, now - input.previousContinuity.observedAtMs)
      },
      continuityState: input.previousContinuity
    };
  }

  return {
    sample: null,
    continuityState: null
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
  const lastCommittedSessionKeyRef = useRef("no-playback");
  const audibleClockAnchorRef = useRef<AudibleClockAnchorState | null>(null);
  const audibleClockContinuityRef = useRef<AudibleClockContinuityState | null>(null);
  const displayClockTransitionRef = useRef<DisplayClockTransitionState>({
    source: "room-fallback",
    anchorDisplayMs: 0,
    anchorAudibleMs: 0,
    anchorAtMs: 0,
    hardDriftSamples: 0
  });
  const acceptedPlaybackRef = useRef<PlaybackSnapshot | null>(null);
  acceptedPlaybackRef.current = acceptedPlayback;

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
      lastCommittedSessionKeyRef.current = "no-playback";
      displayClockTransitionRef.current = {
        source: "room-fallback",
        anchorDisplayMs: 0,
        anchorAudibleMs: 0,
        anchorAtMs: Date.now(),
        hardDriftSamples: 0
      };
      audibleClockAnchorRef.current = null;
      audibleClockContinuityRef.current = null;
      return;
    }

    const commitProgress = (
      currentPlayback: PlaybackSnapshot,
      durationMs: number,
      nextProgressMs: number,
      nextSource: DisplayClockSource,
      nextDriftMs: number
    ) => {
      const currentSessionKey = getPlaybackClockSessionKey(currentPlayback);
      let normalizedProgressMs = clampProgressMs(nextProgressMs, durationMs);
      const sameSession = lastCommittedSessionKeyRef.current === currentSessionKey;
      if (
        currentPlayback.status === "playing" &&
        sameSession &&
        nextSource !== "room-fallback" &&
        normalizedProgressMs < lastCommittedProgressRef.current &&
        lastCommittedProgressRef.current - normalizedProgressMs <=
          monotonicProgressBacktrackToleranceMs
      ) {
        normalizedProgressMs = lastCommittedProgressRef.current;
      }
      const thresholdMs =
        currentPlayback.status === "playing"
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
      lastCommittedSessionKeyRef.current = currentSessionKey;
      setProgressMs(normalizedProgressMs);
    };

    const tick = () => {
      const currentPlayback = acceptedPlaybackRef.current;
      if (!currentPlayback || !progressTrack) {
        return;
      }

      const now = Date.now();
      const roomClockMs = getPlaybackEffectivePositionMs(currentPlayback, progressTrack.durationMs, now);
      const remoteAudioBuffering = remoteAudio
        ? (remoteAudio.paused || remoteAudio.readyState < 2)
        : null;
      const audibleClockResolution =
        currentPlayback.status === "playing"
          ? resolveAudibleClockSample({
              activePlaybackSource,
              shouldUseLocalAudio,
              playbackSessionKey: getPlaybackClockSessionKey(currentPlayback),
              roomClockMs,
              localAudioCurrentTimeSeconds: localAudio?.currentTime ?? null,
              localAudioPaused: localAudio?.paused ?? null,
              remoteAudioCurrentTimeSeconds: remoteAudio?.currentTime ?? null,
              remoteAudioPaused: remoteAudioBuffering,
              localPlaybackPositionMs:
                typeof getLocalPlaybackPositionMs === "function" ? getLocalPlaybackPositionMs() : null,
              previousAnchor: audibleClockAnchorRef.current
            })
          : { sample: null, nextAnchor: null };
      audibleClockAnchorRef.current = audibleClockResolution.nextAnchor;
      const continuityResolution = resolveAudibleClockContinuitySample({
        audibleClockSample: audibleClockResolution.sample,
        previousContinuity: audibleClockContinuityRef.current,
        playbackStatus: currentPlayback.status,
        now
      });
      audibleClockContinuityRef.current = continuityResolution.continuityState;
      const nextDisplayClock = resolveDisplayClockProgress({
        audibleClockSample: continuityResolution.sample,
        roomClockMs,
        durationMs: progressTrack.durationMs,
        previousDisplayMs: lastCommittedProgressRef.current,
        previousSource: displayClockTransitionRef.current.source,
        transitionState: displayClockTransitionRef.current,
        now
      });

      displayClockTransitionRef.current = nextDisplayClock.transitionState;

      if (seekDraft === null || nextDisplayClock.source !== "room-fallback") {
        commitProgress(
          currentPlayback,
          progressTrack.durationMs,
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
    const currentPlayback = acceptedPlaybackRef.current;
    if (!currentPlayback || !progressTrack) {
      return;
    }

    const currentSessionKey = getPlaybackClockSessionKey(currentPlayback);
    const selectedAudio = shouldUseLocalAudio ? audioRef.current : remoteAudioRef.current;

    if (
      event?.type === "timeupdate" &&
      event.currentTarget &&
      event.currentTarget !== selectedAudio
    ) {
      return;
    }

    const now = Date.now();
    const eventAudio = event?.currentTarget ?? null;
    const preferredAudio = eventAudio === selectedAudio ? eventAudio : selectedAudio;
    const localAudio = audioRef.current;
    const remoteAudio = remoteAudioRef.current;
    const remoteAudioBuffering = remoteAudio
      ? (remoteAudio.paused || remoteAudio.readyState < 2)
      : null;
    const roomClockMs = getPlaybackEffectivePositionMs(currentPlayback, progressTrack.durationMs, now);
    const audibleClockResolution =
      currentPlayback.status === "playing"
        ? resolveAudibleClockSample({
            activePlaybackSource,
            shouldUseLocalAudio,
            playbackSessionKey: getPlaybackClockSessionKey(currentPlayback),
            roomClockMs,
            localAudioCurrentTimeSeconds:
              shouldUseLocalAudio && preferredAudio ? preferredAudio.currentTime : localAudio?.currentTime ?? null,
            localAudioPaused:
              shouldUseLocalAudio && preferredAudio ? preferredAudio.paused : localAudio?.paused ?? null,
            remoteAudioCurrentTimeSeconds:
              !shouldUseLocalAudio && preferredAudio ? preferredAudio.currentTime : remoteAudio?.currentTime ?? null,
            remoteAudioPaused:
              !shouldUseLocalAudio && preferredAudio
                ? (preferredAudio.paused || preferredAudio.readyState < 2)
                : remoteAudioBuffering,
            localPlaybackPositionMs:
              typeof getLocalPlaybackPositionMs === "function" ? getLocalPlaybackPositionMs() : null,
            previousAnchor: audibleClockAnchorRef.current
          })
        : { sample: null, nextAnchor: null };
    audibleClockAnchorRef.current = audibleClockResolution.nextAnchor;
    const continuityResolution = resolveAudibleClockContinuitySample({
      audibleClockSample: audibleClockResolution.sample,
      previousContinuity: audibleClockContinuityRef.current,
      playbackStatus: currentPlayback.status,
      now
    });
    audibleClockContinuityRef.current = continuityResolution.continuityState;
    const nextDisplayClock = resolveDisplayClockProgress({
      audibleClockSample: continuityResolution.sample,
      roomClockMs,
      durationMs: progressTrack.durationMs,
      previousDisplayMs: lastCommittedProgressRef.current,
      previousSource: displayClockTransitionRef.current.source,
      transitionState: displayClockTransitionRef.current,
      now
    });
    displayClockTransitionRef.current = nextDisplayClock.transitionState;
    setDisplayClockSource((current) =>
      current === nextDisplayClock.source ? current : nextDisplayClock.source
    );
    setDisplayDriftMs((current) =>
      current === nextDisplayClock.displayDriftMs ? current : nextDisplayClock.displayDriftMs
    );
    let nextProgressMs = nextDisplayClock.progressMs;
    const sameSession = lastCommittedSessionKeyRef.current === currentSessionKey;
    if (
      currentPlayback.status === "playing" &&
      sameSession &&
      nextDisplayClock.source !== "room-fallback" &&
      nextProgressMs < lastCommittedProgressRef.current &&
      lastCommittedProgressRef.current - nextProgressMs <=
        monotonicProgressBacktrackToleranceMs
    ) {
      nextProgressMs = lastCommittedProgressRef.current;
    }
    if (
      Math.abs(nextProgressMs - lastCommittedProgressRef.current) <
      playingProgressCommitThresholdMs &&
      nextDisplayClock.source === displayClockTransitionRef.current.source
    ) {
      return;
    }
    lastCommittedProgressRef.current = nextProgressMs;
    lastCommittedSessionKeyRef.current = currentSessionKey;
    setProgressMs(nextProgressMs);
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
    setSeekDraft(null);

    const currentPlayback = acceptedPlaybackRef.current;
    const nextProgressMs =
      progressTrack && currentPlayback
        ? getPlaybackEffectivePositionMs(currentPlayback, progressTrack.durationMs)
        : 0;
    setProgressMs(nextProgressMs);
    setDisplayClockSource("room-fallback");
    setDisplayDriftMs(0);
    lastCommittedProgressRef.current = nextProgressMs;
    lastCommittedSessionKeyRef.current = getPlaybackClockSessionKey(currentPlayback);
    displayClockTransitionRef.current = {
      source: "room-fallback",
      anchorDisplayMs: nextProgressMs,
      anchorAudibleMs: nextProgressMs,
      anchorAtMs: Date.now(),
      hardDriftSamples: 0
    };
    audibleClockAnchorRef.current = null;
    audibleClockContinuityRef.current = null;
    setAudioDurationMs(progressTrack?.durationMs ?? 0);
  }, [
    progressTrack?.id,
    progressTrack?.durationMs,
    acceptedPlayback?.mediaEpoch
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

function getPlaybackClockSessionKey(playback: PlaybackSnapshot | null | undefined) {
  if (!playback) {
    return "no-playback";
  }

  return [
    playback.currentTrackId ?? "none",
    playback.mediaEpoch,
    playback.playbackRevision ?? playback.queueVersion,
    playback.startedAt ?? "stopped",
    playback.status
  ].join("|");
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
