"use client";

import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { RoomSocket } from "@/lib/ws-client";
import type { P2PMesh } from "@/features/p2p";

export function useRoomCacheTrackCleanup(input: {
  meshRef: MutableRefObject<P2PMesh | null>;
  socketRef: MutableRefObject<RoomSocket | null>;
  roomId: string | null | undefined;
  peerId: string;
  clearAvailabilityForTrack: (trackId: string, ownerPeerId?: string) => void;
}) {
  const {
    meshRef,
    socketRef,
    roomId,
    peerId,
    clearAvailabilityForTrack
  } = input;
  return useCallback(async (trackId: string) => {
    await meshRef.current?.clearCacheStreamTrack(trackId);
    if (peerId) {
      meshRef.current?.removeCacheStreamProvider(trackId, peerId);
    }
    clearAvailabilityForTrack(trackId, peerId);
    if (socketRef.current?.connected && roomId && peerId) {
      socketRef.current.emit("piece.availability.clear", {
        roomId,
        ownerPeerId: peerId,
        trackId,
        updatedAt: new Date().toISOString()
      });
    }
  }, [clearAvailabilityForTrack, meshRef, peerId, roomId, socketRef]);
}
