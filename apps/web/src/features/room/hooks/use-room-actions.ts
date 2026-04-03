"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { AuthSession, PlaybackSnapshot, RoomSnapshot } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  shouldReplacePlaybackSnapshot,
  toUserFacingError
} from "@/lib/music-room-ui";

type UseRoomActionsOptions = {
  activeSession: AuthSession | null;
  roomSnapshot: RoomSnapshot | null;
  setRoomSnapshot: Dispatch<SetStateAction<RoomSnapshot | null>>;
  setSuppressRoomRecovery: Dispatch<SetStateAction<boolean>>;
  setStatusMessage: (value: string) => void;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  resetPlayerSurface: () => void;
  lastRoomStorageKey: string;
  getCurrentPlaybackPositionMs: () => number;
  onTrackDeleted?: (trackId: string) => Promise<void> | void;
  onRoomDeleted?: (trackIds: string[]) => Promise<void> | void;
};

export function useRoomActions({
  activeSession,
  roomSnapshot,
  setRoomSnapshot,
  setSuppressRoomRecovery,
  setStatusMessage,
  refreshAvailableRooms,
  refreshPlaylists,
  resetPlayerSurface,
  lastRoomStorageKey,
  getCurrentPlaybackPositionMs,
  onTrackDeleted,
  onRoomDeleted
}: UseRoomActionsOptions) {
  const applyPlaybackLocally = useCallback(
    (playback: PlaybackSnapshot) => {
      setRoomSnapshot((current) =>
        current && shouldReplacePlaybackSnapshot(current.room.playback, playback)
          ? {
              ...current,
              room: {
                ...current.room,
                playback
              }
            }
          : current
      );
    },
    [setRoomSnapshot]
  );

  const applyQueuePatchLocally = useCallback(
    (queue: RoomSnapshot["queue"], playback: PlaybackSnapshot) => {
      setRoomSnapshot((current) =>
        current
          ? {
              ...current,
              queue,
              room: {
                ...current.room,
                playback: shouldReplacePlaybackSnapshot(current.room.playback, playback)
                  ? playback
                  : current.room.playback
              }
            }
          : current
      );
    },
    [setRoomSnapshot]
  );

  const leaveRoom = useCallback(async () => {
    if (!activeSession || !roomSnapshot) {
      return false;
    }

    try {
      await musicRoomApi.leaveRoom(roomSnapshot.room.id);
      setSuppressRoomRecovery(true);
      setRoomSnapshot(null);
      resetPlayerSurface();
      window.localStorage.removeItem(lastRoomStorageKey);
      await refreshAvailableRooms();
      setStatusMessage("已离开房间。");
      return true;
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
      return false;
    }
  }, [
    activeSession,
    roomSnapshot,
    setSuppressRoomRecovery,
    setRoomSnapshot,
    resetPlayerSurface,
    lastRoomStorageKey,
    refreshAvailableRooms,
    setStatusMessage
  ]);

  const deleteRoom = useCallback(async () => {
    if (!activeSession || !roomSnapshot) {
      return false;
    }

    try {
      const trackIds = roomSnapshot.tracks.map((track) => track.id);
      await musicRoomApi.deleteRoom(roomSnapshot.room.id);
      setSuppressRoomRecovery(true);
      setRoomSnapshot(null);
      resetPlayerSurface();
      window.localStorage.removeItem(lastRoomStorageKey);
      try {
        await onRoomDeleted?.(trackIds);
      } catch {
        // Room deletion already succeeded on the server. Do not fail the exit flow
        // if optional local cleanup cannot finish.
      }
      await refreshAvailableRooms();
      setStatusMessage("房间已解散。");
      return true;
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
      return false;
    }
  }, [
    activeSession,
    roomSnapshot,
    onRoomDeleted,
    setSuppressRoomRecovery,
    setRoomSnapshot,
    resetPlayerSurface,
    lastRoomStorageKey,
    refreshAvailableRooms,
    setStatusMessage
  ]);

  const addToQueue = useCallback(
    async (trackId: string) => {
      if (!activeSession || !roomSnapshot) {
        return;
      }

      try {
        const nextState = await musicRoomApi.addQueueItem(roomSnapshot.room.id, { trackId });
        applyQueuePatchLocally(nextState.queue, nextState.playback);
        setStatusMessage("歌曲已加入共享队列。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, roomSnapshot, applyQueuePatchLocally, setStatusMessage]
  );

  const deleteTrack = useCallback(
    async (trackId: string) => {
      if (!activeSession || !roomSnapshot) {
        return;
      }

      try {
        await musicRoomApi.deleteTrack(roomSnapshot.room.id, trackId);
        await onTrackDeleted?.(trackId);
        setRoomSnapshot((current) =>
          current
            ? {
                ...current,
                tracks: current.tracks.filter((track) => track.id !== trackId),
                queue: current.queue
                  .filter((item) => item.trackId !== trackId)
                  .map((item, index) => ({ ...item, position: index }))
              }
            : current
        );
        await refreshPlaylists();
        setStatusMessage("歌曲已从房间曲库中删除。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [
      activeSession,
      roomSnapshot,
      onTrackDeleted,
      setRoomSnapshot,
      refreshPlaylists,
      setStatusMessage
    ]
  );

  const playTrack = useCallback(
    async (trackId?: string) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      try {
        const playback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "play",
          trackId,
          expectedVersion: roomSnapshot.room.playback.queueVersion
        });
        applyPlaybackLocally(playback);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [roomSnapshot, activeSession, applyPlaybackLocally, setStatusMessage]
  );

  const playQueueItem = useCallback(
    async (queueItemId: string) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      try {
        const playback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "play",
          queueItemId,
          expectedVersion: roomSnapshot.room.playback.queueVersion
        });
        applyPlaybackLocally(playback);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [roomSnapshot, activeSession, applyPlaybackLocally, setStatusMessage]
  );

  const pauseTrack = useCallback(
    async (positionMs = getCurrentPlaybackPositionMs()) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      try {
        const playback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "pause",
          positionMs,
          expectedVersion: roomSnapshot.room.playback.queueVersion
        });
        applyPlaybackLocally(playback);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [
      roomSnapshot,
      activeSession,
      getCurrentPlaybackPositionMs,
      applyPlaybackLocally,
      setStatusMessage
    ]
  );

  const prevTrack = useCallback(async () => {
    if (!roomSnapshot || !activeSession || !roomSnapshot.room.playback.currentTrackId) {
      return;
    }

    try {
      const nextPlayback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "prev",
        expectedVersion: roomSnapshot.room.playback.queueVersion
      });
      applyPlaybackLocally(nextPlayback);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }, [roomSnapshot, activeSession, applyPlaybackLocally, setStatusMessage]);

  const nextTrack = useCallback(async () => {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    try {
      const playback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "next",
        expectedVersion: roomSnapshot.room.playback.queueVersion
      });
      applyPlaybackLocally(playback);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }, [roomSnapshot, activeSession, applyPlaybackLocally, setStatusMessage]);

  const savePlaylistFromQueue = useCallback(
    async (title: string) => {
      if (!activeSession || !roomSnapshot) {
        return;
      }

      try {
        await musicRoomApi.createPlaylistFromRoom({
          roomId: roomSnapshot.room.id,
          title,
          description: "从当前房间队列保存"
        });
        await refreshPlaylists();
        setStatusMessage(`歌单“${title}”已保存。`);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, roomSnapshot, refreshPlaylists, setStatusMessage]
  );

  const updatePlaylistTitle = useCallback(
    async (playlistId: string, title: string) => {
      if (!activeSession) {
        return;
      }

      try {
        await musicRoomApi.updatePlaylist(playlistId, { title });
        await refreshPlaylists();
        setStatusMessage("歌单名称已更新。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, refreshPlaylists, setStatusMessage]
  );

  const updatePlaylistTracks = useCallback(
    async (playlistId: string, trackIds: string[]) => {
      if (!activeSession) {
        return;
      }

      try {
        await musicRoomApi.updatePlaylist(playlistId, { trackIds });
        await refreshPlaylists();
        setStatusMessage("歌单曲目已更新。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, refreshPlaylists, setStatusMessage]
  );

  const deletePlaylist = useCallback(
    async (playlistId: string) => {
      if (!activeSession) {
        return;
      }

      try {
        await musicRoomApi.deletePlaylist(playlistId);
        await refreshPlaylists();
        setStatusMessage("歌单已删除。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, refreshPlaylists, setStatusMessage]
  );

  const loadPlaylistIntoRoom = useCallback(
    async (playlistId: string) => {
      if (!activeSession || !roomSnapshot) {
        return;
      }

      try {
        const nextState = await musicRoomApi.importPlaylistToRoom(playlistId, {
          roomId: roomSnapshot.room.id
        });
        applyQueuePatchLocally(nextState.queue, nextState.playback);
        setStatusMessage("歌单已加入当前房间队列。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, roomSnapshot, applyQueuePatchLocally, setStatusMessage]
  );

  const removeQueueItem = useCallback(
    async (queueItemId: string) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      try {
        const nextState = await musicRoomApi.removeQueueItem(roomSnapshot.room.id, queueItemId);
        applyQueuePatchLocally(nextState.queue, nextState.playback);
        setStatusMessage("歌曲已从队列中移除。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [roomSnapshot, activeSession, applyQueuePatchLocally, setStatusMessage]
  );

  const reorderQueue = useCallback(
    async (queueItemIds: string[]) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      try {
        const nextState = await musicRoomApi.reorderQueue(roomSnapshot.room.id, {
          queueItemIds
        });
        applyQueuePatchLocally(nextState.queue, nextState.playback);
        setStatusMessage("播放队列顺序已更新。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [roomSnapshot, activeSession, applyQueuePatchLocally, setStatusMessage]
  );

  const seekTrack = useCallback(
    async (positionMs: number) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      try {
        const playback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "seek",
          positionMs,
          expectedVersion: roomSnapshot.room.playback.queueVersion
        });
        applyPlaybackLocally(playback);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [roomSnapshot, activeSession, applyPlaybackLocally, setStatusMessage]
  );

  const handleEnded = useCallback(async () => {
    if (!roomSnapshot) {
      return;
    }

    await nextTrack();
  }, [roomSnapshot, nextTrack]);

  return {
    leaveRoom,
    deleteRoom,
    deleteTrack,
    addToQueue,
    playTrack,
    playQueueItem,
    pauseTrack,
    prevTrack,
    nextTrack,
    savePlaylistFromQueue,
    updatePlaylistTitle,
    updatePlaylistTracks,
    deletePlaylist,
    loadPlaylistIntoRoom,
    removeQueueItem,
    reorderQueue,
    seekTrack,
    handleEnded
  };
}
