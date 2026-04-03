"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Playlist, RoomSnapshot } from "@music-room/shared";
import type { Route } from "next";
import { musicRoomApi } from "@/lib/music-room-api";

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
  setSuppressRoomRecovery: Dispatch<SetStateAction<boolean>>;
  setRoomSnapshot: Dispatch<SetStateAction<RoomSnapshot | null>>;
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
  setSuppressRoomRecovery,
  setRoomSnapshot,
  setPlaylists,
  leaveRoom,
  deleteRoom,
  setIsNavigatingRoomExit
}: UseRoomLifecycleActionsInput) {
  const handleClearIdentity = useCallback(() => {
    setSuppressRoomRecovery(true);
    resetPlayerSurface();
    clearIdentity();
    setRoomSnapshot(null);
    setPlaylists([]);
    window.localStorage.removeItem("music-room-last-room");
  }, [
    clearIdentity,
    resetPlayerSurface,
    setPlaylists,
    setRoomSnapshot,
    setSuppressRoomRecovery
  ]);

  const handleLeaveRoomAction = useCallback(async () => {
    setIsNavigatingRoomExit(true);
    const didLeave = await leaveRoom();
    if (!didLeave) {
      setIsNavigatingRoomExit(false);
      return;
    }

    setSuppressRoomRecovery(true);
    setRoomSnapshot(null);
    setPlaylists([]);
    if (workspaceOnly) {
      router.push(workspaceEntryHref as Route);
      return;
    }

    setIsNavigatingRoomExit(false);
  }, [
    leaveRoom,
    router,
    setPlaylists,
    setIsNavigatingRoomExit,
    setRoomSnapshot,
    setSuppressRoomRecovery,
    workspaceEntryHref,
    workspaceOnly
  ]);

  const handleDeleteRoomAction = useCallback(async () => {
    setIsNavigatingRoomExit(true);
    const didDelete = await deleteRoom();
    if (!didDelete) {
      setIsNavigatingRoomExit(false);
      return;
    }

    setSuppressRoomRecovery(true);
    setRoomSnapshot(null);
    setPlaylists([]);
    if (workspaceOnly) {
      router.push(workspaceEntryHref as Route);
      return;
    }

    setIsNavigatingRoomExit(false);
  }, [
    deleteRoom,
    router,
    setPlaylists,
    setIsNavigatingRoomExit,
    setRoomSnapshot,
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
