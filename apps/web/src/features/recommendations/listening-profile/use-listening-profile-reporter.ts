"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ProviderTrackCandidate, TrackMeta } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { ensureListeningAudioFeatures, toListeningTrack } from "./audio-feature-client";

const heartbeatIntervalMs = 15_000;
const maxProgressDeltaMs = 60_000;
export const listeningProfileChangedEvent = "music-room-listening-profile-changed";

type ListeningSession = {
  id: string;
  userId: string;
  track: NonNullable<ReturnType<typeof toListeningTrack>>;
  sourceTrack: TrackMeta;
  occurredAt: string;
  lastProgressMs: number;
  listenedMs: number;
  completed: boolean;
  audioFeatureRequested: boolean;
};

export function useListeningProfileReporter(input: {
  userId: string | null;
  currentTrack: TrackMeta | null;
  isPlaying: boolean;
  progressMs: number;
}) {
  const sessionRef = useRef<ListeningSession | null>(null);
  const isPlayingRef = useRef(input.isPlaying);
  const flushRef = useRef<(settle: boolean) => Promise<void>>(() => Promise.resolve());

  const flush = useCallback(async (settle: boolean) => {
    const session = sessionRef.current;
    if (!session || session.listenedMs < 1_000) return;
    const completed = session.completed;
    const quickSkipped = settle && !completed && session.listenedMs < 30_000;
    try {
      await musicRoomApi.recordListeningProfileEvent({
        id: session.id,
        type: "playback",
        track: session.track,
        listenedMs: Math.round(session.listenedMs),
        completed,
        quickSkipped,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        occurredAt: session.occurredAt
      });
      window.dispatchEvent(new Event(listeningProfileChangedEvent));
      if (completed && !session.audioFeatureRequested) {
        session.audioFeatureRequested = true;
        void ensureListeningAudioFeatures(session.sourceTrack);
      }
    } catch {
      // Listening telemetry must never interrupt playback.
    }
  }, []);
  flushRef.current = flush;

  useEffect(() => {
    const wasPlaying = isPlayingRef.current;
    isPlayingRef.current = input.isPlaying;
    const nextTrack = toListeningTrack(input.currentTrack);
    const session = sessionRef.current;

    if (!input.userId || !nextTrack || !input.currentTrack) {
      if (session) void flush(false);
      sessionRef.current = null;
      return;
    }

    if (!session || session.userId !== input.userId || session.track.key !== nextTrack.key) {
      if (session) void flush(true);
      sessionRef.current = {
        id: createSessionId(),
        userId: input.userId,
        track: nextTrack,
        sourceTrack: input.currentTrack,
        occurredAt: new Date().toISOString(),
        lastProgressMs: Math.max(0, input.progressMs),
        listenedMs: 0,
        completed: false,
        audioFeatureRequested: false
      };
      return;
    }

    if (input.isPlaying) {
      const deltaMs = input.progressMs - session.lastProgressMs;
      if (deltaMs > 0 && deltaMs <= maxProgressDeltaMs) {
        session.listenedMs += deltaMs;
      }
    }
    session.lastProgressMs = Math.max(0, input.progressMs);
    session.completed ||= session.track.durationMs > 0 &&
      session.listenedMs / session.track.durationMs >= 0.7;
    if (wasPlaying && !input.isPlaying) void flush(false);
  }, [flush, input.currentTrack, input.isPlaying, input.progressMs, input.userId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (isPlayingRef.current) void flushRef.current(false);
    }, heartbeatIntervalMs);
    return () => {
      window.clearInterval(intervalId);
      void flushRef.current(false);
    };
  }, []);
}

export function recordListeningFavorite(track: TrackMeta, isFavorite: boolean) {
  const listeningTrack = toListeningTrack(track);
  return recordFavoriteEvent(listeningTrack, isFavorite);
}

export function recordListeningFavoriteCandidate(
  track: ProviderTrackCandidate,
  isFavorite: boolean
) {
  return recordFavoriteEvent({
    key: `${track.provider}:${track.providerTrackId}`,
    provider: track.provider,
    providerTrackId: track.providerTrackId,
    title: track.title.trim() || "未命名歌曲",
    artist: track.artist.trim() || "未知艺人",
    album: track.album?.trim() || null,
    durationMs: Math.max(0, Math.round(track.durationMs)),
    artworkUrl: /^https?:\/\//i.test(track.artworkUrl ?? "") ? track.artworkUrl : null
  }, isFavorite);
}

function recordFavoriteEvent(
  listeningTrack: NonNullable<ReturnType<typeof toListeningTrack>> | null,
  isFavorite: boolean
) {
  if (!listeningTrack) return Promise.resolve();
  return musicRoomApi.recordListeningProfileEvent({
    id: `${isFavorite ? "favorite" : "unfavorite"}:${listeningTrack.key}:${createSessionId()}`,
    type: isFavorite ? "favorite" : "unfavorite",
    track: listeningTrack,
    occurredAt: new Date().toISOString()
  }).then((result) => {
    window.dispatchEvent(new Event(listeningProfileChangedEvent));
    return result;
  });
}

function createSessionId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
