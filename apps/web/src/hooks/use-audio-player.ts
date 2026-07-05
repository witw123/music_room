"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "@music-room/shared";

export type UploadedTrack = {
  file: File;
  objectUrl: string;
};


type UseAudioPlayerOptions = {
  roomSnapshot: RoomSnapshot | null;
  uploadedTracks: Record<string, { objectUrl: string }>;
  canControlPlayback: boolean;
  onPlay: () => void;
  onPause: (positionMs: number) => void;
  onSeek: (positionMs: number) => void;
  onEnded: () => void;
};

type UseAudioPlayerReturn = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  progressMs: number;
  seekDraft: number | null;
  audioDurationMs: number;
  volume: number;
  setVolume: (v: number) => void;
  setSeekDraft: (v: number | null) => void;
  syncProgressFromAudio: () => void;
  syncDurationFromAudio: () => void;
  getCurrentTrackObjectUrl: () => string | undefined;
};

export function useAudioPlayer({
  roomSnapshot,
  uploadedTracks
}: UseAudioPlayerOptions): UseAudioPlayerReturn {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [progressMs, setProgressMs] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [volume, setVolume] = useState(0.72);

  // Progress ticker
  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const track = roomSnapshot?.tracks.find((t) => t.id === playback?.currentTrackId);

    if (!playback || !track) {
      setProgressMs(0);
      return;
    }

    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused && Number.isFinite(audio.currentTime)) {
        setProgressMs(Math.floor(audio.currentTime * 1000));
        return;
      }

      if (playback.status !== "playing" || !playback.startedAt) {
        setProgressMs(playback.positionMs);
        return;
      }

      const elapsed = Date.now() - new Date(playback.startedAt).getTime();
      setProgressMs(Math.min(track.durationMs, playback.positionMs + elapsed));
    };

    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [roomSnapshot]);

  // Audio element control: load track, play/pause, seek
  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const audio = audioRef.current;
    if (!audio) return;

    if (!playback?.currentTrackId) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      setAudioDurationMs(0);
      setProgressMs(0);
      return;
    }

    const uploaded = uploadedTracks[playback.currentTrackId];

    if (uploaded && audio.src !== uploaded.objectUrl) {
      audio.src = uploaded.objectUrl;
      audio.load();
    }

    const expectedSeconds = playback.positionMs / 1000;
    if (uploaded && Math.abs(audio.currentTime - expectedSeconds) > 1.2) {
      audio.currentTime = expectedSeconds;
    }

    if (uploaded && playback.status === "playing") {
      void audio.play().catch(() => {
        // Autoplay blocked — UI handles this via status message
      });
    }

    if (playback.status === "paused") {
      audio.pause();
    }
  }, [roomSnapshot?.room.playback, uploadedTracks]);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const syncProgressFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setProgressMs(Math.floor(audio.currentTime * 1000));
  }, []);

  const syncDurationFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioDurationMs(Math.round(audio.duration * 1000));
  }, []);

  const getCurrentTrackObjectUrl = useCallback((): string | undefined => {
    const trackId = roomSnapshot?.room.playback?.currentTrackId;
    if (!trackId) return undefined;
    return uploadedTracks[trackId]?.objectUrl;
  }, [roomSnapshot, uploadedTracks]);

  return {
    audioRef,
    progressMs,
    seekDraft,
    audioDurationMs,
    volume,
    setVolume,
    setSeekDraft,
    syncProgressFromAudio,
    syncDurationFromAudio,
    getCurrentTrackObjectUrl
  };
}
