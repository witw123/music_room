"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerSignalMessage, RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import { P2PMesh, getMissingChunkIndexes, selectChunkSource } from "@/features/p2p";

type UploadedTrack = { objectUrl: string };

type UseP2POptions = {
  roomId: string;
  peerId: string;
  sessionId?: string;
  roomSnapshot: RoomSnapshot | null;
  uploadedTracks: Record<string, UploadedTrack>;
  socket: { emit: (event: string, payload: unknown) => void; on: (event: string, handler: (...args: unknown[]) => void) => void } | null;
  onPieceReceived: (payload: { trackId: string; totalChunks: number; mimeType: string }) => void;
  onStatusMessage: (msg: string) => void;
};

type UseP2PReturn = {
  connectedPeers: string[];
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  meshRef: React.MutableRefObject<P2PMesh | null>;
};

export function useP2P({
  roomId,
  peerId,
  sessionId,
  roomSnapshot,
  uploadedTracks,
  socket,
  onPieceReceived,
  onStatusMessage
}: UseP2POptions): UseP2PReturn {
  const meshRef = useRef<P2PMesh | null>(null);
  const requestedPiecesRef = useRef<Map<string, number>>(new Map());
  const failedPiecePeersRef = useRef<Map<string, Set<string>>>(new Map());
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [availabilityByTrack, setAvailabilityByTrack] = useState<
    Record<string, Record<string, TrackAvailabilityAnnouncement>>
  >({});

  // Set up P2P mesh and socket listeners
  useEffect(() => {
    if (!roomId || !peerId || !socket) {
      return;
    }

    const mesh = new P2PMesh(
      roomId,
      peerId,
      (payload: PeerSignalMessage) => socket.emit("peer.signal", payload),
      {
        onPieceReceived: ({ trackId, totalChunks, mimeType }) => {
          requestedPiecesRef.current.forEach((_, requestKey) => {
            if (requestKey.startsWith(`${trackId}:`)) {
              requestedPiecesRef.current.delete(requestKey);
              failedPiecePeersRef.current.delete(requestKey);
            }
          });
          onPieceReceived({ trackId, totalChunks, mimeType });
        },
        onPieceRequestTimeout: ({ trackId, chunkIndex, peerId: timedOutPeerId }) => {
          const requestKey = `${trackId}:${chunkIndex}`;
          requestedPiecesRef.current.delete(requestKey);
          const failedPeers = failedPiecePeersRef.current.get(requestKey) ?? new Set<string>();
          failedPeers.add(timedOutPeerId);
          failedPiecePeersRef.current.set(requestKey, failedPeers);
        },
        onPeerConnectionChange: ({ peerId: remotePeerId, state }) => {
          setConnectedPeers((current) => {
            const next = new Set(current);
            if (state === "connected") {
              next.add(remotePeerId);
            } else if (state === "closed" || state === "failed" || state === "disconnected") {
              next.delete(remotePeerId);
            }
            return [...next];
          });
        }
      }
    );
    meshRef.current = mesh;

    socket.on("peer.signal", (payload: unknown) => {
      void mesh.handleSignal(payload as PeerSignalMessage);
    });

    socket.on("piece.availability", (announcement: unknown) => {
      const a = announcement as TrackAvailabilityAnnouncement;
      setAvailabilityByTrack((current) => ({
        ...current,
        [a.trackId]: {
          ...(current[a.trackId] ?? {}),
          [a.ownerPeerId]: a
        }
      }));
    });

    // Subscribe to room
    socket.emit("room.subscribe", {
      roomId,
      sessionId,
      peerId
    });

    return () => {
      socket.emit("room.unsubscribe", { roomId });
      mesh.destroy();
      meshRef.current = null;
      setConnectedPeers([]);
    };
  }, [roomId, peerId, sessionId, socket]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync peers when room members change
  useEffect(() => {
    const remotePeerIds =
      roomSnapshot?.room.members
        .map((m) => m.peerId)
        .filter((p): p is string => !!p && p !== peerId) ?? [];
    void meshRef.current?.syncPeers(remotePeerIds);
  }, [roomSnapshot?.room.members, peerId]);

  // Clear piece request maps when room changes
  useEffect(() => {
    requestedPiecesRef.current.clear();
    failedPiecePeersRef.current.clear();
  }, [roomId, peerId]);

  // Chunk request loop
  useEffect(() => {
    if (!roomSnapshot || !meshRef.current) return;

    const currentTrackId = roomSnapshot.room.playback.currentTrackId;
    const currentTrack = roomSnapshot.tracks.find((t) => t.id === currentTrackId) ?? null;

    const queue = roomSnapshot.queue;
    const currentQueueIndex = currentTrackId ? queue.findIndex((q) => q.trackId === currentTrackId) : -1;
    const nextQueueItem = currentQueueIndex >= 0 ? queue[currentQueueIndex + 1] : null;
    const upcomingTrack = nextQueueItem
      ? roomSnapshot.tracks.find((t) => t.id === nextQueueItem.trackId) ?? null
      : null;

    const requestPlan = [
      { track: currentTrack, limit: 8 },
      { track: upcomingTrack, limit: 3 }
    ];

    for (const plan of requestPlan) {
      if (!plan.track || uploadedTracks[plan.track.id]) {
        continue;
      }

      const announcements = Object.values(availabilityByTrack[plan.track.id] ?? {});
      const localChunks = availabilityByTrack[plan.track.id]?.[peerId]?.availableChunks ?? [];
      const totalChunks = announcements.reduce((max, a) => Math.max(max, a.totalChunks), 0);
      const missingChunkIndexes = getMissingChunkIndexes(totalChunks, localChunks, plan.limit);

      for (const chunkIndex of missingChunkIndexes) {
        const requestKey = `${plan.track.id}:${chunkIndex}`;
        if (requestedPiecesRef.current.has(requestKey)) {
          continue;
        }

        const excludedPeerIds = [...(failedPiecePeersRef.current.get(requestKey) ?? new Set())];
        const connectedPeerIds = meshRef.current?.getConnectedPeerIds() ?? [];
        const preferredSource = selectChunkSource(
          announcements.filter((a) => a.availableChunks.includes(chunkIndex)),
          connectedPeerIds,
          peerId,
          excludedPeerIds
        );
        if (!preferredSource) {
          continue;
        }

        const didRequest = meshRef.current?.requestPiece(
          preferredSource.ownerPeerId,
          plan.track.id,
          chunkIndex,
          totalChunks
        );

        if (didRequest) {
          requestedPiecesRef.current.set(requestKey, Date.now());
        }
      }
    }
  }, [availabilityByTrack, roomSnapshot, uploadedTracks, peerId]);

  // Timeout stale requests
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const [requestKey, startedAt] of requestedPiecesRef.current.entries()) {
        if (now - startedAt > 8000) {
          requestedPiecesRef.current.delete(requestKey);
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const mergeAvailability = useCallback((announcement: TrackAvailabilityAnnouncement) => {
    setAvailabilityByTrack((current) => ({
      ...current,
      [announcement.trackId]: {
        ...(current[announcement.trackId] ?? {}),
        [announcement.ownerPeerId]: announcement
      }
    }));
  }, []);

  return {
    connectedPeers,
    availabilityByTrack,
    meshRef
  };
}
