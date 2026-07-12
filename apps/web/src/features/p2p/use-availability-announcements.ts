"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  compactTrackAvailabilityAnnouncement,
  type TrackAvailabilityAnnouncement
} from "@music-room/shared";
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

type AvailabilityEmitSocket = Pick<RoomSocket, "connected" | "emit"> | null | undefined;

export function getAvailabilityAnnouncementKey(announcement: TrackAvailabilityAnnouncement) {
  return `${announcement.trackId}:${announcement.ownerPeerId}`;
}

export function queueAvailabilityEmit(
  pendingEmit: Map<string, TrackAvailabilityAnnouncement>,
  announcement: TrackAvailabilityAnnouncement
) {
  pendingEmit.set(getAvailabilityAnnouncementKey(announcement), announcement);
}

export function flushAvailabilityEmitQueue(input: {
  pendingEmit: Map<string, TrackAvailabilityAnnouncement>;
  pendingDisconnected: Map<string, TrackAvailabilityAnnouncement>;
  socket: AvailabilityEmitSocket;
}) {
  if (input.pendingEmit.size === 0) {
    return;
  }

  for (const [key, announcement] of input.pendingEmit.entries()) {
    if (!input.socket?.connected) {
      input.pendingDisconnected.set(key, announcement);
      continue;
    }

    input.socket.emit(
      "piece.availability",
      compactTrackAvailabilityAnnouncement(announcement)
    );
  }

  input.pendingEmit.clear();
}

export function useAvailabilityAnnouncements({
  socketRef,
  flushDelayMs = 30,
  emitDelayMs = 60
}: UseAvailabilityAnnouncementsOptions) {
  const pendingAvailabilityRef = useRef(new Map<string, TrackAvailabilityAnnouncement>());
  const pendingAvailabilityEmitRef = useRef(new Map<string, TrackAvailabilityAnnouncement>());
  const queuedAvailabilityRef = useRef(new Map<string, TrackAvailabilityAnnouncement>());
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

    if (queuedAvailabilityRef.current.size === 0) {
      return;
    }

    const queued = [...queuedAvailabilityRef.current.values()];
    queuedAvailabilityRef.current.clear();
    setAvailabilityByTrack((current) =>
      queued.reduce(
        (state, announcement) => upsertAvailabilityAnnouncement(state, announcement),
        current
      )
    );
  }, []);

  const queueAvailability = useCallback(
    (announcement: TrackAvailabilityAnnouncement) => {
      queueAvailabilityEmit(queuedAvailabilityRef.current, announcement);
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

    flushAvailabilityEmitQueue({
      pendingEmit: pendingAvailabilityEmitRef.current,
      pendingDisconnected: pendingAvailabilityRef.current,
      socket: socketRef.current
    });
  }, [socketRef]);

  const scheduleAvailabilityEmit = useCallback(
    (announcement: TrackAvailabilityAnnouncement) => {
      queueAvailabilityEmit(pendingAvailabilityEmitRef.current, announcement);
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

      if (!socket || !socket.connected) {
        pendingAvailabilityRef.current.set(
          getAvailabilityAnnouncementKey(announcement),
          announcement
        );
        return;
      }

      scheduleAvailabilityEmit(announcement);
    },
    [scheduleAvailabilityEmit, socketRef]
  );

  const flushPendingAvailability = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || pendingAvailabilityRef.current.size === 0) {
      return;
    }

    for (const announcement of pendingAvailabilityRef.current.values()) {
      socket.emit(
        "piece.availability",
        compactTrackAvailabilityAnnouncement(announcement)
      );
    }

    pendingAvailabilityRef.current.clear();
  }, [socketRef]);

  const clearAvailabilityForPeer = useCallback((ownerPeerId: string) => {
    for (const [key, announcement] of queuedAvailabilityRef.current.entries()) {
      if (announcement.ownerPeerId === ownerPeerId) {
        queuedAvailabilityRef.current.delete(key);
      }
    }

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

    queuedAvailabilityRef.current.clear();
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
