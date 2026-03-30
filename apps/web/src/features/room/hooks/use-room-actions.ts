"use client";

import type { GuestSession, Playlist, RoomSnapshot } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";
import { toUserFacingError } from "@/lib/music-room-ui";

type UseRoomActionsOptions = {
  activeSession: GuestSession | null;
  nickname: string;
  roomSnapshot: RoomSnapshot | null;
  progressMs: number;
  setNickname: (value: string) => void;
  setActiveSession: (value: GuestSession | null) => void;
  setRoomSnapshot: (value: RoomSnapshot | null) => void;
  setAvailableRooms: React.Dispatch<React.SetStateAction<RoomSnapshot[]>>;
  setPlaylists: React.Dispatch<React.SetStateAction<Playlist[]>>;
  setStatusMessage: (value: string) => void;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: (ownerId: string) => Promise<void>;
  resetPlayerSurface: () => void;
  lastRoomStorageKey: string;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

export function useRoomActions(options: UseRoomActionsOptions) {
  const {
    activeSession,
    nickname,
    roomSnapshot,
    progressMs,
    setNickname,
    setActiveSession,
    setRoomSnapshot,
    setAvailableRooms,
    setStatusMessage,
    refreshAvailableRooms,
    refreshPlaylists,
    resetPlayerSurface,
    lastRoomStorageKey,
    audioRef
  } = options;

  async function ensureSession(requiredNickname: string, actionLabel: string) {
    const trimmedNickname = requiredNickname.trim();
    if (!trimmedNickname) {
      setStatusMessage("请输入昵称。");
      return null;
    }

    setNickname(trimmedNickname);

    if (activeSession && activeSession.nickname === trimmedNickname) {
      return activeSession;
    }

    try {
      const nextSession = await musicRoomApi.createGuestSession(trimmedNickname);
      setActiveSession(nextSession);
      return nextSession;
    } catch (error) {
      const message = toUserFacingError(error);
      setStatusMessage(`${actionLabel}失败：${message}`);
      return null;
    }
  }

  async function handleConfirmIdentity() {
    const sessionForAction = await ensureSession(nickname, "确认昵称");
    if (!sessionForAction) {
      return;
    }
    setStatusMessage(`已确认身份：${sessionForAction.nickname}。现在可以创建或加入房间。`);
    await refreshAvailableRooms();
  }

  async function refreshRoom(roomId: string) {
    const snapshot = await musicRoomApi.getRoom(roomId, activeSession?.id);
    setRoomSnapshot(snapshot);
  }

  async function handleCreateRoom() {
    if (!activeSession) {
      setStatusMessage("请先输入昵称并确认身份。");
      return;
    }

    try {
      const snapshot = await musicRoomApi.createRoom(activeSession.id, "public");
      setRoomSnapshot(snapshot);
      setAvailableRooms((current) => {
        const next = current.filter((room) => room.room.id !== snapshot.room.id);
        return [snapshot, ...next];
      });
      setStatusMessage(`房间已创建，房间码 ${snapshot.room.joinCode}。`);
      await refreshPlaylists(activeSession.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleJoinRoom(code: string) {
    if (!activeSession) {
      setStatusMessage("请先输入昵称并确认身份。");
      return;
    }
    if (!code.trim()) {
      setStatusMessage("请输入房间码。");
      return;
    }

    try {
      const snapshot = await musicRoomApi.joinRoomByCode(activeSession.id, code.trim());
      setRoomSnapshot(snapshot);
      await refreshAvailableRooms();
      const joinedMember =
        snapshot.room.members.find((member) => member.id === activeSession.id) ??
        (snapshot.room.hostId === activeSession.id
          ? { role: "host" as const }
          : { role: "member" as const });
      setStatusMessage(
        joinedMember.role === "host"
          ? `已加入房间 ${snapshot.room.joinCode}，你当前是房主。`
          : `已加入房间 ${snapshot.room.joinCode}，你当前是成员。`
      );
      await refreshPlaylists(activeSession.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function leaveRoom() {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.leaveRoom(roomSnapshot.room.id, activeSession.id);
      resetPlayerSurface();
      setRoomSnapshot(null);
      window.localStorage.removeItem(lastRoomStorageKey);
      await refreshAvailableRooms();
      setStatusMessage("已离开房间。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function deleteRoom() {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.deleteRoom(roomSnapshot.room.id, activeSession.id);
      resetPlayerSurface();
      setRoomSnapshot(null);
      window.localStorage.removeItem(lastRoomStorageKey);
      await refreshAvailableRooms();
      setStatusMessage("房间已删除。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function addToQueue(trackId: string) {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.addQueueItem(roomSnapshot.room.id, {
        sessionId: activeSession.id,
        trackId
      });
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("曲目已添加到播放队列。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function playTrack(trackId?: string) {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "play",
        trackId,
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function playQueueItem(queueItemId: string) {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "play",
        queueItemId,
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function pauseTrack(positionMs = Math.round((audioRef.current?.currentTime ?? 0) * 1000)) {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "pause",
        positionMs,
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function prevTrack() {
    if (!roomSnapshot || !activeSession) return;

    try {
      const playback = roomSnapshot.room.playback;
      if (!playback?.currentTrackId) {
        return;
      }

      if (progressMs > 3000) {
        await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "seek",
          positionMs: 0,
          sessionId: activeSession.id
        });
      } else {
        await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "prev",
          sessionId: activeSession.id
        });
      }
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function nextTrack() {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "next",
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function savePlaylistFromQueue(title: string) {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.createPlaylistFromRoom({
        ownerId: activeSession.id,
        roomId: roomSnapshot.room.id,
        title,
        description: "从当前房间队列保存"
      });
      await refreshPlaylists(activeSession.id);
      setStatusMessage(`歌单“${title}”已保存。`);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function updatePlaylistTitle(playlistId: string, title: string) {
    if (!activeSession) return;

    try {
      await musicRoomApi.updatePlaylist(playlistId, {
        ownerId: activeSession.id,
        title
      });
      await refreshPlaylists(activeSession.id);
      setStatusMessage("歌单名称已更新。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function deletePlaylist(playlistId: string) {
    if (!activeSession) return;

    try {
      await musicRoomApi.deletePlaylist(playlistId, activeSession.id);
      await refreshPlaylists(activeSession.id);
      setStatusMessage("歌单已删除。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function loadPlaylistIntoRoom(playlistId: string) {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.importPlaylistToRoom(playlistId, {
        roomId: roomSnapshot.room.id,
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("歌单已加载到当前房间的播放队列。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function removeQueueItem(queueItemId: string) {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.removeQueueItemAs(roomSnapshot.room.id, queueItemId, activeSession.id);
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("曲目已从队列中移除。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function reorderQueue(queueItemIds: string[]) {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.reorderQueue(roomSnapshot.room.id, {
        sessionId: activeSession.id,
        queueItemIds
      });
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("播放队列顺序已更新。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function seekTrack(positionMs: number) {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "seek",
        positionMs,
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleEnded() {
    if (!roomSnapshot) return;
    await nextTrack();
  }

  return {
    ensureSession,
    handleConfirmIdentity,
    handleCreateRoom,
    handleJoinRoom,
    refreshRoom,
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
    deletePlaylist,
    loadPlaylistIntoRoom,
    removeQueueItem,
    reorderQueue,
    seekTrack,
    handleEnded
  };
}
