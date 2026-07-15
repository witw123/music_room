import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { GuestSession, RoomSnapshot } from "@music-room/shared";
import {
  clearTransientTrackCacheData,
  deleteCachedPiecesForTrack,
  deleteManualCacheTask,
  getCachedLibraryTrack,
  getCachedLibraryTrackSummary,
  getCachedPieceIndexes,
  listManualCacheTasksForRoom,
  localCacheOwnerKey
} from "@/lib/indexeddb";
import type {
  CachedLibraryTrack,
  UploadedTrack
} from "@/features/upload/audio-utils";
import { hasActivePlayback } from "@/features/playback/asset-transfer-scheduler";
import {
  applyHydratedManualCacheTasksResult,
  hydrateManualCacheTasksForRoom,
  type ManualCacheTask
} from "./manual-cache-task-store";
import {
  resolveMissingOwnedUploadedTracks
} from "./track-availability";
import {
  applyOwnedUploadRehydrationResult,
  rehydrateOwnedUploadedTracksFromCache
} from "./upload-rehydration";
import {
  applyUploadRuntimePruneForActiveTracks,
  cleanupUploadRuntimeRefs,
  resolveRetainedCachePieceTrackIdsToConsume,
  syncUploadedTrackObjectUrls
} from "./upload-runtime-cleanup";

type UploadRuntimeEffectsInput = {
  activeSession: GuestSession | null;
  cacheLibraryTracks: CachedLibraryTrack[];
  cacheLibraryTracksRef: MutableRefObject<Map<string, CachedLibraryTrack>>;
  manualCacheAssemblingTrackIdsRef: MutableRefObject<Set<string>>;
  manualCacheChunkIndexesRef: MutableRefObject<Map<string, Set<number>>>;
  manualCacheRetainedPieceTrackIdsRef: MutableRefObject<Set<string>>;
  peerId: string;
  refreshCacheLibrary: () => Promise<void>;
  roomSnapshot: RoomSnapshot | null;
  roomTrackIdsKey: string;
  setManualCacheTasks: Dispatch<SetStateAction<Record<string, ManualCacheTask>>>;
  setUploadedTracks: Dispatch<SetStateAction<Record<string, UploadedTrack>>>;
  uploadedTrackUrlsRef: MutableRefObject<Map<string, string>>;
  uploadedTracks: Record<string, UploadedTrack>;
};

export function useUploadRuntimeEffects({
  activeSession,
  cacheLibraryTracks,
  cacheLibraryTracksRef,
  manualCacheAssemblingTrackIdsRef,
  manualCacheChunkIndexesRef,
  manualCacheRetainedPieceTrackIdsRef,
  peerId,
  refreshCacheLibrary,
  roomSnapshot,
  roomTrackIdsKey,
  setManualCacheTasks,
  setUploadedTracks,
  uploadedTrackUrlsRef,
  uploadedTracks
}: UploadRuntimeEffectsInput) {
  useEffect(() => {
    uploadedTrackUrlsRef.current = syncUploadedTrackObjectUrls({
      currentUrls: uploadedTrackUrlsRef.current,
      uploadedTracks,
      revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl)
    });
  }, [uploadedTrackUrlsRef, uploadedTracks]);

  useEffect(() => {
    void refreshCacheLibrary();
  }, [refreshCacheLibrary]);

  useEffect(() => {
    if (!roomSnapshot?.room.id) {
      return;
    }
    let cancelled = false;
    void hydrateManualCacheTasksForRoom({
      roomId: roomSnapshot.room.id,
      peerId,
      currentPlaybackTrackId: roomSnapshot.room.playback.currentTrackId ?? null,
      roomTracks: roomSnapshot.tracks,
      listManualCacheTasksForRoom,
      getCachedPieceIndexes,
      localCacheOwnerKey
    }).then((result) => {
      applyHydratedManualCacheTasksResult({
        cancelled,
        result,
        currentPlaybackTrackId: roomSnapshot.room.playback.currentTrackId ?? null,
        setManualCacheTasks,
        chunkIndexesByTrack: manualCacheChunkIndexesRef.current,
        deleteManualCacheTask
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    manualCacheChunkIndexesRef,
    peerId,
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.tracks,
    setManualCacheTasks
  ]);

  useEffect(() => {
    const trackIdsToConsume = resolveRetainedCachePieceTrackIdsToConsume({
      retainedTrackIds: manualCacheRetainedPieceTrackIdsRef.current,
      currentPlaybackTrackId: null,
      playbackHasActiveIntent: false
    });
    for (const trackId of trackIdsToConsume) {
      void deleteCachedPiecesForTrack(trackId, undefined, {
        ownerKey: localCacheOwnerKey
      });
    }
    manualCacheChunkIndexesRef.current.clear();
    manualCacheAssemblingTrackIdsRef.current.clear();
    manualCacheRetainedPieceTrackIdsRef.current.clear();
    void clearTransientTrackCacheData();
  }, [
    manualCacheAssemblingTrackIdsRef,
    manualCacheChunkIndexesRef,
    manualCacheRetainedPieceTrackIdsRef,
    roomSnapshot?.room.id
  ]);

  useEffect(() => {
    const trackIdsToConsume = resolveRetainedCachePieceTrackIdsToConsume({
      retainedTrackIds: manualCacheRetainedPieceTrackIdsRef.current,
      currentPlaybackTrackId: roomSnapshot?.room.playback.currentTrackId ?? null,
      playbackHasActiveIntent: hasActivePlayback(roomSnapshot?.room.playback)
    });
    if (trackIdsToConsume.length === 0) {
      return;
    }

    for (const trackId of trackIdsToConsume) {
      manualCacheRetainedPieceTrackIdsRef.current.delete(trackId);
      manualCacheChunkIndexesRef.current.delete(trackId);
      void deleteCachedPiecesForTrack(trackId, undefined, {
        ownerKey: localCacheOwnerKey
      });
    }
  }, [
    manualCacheChunkIndexesRef,
    manualCacheRetainedPieceTrackIdsRef,
    roomSnapshot?.room.playback
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id) {
      return;
    }
    const activeTrackIds = new Set(roomTrackIdsKey ? roomTrackIdsKey.split("|") : []);
    applyUploadRuntimePruneForActiveTracks({
      activeTrackIds,
      setUploadedTracks,
      chunkIndexesByTrack: manualCacheChunkIndexesRef.current,
      assemblingTrackIdsByTrack: manualCacheAssemblingTrackIdsRef.current
    });
  }, [
    manualCacheAssemblingTrackIdsRef,
    manualCacheChunkIndexesRef,
    roomSnapshot?.room.id,
    roomTrackIdsKey,
    setUploadedTracks
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !activeSession) {
      return;
    }

    const missingOwnedTracks = resolveMissingOwnedUploadedTracks({
      roomTracks: roomSnapshot.tracks,
      activeSessionId: activeSession.userId,
      uploadedTracks
    });
    if (missingOwnedTracks.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const result = await rehydrateOwnedUploadedTracksFromCache({
        missingOwnedTracks,
        cachedLibraryTracksByHash: cacheLibraryTracksRef.current,
        getCachedLibraryTrackSummary,
        getCachedLibraryTrack,
        createObjectUrl: (file) => URL.createObjectURL(file)
      });

      applyOwnedUploadRehydrationResult({
        cancelled,
        result,
        setUploadedTracks,
        revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl)
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeSession,
    cacheLibraryTracks,
    cacheLibraryTracksRef,
    roomSnapshot?.room.id,
    roomSnapshot?.tracks,
    setUploadedTracks,
    uploadedTracks
  ]);

  useEffect(() => {
    return () => {
      cleanupUploadRuntimeRefs({
        uploadedTrackUrlsRef,
        cacheLibraryTracksRef,
        revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl)
      });
    };
  }, [cacheLibraryTracksRef, uploadedTrackUrlsRef]);
}
