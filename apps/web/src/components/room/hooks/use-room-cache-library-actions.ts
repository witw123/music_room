"use client";

import { useCallback } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import { toUserFacingError } from "@/lib/music-room-ui";

type UseRoomCacheLibraryActionsInput = {
  roomSnapshot: RoomSnapshot | null;
  startManualCacheDownload: (trackId: string) => Promise<unknown>;
  pauseManualCacheDownload: (trackId: string) => void;
  deleteCachedLibraryTrackEntry: (fileHash: string) => Promise<unknown>;
  exportCachedLibraryTrack: (fileHash: string) => Promise<unknown>;
  importCachedLibraryTrackToRoom: (fileHash: string) => Promise<string | null | undefined>;
  resetPlayerSurface: () => void;
  setStatusMessage: (value: string) => void;
};

export function useRoomCacheLibraryActions({
  roomSnapshot,
  startManualCacheDownload,
  pauseManualCacheDownload,
  deleteCachedLibraryTrackEntry,
  exportCachedLibraryTrack,
  importCachedLibraryTrackToRoom,
  resetPlayerSurface,
  setStatusMessage
}: UseRoomCacheLibraryActionsInput) {
  const handleStartManualCacheDownload = useCallback(
    async (trackId: string) => {
      try {
        await startManualCacheDownload(trackId);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [setStatusMessage, startManualCacheDownload]
  );

  const handlePauseManualCacheDownload = useCallback((trackId: string) => {
    pauseManualCacheDownload(trackId);
    const trackTitle = roomSnapshot?.tracks.find((track) => track.id === trackId)?.title ?? "歌曲";
    setStatusMessage(`已暂停《${trackTitle}》的缓存下载。`);
  }, [pauseManualCacheDownload, roomSnapshot?.tracks, setStatusMessage]);

  const handleDeleteCachedLibraryTrack = useCallback(
    async (fileHash: string) => {
      try {
        const removesCurrentTrack = roomSnapshot?.tracks.some(
          (track) =>
            track.id === roomSnapshot.room.playback.currentTrackId &&
            track.fileHash === fileHash
        );
        await deleteCachedLibraryTrackEntry(fileHash);
        if (removesCurrentTrack) {
          resetPlayerSurface();
        }
        setStatusMessage("已从我的缓存库移除歌曲。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [deleteCachedLibraryTrackEntry, resetPlayerSurface, roomSnapshot, setStatusMessage]
  );

  const handleExportCachedLibraryTrack = useCallback(
    async (fileHash: string) => {
      try {
        await exportCachedLibraryTrack(fileHash);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [exportCachedLibraryTrack, setStatusMessage]
  );

  const handleAddCachedLibraryTrackToLibrary = useCallback(
    async (fileHash: string) => {
      try {
        const trackId = await importCachedLibraryTrackToRoom(fileHash);
        if (!trackId) {
          return;
        }
        const importedTrack = roomSnapshot?.tracks.find((track) => track.id === trackId)?.title ?? "歌曲";
        setStatusMessage(`已将《${importedTrack}》添加到当前曲库。`);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [importCachedLibraryTrackToRoom, roomSnapshot?.tracks, setStatusMessage]
  );

  return {
    handleAddCachedLibraryTrackToLibrary,
    handleDeleteCachedLibraryTrack,
    handleExportCachedLibraryTrack,
    handlePauseManualCacheDownload,
    handleStartManualCacheDownload
  };
}
