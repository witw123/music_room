"use client";

import { useRef } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import { ChunkScheduler } from "@/features/p2p";
import type { P2PMesh } from "@/features/p2p";
import type { useSessionIdentity } from "@/features/session/use-session-identity";

type UseRoomAppRefsInput = {
  roomPlayback: RoomSnapshot["room"]["playback"] | null;
};

export function useRoomAppRefs({ roomPlayback }: UseRoomAppRefsInput) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const chunkSchedulerRef = useRef<ChunkScheduler | null>(null);
  const meshRef = useRef<P2PMesh | null>(null);
  const currentPlaybackPositionRef = useRef(0);
  const activeSessionRef = useRef<ReturnType<typeof useSessionIdentity>["activeSession"]>(null);
  const currentRoomRef = useRef<RoomSnapshot | null>(null);
  const uploadedTrackIdsRef = useRef<string[]>([]);
  const playbackSourceInitializationKeyRef = useRef<string | null>(null);
  const roomPlaybackRef = useRef(roomPlayback);
  roomPlaybackRef.current = roomPlayback;

  return {
    activeSessionRef,
    audioRef,
    chunkSchedulerRef,
    currentPlaybackPositionRef,
    currentRoomRef,
    meshRef,
    playbackSourceInitializationKeyRef,
    roomPlaybackRef,
    socketRef,
    uploadedTrackIdsRef
  };
}
