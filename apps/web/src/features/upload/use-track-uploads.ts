"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import type { GuestSession, RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  deleteManualCacheTask,
  getCachedLibraryTrackCount,
  listCachedLibraryTrackSummaries,
  upsertManualCacheTask
} from "@/lib/indexeddb";
import {
  type CachedLibraryTrack,
  type UploadedTrack
} from "@/features/upload/audio-utils";
import {
  loadCacheLibrarySnapshot
} from "./cache-library";
import {
  buildRoomTrackIdsKey,
  resolveStalePlaybackDemandTaskIds,
  selectActiveManualCacheTrackIds,
  type ManualCacheTask
} from "./upload-ui-state";
import {
  applyManualCacheTaskDrop,
  applyManualCacheTaskUpdate
} from "./manual-cache-task-store";
import { useUploadRuntimeEffects } from "./upload-runtime-effects";
import { useManualCacheActions } from "./use-manual-cache-actions";
import { useCacheLibraryActions } from "./use-cache-library-actions";
import { useUploadPipelineActions } from "./use-upload-pipeline-actions";

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
  buildRoomTrackIdsKey,
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
  shouldIgnoreManualCachePieceTaskUpdate,
  selectActiveManualCacheTrackIds
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
    () => buildRoomTrackIdsKey(roomSnapshot?.tracks),
    [roomSnapshot?.tracks]
  );

  const manualCacheTrackIds = useMemo(
    () =>
      selectActiveManualCacheTrackIds({
        tasks: manualCacheTasks,
        currentPlaybackTrackId: roomSnapshot?.room.playback.currentTrackId
      }),
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

  const {
    syncRoomSnapshot,
    announceRoomTrackAvailability,
    assembleManualCacheTrack,
    handleFilesSelected
  } = useUploadPipelineActions({
    activeSession,
    availabilityAnnouncementInFlightRef,
    availabilityAnnouncementTtlRef,
    dispatchRoomStateEvent,
    emitAvailability,
    inFlightUploadHashesRef,
    manualCacheAssemblingTrackIdsRef,
    manualCacheChunkIndexesRef,
    onAvailability,
    peerId,
    refreshCacheLibrary,
    roomSnapshot,
    setStatusMessage,
    setUploadedTracks,
    updateManualCacheTask,
    uploadedTracks
  });

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
