"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthSession, RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import {
  buildLocalPieceAvailabilityAnnouncement,
  removeAvailabilityAnnouncementsByPeer,
  upsertAvailabilityAnnouncement,
  type AvailabilityState
} from "./availability-state";

type UseAvailabilityAnnouncementsOptions = {
  peerId: string;
  socketRef: React.RefObject<RoomSocket | null>;
  activeSessionRef: React.MutableRefObject<AuthSession | null>;
  currentRoomRef: React.MutableRefObject<RoomSnapshot | null>;
  flushDelayMs?: number;
  emitDelayMs?: number;
};

export function useAvailabilityAnnouncements({
  peerId,
  socketRef,
  activeSessionRef,
  currentRoomRef,
  flushDelayMs = 90,
  emitDelayMs = 140
}: UseAvailabilityAnnouncementsOptions) {
  const pendingAvailabilityRef = useRef(new Map<string, TrackAvailabilityAnnouncement>());
  const pendingAvailabilityEmitRef = useRef(new Map<string, TrackAvailabilityAnnouncement>());
  const queuedAvailabilityRef = useRef<TrackAvailabilityAnnouncement[]>([]);
  const availabilityFlushTimerRef = useRef<number | null>(null);
  const availabilityEmitTimerRef = useRef<number | null>(null);
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

  const flushQueuedAvailabilityEmits = useCallback(() => {
    if (availabilityEmitTimerRef.current !== null) {
      window.clearTimeout(availabilityEmitTimerRef.current);
      availabilityEmitTimerRef.current = null;
    }

    if (pendingAvailabilityEmitRef.current.size === 0) {
      return;
    }

    const socket = socketRef.current;
    for (const [key, announcement] of pendingAvailabilityEmitRef.current.entries()) {
      if (!socket || !socket.connected) {
        pendingAvailabilityRef.current.set(key, announcement);
        continue;
      }

      socket.emit("piece.availability", announcement);
    }

    pendingAvailabilityEmitRef.current.clear();
  }, [socketRef]);

  const scheduleAvailabilityEmit = useCallback(
    (announcement: TrackAvailabilityAnnouncement) => {
      const key = `${announcement.trackId}:${announcement.ownerPeerId}`;
      pendingAvailabilityEmitRef.current.set(key, announcement);
      if (availabilityEmitTimerRef.current !== null) {
        return;
      }

      availabilityEmitTimerRef.current = window.setTimeout(() => {
        flushQueuedAvailabilityEmits();
      }, emitDelayMs);
    },
    [emitDelayMs, flushQueuedAvailabilityEmits]
  );

  const mergeLocalPieceAvailability = useCallback(
    (trackId: string, chunkIndex: number, totalChunks: number, chunkSize: number) => {
      const session = activeSessionRef.current;
      const room = currentRoomRef.current;

      if (!peerId || !session || !room) {
        return;
      }

      const queuedExisting =
        [...queuedAvailabilityRef.current]
          .reverse()
          .find(
            (announcement) =>
              announcement.trackId === trackId && announcement.ownerPeerId === peerId
          ) ??
        [...pendingAvailabilityEmitRef.current.values()]
          .reverse()
          .find(
            (announcement) =>
              announcement.trackId === trackId && announcement.ownerPeerId === peerId
          ) ??
        null;
      const existing = availabilityByTrackRef.current[trackId]?.[peerId] ?? queuedExisting;
      const nextAnnouncement = buildLocalPieceAvailabilityAnnouncement({
        existing,
        roomId: room.room.id,
        trackId,
        ownerPeerId: peerId,
        nickname: session.nickname,
        chunkIndex,
        totalChunks,
        chunkSize
      });

      if (existing === nextAnnouncement) {
        return;
      }

      setAvailabilityByTrack((current) => {
        const next = upsertAvailabilityAnnouncement(current, nextAnnouncement);
        availabilityByTrackRef.current = next;
        return next;
      });
      queueAvailability(nextAnnouncement);
      scheduleAvailabilityEmit(nextAnnouncement);
    },
    [activeSessionRef, currentRoomRef, peerId, queueAvailability, scheduleAvailabilityEmit]
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

  const clearAvailabilityForPeer = useCallback((ownerPeerId: string) => {
    queuedAvailabilityRef.current = queuedAvailabilityRef.current.filter(
      (announcement) => announcement.ownerPeerId !== ownerPeerId
    );

    for (const [key, announcement] of pendingAvailabilityEmitRef.current.entries()) {
      if (announcement.ownerPeerId === ownerPeerId) {
        pendingAvailabilityEmitRef.current.delete(key);
      }
    }

    for (const [key, announcement] of pendingAvailabilityRef.current.entries()) {
      if (announcement.ownerPeerId === ownerPeerId) {
        pendingAvailabilityRef.current.delete(key);
      }
    }

    setAvailabilityByTrack((current) => {
      const next = removeAvailabilityAnnouncementsByPeer(current, ownerPeerId);
      availabilityByTrackRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (availabilityFlushTimerRef.current !== null) {
        window.clearTimeout(availabilityFlushTimerRef.current);
      }
      if (availabilityEmitTimerRef.current !== null) {
        window.clearTimeout(availabilityEmitTimerRef.current);
      }
    };
  }, []);

  return {
    availabilityByTrack,
    queueAvailability,
    mergeAvailability,
    mergeLocalPieceAvailability,
    emitAvailability,
    flushPendingAvailability,
    clearAvailabilityForPeer
  };
}
