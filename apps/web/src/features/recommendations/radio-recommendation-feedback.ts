"use client";

import { useEffect, useRef } from "react";
import type { ProviderTrackCandidate, QueueItem, RoomSnapshot, TrackMeta } from "@music-room/shared";
import { providerTrackToRecommendationCandidate, roomTrackToRecommendationCandidate } from "./provider-track-adapter";
import { recordRecommendationFeedback } from "./recommendation-store";
import type { RecommendationCandidate } from "./recommendation-types";

type FavoriteTracksChangedDetail = {
  userId: string;
  track: ProviderTrackCandidate;
  isFavorite: boolean;
};

type PlaybackSession = {
  queueItemId: string;
  mediaEpoch: number;
  candidate: RecommendationCandidate;
  durationMs: number;
  maxProgressMs: number;
  wasPlaying: boolean;
  completed: boolean;
};

type QueueSnapshot = {
  queue: QueueItem[];
  tracks: TrackMeta[];
};

export function useRadioRecommendationFeedback(input: {
  activeUserId: string | null;
  roomSnapshot: RoomSnapshot | null;
  progressMs: number;
  isPlaying: boolean;
}) {
  const previousQueueRef = useRef<QueueSnapshot | null>(null);
  const playbackRef = useRef<PlaybackSession | null>(null);
  const isRadioHost = input.roomSnapshot?.room.roomType === "radio" &&
    input.roomSnapshot.room.hostId === input.activeUserId;
  const roomId = input.roomSnapshot?.room.id ?? null;
  const contextKey = roomId ? `radio:${roomId}` : null;

  useEffect(() => {
    if (!isRadioHost || !input.activeUserId || !input.roomSnapshot || !contextKey) {
      previousQueueRef.current = null;
      return;
    }

    const previous = previousQueueRef.current;
    const current = input.roomSnapshot;
    if (previous) {
      const previousQueueIds = new Set(previous.queue.map((item) => item.id));
      const currentQueueIds = new Set(current.queue.map((item) => item.id));
      const currentTracks = new Map(current.tracks.map((track) => [track.id, track]));
      const previousTracks = new Map(previous.tracks.map((track) => [track.id, track]));

      for (const queueItem of current.queue) {
        if (previousQueueIds.has(queueItem.id) || queueItem.source !== "manual") continue;
        if (queueItem.requestedById !== input.activeUserId) continue;
        const candidate = currentTracks.get(queueItem.trackId);
        const recommendation = candidate ? roomTrackToRecommendationCandidate(candidate) : null;
        if (!recommendation) continue;
        void recordRecommendationFeedback({
          userId: input.activeUserId,
          candidate: recommendation,
          eventType: "manual-selection",
          contextKey,
          dedupeKey: `queue:${queueItem.id}:manual-selection`
        }).catch(() => undefined);
      }

      for (const queueItem of previous.queue) {
        if (currentQueueIds.has(queueItem.id) || queueItem.source !== "autopilot") continue;
        if (queueItem.id === current.room.playback.currentQueueItemId) continue;
        const candidate = previousTracks.get(queueItem.trackId);
        const recommendation = candidate ? roomTrackToRecommendationCandidate(candidate) : null;
        if (!recommendation) continue;
        void recordRecommendationFeedback({
          userId: input.activeUserId,
          candidate: recommendation,
          eventType: "dismissed",
          contextKey,
          dedupeKey: `queue:${queueItem.id}:dismissed`
        }).catch(() => undefined);
      }
    }

    previousQueueRef.current = {
      queue: current.queue,
      tracks: current.tracks
    };
  }, [contextKey, input.activeUserId, input.roomSnapshot, isRadioHost]);

  useEffect(() => {
    const playback = input.roomSnapshot?.room.playback;
    const queueItemId = playback?.currentQueueItemId ?? null;
    const track = playback?.currentTrackId
      ? input.roomSnapshot?.tracks.find((item) => item.id === playback.currentTrackId) ?? null
      : null;
    const candidate = track ? roomTrackToRecommendationCandidate(track) : null;

    if (!isRadioHost || !input.activeUserId || !contextKey || !queueItemId || !candidate || !playback) {
      playbackRef.current = null;
      return;
    }

    const existing = playbackRef.current;
    if (!existing || existing.queueItemId !== queueItemId) {
      if (existing) {
        settlePlaybackSession(existing, input.activeUserId, contextKey);
      }
      playbackRef.current = {
        queueItemId,
        mediaEpoch: playback.mediaEpoch,
        candidate,
        durationMs: Math.max(0, track?.durationMs ?? 0),
        maxProgressMs: Math.max(0, input.progressMs),
        wasPlaying: input.isPlaying,
        completed: false
      };
    } else if (existing.mediaEpoch !== playback.mediaEpoch) {
      existing.mediaEpoch = playback.mediaEpoch;
      existing.maxProgressMs = Math.max(0, input.progressMs);
      existing.wasPlaying = input.isPlaying;
      existing.completed = false;
      existing.candidate = candidate;
      existing.durationMs = Math.max(0, track?.durationMs ?? 0);
    } else {
      existing.maxProgressMs = Math.max(existing.maxProgressMs, input.progressMs);
      existing.wasPlaying ||= input.isPlaying;
    }

    const session = playbackRef.current;
    if (!session || session.completed || !session.wasPlaying || session.durationMs <= 0) return;
    if (session.maxProgressMs / session.durationMs < 0.7) return;
    session.completed = true;
    void recordRecommendationFeedback({
      userId: input.activeUserId,
      candidate: session.candidate,
      eventType: "completion",
      contextKey,
      dedupeKey: `playback:${session.queueItemId}:${session.mediaEpoch}:completion`
    }).catch(() => undefined);
  }, [contextKey, input.activeUserId, input.isPlaying, input.progressMs, input.roomSnapshot, isRadioHost]);

  useEffect(() => {
    if (!isRadioHost || !input.activeUserId || !contextKey) return;
    const handleFavoriteChange = (event: Event) => {
      const detail = (event as CustomEvent<FavoriteTracksChangedDetail>).detail;
      if (!detail?.isFavorite || detail.userId !== input.activeUserId) return;
      void recordRecommendationFeedback({
        userId: input.activeUserId,
        candidate: providerTrackToRecommendationCandidate(detail.track),
        eventType: "favorite",
        contextKey
      }).catch(() => undefined);
    };
    window.addEventListener("music-room-favorite-tracks-changed", handleFavoriteChange);
    return () => window.removeEventListener("music-room-favorite-tracks-changed", handleFavoriteChange);
  }, [contextKey, input.activeUserId, isRadioHost]);
}

export function recordRadioRecommendationUnavailable(input: {
  userId: string;
  roomId: string;
  candidate: ProviderTrackCandidate;
}) {
  return recordRecommendationFeedback({
    userId: input.userId,
    candidate: providerTrackToRecommendationCandidate(input.candidate),
    eventType: "unavailable",
    contextKey: `radio:${input.roomId}`
  });
}

function settlePlaybackSession(session: PlaybackSession, userId: string, contextKey: string) {
  if (session.completed || !session.wasPlaying || session.maxProgressMs >= 30_000) return;
  void recordRecommendationFeedback({
    userId,
    candidate: session.candidate,
    eventType: "quick-skip",
    contextKey,
    dedupeKey: `playback:${session.queueItemId}:${session.mediaEpoch}:quick-skip`
  }).catch(() => undefined);
}
