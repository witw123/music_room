"use client";

import { useEffect, useMemo, useState, type RefObject, type SyntheticEvent } from "react";
import type { PlaybackSnapshot, TrackMeta } from "@music-room/shared";
import { shouldAcceptPlaybackSnapshot } from "@/lib/music-room-ui";

type UseRoomPlaybackOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  playback: PlaybackSnapshot | null | undefined;
  tracks: TrackMeta[];
  shouldUseLocalAudio: boolean;
};

export function useRoomPlayback(options: UseRoomPlaybackOptions) {
  const { audioRef, remoteAudioRef, playback, tracks, shouldUseLocalAudio } = options;
  const [progressMs, setProgressMs] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [volume, setVolume] = useState(0.72);
  const [acceptedPlayback, setAcceptedPlayback] = useState<PlaybackSnapshot | null>(null);

  useEffect(() => {
    if (!playback) {
      setAcceptedPlayback(null);
      return;
    }

    setAcceptedPlayback((current) =>
      shouldAcceptPlaybackSnapshot(current, playback) ? playback : current
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

    if (!acceptedPlayback || !progressTrack) {
      setProgressMs(0);
      return;
    }

    const tick = () => {
      if (
        shouldUseLocalAudio &&
        acceptedPlayback.status === "playing" &&
        localAudio &&
        Number.isFinite(localAudio.currentTime) &&
        localAudio.currentTime >= 0 &&
        !localAudio.paused
      ) {
        setProgressMs(Math.min(Math.floor(localAudio.currentTime * 1000), progressTrack.durationMs));
        return;
      }

      if (seekDraft !== null) {
        return;
      }

      setProgressMs(getPlaybackEffectivePositionMs(acceptedPlayback, progressTrack.durationMs));
    };

    tick();
    const timer = window.setInterval(tick, 750);
    return () => window.clearInterval(timer);
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
    seekDraft
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
    if (!shouldUseLocalAudio) {
      return;
    }

    const audio = event?.currentTarget ?? audioRef.current;
    if (!audio || !Number.isFinite(audio.currentTime)) {
      return;
    }

    const nextProgressMs = Math.floor(audio.currentTime * 1000);
    setProgressMs(
      progressTrack?.durationMs && progressTrack.durationMs > 0
        ? Math.min(nextProgressMs, progressTrack.durationMs)
        : nextProgressMs
    );
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
      setProgressMs(
        progressTrack && acceptedPlayback
          ? getPlaybackEffectivePositionMs(acceptedPlayback, progressTrack.durationMs)
          : 0
      );
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
