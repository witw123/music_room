"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackAvailabilityAnnouncement } from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import {
  removeAvailabilityAnnouncementsByPeer,
  upsertAvailabilityAnnouncement,
  type AvailabilityState
} from "./availability-state";

type UseAvailabilityAnnouncementsOptions = {
  socketRef: React.RefObject<RoomSocket | null>;
  flushDelayMs?: number;
  emitDelayMs?: number;
};

export function useAvailabilityAnnouncements({
  socketRef,
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

  const resetAvailabilityState = useCallback(() => {
    if (availabilityFlushTimerRef.current !== null) {
      window.clearTimeout(availabilityFlushTimerRef.current);
      availabilityFlushTimerRef.current = null;
    }
    if (availabilityEmitTimerRef.current !== null) {
      window.clearTimeout(availabilityEmitTimerRef.current);
      availabilityEmitTimerRef.current = null;
    }

    queuedAvailabilityRef.current = [];
    pendingAvailabilityRef.current.clear();
    pendingAvailabilityEmitRef.current.clear();
    availabilityByTrackRef.current = {};
    setAvailabilityByTrack({});
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
    emitAvailability,
    flushPendingAvailability,
    clearAvailabilityForPeer,
    resetAvailabilityState
  };
}
