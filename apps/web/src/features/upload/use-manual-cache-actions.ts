import { useCallback, useEffect, type MutableRefObject } from "react";
import type {
  GuestSession,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import {
  deleteCachedPiecesForTrack,
  getCachedLibraryTrack,
  getCachedLibraryTrackSummary,
  getCachedPiecesForTrack,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  localCacheOwnerKey
} from "@/lib/indexeddb";
import { enableManualTrackCaching } from "@/features/cache/cache-policy";
import { isCachedLibraryTrackUsableForRoomTrack } from "@/features/upload/cached-library-track-policy";
import { hasActivePlaybackIntent } from "@/features/playback/progressive-playback";
import { isCurrentPlaybackSourceDevice } from "@/features/playback/playback-source-identity";
import type { ManualCacheTrackPlan } from "@/features/room/hooks/use-manual-cache-downloader";
import type {
  CachedLibraryTrack,
  UploadedTrack
} from "@/features/upload/audio-utils";
import {
  startCacheDownload as startCacheDownloadFromLibrary
} from "./cache-library";
import {
  applyManualCacheDownloadStartResult,
  applyManualCacheProgressResult,
  resolveManualCachePausePatch,
  type ManualCacheTask,
  type ManualCacheTaskPatch
} from "./manual-cache-task-store";
import {
  resolveAutomaticPlaybackCacheTaskMode,
  resolveManualCachePieceReceivedAction,
  resolveManualCachePlanReceivedAction,
  shouldEnsurePlaybackDemandCacheTask
} from "./upload-ui-state";

type ManualCachePieceInput = {
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
};

type ManualCacheActionsInput = {
  activeSession: GuestSession | null;
  assembleManualCacheTrack: (
    trackId: string,
    mimeType: string | null,
    totalChunks: number
  ) => Promise<void>;
  cacheLibraryTracksRef: MutableRefObject<Map<string, CachedLibraryTrack>>;
  emitAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  manualCacheChunkIndexesRef: MutableRefObject<Map<string, Set<number>>>;
  manualCacheTasks: Record<string, ManualCacheTask>;
  onAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  peerId: string;
  roomSnapshot: RoomSnapshot | null;
  setStatusMessage: (message: string) => void;
  updateManualCacheTask: (trackId: string, patch: ManualCacheTaskPatch) => void;
  uploadedTracks: Record<string, UploadedTrack>;
};

export function useManualCacheActions({
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
}: ManualCacheActionsInput) {
  const startCacheDownload = useCallback(
    async (trackId: string, mode: ManualCacheTask["mode"]) => {
      if (!enableManualTrackCaching || !roomSnapshot) {
        return;
      }

      const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
      if (!track) {
        return;
      }

      const result = await startCacheDownloadFromLibrary({
        manualTrackCachingEnabled: enableManualTrackCaching,
        trackId,
        mode,
        roomTracks: roomSnapshot.tracks,
        peerId,
        cachedLibraryTracksByHash: cacheLibraryTracksRef.current,
        getCachedLibraryTrackSummary,
        getCachedLibraryTrack,
        getTrackPieceManifestByFileHash,
        getTrackPieceManifest,
        deleteCachedPiecesForTrack,
        getCachedPiecesForTrack,
        localCacheOwnerKey
      });
      applyManualCacheDownloadStartResult({
        trackId,
        result,
        chunkIndexesByTrack: manualCacheChunkIndexesRef.current,
        updateManualCacheTask,
        setStatusMessage,
        assembleManualCacheTrack: (assembleTrackId, mimeType, totalChunks) => {
          void assembleManualCacheTrack(assembleTrackId, mimeType, totalChunks);
        }
      });
    },
    [
      assembleManualCacheTrack,
      cacheLibraryTracksRef,
      manualCacheChunkIndexesRef,
      peerId,
      roomSnapshot,
      setStatusMessage,
      updateManualCacheTask
    ]
  );

  const startManualCacheDownload = useCallback(
    async (trackId: string) => {
      await startCacheDownload(trackId, "manual");
    },
    [startCacheDownload]
  );

  const startPlaybackDemandCacheDownload = useCallback(
    async (trackId: string) => {
      await startCacheDownload(trackId, resolveAutomaticPlaybackCacheTaskMode());
    },
    [startCacheDownload]
  );

  useEffect(() => {
    const playback = roomSnapshot?.room.playback ?? null;
    const trackId = playback?.currentTrackId ?? null;
    if (!trackId) {
      return;
    }

    const track = roomSnapshot?.tracks.find((entry) => entry.id === trackId) ?? null;
    const trackExists = !!track;
    const cachedLibraryTrack = track
      ? cacheLibraryTracksRef.current.get(track.fileHash)
      : null;
    const hasLocalFullTrack =
      !!uploadedTracks[trackId] ||
      isCachedLibraryTrackUsableForRoomTrack({
        cachedTrack: cachedLibraryTrack,
        roomTrack: track
      });
    if (
      !shouldEnsurePlaybackDemandCacheTask({
        enableManualTrackCaching,
        playback,
        trackExists,
        peerId,
        activeSessionId: activeSession?.userId,
        hasLocalFullTrack,
        existingTask: manualCacheTasks[trackId] ?? null
      })
    ) {
      return;
    }

    void startPlaybackDemandCacheDownload(trackId);
  }, [
    activeSession?.userId,
    cacheLibraryTracksRef,
    manualCacheTasks,
    peerId,
    roomSnapshot?.room.playback,
    roomSnapshot?.tracks,
    startPlaybackDemandCacheDownload,
    uploadedTracks
  ]);

  const pauseManualCacheDownload = useCallback(
    (trackId: string) => {
      updateManualCacheTask(trackId, resolveManualCachePausePatch);
    },
    [updateManualCacheTask]
  );

  const handleManualCachePieceReceived = useCallback(
    (input: ManualCachePieceInput) => {
      const track = roomSnapshot?.tracks.find((entry) => entry.id === input.trackId) ?? null;
      const knownChunkIndexes =
        manualCacheChunkIndexesRef.current.get(input.trackId) ?? new Set<number>();
      const hasLocalFullTrack =
        !!uploadedTracks[input.trackId] ||
        isCachedLibraryTrackUsableForRoomTrack({
          cachedTrack: track ? cacheLibraryTracksRef.current.get(track.fileHash) : null,
          roomTrack: track
        });
      const result = resolveManualCachePieceReceivedAction({
        piece: input,
        currentTask: manualCacheTasks[input.trackId] ?? null,
        knownChunkIndexes,
        track,
        roomId: roomSnapshot?.room.id,
        activeSession,
        peerId,
        playback: roomSnapshot?.room.playback,
        hasLocalFullTrack,
        nowIso: new Date().toISOString()
      });

      applyManualCacheProgressResult({
        trackId: input.trackId,
        result,
        chunkIndexesByTrack: manualCacheChunkIndexesRef.current,
        publishAvailability: (availability) => {
          onAvailability(availability);
          emitAvailability(availability);
        },
        updateManualCacheTask,
        assembleManualCacheTrack: (assembleTrackId, mimeType, totalChunks) => {
          void assembleManualCacheTrack(assembleTrackId, mimeType, totalChunks);
        }
      });
    },
    [
      activeSession,
      assembleManualCacheTrack,
      cacheLibraryTracksRef,
      emitAvailability,
      manualCacheChunkIndexesRef,
      manualCacheTasks,
      onAvailability,
      peerId,
      roomSnapshot,
      updateManualCacheTask,
      uploadedTracks
    ]
  );

  const handleManualCachePlan = useCallback(
    (plan: ManualCacheTrackPlan) => {
      if (!plan.trackId || !roomSnapshot) {
        return;
      }
      const track = roomSnapshot.tracks.find((entry) => entry.id === plan.trackId) ?? null;
      if (!track) {
        return;
      }
      const knownChunkIndexes =
        manualCacheChunkIndexesRef.current.get(plan.trackId) ?? new Set<number>();
      const hasLocalFullTrack =
        !!uploadedTracks[plan.trackId] ||
        isCachedLibraryTrackUsableForRoomTrack({
          cachedTrack: cacheLibraryTracksRef.current.get(track.fileHash),
          roomTrack: track
        });
      const isCurrentPlaybackDemand =
        plan.trackId === roomSnapshot.room.playback.currentTrackId &&
        hasActivePlaybackIntent(roomSnapshot.room.playback) &&
        (!isCurrentPlaybackSourceDevice({
          playback: roomSnapshot.room.playback,
          peerId,
          activeSessionId: activeSession?.userId
        }) ||
          !hasLocalFullTrack);
      const result = resolveManualCachePlanReceivedAction({
        plan,
        currentTask: manualCacheTasks[plan.trackId] ?? null,
        knownChunkIndexes,
        track,
        isCurrentPlaybackDemand
      });
      applyManualCacheProgressResult({
        trackId: plan.trackId,
        result,
        chunkIndexesByTrack: manualCacheChunkIndexesRef.current,
        publishAvailability: () => undefined,
        updateManualCacheTask,
        assembleManualCacheTrack: (assembleTrackId, mimeType, totalChunks) => {
          void assembleManualCacheTrack(assembleTrackId, mimeType, totalChunks);
        }
      });
    },
    [
      activeSession?.userId,
      assembleManualCacheTrack,
      cacheLibraryTracksRef,
      manualCacheChunkIndexesRef,
      manualCacheTasks,
      peerId,
      roomSnapshot,
      updateManualCacheTask,
      uploadedTracks
    ]
  );

  return {
    startManualCacheDownload,
    startPlaybackDemandCacheDownload,
    pauseManualCacheDownload,
    handleManualCachePieceReceived,
    handleManualCachePlan
  };
}
