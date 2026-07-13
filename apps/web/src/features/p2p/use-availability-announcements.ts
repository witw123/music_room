"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  assetAvailabilityKey,
  mergeAssetAvailability as mergeAssetAnnouncement,
  compactTrackAvailabilityAnnouncement,
  type AssetAvailabilityAnnouncement,
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
  const [availabilityByAsset, setAvailabilityByAsset] = useState<
    Record<string, Record<string, AssetAvailabilityAnnouncement>>
  >({});
  const pendingAssetAvailabilityRef = useRef(new Map<string, AssetAvailabilityAnnouncement>());
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

  const mergeAssetAvailability = useCallback((announcement: AssetAvailabilityAnnouncement) => {
    setAvailabilityByAsset((current) => {
      const currentAsset = current[announcement.assetId] ?? {};
      const existing = currentAsset[announcement.ownerPeerId];
      const merged = mergeAssetAnnouncement(existing, announcement);
      if (merged === existing) {
        return current;
      }
      return {
        ...current,
        [announcement.assetId]: {
          ...currentAsset,
          [announcement.ownerPeerId]: merged
        }
      };
    });
  }, []);

  const emitAssetAvailability = useCallback((announcement: AssetAvailabilityAnnouncement) => {
    const socket = socketRef.current;
    const key = assetAvailabilityKey(announcement);
    if (!socket?.connected) {
      pendingAssetAvailabilityRef.current.set(key, announcement);
      return;
    }
    socket.emit("asset.availability", announcement);
  }, [socketRef]);

  const flushPendingAvailability = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      return;
    }

    for (const announcement of pendingAvailabilityRef.current.values()) {
      socket.emit(
        "piece.availability",
        compactTrackAvailabilityAnnouncement(announcement)
      );
    }

    pendingAvailabilityRef.current.clear();
    for (const announcement of pendingAssetAvailabilityRef.current.values()) {
      socket.emit("asset.availability", announcement);
    }
    pendingAssetAvailabilityRef.current.clear();
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
    setAvailabilityByAsset((current) => Object.fromEntries(
      Object.entries(current).flatMap(([assetId, announcements]) => {
        const remaining = Object.fromEntries(
          Object.entries(announcements).filter(([, announcement]) => announcement.ownerPeerId !== ownerPeerId)
        );
        return Object.keys(remaining).length > 0 ? [[assetId, remaining]] : [];
      })
    ));
  }, []);

  const clearAvailabilityForAsset = useCallback((assetId: string, ownerPeerId?: string) => {
    setAvailabilityByAsset((current) => {
      const announcements = current[assetId];
      if (!announcements) {
        return current;
      }
      const remaining = ownerPeerId
        ? Object.fromEntries(Object.entries(announcements).filter(([peerId]) => peerId !== ownerPeerId))
        : {};
      const next = { ...current };
      if (Object.keys(remaining).length > 0) {
        next[assetId] = remaining;
      } else {
        delete next[assetId];
      }
      return next;
    });
  }, []);

  const clearAvailabilityForTrack = useCallback((trackId: string, ownerPeerId?: string) => {
    const matches = (announcement: TrackAvailabilityAnnouncement) =>
      announcement.trackId === trackId &&
      (!ownerPeerId || announcement.ownerPeerId === ownerPeerId);

    for (const [key, announcement] of queuedAvailabilityRef.current.entries()) {
      if (matches(announcement)) {
        queuedAvailabilityRef.current.delete(key);
      }
    }
    for (const [key, announcement] of pendingAvailabilityEmitRef.current.entries()) {
      if (matches(announcement)) {
        pendingAvailabilityEmitRef.current.delete(key);
      }
    }
    for (const [key, announcement] of pendingAvailabilityRef.current.entries()) {
      if (matches(announcement)) {
        pendingAvailabilityRef.current.delete(key);
      }
    }

    setAvailabilityByTrack((current) => {
      const currentTrack = current[trackId];
      if (!currentTrack) {
        return current;
      }
      const nextTrack = Object.fromEntries(
        Object.entries(currentTrack).filter(([, announcement]) => !matches(announcement))
      );
      const next = { ...current };
      if (Object.keys(nextTrack).length === 0) {
        delete next[trackId];
      } else {
        next[trackId] = nextTrack;
      }
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
    pendingAssetAvailabilityRef.current.clear();
    availabilityByTrackRef.current = {};
    setAvailabilityByTrack({});
    setAvailabilityByAsset({});
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
    availabilityByAsset,
    queueAvailability,
    mergeAvailability,
    emitAvailability,
    emitAssetAvailability,
    mergeAssetAvailability,
    flushPendingAvailability,
    clearAvailabilityForPeer,
    clearAvailabilityForTrack,
    clearAvailabilityForAsset,
    resetAvailabilityState
  };
}
