import {
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";
import type {
  GuestSession,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import {
  deleteCachedLibraryTrack as deleteCachedLibraryTrackRecord,
  deleteManualCacheTask,
  deleteManualCacheTasksForTracks,
  deleteCachedPiecesForTrack,
  deleteCachedPiecesForTracks,
  getCachedLibraryTrack
} from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  buildTrackAvailabilityFromFile
} from "@/features/p2p";
import {
  buildTrackMeta,
  type UploadedTrack
} from "@/features/upload/audio-utils";
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
import {
  shouldAnnounceTrackAvailability
} from "./track-availability";
import type { ManualCacheTask } from "./manual-cache-task-store";

type CacheLibraryActionsInput = {
  activeSession: GuestSession | null;
  dropManualCacheTask: (trackId: string) => void;
  emitAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  manualCacheAssemblingTrackIdsRef: MutableRefObject<Set<string>>;
  manualCacheChunkIndexesRef: MutableRefObject<Map<string, Set<number>>>;
  onAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  peerId: string;
  refreshCacheLibrary: () => Promise<void>;
  roomSnapshot: RoomSnapshot | null;
  setManualCacheTasks: Dispatch<SetStateAction<Record<string, ManualCacheTask>>>;
  setUploadedTracks: Dispatch<SetStateAction<Record<string, UploadedTrack>>>;
  syncRoomSnapshot: (roomId: string) => Promise<void>;
};

export function useCacheLibraryActions({
  activeSession,
  dropManualCacheTask,
  emitAvailability,
  manualCacheAssemblingTrackIdsRef,
  manualCacheChunkIndexesRef,
  onAvailability,
  peerId,
  refreshCacheLibrary,
  roomSnapshot,
  setManualCacheTasks,
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
        const result = await importCachedLibraryTrackToRoomFromLibrary({
        fileHash,
        activeSession,
        roomId: roomSnapshot.room.id,
        roomTracks: roomSnapshot.tracks,
        peerId,
        shouldAnnounceAvailability: shouldAnnounceTrackAvailability({ peerId }),
        loadCachedLibraryTrackFile,
        createObjectUrl: (file) => URL.createObjectURL(file),
        revokeObjectUrl: (href) => URL.revokeObjectURL(href),
        buildTrackMeta: (file, objectUrl) => buildTrackMeta(file, objectUrl, activeSession),
        buildRegisterTrackPayload: buildCachedLibraryTrackRegisterPayload,
        registerTrack: (roomId, payload) =>
          musicRoomApi.registerTrack(
            roomId,
            payload as Parameters<typeof musicRoomApi.registerTrack>[1]
          ),
        syncRoomSnapshot,
        buildTrackAvailabilityFromFile,
        publishAvailability: (availability) => {
          onAvailability(availability);
          emitAvailability(availability);
        }
      });
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
      emitAvailability,
      loadCachedLibraryTrackFile,
      onAvailability,
      peerId,
      roomSnapshot,
      setUploadedTracks,
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
