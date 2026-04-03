"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthSession, RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import { upsertAvailabilityAnnouncement, type AvailabilityState } from "./availability-state";

type UseAvailabilityAnnouncementsOptions = {
  peerId: string;
  socketRef: React.RefObject<RoomSocket | null>;
  activeSessionRef: React.MutableRefObject<AuthSession | null>;
  currentRoomRef: React.MutableRefObject<RoomSnapshot | null>;
  flushDelayMs?: number;
};

export function useAvailabilityAnnouncements({
  peerId,
  socketRef,
  activeSessionRef,
  currentRoomRef,
  flushDelayMs = 90
}: UseAvailabilityAnnouncementsOptions) {
  const pendingAvailabilityRef = useRef(new Map<string, TrackAvailabilityAnnouncement>());
  const queuedAvailabilityRef = useRef<TrackAvailabilityAnnouncement[]>([]);
  const availabilityFlushTimerRef = useRef<number | null>(null);
  const [availabilityByTrack, setAvailabilityByTrack] = useState<AvailabilityState>({});
  const availabilityByTrackRef = useRef<AvailabilityState>({});

  useEffect(() => {
    availabilityByTrackRef.current = availabilityByTrack;
  }, [availabilityByTrack]);

  const flushQueuedAvailability = useCallback(() => {
    if (availabilityFlushTimerRef.current !== null) {
      window.clearTimeout(availabilityFlushTimerRef.current);
      availabilityFlushTimerRef.current = null;
    }

    if (queuedAvailabilityRef.current.length === 0) {
      return;
    }

    const queued = queuedAvailabilityRef.current.splice(0, queuedAvailabilityRef.current.length);
    setAvailabilityByTrack((current) =>
      queued.reduce(
        (state, announcement) => upsertAvailabilityAnnouncement(state, announcement),
        current
      )
    );
  }, []);

  const queueAvailability = useCallback(
    (announcement: TrackAvailabilityAnnouncement) => {
      queuedAvailabilityRef.current.push(announcement);
      if (availabilityFlushTimerRef.current !== null) {
        return;
      }

      availabilityFlushTimerRef.current = window.setTimeout(() => {
        flushQueuedAvailability();
      }, flushDelayMs);
    },
    [flushDelayMs, flushQueuedAvailability]
  );

  const mergeAvailability = useCallback(
    (announcement: TrackAvailabilityAnnouncement) => {
      queueAvailability(announcement);
    },
    [queueAvailability]
  );

  const mergeLocalPieceAvailability = useCallback(
    (trackId: string, chunkIndex: number, totalChunks: number, chunkSize: number) => {
      const session = activeSessionRef.current;
      const room = currentRoomRef.current;

      if (!peerId || !session || !room) {
        return;
      }

      const queuedExisting = [...queuedAvailabilityRef.current]
        .reverse()
        .find(
          (announcement) =>
            announcement.trackId === trackId && announcement.ownerPeerId === peerId
        );
      const existing = availabilityByTrackRef.current[trackId]?.[peerId] ?? queuedExisting;
      const availableChunkSet = new Set(existing?.availableChunks ?? []);
      const nextChunkCountBefore = availableChunkSet.size;
      availableChunkSet.add(chunkIndex);

      if (
        existing &&
        availableChunkSet.size === nextChunkCountBefore &&
        existing.totalChunks >= totalChunks
      ) {
        return;
      }

      queueAvailability({
        roomId: room.room.id,
        trackId,
        ownerPeerId: peerId,
        nickname: session.nickname,
        totalChunks: Math.max(totalChunks, existing?.totalChunks ?? 0),
        chunkSize: existing?.chunkSize ?? chunkSize,
        availableChunks: [...availableChunkSet].sort((left, right) => left - right),
        source: existing?.source ?? "local_cache",
        announcedAt: new Date().toISOString()
      });
    },
    [activeSessionRef, currentRoomRef, peerId, queueAvailability]
  );

  const emitAvailability = useCallback(
    (announcement: TrackAvailabilityAnnouncement) => {
      const socket = socketRef.current;
      const key = `${announcement.trackId}:${announcement.ownerPeerId}`;

      if (!socket || !socket.connected) {
        pendingAvailabilityRef.current.set(key, announcement);
        return;
      }

      socket.emit("piece.availability", announcement);
    },
    [socketRef]
  );

  const flushPendingAvailability = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || pendingAvailabilityRef.current.size === 0) {
      return;
    }

    for (const announcement of pendingAvailabilityRef.current.values()) {
      socket.emit("piece.availability", announcement);
    }

    pendingAvailabilityRef.current.clear();
  }, [socketRef]);

  useEffect(() => {
    return () => {
      if (availabilityFlushTimerRef.current !== null) {
        window.clearTimeout(availabilityFlushTimerRef.current);
      }
    };
  }, []);

  return {
    availabilityByTrack,
    queueAvailability,
    mergeAvailability,
    mergeLocalPieceAvailability,
    emitAvailability,
    flushPendingAvailability
  };
}
