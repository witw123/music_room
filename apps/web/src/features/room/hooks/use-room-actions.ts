"use client";

import type { Dispatch, SetStateAction } from "react";
import type { AuthSession, Playlist, RoomSnapshot } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";
import { toUserFacingError } from "@/lib/music-room-ui";

type UseRoomActionsOptions = {
  activeSession: AuthSession | null;
  roomSnapshot: RoomSnapshot | null;
  progressMs: number;
  setRoomSnapshot: Dispatch<SetStateAction<RoomSnapshot | null>>;
  setAvailableRooms: Dispatch<SetStateAction<RoomSnapshot[]>>;
  setPlaylists: Dispatch<SetStateAction<Playlist[]>>;
  setStatusMessage: (value: string) => void;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  resetPlayerSurface: () => void;
  lastRoomStorageKey: string;
  getCurrentPlaybackPositionMs: () => number;
};

export function useRoomActions(options: UseRoomActionsOptions) {
  const {
    activeSession,
    roomSnapshot,
    progressMs,
    setRoomSnapshot,
    setAvailableRooms,
    setStatusMessage,
    refreshAvailableRooms,
    refreshPlaylists,
    resetPlayerSurface,
    lastRoomStorageKey,
    getCurrentPlaybackPositionMs
  } = options;

  async function refreshRoom(roomId: string) {
    const snapshot = await musicRoomApi.getRoom(roomId);
    setRoomSnapshot(snapshot);
  }

  function applyPlaybackLocally(playback: Awaited<ReturnType<typeof musicRoomApi.updatePlayback>>) {
    setRoomSnapshot((current) =>
      current
        ? {
            ...current,
            room: {
              ...current.room,
              playback
            }
          }
        : current
    );
  }

  async function leaveRoom() {
    if (!activeSession || !roomSnapshot) {
      return false;
    }

    try {
      await musicRoomApi.leaveRoom(roomSnapshot.room.id);
      resetPlayerSurface();
      setRoomSnapshot(null);
      window.localStorage.removeItem(lastRoomStorageKey);
      await refreshAvailableRooms();
      setStatusMessage("已离开房间。");
      return true;
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
      return false;
    }
  }

  async function deleteRoom() {
    if (!activeSession || !roomSnapshot) {
      return false;
    }

    try {
      await musicRoomApi.deleteRoom(roomSnapshot.room.id);
      resetPlayerSurface();
      setRoomSnapshot(null);
      window.localStorage.removeItem(lastRoomStorageKey);
      await refreshAvailableRooms();
      setStatusMessage("房间已删除。");
      return true;
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
      return false;
    }
  }

  async function addToQueue(trackId: string) {
    if (!activeSession || !roomSnapshot) {
      return;
    }

    try {
      await musicRoomApi.addQueueItem(roomSnapshot.room.id, { trackId });
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("曲目已加入共享队列。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function playTrack(trackId?: string) {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    try {
      const playback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "play",
        trackId
      });
      applyPlaybackLocally(playback);
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function playQueueItem(queueItemId: string) {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    try {
      const playback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "play",
        queueItemId
      });
      applyPlaybackLocally(playback);
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function pauseTrack(positionMs = getCurrentPlaybackPositionMs()) {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    try {
      const playback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "pause",
        positionMs
      });
      applyPlaybackLocally(playback);
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function prevTrack() {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    try {
      const playback = roomSnapshot.room.playback;
      if (!playback?.currentTrackId) {
        return;
      }

      if (progressMs > 3000) {
        const nextPlayback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "seek",
          positionMs: 0
        });
        applyPlaybackLocally(nextPlayback);
      } else {
        const nextPlayback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "prev"
        });
        applyPlaybackLocally(nextPlayback);
      }

      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function nextTrack() {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    try {
      const playback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "next"
      });
      applyPlaybackLocally(playback);
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function savePlaylistFromQueue(title: string) {
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
  }

  async function updatePlaylistTitle(playlistId: string, title: string) {
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
  }

  async function updatePlaylistTracks(playlistId: string, trackIds: string[]) {
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
  }

  async function deletePlaylist(playlistId: string) {
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
  }

  async function loadPlaylistIntoRoom(playlistId: string) {
    if (!activeSession || !roomSnapshot) {
      return;
    }

    try {
      await musicRoomApi.importPlaylistToRoom(playlistId, {
        roomId: roomSnapshot.room.id
      });
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("歌单已加入当前房间队列。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function removeQueueItem(queueItemId: string) {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    try {
      await musicRoomApi.removeQueueItem(roomSnapshot.room.id, queueItemId);
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("曲目已从队列中移除。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function reorderQueue(queueItemIds: string[]) {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    try {
      await musicRoomApi.reorderQueue(roomSnapshot.room.id, {
        queueItemIds
      });
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("播放队列顺序已更新。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function seekTrack(positionMs: number) {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    try {
      const playback = await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "seek",
        positionMs
      });
      applyPlaybackLocally(playback);
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleEnded() {
    if (!roomSnapshot) {
      return;
    }

    await nextTrack();
  }

  return {
    leaveRoom,
    deleteRoom,
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
