"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type {
  GuestSession,
  QqMusicTrackCandidate,
  NeteaseTrackCandidate,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  cleanupOrphanedLocalAudioStorage,
  deleteLocalTrackDataForTracks,
  getCachedLibraryTrack,
  listCachedLibraryTrackSummaries
} from "@/lib/indexeddb";
import type { CachedLibraryTrack, UploadedTrack } from "./audio-utils";
import {
  buildCachedLibraryFileName,
  buildCachedLibraryTrackUpsertRecord,
  createInFlightCachedLibraryTrackFileLoader,
  hasUsableCachedLibraryFileForRoomTrack,
  loadCacheLibrarySnapshot,
  toCachedLibraryFile
} from "./cache-library";
import {
  buildLocalAudioFileName,
  chooseLocalAudioDirectory,
  cleanupLocalAudioCacheFiles,
  downloadAudioFile,
  getLocalAudioCacheFile,
  getLocalAudioFile,
  getLocalAudioStorageState,
  getOriginalAssetFile,
  normalizeLocalAudioMimeType,
  saveAudioFileToLocalDirectory,
  supportsLocalAudioDirectory
} from "./local-audio-storage";
import { useUploadRuntimeEffects } from "./upload-runtime-effects";
import { useUploadPipelineActions } from "./use-upload-pipeline-actions";
import {
  playlistsChangedEventName,
  playlistsChangedStorageKey,
  musicRoomApi
} from "@/lib/music-room-api";
import {
  ensureDefaultLocalPlaylist,
  getDefaultLocalPlaylistTrackIds,
  listMergedLocalPlaylistTracks,
  restoreLocalPlaylistsFromRepository,
  syncSelectedLocalDirectoryTracks
} from "@/features/playlist/local-playlist";
import type { LocalPlaylistRecord } from "@/features/playlist/local-playlist";
import type { LocalPlaylistTrackRecord } from "@/lib/indexeddb";

export type LocalStorageSummary = {
  usageBytes: number | null;
  quotaBytes: number | null;
  cachedTrackCount: number;
  cachedLibraryTracks: CachedLibraryTrack[];
  localPlaylists: LocalPlaylistRecord[];
  localPlaylistTracks: LocalPlaylistTrackRecord[];
  localFolderName: string | null;
  localCachedFileHashes: string[];
  localSavedFileHashes: string[];
  supportsLocalFolder: boolean;
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
    cachedTrackCount: 0,
    cachedLibraryTracks: [],
    localPlaylists: [],
    localPlaylistTracks: [],
    localFolderName: null,
    localCachedFileHashes: [],
    localSavedFileHashes: [],
    supportsLocalFolder: false
  });
  const uploadedTrackUrlsRef = useRef<Map<string, string>>(new Map());
  const cacheLibraryTracksRef = useRef<Map<string, CachedLibraryTrack>>(new Map());
  const inFlightUploadHashesRef = useRef<Set<string>>(new Set());
  const localDirectoryScanAttemptedRef = useRef(false);
  const roomTrackIdsKey = [...new Set(roomSnapshot?.tracks.map((track) => track.id) ?? [])]
    .sort()
    .join("|");

  const refreshCacheLibrary = useCallback(async () => {
    let localStorageState = await getLocalAudioStorageState();
    if (localStorageState.directoryName && !localDirectoryScanAttemptedRef.current) {
      localDirectoryScanAttemptedRef.current = true;
      await syncSelectedLocalDirectoryTracks().catch(() => undefined);
      localStorageState = await getLocalAudioStorageState();
    }
    const [snapshot, localPlaylistTracks] = await Promise.all([
      loadCacheLibrarySnapshot({ listCachedLibraryTrackSummaries }),
      listMergedLocalPlaylistTracks()
    ]);
    await restoreLocalPlaylistsFromRepository();
    const localPlaylists = ensureDefaultLocalPlaylist({
      trackIds: getDefaultLocalPlaylistTrackIds(
        localPlaylistTracks,
        new Set(localStorageState.savedFileHashes)
      ),
      sourceDirectoryName: localStorageState.directoryName
    });
    cacheLibraryTracksRef.current = snapshot.tracksByHash;
    setCacheLibraryVersion((current) => current + 1);
    const localCachedFileHashes = localStorageState.directoryName
      ? new Set(localStorageState.cachedFileHashes)
      : new Set<string>();
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
      cachedTrackCount: snapshot.tracks.length,
      cachedLibraryTracks: snapshot.tracks.filter((track) =>
        localCachedFileHashes.has(track.fileHash)
      ),
      localPlaylists,
      localPlaylistTracks,
      localFolderName: localStorageState.directoryName,
      localCachedFileHashes: localStorageState.cachedFileHashes,
      localSavedFileHashes: localStorageState.savedFileHashes,
      supportsLocalFolder: localStorageState.supported
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

  const {
    syncRoomSnapshot,
    handleFilesSelected,
    handleNeteaseTrackImport,
    handleQqMusicTrackImport
  } = useUploadPipelineActions({
    activeSession,
    dispatchRoomStateEvent,
    inFlightUploadHashesRef,
    refreshCacheLibrary,
    roomSnapshot,
    setStatusMessage,
    setUploadedTracks,
    uploadedTracks
  });

  const importCachedTrack = useCallback(async (cachedTrack: CachedLibraryTrack) => {
    try {
      const localFile =
        (await getLocalAudioCacheFile(cachedTrack.fileHash)) ??
        (await getLocalAudioFile(
          cachedTrack.fileHash,
          cachedTrack.sourceDirectoryId,
          cachedTrack.sourceFileName
        ));
      const indexedDbRecord = localFile
        ? null
        : await getCachedLibraryTrack(cachedTrack.fileHash);
      const sourceFile = localFile ?? indexedDbRecord?.file ?? null;
      if (!sourceFile) {
        setStatusMessage(`《${cachedTrack.title}》的本地缓存文件不可读取，请重新选择存储文件夹。`);
        return;
      }

      const file = new File([sourceFile], buildCachedLibraryFileName({
        title: cachedTrack.title,
        mimeType: cachedTrack.mimeType || sourceFile.type || "audio/mpeg",
        fileHash: cachedTrack.fileHash
      }), {
        type: cachedTrack.mimeType || sourceFile.type || "audio/mpeg"
      });
      await handleFilesSelected([file], new Map([[cachedTrack.fileHash, cachedTrack]]));
    } catch (error) {
      const detail = error instanceof Error && error.message
        ? `：${error.message}`
        : "，请重试";
      setStatusMessage(`《${cachedTrack.title}》导入失败${detail}`);
    }
  }, [handleFilesSelected, setStatusMessage]);

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
    await cleanupLocalAudioCacheFiles();
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
    await cleanupLocalAudioCacheFiles();
    await refreshCacheLibrary();
  }, [refreshCacheLibrary]);

  const chooseLocalFolder = useCallback(async () => {
    try {
      const folderName = await chooseLocalAudioDirectory();
      localDirectoryScanAttemptedRef.current = false;
      await refreshCacheLibrary();
      setStatusMessage(`Music Room 本地存储仓库已设置为“${folderName}”，仅点击“保存到本地”的歌曲会写入该目录。`);
    } catch (error) {
      setStatusMessage(error instanceof Error && error.name === "AbortError"
        ? "已取消选择本地音频文件夹。"
        : toLocalAudioErrorMessage(error));
    }
  }, [refreshCacheLibrary, setStatusMessage]);

  const saveTrackToLocal = useCallback(async (track: TrackMeta) => {
    try {
      let file: Blob | null = null;
      if (track.sourceRef) {
        setStatusMessage(`正在从${track.sourceRef.provider === "netease" ? "网易云音乐" : "QQ 音乐"}下载《${track.title}》...`);
        const downloaded = track.sourceRef.provider === "netease"
          ? await musicRoomApi.downloadNeteaseTrack(track.sourceRef.trackId, "exhigh")
          : await musicRoomApi.downloadQqMusicTrack(track.sourceRef.trackId, "exhigh");
        const downloadedMimeType = normalizeLocalAudioMimeType(downloaded.contentType);
        file = new File(
          [downloaded.blob],
          buildLocalAudioFileName({
            title: track.title,
            mimeType: downloadedMimeType,
            fileHash: track.fileHash
          }),
          { type: downloadedMimeType }
        );
      } else {
        file = uploadedTracks[track.id]?.file ?? null;
        if (!file) {
          const cachedRecord = await getCachedLibraryTrack(track.fileHash);
          if (cachedRecord) {
            file = toCachedLibraryFile({
              file: cachedRecord.file,
              title: cachedRecord.title,
              mimeType: cachedRecord.mimeType,
              fileHash: cachedRecord.fileHash
            });
          }
        }
        if (!file) {
          const localCachedFile = await getLocalAudioCacheFile(track.fileHash);
          if (localCachedFile) file = localCachedFile;
        }
        if (!file) {
          const localFile = await getLocalAudioFile(track.fileHash);
          if (localFile) file = localFile;
        }
        if (!file && track.originalAsset) {
          const originalFile = await getOriginalAssetFile({
            assetId: track.originalAsset.assetId,
            fileHash: track.fileHash,
            title: track.title,
            mimeType: track.mimeType ?? track.originalAsset.mimeType
          });
          if (originalFile) file = originalFile;
        }
      }
      if (!file) {
        throw new Error(track.sourceType === "local_upload"
          ? "本地上传歌曲没有平台下载地址，请由上传者先保存到本地后再导入。"
          : "当前歌曲没有可用的下载地址，请稍后重试。");
      }

      const mimeType = normalizeLocalAudioMimeType(track.mimeType ?? file.type);
      const lyrics = track.sourceRef
        ? (await (track.sourceRef.provider === "netease"
          ? musicRoomApi.getNeteaseLyrics(track.sourceRef.trackId)
          : musicRoomApi.getQqMusicLyrics(track.sourceRef.trackId)
        ).catch(() => null))?.plainLyric ?? null
        : null;
      if (supportsLocalAudioDirectory()) {
        await saveAudioFileToLocalDirectory({
          file,
          fileHash: track.fileHash,
          title: track.title,
          mimeType,
          trackId: track.id,
          track: {
            artist: track.artist,
            album: track.album,
            artworkUrl: track.artworkUrl,
            lyrics,
            provider: track.sourceType,
            providerTrackId: track.sourceRef?.trackId ?? null,
            durationMs: track.durationMs,
            sizeBytes: file.size
          }
        });
        await refreshCacheLibrary();
        setStatusMessage(`《${track.title}》已保存到本地文件夹，浏览器缓存中的源文件已释放。`);
        return;
      }

      downloadAudioFile(
        file,
        buildLocalAudioFileName({
          title: track.title,
          mimeType,
          fileHash: track.fileHash
        })
      );
      setStatusMessage(`《${track.title}》已开始下载。当前浏览器不支持自动选择文件夹。`);
    } catch (error) {
      setStatusMessage(toLocalAudioErrorMessage(error));
    }
  }, [refreshCacheLibrary, setStatusMessage, uploadedTracks]);

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
      const deletedLocalCacheFiles = await cleanupLocalAudioCacheFiles();
      const preserved = new Set(preserveTrackIds);
      setUploadedTracks((current) =>
        Object.fromEntries(Object.entries(current).filter(([trackId]) => preserved.has(trackId)))
      );
      await refreshCacheLibrary();
      setStatusMessage(
        result.deletedCacheCount > 0 || result.deletedAssetCount > 0 || deletedLocalCacheFiles > 0
          ? `已清理 ${result.deletedCacheCount + deletedLocalCacheFiles} 个缓存文件和 ${result.deletedAssetCount} 个播放资产。`
          : "没有发现可清理的无效本机存储。"
      );
    } catch (error) {
      setStatusMessage("本机存储清理失败，请重试。");
      throw error;
    }
  }, [refreshCacheLibrary, roomSnapshot, setStatusMessage]);

  useEffect(() => {
    void refreshCacheLibrary();
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") {
        void refreshCacheLibrary();
      }
    };
    const refreshWhenPlaylistsChange = () => {
      void refreshCacheLibrary();
    };
    const refreshWhenPlaylistStorageChanges = (event: StorageEvent) => {
      if (event.key === playlistsChangedStorageKey) {
        refreshWhenPlaylistsChange();
      }
    };
    const refreshInterval = window.setInterval(refreshWhenActive, 10_000);
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener(playlistsChangedEventName, refreshWhenPlaylistsChange);
    window.addEventListener("storage", refreshWhenPlaylistStorageChanges);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener(playlistsChangedEventName, refreshWhenPlaylistsChange);
      window.removeEventListener("storage", refreshWhenPlaylistStorageChanges);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [refreshCacheLibrary, roomSnapshot?.room.id]);

  return {
    uploadedTracks,
    setUploadedTracks,
    refreshCacheLibrary,
    importCachedTrack,
    localStorageSummary,
    cleanLocalStorage,
    chooseLocalFolder,
    saveTrackToLocal,
    handleFilesSelected,
    handleNeteaseTrackImport: (candidate: NeteaseTrackCandidate) =>
      handleNeteaseTrackImport(candidate),
    handleQqMusicTrackImport: (candidate: QqMusicTrackCandidate) =>
      handleQqMusicTrackImport(candidate),
    syncRoomSnapshot,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    hasUsableCachedLibraryFileForRoomTrack,
    createInFlightCachedLibraryTrackFileLoader,
    buildCachedLibraryTrackUpsertRecord
  };
}

function toLocalAudioErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "本地音频保存失败，请重试。";
}
