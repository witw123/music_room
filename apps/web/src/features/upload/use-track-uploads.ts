"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import type { GuestSession, RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import {
  assembleTrackFileFromPieces,
  buildTrackAvailabilityFromCache,
  buildTrackAvailabilityFromFile,
  buildTrackAvailabilityFromManifest
} from "@/features/p2p";
import { enableManualTrackCaching } from "@/features/cache/cache-policy";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  deleteManualCacheTask,
  deleteCachedPiecesForTrack,
  getCachedLibraryTrack,
  getCachedLibraryTrackCount,
  getCachedLibraryTrackSummary,
  getCachedPiecesForTrack,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  listCachedLibraryTrackSummaries,
  localCacheOwnerKey,
  upsertManualCacheTask,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  buildTrackMeta,
  type CachedLibraryTrack,
  type UploadedTrack
} from "@/features/upload/audio-utils";
import {
  buildCachedLibraryTrackUpsertRecord,
  loadCacheLibrarySnapshot
} from "./cache-library";
import {
  announceRoomTrackAvailability as announceRoomTrackAvailabilityFromSources
} from "./track-availability";
import {
  resolveStalePlaybackDemandTaskIds,
  type ManualCacheTask
} from "./upload-ui-state";
import {
  applyManualCacheTaskDrop,
  applyManualCacheTaskUpdate
} from "./manual-cache-task-store";
import {
  applySelectedTrackFilesResult,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
import { assembleManualCacheTrackFromPieces } from "./manual-cache-assembly";
import { useUploadRuntimeEffects } from "./upload-runtime-effects";
import { useManualCacheActions } from "./use-manual-cache-actions";
import { useCacheLibraryActions } from "./use-cache-library-actions";

export {
  buildCachedLibraryTrackRegisterPayload,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
export {
  createInFlightCachedLibraryTrackFileLoader,
  hasUsableCachedLibraryFileForRoomTrack
} from "./cache-library";
export {
  announceRoomTrackAvailability,
  buildManualCachePieceAvailabilityAnnouncement,
  isManualCachePieceCompatible,
  resolveMissingOwnedUploadedTracks,
  resolveReusableCachedPieceManifest,
  shouldAnnounceTrackAvailability
} from "./track-availability";
export {
  mergeHydratedManualCacheTasks,
  mergeManualCachePieceTaskProgress,
  mergeManualCachePlanTaskProgress,
  pruneManualCacheChunkIndexesByActiveTracks,
  resolveAutomaticPlaybackCacheTaskMode,
  resolveManualCachePlanReceivedAction,
  resolveStalePlaybackDemandTaskIds,
  shouldAssembleManualCachePlanProgress,
  shouldCreatePlaybackDemandTaskFromCachePiece,
  shouldEnsurePlaybackDemandCacheTask,
  shouldHydrateCacheTaskPieceIndexes,
  shouldIgnoreManualCachePieceTaskUpdate
} from "./upload-ui-state";
export type {
  ManualCacheTask,
  ManualCacheTaskStatus
} from "./upload-ui-state";

export function useTrackUploads(options: {
  peerId: string;
  activeSession: GuestSession | null;
  roomSnapshot: RoomSnapshot | null;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setStatusMessage: (message: string) => void;
  onAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  emitAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
}) {
  const {
    peerId,
    activeSession,
    roomSnapshot,
    dispatchRoomStateEvent,
    setStatusMessage,
    onAvailability,
    emitAvailability
  } = options;
  const [uploadedTracks, setUploadedTracks] = useState<Record<string, UploadedTrack>>({});
  const [cachedTrackCount, setCachedTrackCount] = useState(0);
  const [cacheLibraryTracks, setCacheLibraryTracks] = useState<CachedLibraryTrack[]>([]);
  const [manualCacheTasks, setManualCacheTasks] = useState<Record<string, ManualCacheTask>>({});
  const uploadedTrackUrlsRef = useRef<Map<string, string>>(new Map());
  const cacheLibraryTracksRef = useRef<Map<string, CachedLibraryTrack>>(new Map());
  const inFlightUploadHashesRef = useRef<Set<string>>(new Set());
  const availabilityAnnouncementInFlightRef = useRef<Set<string>>(new Set());
  const availabilityAnnouncementTtlRef = useRef<Map<string, number>>(new Map());
  const manualCacheChunkIndexesRef = useRef<Map<string, Set<number>>>(new Map());
  const manualCacheAssemblingTrackIdsRef = useRef<Set<string>>(new Set());
  const roomTrackIdsKey = useMemo(
    () => [...new Set(roomSnapshot?.tracks.map((track) => track.id) ?? [])].sort().join("|"),
    [roomSnapshot?.tracks]
  );

  const manualCacheTrackIds = useMemo(
    () =>
      Object.values(manualCacheTasks)
        .filter(
          (task) =>
            (task.mode === "manual" ||
              task.trackId === roomSnapshot?.room.playback.currentTrackId) &&
            (task.status === "queued" ||
              task.status === "downloading" ||
              task.status === "blocked" ||
              task.status === "assembling")
        )
        .map((task) => task.trackId),
    [manualCacheTasks, roomSnapshot?.room.playback.currentTrackId]
  );

  const refreshCacheLibrary = useCallback(async () => {
    const snapshot = await loadCacheLibrarySnapshot({
      listCachedLibraryTrackSummaries,
      getCachedLibraryTrackCount
    });

    cacheLibraryTracksRef.current = snapshot.tracksByHash;
    setCacheLibraryTracks(snapshot.tracks);
    setCachedTrackCount(snapshot.count);
  }, []);

  useUploadRuntimeEffects({
    activeSession,
    cacheLibraryTracks,
    cacheLibraryTracksRef,
    manualCacheAssemblingTrackIdsRef,
    manualCacheChunkIndexesRef,
    peerId,
    refreshCacheLibrary,
    roomSnapshot,
    roomTrackIdsKey,
    setManualCacheTasks,
    setUploadedTracks,
    uploadedTrackUrlsRef,
    uploadedTracks
  });

  const syncRoomSnapshot = useCallback(
    async (roomId: string) => {
      try {
        const latestSnapshot = await musicRoomApi.getRoom(roomId);
        dispatchRoomStateEvent({
          type: "recover-snapshot",
          snapshot: latestSnapshot
        });
      } catch {
        // Later snapshot resync remains the source of truth.
      }
    },
    [dispatchRoomStateEvent]
  );

  const updateManualCacheTask = useCallback(
    (
      trackId: string,
      patch:
        | Partial<ManualCacheTask>
        | ((current: ManualCacheTask | null) => Partial<ManualCacheTask> | null)
    ) => {
      applyManualCacheTaskUpdate({
        trackId,
        patch,
        roomId: roomSnapshot?.room.id,
        roomTracks: roomSnapshot?.tracks,
        updatedAt: new Date().toISOString(),
        setManualCacheTasks,
        upsertManualCacheTask
      });
    },
    [roomSnapshot]
  );

  const dropManualCacheTask = useCallback((trackId: string) => {
    applyManualCacheTaskDrop({
      trackId,
      roomId: roomSnapshot?.room.id,
      chunkIndexesByTrack: manualCacheChunkIndexesRef.current,
      assemblingTrackIdsByTrack: manualCacheAssemblingTrackIdsRef.current,
      setManualCacheTasks,
      deleteManualCacheTask
    });
  }, [roomSnapshot?.room.id]);

  useEffect(() => {
    const staleTrackIds = resolveStalePlaybackDemandTaskIds({
      currentTasks: manualCacheTasks,
      currentPlaybackTrackId: roomSnapshot?.room.playback.currentTrackId ?? null
    });
    if (staleTrackIds.length === 0) {
      return;
    }

    for (const trackId of staleTrackIds) {
      dropManualCacheTask(trackId);
    }
  }, [dropManualCacheTask, manualCacheTasks, roomSnapshot?.room.playback.currentTrackId]);

  const persistTrackIntoLibrary = useCallback(
    async (input: {
      track: Pick<
        TrackMeta,
        | "id"
        | "title"
        | "artist"
        | "mimeType"
        | "durationMs"
        | "sizeBytes"
        | "fileHash"
        | "ownerNickname"
      >;
      roomId: string;
      file: File | Blob;
    }) => {
      await upsertCachedLibraryTrack(buildCachedLibraryTrackUpsertRecord(input));
      await refreshCacheLibrary();
    },
    [refreshCacheLibrary]
  );

  const announceRoomTrackAvailability = useCallback(
    async (trackId: string) => {
      await announceRoomTrackAvailabilityFromSources({
        roomId: roomSnapshot?.room.id,
        roomTracks: roomSnapshot?.tracks ?? [],
        activeSession,
        peerId,
        trackId,
        uploadedTrack: uploadedTracks[trackId] ?? null,
        inFlightAnnouncements: availabilityAnnouncementInFlightRef.current,
        announcementTtl: availabilityAnnouncementTtlRef.current,
        getCachedLibraryTrackSummary,
        getCachedLibraryTrack,
        getTrackPieceManifestByFileHash,
        getTrackPieceManifest,
        buildTrackAvailabilityFromCache,
        buildTrackAvailabilityFromManifest,
        publishAvailability: (availability) => {
          onAvailability(availability);
          emitAvailability(availability);
        }
      });
    },
    [activeSession, emitAvailability, onAvailability, peerId, roomSnapshot, uploadedTracks]
  );

  const assembleManualCacheTrack = useCallback(
    async (trackId: string, mimeType: string | null, totalChunks: number) => {
      await assembleManualCacheTrackFromPieces({
        manualTrackCachingEnabled: enableManualTrackCaching,
        assemblingTrackIds: manualCacheAssemblingTrackIdsRef.current,
        trackId,
        mimeType,
        totalChunks,
        roomId: roomSnapshot?.room.id,
        roomTracks: roomSnapshot?.tracks ?? [],
        peerId,
        localCacheOwnerKey,
        updateManualCacheTask,
        getCachedPiecesForTrack,
        assembleTrackFileFromPieces,
        persistTrackIntoLibrary,
        deleteCachedPiecesForTrack,
        onCachedPiecesConsumed: (assembledTrackId) => {
          manualCacheChunkIndexesRef.current.delete(assembledTrackId);
        },
        announceRoomTrackAvailability: (assembledTrackId) => {
          void announceRoomTrackAvailability(assembledTrackId);
        },
        setStatusMessage
      });
    },
    [
      announceRoomTrackAvailability,
      peerId,
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      updateManualCacheTask
    ]
  );

  const handleFilesSelected = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || !activeSession || !roomSnapshot) {
        return;
      }

      const roomId = roomSnapshot.room.id;
      const result = await processSelectedTrackFiles({
        files: Array.from(files),
        activeSession,
        roomId,
        roomTracks: roomSnapshot.tracks,
        peerId,
        manualTrackCachingEnabled: enableManualTrackCaching,
        inFlightUploadHashes: inFlightUploadHashesRef.current,
        createObjectUrl: (file) => URL.createObjectURL(file),
        revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl),
        buildTrackMeta: (file, objectUrl) => buildTrackMeta(file, objectUrl, activeSession),
        buildRegisterTrackPayload,
        registerTrack: (registerRoomId, payload) =>
          musicRoomApi.registerTrack(
            registerRoomId,
            payload as Parameters<typeof musicRoomApi.registerTrack>[1]
          ),
        persistTrackIntoLibrary,
        buildTrackAvailabilityFromFile,
        publishAvailability: (availability) => {
          onAvailability(availability);
          emitAvailability(availability);
        }
      });

      await applySelectedTrackFilesResult({ roomId, result, setUploadedTracks, syncRoomSnapshot, setStatusMessage });
    },
    [
      activeSession,
      emitAvailability,
      onAvailability,
      peerId,
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      syncRoomSnapshot
    ]
  );

  const {
    startManualCacheDownload,
    startPlaybackDemandCacheDownload,
    pauseManualCacheDownload,
    handleManualCachePieceReceived,
    handleManualCachePlan
  } = useManualCacheActions({
    activeSession,
    assembleManualCacheTrack,
    cacheLibraryTracksRef,
    emitAvailability,
    manualCacheChunkIndexesRef,
    manualCacheTasks,
    onAvailability,
    peerId,
    roomSnapshot,
    setStatusMessage,
    updateManualCacheTask,
    uploadedTracks
  });

  const {
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    deleteCachedLibraryTrackEntry,
    loadCachedLibraryTrackFile,
    exportCachedLibraryTrack,
    importCachedLibraryTrackToRoom
  } = useCacheLibraryActions({
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
  });

  return {
    uploadedTracks,
    setUploadedTracks,
    cachedTrackCount,
    cacheLibraryTracks,
    manualCacheTasks,
    manualCacheTrackIds,
    handleFilesSelected,
    announceRoomTrackAvailability,
    startManualCacheDownload,
    startPlaybackDemandCacheDownload,
    pauseManualCacheDownload,
    handleManualCachePieceReceived,
    handleManualCachePlan,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    deleteCachedLibraryTrackEntry,
    loadCachedLibraryTrackFile,
    exportCachedLibraryTrack,
    importCachedLibraryTrackToRoom
  };
}
