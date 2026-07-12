"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import { toUserFacingError } from "@/lib/music-room-ui";
import {
  deleteCachedLibraryDeleteLease,
  listCachedLibraryDeleteLeases
} from "@/lib/indexeddb";

type UseRoomCacheLibraryActionsInput = {
  roomSnapshot: RoomSnapshot | null;
  startManualCacheDownload: (trackId: string) => Promise<unknown>;
  pauseManualCacheDownload: (trackId: string) => void;
  deleteCachedLibraryTrackEntry: (fileHash: string) => Promise<unknown>;
  exportCachedLibraryTrack: (fileHash: string) => Promise<unknown>;
  importCachedLibraryTrackToRoom: (fileHash: string) => Promise<string | null | undefined>;
  setStatusMessage: (value: string) => void;
  clearCacheStreamTrack?: (trackId: string) => void;
};

export function useRoomCacheLibraryActions({
  roomSnapshot,
  startManualCacheDownload,
  pauseManualCacheDownload,
  deleteCachedLibraryTrackEntry,
  exportCachedLibraryTrack,
  importCachedLibraryTrackToRoom,
  setStatusMessage,
  clearCacheStreamTrack
}: UseRoomCacheLibraryActionsInput) {
  const pendingCacheDeletesRef = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    void listCachedLibraryDeleteLeases().then(async (leases) => {
      for (const lease of leases) pendingCacheDeletesRef.current.add(lease.fileHash);
      for (const fileHash of pendingCacheDeletesRef.current) {
        if (cancelled) return;
        try {
          for (const track of roomSnapshot?.tracks ?? []) {
            if (track.fileHash === fileHash) {
              clearCacheStreamTrack?.(track.id);
            }
          }
          await deleteCachedLibraryTrackEntry(fileHash);
          await deleteCachedLibraryDeleteLease(fileHash);
          pendingCacheDeletesRef.current.delete(fileHash);
        } catch (error) {
          setStatusMessage(toUserFacingError(error));
        }
      }
    }).catch((error) => setStatusMessage(toUserFacingError(error)));
    return () => {
      cancelled = true;
    };
  }, [clearCacheStreamTrack, deleteCachedLibraryTrackEntry, roomSnapshot?.tracks, setStatusMessage]);
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
        for (const track of roomSnapshot?.tracks ?? []) {
          if (track.fileHash === fileHash) {
            clearCacheStreamTrack?.(track.id);
          }
        }
        await deleteCachedLibraryTrackEntry(fileHash);
        await deleteCachedLibraryDeleteLease(fileHash);
        pendingCacheDeletesRef.current.delete(fileHash);
        setStatusMessage("已从我的缓存库移除歌曲。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [clearCacheStreamTrack, deleteCachedLibraryTrackEntry, roomSnapshot?.tracks, setStatusMessage]
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
