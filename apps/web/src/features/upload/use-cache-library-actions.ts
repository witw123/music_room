import {
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";
import type {
  AssetAvailabilityAnnouncement,
  GuestSession,
  RoomSnapshot
} from "@music-room/shared";
import {
  deleteCachedLibraryTrack as deleteCachedLibraryTrackRecord,
  deleteManualCacheTask,
  deleteManualCacheTasksForTracks,
  deleteCachedPiecesForTrack,
  deleteCachedPiecesForTracks,
  getCachedLibraryTrack,
  linkTrackAssets
} from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  buildTrackMeta,
  type UploadedTrack
} from "@/features/upload/audio-utils";
import { buildCompleteAssetAnnouncements } from "./asset-availability";
import { prepareAudioAssets, type PreparedAudioAssets } from "./audio-asset-builder";
import {
  applyCachedLibraryRoomImportResult,
  createInFlightCachedLibraryTrackFileLoader,
  deleteCachedLibraryTrackEntry as deleteCachedLibraryTrackEntryFromLibrary,
  deleteRoomTrackArtifacts as deleteRoomTrackArtifactsFromLibrary,
  deleteUploadedTrackArtifacts as deleteUploadedTrackArtifactsFromLibrary,
  exportCachedLibraryTrackFile,
  importCachedLibraryTrackToRoom as importCachedLibraryTrackToRoomFromLibrary,
  toCachedLibraryTrackFile
} from "./cache-library";
import {
  applyUploadRuntimeTrackRemoval
} from "./upload-runtime-cleanup";
import {
  buildCachedLibraryTrackRegisterPayload
} from "./upload-pipeline";
import type { ManualCacheTask } from "./manual-cache-task-store";

type CacheLibraryActionsInput = {
  activeSession: GuestSession | null;
  dropManualCacheTask: (trackId: string) => void;
  emitAssetAvailability: (announcement: AssetAvailabilityAnnouncement) => void;
  manualCacheAssemblingTrackIdsRef: MutableRefObject<Set<string>>;
  manualCacheChunkIndexesRef: MutableRefObject<Map<string, Set<number>>>;
  onAssetAvailability: (announcement: AssetAvailabilityAnnouncement) => void;
  peerId: string;
  refreshCacheLibrary: () => Promise<void>;
  roomSnapshot: RoomSnapshot | null;
  setManualCacheTasks: Dispatch<SetStateAction<Record<string, ManualCacheTask>>>;
  setStatusMessage: (message: string) => void;
  setUploadedTracks: Dispatch<SetStateAction<Record<string, UploadedTrack>>>;
  syncRoomSnapshot: (roomId: string) => Promise<void>;
};

export function useCacheLibraryActions({
  activeSession,
  dropManualCacheTask,
  emitAssetAvailability,
  manualCacheAssemblingTrackIdsRef,
  manualCacheChunkIndexesRef,
  onAssetAvailability,
  peerId,
  refreshCacheLibrary,
  roomSnapshot,
  setManualCacheTasks,
  setStatusMessage,
  setUploadedTracks,
  syncRoomSnapshot
}: CacheLibraryActionsInput) {
  const roomImportInFlightRef = useRef(new Map<string, Promise<string | null>>());
  const deleteUploadedTrackArtifacts = useCallback(
    async (trackId: string) => {
      const result = await deleteUploadedTrackArtifactsFromLibrary({
        trackId,
        roomId: roomSnapshot?.room.id,
        deleteCachedPiecesForTrack,
        deleteManualCacheTask
      });
      applyUploadRuntimeTrackRemoval({
        trackIds: result.removedTrackIds,
        setUploadedTracks,
        chunkIndexesByTrack: manualCacheChunkIndexesRef.current,
        assemblingTrackIdsByTrack: manualCacheAssemblingTrackIdsRef.current
      });
    },
    [
      manualCacheAssemblingTrackIdsRef,
      manualCacheChunkIndexesRef,
      roomSnapshot?.room.id,
      setUploadedTracks
    ]
  );

  const deleteRoomTrackArtifacts = useCallback(
    async (trackIds: string[]) => {
      const result = await deleteRoomTrackArtifactsFromLibrary({
        trackIds,
        roomId: roomSnapshot?.room.id,
        deleteCachedPiecesForTracks,
        deleteManualCacheTasksForTracks
      });
      applyUploadRuntimeTrackRemoval({
        trackIds: result.removedTrackIds,
        setUploadedTracks,
        setManualCacheTasks,
        chunkIndexesByTrack: manualCacheChunkIndexesRef.current,
        assemblingTrackIdsByTrack: manualCacheAssemblingTrackIdsRef.current
      });
    },
    [
      manualCacheAssemblingTrackIdsRef,
      manualCacheChunkIndexesRef,
      roomSnapshot?.room.id,
      setManualCacheTasks,
      setUploadedTracks
    ]
  );

  const loadCachedLibraryTrackFile = useMemo(
    () =>
      createInFlightCachedLibraryTrackFileLoader(async (fileHash) => {
        const cachedTrack = await getCachedLibraryTrack(fileHash);
        return cachedTrack ? toCachedLibraryTrackFile(cachedTrack) : null;
      }),
    []
  );

  const deleteCachedLibraryTrackEntry = useCallback(
    async (fileHash: string) => {
      const result = await deleteCachedLibraryTrackEntryFromLibrary({
        fileHash,
        deleteCachedLibraryTrackRecord,
        deleteCachedPiecesForTracks
      });
      for (const trackId of result.affectedTrackIds) {
        dropManualCacheTask(trackId);
      }
      await refreshCacheLibrary();
    },
    [dropManualCacheTask, refreshCacheLibrary]
  );

  const exportCachedLibraryTrack = useCallback(
    async (fileHash: string) => {
      await exportCachedLibraryTrackFile({
        fileHash,
        loadCachedLibraryTrackFile,
        createObjectUrl: (file) => URL.createObjectURL(file),
        clickDownload: (href, filename) => {
          const anchor = document.createElement("a");
          anchor.href = href;
          anchor.download = filename;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        },
        revokeObjectUrl: (href) => URL.revokeObjectURL(href),
        defer: (callback) => {
          window.setTimeout(callback, 0);
        }
      });
    },
    [loadCachedLibraryTrackFile]
  );

  const importCachedLibraryTrackToRoom = useCallback(
    async (fileHash: string) => {
      if (!activeSession || !roomSnapshot) {
        return null;
      }

      const existingImport = roomImportInFlightRef.current.get(fileHash);
      if (existingImport) {
        return existingImport;
      }

      const importPromise = (async () => {
        let preparedAssets: PreparedAudioAssets | null = null;
        const result = await importCachedLibraryTrackToRoomFromLibrary({
          fileHash,
          activeSession,
          roomId: roomSnapshot.room.id,
          roomTracks: roomSnapshot.tracks,
          loadCachedLibraryTrackFile,
          createObjectUrl: (file) => URL.createObjectURL(file),
          revokeObjectUrl: (href) => URL.revokeObjectURL(href),
          buildTrackMeta: async (file, objectUrl) => {
            preparedAssets = await prepareAudioAssets({
              file,
              onProgress: ({ completed, total }) => {
                const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
                setStatusMessage(`正在重建成员端播放资产 ${percent}%`);
              }
            });
            return buildTrackMeta(file, objectUrl, activeSession, preparedAssets);
          },
          buildRegisterTrackPayload: buildCachedLibraryTrackRegisterPayload,
          registerTrack: (roomId, payload) =>
            musicRoomApi.registerTrack(
              roomId,
              payload as Parameters<typeof musicRoomApi.registerTrack>[1]
            ),
          syncRoomSnapshot
        });
        const assets = preparedAssets as PreparedAudioAssets | null;
        if (result && assets && peerId) {
          await linkTrackAssets({
            trackId: result.trackId,
            originalAssetId: assets.originalAsset.assetId,
            playbackAssetId: assets.playbackAsset.assetId
          });
          for (const announcement of buildCompleteAssetAnnouncements({
            roomId: roomSnapshot.room.id,
            peerId,
            nickname: activeSession.nickname,
            source: "local_cache",
            originalAsset: assets.originalAsset
          })) {
            onAssetAvailability(announcement);
            emitAssetAvailability(announcement);
          }
        }
        return applyCachedLibraryRoomImportResult({
          result,
          setUploadedTracks
        });
      })();
      roomImportInFlightRef.current.set(fileHash, importPromise);
      try {
        return await importPromise;
      } finally {
        if (roomImportInFlightRef.current.get(fileHash) === importPromise) {
          roomImportInFlightRef.current.delete(fileHash);
        }
      }
    },
    [
      activeSession,
      emitAssetAvailability,
      loadCachedLibraryTrackFile,
      onAssetAvailability,
      peerId,
      roomSnapshot,
      setUploadedTracks,
      setStatusMessage,
      syncRoomSnapshot
    ]
  );

  return {
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    deleteCachedLibraryTrackEntry,
    loadCachedLibraryTrackFile,
    exportCachedLibraryTrack,
    importCachedLibraryTrackToRoom
  };
}
