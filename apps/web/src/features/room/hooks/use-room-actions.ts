"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { AuthSession, PlaybackSnapshot, RoomSnapshot } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";
import { toUserFacingError } from "@/lib/music-room-ui";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";

type UseRoomActionsOptions = {
  activeSession: AuthSession | null;
  roomSnapshot: RoomSnapshot | null;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setSuppressRoomRecovery: Dispatch<SetStateAction<boolean>>;
  setStatusMessage: (value: string) => void;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  resetPlayerSurface: () => void;
  resetRealtimePeer: () => void;
  lastRoomStorageKey: string;
  getCurrentPlaybackPositionMs: () => number;
  onTrackDeleted?: (trackId: string) => Promise<void> | void;
  onRoomDeleted?: (trackIds: string[]) => Promise<void> | void;
};

export function useRoomActions({
  activeSession,
  roomSnapshot,
  dispatchRoomStateEvent,
  setSuppressRoomRecovery,
  setStatusMessage,
  refreshAvailableRooms,
  refreshPlaylists,
  resetPlayerSurface,
  resetRealtimePeer,
  lastRoomStorageKey,
  getCurrentPlaybackPositionMs,
  onTrackDeleted,
  onRoomDeleted
}: UseRoomActionsOptions) {
  const syncRoomSnapshot = useCallback(
    async (roomId: string) => {
      const snapshot = await musicRoomApi.getRoom(roomId);
      dispatchRoomStateEvent({
        type: "recover-snapshot",
        snapshot
      });
      return snapshot;
    },
    [dispatchRoomStateEvent]
  );

  const runPlaybackMutation = useCallback(
    async (
      roomId: string,
      expectedVersion: number,
      requestPlayback: (nextExpectedVersion: number) => Promise<PlaybackSnapshot>
    ) => {
      let nextExpectedVersion = expectedVersion;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const playback = await requestPlayback(nextExpectedVersion);
          dispatchRoomStateEvent({
            type: "server-playback-patch",
            roomId,
            playback
          });
          void syncRoomSnapshot(roomId).catch(() => undefined);
          return playback;
        } catch (error) {
          const isVersionConflict =
            error instanceof Error && error.message.includes("Playback state version conflict");

          if (!isVersionConflict || attempt === 1) {
            setStatusMessage(toUserFacingError(error));
            return null;
          }

          try {
            const snapshot = await syncRoomSnapshot(roomId);
            nextExpectedVersion = snapshot.room.playback.queueVersion;
          } catch (refreshError) {
            setStatusMessage(toUserFacingError(refreshError));
            return null;
          }
        }
      }

      return null;
    },
    [dispatchRoomStateEvent, setStatusMessage, syncRoomSnapshot]
  );

  const leaveRoom = useCallback(async () => {
    if (!activeSession || !roomSnapshot) {
      return false;
    }

    try {
      await musicRoomApi.leaveRoom(roomSnapshot.room.id);
      setSuppressRoomRecovery(true);
      dispatchRoomStateEvent({ type: "local-reset" });
      resetPlayerSurface();
      resetRealtimePeer();
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
    dispatchRoomStateEvent,
    roomSnapshot,
    setSuppressRoomRecovery,
    resetPlayerSurface,
    resetRealtimePeer,
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
      dispatchRoomStateEvent({ type: "local-reset" });
      resetPlayerSurface();
      resetRealtimePeer();
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
    dispatchRoomStateEvent,
    roomSnapshot,
    onRoomDeleted,
    setSuppressRoomRecovery,
    resetPlayerSurface,
    resetRealtimePeer,
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
        await musicRoomApi.addQueueItem(roomSnapshot.room.id, { trackId });
        void syncRoomSnapshot(roomSnapshot.room.id).catch(() => undefined);
        setStatusMessage("歌曲已加入共享队列。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, roomSnapshot, setStatusMessage, syncRoomSnapshot]
  );

  const deleteTrack = useCallback(
    async (trackId: string) => {
      if (!activeSession || !roomSnapshot) {
        return;
      }

      try {
        await musicRoomApi.deleteTrack(roomSnapshot.room.id, trackId);
        await onTrackDeleted?.(trackId);
        void syncRoomSnapshot(roomSnapshot.room.id).catch(() => undefined);
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
      syncRoomSnapshot,
      refreshPlaylists,
      setStatusMessage
    ]
  );

  const playTrack = useCallback(
    async (trackId?: string) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      await runPlaybackMutation(
        roomSnapshot.room.id,
        roomSnapshot.room.playback.queueVersion,
        (expectedVersion) =>
          musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "play",
            trackId,
            expectedVersion
          })
      );
    },
    [roomSnapshot, activeSession, runPlaybackMutation]
  );

  const playQueueItem = useCallback(
    async (queueItemId: string) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      await runPlaybackMutation(
        roomSnapshot.room.id,
        roomSnapshot.room.playback.queueVersion,
        (expectedVersion) =>
          musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "play",
            queueItemId,
            expectedVersion
          })
      );
    },
    [roomSnapshot, activeSession, runPlaybackMutation]
  );

  const pauseTrack = useCallback(
    async (positionMs = getCurrentPlaybackPositionMs()) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      await runPlaybackMutation(
        roomSnapshot.room.id,
        roomSnapshot.room.playback.queueVersion,
        (expectedVersion) =>
          musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "pause",
            positionMs,
            expectedVersion
          })
      );
    },
    [
      roomSnapshot,
      activeSession,
      getCurrentPlaybackPositionMs,
      runPlaybackMutation
    ]
  );

  const prevTrack = useCallback(async () => {
    if (!roomSnapshot || !activeSession || !roomSnapshot.room.playback.currentTrackId) {
      return;
    }

    await runPlaybackMutation(
      roomSnapshot.room.id,
      roomSnapshot.room.playback.queueVersion,
      (expectedVersion) =>
        musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "prev",
          expectedVersion
        })
    );
  }, [roomSnapshot, activeSession, runPlaybackMutation]);

  const nextTrack = useCallback(async () => {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    await runPlaybackMutation(
      roomSnapshot.room.id,
      roomSnapshot.room.playback.queueVersion,
      (expectedVersion) =>
        musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "next",
          expectedVersion
        })
    );
  }, [roomSnapshot, activeSession, runPlaybackMutation]);

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
        await musicRoomApi.importPlaylistToRoom(playlistId, {
          roomId: roomSnapshot.room.id
        });
        void syncRoomSnapshot(roomSnapshot.room.id).catch(() => undefined);
        setStatusMessage("歌单已加入当前房间队列。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, roomSnapshot, setStatusMessage, syncRoomSnapshot]
  );

  const removeQueueItem = useCallback(
    async (queueItemId: string) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      try {
        await musicRoomApi.removeQueueItem(roomSnapshot.room.id, queueItemId);
        void syncRoomSnapshot(roomSnapshot.room.id).catch(() => undefined);
        setStatusMessage("歌曲已从队列中移除。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [roomSnapshot, activeSession, setStatusMessage, syncRoomSnapshot]
  );

  const reorderQueue = useCallback(
    async (queueItemIds: string[]) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      try {
        await musicRoomApi.reorderQueue(roomSnapshot.room.id, {
          queueItemIds
        });
        void syncRoomSnapshot(roomSnapshot.room.id).catch(() => undefined);
        setStatusMessage("播放队列顺序已更新。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [roomSnapshot, activeSession, setStatusMessage, syncRoomSnapshot]
  );

  const seekTrack = useCallback(
    async (positionMs: number) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      await runPlaybackMutation(
        roomSnapshot.room.id,
        roomSnapshot.room.playback.queueVersion,
        (expectedVersion) =>
          musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "seek",
            positionMs,
            expectedVersion
          })
      );
    },
    [roomSnapshot, activeSession, runPlaybackMutation]
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
