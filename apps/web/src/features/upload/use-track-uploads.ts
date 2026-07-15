"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { GuestSession, NeteaseTrackCandidate, RoomSnapshot } from "@music-room/shared";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  cleanupOrphanedLocalAudioStorage,
  deleteLocalTrackDataForTracks,
  listCachedLibraryTrackSummaries
} from "@/lib/indexeddb";
import type { CachedLibraryTrack, UploadedTrack } from "./audio-utils";
import {
  buildCachedLibraryTrackUpsertRecord,
  createInFlightCachedLibraryTrackFileLoader,
  hasUsableCachedLibraryFileForRoomTrack,
  loadCacheLibrarySnapshot
} from "./cache-library";
import { useUploadRuntimeEffects } from "./upload-runtime-effects";
import { useUploadPipelineActions } from "./use-upload-pipeline-actions";

export type LocalStorageSummary = {
  usageBytes: number | null;
  quotaBytes: number | null;
  cachedTrackCount: number;
};

export {
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
export {
  buildCachedLibraryFileName,
  createInFlightCachedLibraryTrackFileLoader,
  hasUsableCachedLibraryFileForRoomTrack,
  toCachedLibraryFile,
  toCachedLibraryFileFromBlob,
  toCachedLibraryTrack,
  toCachedLibraryTrackFile
} from "./cache-library";

export function useTrackUploads(options: {
  activeSession: GuestSession | null;
  roomSnapshot: RoomSnapshot | null;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setStatusMessage: (message: string) => void;
}) {
  const {
    activeSession,
    roomSnapshot,
    dispatchRoomStateEvent,
    setStatusMessage
  } = options;
  const [uploadedTracks, setUploadedTracks] = useState<Record<string, UploadedTrack>>({});
  const [cacheLibraryVersion, setCacheLibraryVersion] = useState(0);
  const [localStorageSummary, setLocalStorageSummary] = useState<LocalStorageSummary>({
    usageBytes: null,
    quotaBytes: null,
    cachedTrackCount: 0
  });
  const uploadedTrackUrlsRef = useRef<Map<string, string>>(new Map());
  const cacheLibraryTracksRef = useRef<Map<string, CachedLibraryTrack>>(new Map());
  const inFlightUploadHashesRef = useRef<Set<string>>(new Set());
  const roomTrackIdsKey = [...new Set(roomSnapshot?.tracks.map((track) => track.id) ?? [])]
    .sort()
    .join("|");

  const refreshCacheLibrary = useCallback(async () => {
    const snapshot = await loadCacheLibrarySnapshot({
      listCachedLibraryTrackSummaries
    });
    cacheLibraryTracksRef.current = snapshot.tracksByHash;
    setCacheLibraryVersion((current) => current + 1);
    let estimate: StorageEstimate | null = null;
    try {
      estimate = typeof navigator !== "undefined" && navigator.storage
        ? await navigator.storage.estimate()
        : null;
    } catch {
      estimate = null;
    }
    setLocalStorageSummary({
      usageBytes: estimate?.usage ?? null,
      quotaBytes: estimate?.quota ?? null,
      cachedTrackCount: snapshot.tracks.length
    });
  }, []);

  useUploadRuntimeEffects({
    activeSession,
    cacheLibraryVersion,
    cacheLibraryTracksRef,
    deleteLocalTrackData: deleteLocalTrackDataForTracks,
    roomSnapshot,
    roomTrackIdsKey,
    setUploadedTracks,
    uploadedTrackUrlsRef,
    uploadedTracks
  });

  const { syncRoomSnapshot, handleFilesSelected, handleNeteaseTrackImport } = useUploadPipelineActions({
    activeSession,
    dispatchRoomStateEvent,
    inFlightUploadHashesRef,
    refreshCacheLibrary,
    roomSnapshot,
    setStatusMessage,
    setUploadedTracks,
    uploadedTracks
  });

  const deleteUploadedTrackArtifacts = useCallback(async (trackId: string) => {
    setUploadedTracks((current) => {
      if (!current[trackId]) {
        return current;
      }
      const next = { ...current };
      delete next[trackId];
      return next;
    });
    await deleteLocalTrackDataForTracks([trackId]);
    await refreshCacheLibrary();
  }, [refreshCacheLibrary]);

  const deleteRoomTrackArtifacts = useCallback(async (trackIds: string[]) => {
    const removed = new Set(trackIds);
    setUploadedTracks((current) => {
      const next = { ...current };
      for (const trackId of removed) {
        delete next[trackId];
      }
      return next;
    });
    await deleteLocalTrackDataForTracks([...removed]);
    await refreshCacheLibrary();
  }, [refreshCacheLibrary]);

  const cleanLocalStorage = useCallback(async () => {
    try {
      const preserveTrackIds = roomSnapshot?.tracks.map((track) => track.id) ?? [];
      const preserveAssetIds = roomSnapshot?.tracks.flatMap((track) => [
        track.originalAsset?.assetId,
        track.playbackAsset?.assetId
      ].filter((assetId): assetId is string => !!assetId)) ?? [];
      const result = await cleanupOrphanedLocalAudioStorage({
        preserveTrackIds,
        preserveAssetIds
      });
      const preserved = new Set(preserveTrackIds);
      setUploadedTracks((current) =>
        Object.fromEntries(Object.entries(current).filter(([trackId]) => preserved.has(trackId)))
      );
      await refreshCacheLibrary();
      setStatusMessage(
        result.deletedCacheCount > 0 || result.deletedAssetCount > 0
          ? `已清理 ${result.deletedCacheCount} 个缓存文件和 ${result.deletedAssetCount} 个播放资产。`
          : "没有发现可清理的无效本机存储。"
      );
    } catch (error) {
      setStatusMessage("本机存储清理失败，请重试。");
      throw error;
    }
  }, [refreshCacheLibrary, roomSnapshot, setStatusMessage]);

  useEffect(() => {
    void refreshCacheLibrary();
  }, [refreshCacheLibrary]);

  return {
    uploadedTracks,
    setUploadedTracks,
    refreshCacheLibrary,
    localStorageSummary,
    cleanLocalStorage,
    handleFilesSelected,
    handleNeteaseTrackImport: (candidate: NeteaseTrackCandidate) =>
      handleNeteaseTrackImport(candidate),
    syncRoomSnapshot,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    hasUsableCachedLibraryFileForRoomTrack,
    createInFlightCachedLibraryTrackFileLoader,
    buildCachedLibraryTrackUpsertRecord
  };
}
