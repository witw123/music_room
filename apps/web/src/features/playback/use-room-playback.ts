"use client";

import { useEffect, useMemo, useState, type RefObject, type SyntheticEvent } from "react";
import type { PlaybackSnapshot, TrackMeta } from "@music-room/shared";

type UseRoomPlaybackOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  playback: PlaybackSnapshot | null | undefined;
  tracks: TrackMeta[];
  isCurrentSourceOwner: boolean;
};

export function useRoomPlayback(options: UseRoomPlaybackOptions) {
  const { audioRef, remoteAudioRef, playback, tracks, isCurrentSourceOwner } = options;
  const [progressMs, setProgressMs] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [volume, setVolume] = useState(0.72);

  const progressTrack = useMemo(() => {
    if (!playback?.currentTrackId) {
      return null;
    }

    return tracks.find((item) => item.id === playback.currentTrackId) ?? null;
  }, [playback?.currentTrackId, tracks]);

  useEffect(() => {
    const localAudio = audioRef.current;

    if (!playback || !progressTrack) {
      setProgressMs(0);
      return;
    }

    const tick = () => {
      if (isCurrentSourceOwner && localAudio && !localAudio.paused && Number.isFinite(localAudio.currentTime)) {
        setProgressMs(Math.min(Math.floor(localAudio.currentTime * 1000), progressTrack.durationMs));
        return;
      }

      setProgressMs(getPlaybackEffectivePositionMs(playback, progressTrack.durationMs));
    };

    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [
    audioRef,
    remoteAudioRef,
    playback?.status,
    playback?.currentTrackId,
    playback?.positionMs,
    playback?.startedAt,
    playback?.mediaEpoch,
    progressTrack?.durationMs,
    isCurrentSourceOwner
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
    if (!isCurrentSourceOwner) {
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
    const audio = event?.currentTarget ?? audioRef.current;
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
    setAudioDurationMs(progressTrack?.durationMs ?? 0);
  }, [progressTrack?.id, progressTrack?.durationMs, setSeekDraft]);

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
