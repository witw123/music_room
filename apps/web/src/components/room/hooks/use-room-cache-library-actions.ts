"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import { toUserFacingError } from "@/lib/music-room-ui";
import {
  deleteCachedLibraryDeleteLease,
  listCachedLibraryDeleteLeases,
  upsertCachedLibraryDeleteLease
} from "@/lib/indexeddb";

type UseRoomCacheLibraryActionsInput = {
  roomSnapshot: RoomSnapshot | null;
  startManualCacheDownload: (trackId: string) => Promise<unknown>;
  pauseManualCacheDownload: (trackId: string) => void;
  deleteCachedLibraryTrackEntry: (fileHash: string) => Promise<unknown>;
  exportCachedLibraryTrack: (fileHash: string) => Promise<unknown>;
  importCachedLibraryTrackToRoom: (fileHash: string) => Promise<string | null | undefined>;
  setStatusMessage: (value: string) => void;
};

export function useRoomCacheLibraryActions({
  roomSnapshot,
  startManualCacheDownload,
  pauseManualCacheDownload,
  deleteCachedLibraryTrackEntry,
  exportCachedLibraryTrack,
  importCachedLibraryTrackToRoom,
  setStatusMessage
}: UseRoomCacheLibraryActionsInput) {
  const pendingCacheDeletesRef = useRef(new Set<string>());
  const currentPlaybackFileHash = roomSnapshot?.tracks.find(
    (track) => track.id === roomSnapshot.room.playback.currentTrackId
  )?.fileHash ?? null;

  useEffect(() => {
    let cancelled = false;
    void listCachedLibraryDeleteLeases().then(async (leases) => {
      for (const lease of leases) pendingCacheDeletesRef.current.add(lease.fileHash);
      const readyDeletes = selectReadyCachedLibraryDeleteLeases(
        pendingCacheDeletesRef.current,
        currentPlaybackFileHash
      );
      for (const fileHash of readyDeletes) {
        if (cancelled) return;
        try {
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
  }, [currentPlaybackFileHash, deleteCachedLibraryTrackEntry, setStatusMessage]);
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
        if (removesCurrentTrack) {
          const leaseTrackId = roomSnapshot?.room.playback.currentTrackId ?? "";
          await upsertCachedLibraryDeleteLease({ fileHash, leaseTrackId });
          pendingCacheDeletesRef.current.add(fileHash);
          setStatusMessage("当前歌曲播放结束或切换后将从缓存库移除。");
          return;
        }
        await deleteCachedLibraryTrackEntry(fileHash);
        setStatusMessage("已从我的缓存库移除歌曲。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [deleteCachedLibraryTrackEntry, roomSnapshot, setStatusMessage]
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

export function selectReadyCachedLibraryDeleteLeases(
  fileHashes: ReadonlySet<string>,
  currentPlaybackFileHash: string | null
) {
  return [...fileHashes].filter((fileHash) => fileHash !== currentPlaybackFileHash);
}
