"use client";

import { useCallback } from "react";
import type { RoomSnapshot } from "@music-room/shared";

type UseRoomClipboardActionsInput = {
  roomSnapshot: RoomSnapshot | null;
  setStatusMessage: (message: string) => void;
};

export function useRoomClipboardActions({
  roomSnapshot,
  setStatusMessage
}: UseRoomClipboardActionsInput) {
  const handleCopyJoinCode = useCallback(async () => {
    if (!roomSnapshot) {
      return;
    }

    try {
      await navigator.clipboard.writeText(roomSnapshot.room.joinCode);
      setStatusMessage(`已复制房间码 ${roomSnapshot.room.joinCode}。`);
    } catch {
      setStatusMessage("复制房间码失败，请手动复制。");
    }
  }, [roomSnapshot, setStatusMessage]);

  return {
    handleCopyJoinCode
  };
}
