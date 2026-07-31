"use client";

import { useCallback, useEffect, useRef } from "react";
import type { TrackMeta } from "@music-room/shared";
import {
  musicRoomApi,
  type PlaybackHistoryRecord,
  type PlaybackHistoryProvider
} from "@/lib/network/music-room-api";

const heartbeatIntervalMs = 15_000;
const maxProgressDeltaMs = 60_000;

type PlaybackHistoryState = PlaybackHistoryRecord & {
  userId: string;
  key: string;
  lastProgressMs: number;
  pendingMs: number;
};

export function usePlaybackHistoryReporter(input: {
  userId: string | null;
  currentTrack: TrackMeta | null;
  isPlaying: boolean;
  progressMs: number;
}) {
  const stateRef = useRef<PlaybackHistoryState | null>(null);
  const isPlayingRef = useRef(input.isPlaying);
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  const flush = useCallback(async () => {
    const state = stateRef.current;
    if (!state || state.pendingMs < 1_000) {
      return;
    }

    const listenedMs = Math.min(Math.round(state.pendingMs), 120_000);
    state.pendingMs -= listenedMs;
    try {
      await musicRoomApi.recordPlaybackHistory({
        provider: state.provider,
        providerTrackId: state.providerTrackId,
        title: state.title,
        artist: state.artist,
        album: state.album,
        durationMs: state.durationMs,
        listenedMs
      });
    } catch {
      // Playback should never be blocked by a temporary API or database outage.
      state.pendingMs += listenedMs;
    }
  }, []);

  flushRef.current = flush;

  useEffect(() => {
    const wasPlaying = isPlayingRef.current;
    isPlayingRef.current = input.isPlaying;
    const nextTrack = toPlaybackHistoryRecord(input.currentTrack);
    const current = stateRef.current;

    if (!input.userId || !nextTrack) {
      if (current) {
        void flush();
      }
      stateRef.current = null;
      return;
    }

    if (!current || current.userId !== input.userId || current.key !== nextTrack.key) {
      if (current) {
        void flush();
      }
      stateRef.current = {
        ...nextTrack,
        userId: input.userId,
        lastProgressMs: Math.max(0, input.progressMs),
        pendingMs: 0
      };
      return;
    }

    if (input.isPlaying) {
      const deltaMs = input.progressMs - current.lastProgressMs;
      if (deltaMs > 0 && deltaMs <= maxProgressDeltaMs) {
        current.pendingMs += deltaMs;
      }
    }
    current.lastProgressMs = Math.max(0, input.progressMs);
    if (wasPlaying && !input.isPlaying) {
      void flush();
    }
  }, [flush, input.currentTrack, input.isPlaying, input.progressMs, input.userId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (isPlayingRef.current) {
        void flushRef.current?.();
      }
    }, heartbeatIntervalMs);

    return () => {
      window.clearInterval(intervalId);
      void flushRef.current?.();
    };
  }, []);
}

function toPlaybackHistoryRecord(track: TrackMeta | null): (PlaybackHistoryRecord & { key: string }) | null {
  if (!track) {
    return null;
  }

  const provider: PlaybackHistoryProvider = track.sourceRef?.provider ?? track.sourceType;
  const providerTrackId = track.sourceRef?.trackId ?? track.fileHash ?? track.id;
  return {
    key: `${provider}:${providerTrackId}`,
    provider,
    providerTrackId,
    title: track.title || "未命名歌曲",
    artist: track.artist || "未知艺人",
    album: track.album,
    durationMs: Math.max(0, Math.round(track.durationMs)),
    listenedMs: 0
  };
}
