"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Playlist } from "@music-room/shared";
import type { Route } from "next";
import { musicRoomApi } from "@/lib/network/music-room-api";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { clearAwayRoomId } from "@/lib/domain/away-room";
import { closeDesktopLyricsNative } from "@/features/playback/desktop-lyrics-context";

type RoomRouter = {
  push: (href: Route) => void;
  replace: (href: Route) => void;
};

type UseRoomLifecycleActionsInput = {
  workspaceOnly: boolean;
  workspaceEntryHref: string;
  authEntryHref: string;
  router: RoomRouter;
  clearIdentity: () => void;
  resetPlayerSurface: () => void;
  resetRealtimePeer: () => void;
  setSuppressRoomRecovery: Dispatch<SetStateAction<boolean>>;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setPlaylists: Dispatch<SetStateAction<Playlist[]>>;
  leaveRoom: () => Promise<boolean>;
  deleteRoom: () => Promise<boolean>;
  setIsNavigatingRoomExit: Dispatch<SetStateAction<boolean>>;
};

export function useRoomLifecycleActions({
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
}: UseRoomLifecycleActionsInput) {
  const handleClearIdentity = useCallback(() => {
    setSuppressRoomRecovery(true);
    resetPlayerSurface();
    roomAudioOutput.releaseRoomAudioSession();
    closeDesktopLyricsNative();
    resetRealtimePeer();
    clearIdentity();
    clearAwayRoomId();
    dispatchRoomStateEvent({ type: "local-reset" });
    setPlaylists([]);
    window.localStorage.removeItem("music-room-last-room");
  }, [
    clearIdentity,
    dispatchRoomStateEvent,
    resetPlayerSurface,
    resetRealtimePeer,
    setPlaylists,
    setSuppressRoomRecovery
  ]);

  const handleLeaveRoomAction = useCallback(async () => {
    setIsNavigatingRoomExit(true);
    closeDesktopLyricsNative();
    const didLeave = await leaveRoom();
    if (!didLeave) {
      setIsNavigatingRoomExit(false);
      return;
    }

    setSuppressRoomRecovery(true);
    clearAwayRoomId();
    dispatchRoomStateEvent({ type: "local-reset" });
    setPlaylists([]);
    if (workspaceOnly) {
      router.replace(workspaceEntryHref as Route);
      return;
    }

    setIsNavigatingRoomExit(false);
  }, [
    dispatchRoomStateEvent,
    leaveRoom,
    router,
    setPlaylists,
    setIsNavigatingRoomExit,
    setSuppressRoomRecovery,
    workspaceEntryHref,
    workspaceOnly
  ]);

  const handleDeleteRoomAction = useCallback(async () => {
    setIsNavigatingRoomExit(true);
    closeDesktopLyricsNative();
    const didDelete = await deleteRoom();
    if (!didDelete) {
      setIsNavigatingRoomExit(false);
      return;
    }

    setSuppressRoomRecovery(true);
    clearAwayRoomId();
    dispatchRoomStateEvent({ type: "local-reset" });
    setPlaylists([]);
    if (workspaceOnly) {
      router.replace(workspaceEntryHref as Route);
      return;
    }

    setIsNavigatingRoomExit(false);
  }, [
    dispatchRoomStateEvent,
    deleteRoom,
    router,
    setPlaylists,
    setIsNavigatingRoomExit,
    setSuppressRoomRecovery,
    workspaceEntryHref,
    workspaceOnly
  ]);

  const handleLogout = useCallback(async () => {
    try {
      await musicRoomApi.logout();
    } catch {
      // Keep local logout behavior even if the server session is already gone.
    }

    handleClearIdentity();
    router.replace(authEntryHref as Route);
  }, [authEntryHref, handleClearIdentity, router]);

  return {
    handleClearIdentity,
    handleLeaveRoomAction,
    handleDeleteRoomAction,
    handleLogout
  };
}
