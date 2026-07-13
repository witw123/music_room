"use client";

import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import type {
  Playlist,
  RoomMediaConnectionState,
  RoomSnapshot
} from "@music-room/shared";
import type { Route } from "next";
import { musicRoomApi } from "@/lib/music-room-api";
import { filterOpenPublicRooms } from "@/features/room/room-list-visibility";
import { useRoomActions } from "@/features/room/hooks/use-room-actions";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import type { PlaybackStartIntent } from "@/features/playback/playback-start-intent";
import { useRoomLifecycleActions } from "@/components/room/hooks/use-room-lifecycle-actions";
import type { RoomRecoveryState } from "@/components/room/hooks/use-room-page-state";

type RoomRouter = {
  push: (href: Route) => void;
  replace: (href: Route) => void;
};

type UseRoomActionsInput = Parameters<typeof useRoomActions>[0];

type UseRoomPageRoomActionsInput = {
  activeSession: UseRoomActionsInput["activeSession"];
  audioRef: RefObject<HTMLAudioElement | null>;
  authEntryHref: string;
  clearIdentity: () => void;
  currentPlaybackPositionRef: MutableRefObject<number>;
  deleteRoomTrackArtifacts: (trackIds: string[]) => Promise<void> | void;
  deleteUploadedTrackArtifacts: (trackId: string) => Promise<void> | void;
  clearCacheStreamTrack: (trackId: string) => Promise<void> | void;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  peerId: string;
  peerStorageKey: string;
  resetAvailabilityState: () => void;
  resetPeerDiagnostics: () => void;
  roomSnapshot: RoomSnapshot | null;
  router: RoomRouter;
  setAvailableRooms: Dispatch<SetStateAction<RoomSnapshot[]>>;
  setBufferHealth: Dispatch<SetStateAction<"healthy" | "low" | "critical">>;
  setIsNavigatingRoomExit: Dispatch<SetStateAction<boolean>>;
  setMediaConnectedPeers: Dispatch<SetStateAction<string[]>>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  setPeerId: Dispatch<SetStateAction<string>>;
  setPlaybackStartIntent: Dispatch<SetStateAction<PlaybackStartIntent | null>>;
  setPlayerResetEpoch: Dispatch<SetStateAction<number>>;
  setPlaylists: Dispatch<SetStateAction<Playlist[]>>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setSchedulerPlaybackBucketMs: Dispatch<SetStateAction<number>>;
  setStatusMessage: (value: string) => void;
  setSuppressRoomRecovery: Dispatch<SetStateAction<boolean>>;
  workspaceEntryHref: string;
  workspaceOnly: boolean;
};

export function useRoomPageRoomActions({
  activeSession,
  audioRef,
  authEntryHref,
  clearIdentity,
  currentPlaybackPositionRef,
  deleteRoomTrackArtifacts,
  deleteUploadedTrackArtifacts,
  clearCacheStreamTrack,
  dispatchRoomStateEvent,
  peerId,
  peerStorageKey,
  resetAvailabilityState,
  resetPeerDiagnostics,
  roomSnapshot,
  router,
  setAvailableRooms,
  setBufferHealth,
  setIsNavigatingRoomExit,
  setMediaConnectedPeers,
  setMediaConnectionState,
  setPeerId,
  setPlaybackStartIntent,
  setPlayerResetEpoch,
  setPlaylists,
  setRoomRecoveryState,
  setSchedulerPlaybackBucketMs,
  setStatusMessage,
  setSuppressRoomRecovery,
  workspaceEntryHref,
  workspaceOnly
}: UseRoomPageRoomActionsInput) {
  const resetRealtimePeer = useCallback(() => {
    const nextPeerId = `peer_${crypto.randomUUID()}`;
    window.sessionStorage.setItem(peerStorageKey, nextPeerId);
    setPeerId(nextPeerId);
  }, [peerStorageKey, setPeerId]);
  const getCurrentPeerId = useCallback(() => peerId || null, [peerId]);

  const refreshAvailableRooms = useCallback(async () => {
    try {
      const rooms = await musicRoomApi.listRooms();
      setAvailableRooms(filterOpenPublicRooms(rooms));
    } catch {
      setAvailableRooms([]);
    }
  }, [setAvailableRooms]);

  const refreshPlaylists = useCallback(async () => {
    try {
      const nextPlaylists = await musicRoomApi.listMyPlaylists();
      setPlaylists(nextPlaylists);
    } catch {
      setPlaylists([]);
    }
  }, [setPlaylists]);

  const handleTrackDeleted = useCallback(
    async (trackId: string) => {
      await clearCacheStreamTrack(trackId);
      await deleteUploadedTrackArtifacts(trackId);
    },
    [clearCacheStreamTrack, deleteUploadedTrackArtifacts]
  );
  const handleRoomDeleted = useCallback(
    async (trackIds: string[]) => {
      for (const trackId of trackIds) {
        await clearCacheStreamTrack(trackId);
      }
      await deleteRoomTrackArtifacts(trackIds);
    },
    [clearCacheStreamTrack, deleteRoomTrackArtifacts]
  );

  const resetPlayerSurface = useCallback(() => {
    const localAudio = audioRef.current;

    if (localAudio) {
      localAudio.pause();
      localAudio.srcObject = null;
      localAudio.removeAttribute("src");
      localAudio.load();
    }

    resetAvailabilityState();
    resetPeerDiagnostics();
    currentPlaybackPositionRef.current = 0;
    setPlayerResetEpoch((current) => current + 1);
    setSchedulerPlaybackBucketMs(0);
    setBufferHealth("healthy");
    setMediaConnectionState("idle");
    setMediaConnectedPeers([]);
    setPlaybackStartIntent(null);
    setRoomRecoveryState({
      phase: "joining",
      mode: "steady",
      generation: null,
      bootstrapStartedAt: null,
      bootstrapSourcePeerId: null,
      pendingSnapshot: false,
      pendingData: false,
      pendingMedia: false,
      listenerBootstrapAttempts: null,
      fullLocalRecoveryActive: false
    });
  }, [
    audioRef,
    currentPlaybackPositionRef,
    resetAvailabilityState,
    resetPeerDiagnostics,
    setBufferHealth,
    setMediaConnectedPeers,
    setMediaConnectionState,
    setPlaybackStartIntent,
    setPlayerResetEpoch,
    setRoomRecoveryState,
    setSchedulerPlaybackBucketMs
  ]);

  const {
    leaveRoom,
    deleteRoom,
    deleteTrack,
    addToQueue,
    playTrack,
    playQueueItem,
    pauseTrack,
    prevTrack,
    nextTrack,
    removeQueueItem,
    reorderQueue,
    seekTrack
  } = useRoomActions({
    activeSession,
    roomSnapshot,
    dispatchRoomStateEvent,
    setSuppressRoomRecovery,
    setStatusMessage,
    refreshAvailableRooms,
    refreshPlaylists,
    resetPlayerSurface,
    resetRealtimePeer,
    lastRoomStorageKey: "music-room-last-room",
    getCurrentPlaybackPositionMs: () => currentPlaybackPositionRef.current,
    getCurrentPeerId,
    onTrackDeleted: handleTrackDeleted,
    onRoomDeleted: handleRoomDeleted
  });

  const {
    handleClearIdentity,
    handleLeaveRoomAction,
    handleDeleteRoomAction,
    handleLogout
  } = useRoomLifecycleActions({
    workspaceOnly,
    workspaceEntryHref,
    authEntryHref,
    router,
    clearIdentity,
    resetPlayerSurface,
    resetRealtimePeer,
    setSuppressRoomRecovery,
    dispatchRoomStateEvent,
    setPlaylists,
    leaveRoom,
    deleteRoom,
    setIsNavigatingRoomExit
  });

  return {
    addToQueue,
    deleteTrack,
    handleClearIdentity,
    handleDeleteRoomAction,
    handleLeaveRoomAction,
    handleLogout,
    nextTrack,
    pauseTrack,
    playQueueItem,
    playTrack,
    prevTrack,
    refreshAvailableRooms,
    refreshPlaylists,
    removeQueueItem,
    reorderQueue,
    resetPlayerSurface,
    seekTrack
  };
}
