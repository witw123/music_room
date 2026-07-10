import { useCallback, type Dispatch, type MutableRefObject } from "react";
import type {
  GuestSession,
  RoomSnapshot,
  TrackAvailabilityAnnouncement,
  TrackMeta
} from "@music-room/shared";
import {
  assembleTrackFileFromPieces,
  buildTrackAvailabilityFromCache,
  buildTrackAvailabilityFromFile,
  buildTrackAvailabilityFromManifest
} from "@/features/p2p";
import { enableManualTrackCaching } from "@/features/cache/cache-policy";
import { hasActivePlaybackIntent } from "@/features/playback/progressive-playback";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  deleteCachedPiecesForTrack,
  getCachedLibraryTrack,
  getCachedLibraryTrackSummary,
  getCachedPiecesForTrack,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  localCacheOwnerKey,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  buildTrackMeta,
  type UploadedTrack
} from "@/features/upload/audio-utils";
import {
  buildCachedLibraryTrackUpsertRecord
} from "./cache-library";
import {
  announceRoomTrackAvailability as announceRoomTrackAvailabilityFromSources
} from "./track-availability";
import {
  applySelectedTrackFilesResult,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
import {
  assembleManualCacheTrackFromPieces
} from "./manual-cache-assembly";
import type {
  ManualCacheTaskPatch
} from "./manual-cache-task-store";

type UploadPipelineActionsInput = {
  activeSession: GuestSession | null;
  availabilityAnnouncementInFlightRef: MutableRefObject<Set<string>>;
  availabilityAnnouncementTtlRef: MutableRefObject<Map<string, number>>;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  emitAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  inFlightUploadHashesRef: MutableRefObject<Set<string>>;
  manualCacheAssemblingTrackIdsRef: MutableRefObject<Set<string>>;
  manualCacheChunkIndexesRef: MutableRefObject<Map<string, Set<number>>>;
  manualCacheRetainedPieceTrackIdsRef: MutableRefObject<Set<string>>;
  onAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  peerId: string;
  refreshCacheLibrary: () => Promise<void>;
  roomSnapshot: RoomSnapshot | null;
  setStatusMessage: (message: string) => void;
  setUploadedTracks: (updater: (current: Record<string, UploadedTrack>) => Record<string, UploadedTrack>) => void;
  updateManualCacheTask: (trackId: string, patch: ManualCacheTaskPatch) => void;
  uploadedTracks: Record<string, UploadedTrack>;
};

export function useUploadPipelineActions({
  activeSession,
  availabilityAnnouncementInFlightRef,
  availabilityAnnouncementTtlRef,
  dispatchRoomStateEvent,
  emitAvailability,
  inFlightUploadHashesRef,
  manualCacheAssemblingTrackIdsRef,
  manualCacheChunkIndexesRef,
  manualCacheRetainedPieceTrackIdsRef,
  onAvailability,
  peerId,
  refreshCacheLibrary,
  roomSnapshot,
  setStatusMessage,
  setUploadedTracks,
  updateManualCacheTask,
  uploadedTracks
}: UploadPipelineActionsInput) {
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
    async (trackId: string, options?: { force?: boolean }) => {
      return announceRoomTrackAvailabilityFromSources({
        roomId: roomSnapshot?.room.id,
        roomTracks: roomSnapshot?.tracks ?? [],
        activeSession,
        peerId,
        trackId,
        uploadedTrack: uploadedTracks[trackId] ?? null,
        force: options?.force,
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
    [
      activeSession,
      availabilityAnnouncementInFlightRef,
      availabilityAnnouncementTtlRef,
      emitAvailability,
      onAvailability,
      peerId,
      roomSnapshot,
      uploadedTracks
    ]
  );

  const assembleManualCacheTrack = useCallback(
    async (trackId: string, mimeType: string | null, totalChunks: number) => {
      const playback = roomSnapshot?.room.playback ?? null;
      const retainCachedPiecesAfterAssembly =
        playback?.currentTrackId === trackId && hasActivePlaybackIntent(playback);
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
        retainCachedPiecesAfterAssembly,
        onCachedPiecesConsumed: (assembledTrackId) => {
          manualCacheChunkIndexesRef.current.delete(assembledTrackId);
        },
        onCachedPiecesRetained: (assembledTrackId) => {
          manualCacheRetainedPieceTrackIdsRef.current.add(assembledTrackId);
        },
        announceRoomTrackAvailability: (assembledTrackId) => {
          void announceRoomTrackAvailability(assembledTrackId);
        },
        setStatusMessage
      });
    },
    [
      announceRoomTrackAvailability,
      manualCacheAssemblingTrackIdsRef,
      manualCacheChunkIndexesRef,
      manualCacheRetainedPieceTrackIdsRef,
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
        onTrackReady: (trackId, upload) => {
          setUploadedTracks((current) => ({
            ...current,
            [trackId]: upload
          }));
        },
        buildTrackAvailabilityFromFile,
        publishAvailability: (availability) => {
          onAvailability(availability);
          emitAvailability(availability);
        }
      });

      await applySelectedTrackFilesResult({
        roomId,
        result,
        setUploadedTracks,
        syncRoomSnapshot,
        setStatusMessage
      });
    },
    [
      activeSession,
      emitAvailability,
      inFlightUploadHashesRef,
      onAvailability,
      peerId,
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      setUploadedTracks,
      syncRoomSnapshot
    ]
  );

  return {
    syncRoomSnapshot,
    persistTrackIntoLibrary,
    announceRoomTrackAvailability,
    assembleManualCacheTrack,
    handleFilesSelected
  };
}
