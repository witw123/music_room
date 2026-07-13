import { useCallback, type Dispatch, type MutableRefObject } from "react";
import {
  unitIndexesToRanges,
  type AssetAvailabilityAnnouncement,
  type GuestSession,
  type RoomSnapshot,
  type TrackMeta
} from "@music-room/shared";
import {
  assembleTrackFileFromPieces
} from "@/features/p2p";
import { enableManualTrackCaching } from "@/features/cache/cache-policy";
import { hasActivePlaybackIntent } from "@/features/playback/progressive-playback";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  deleteCachedPiecesForTrack,
  getCachedPiecesForTrack,
  getAssetUnitIndexes,
  linkTrackAssets,
  localCacheOwnerKey,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  buildTrackMeta,
  type UploadedTrack
} from "@/features/upload/audio-utils";
import { prepareAudioAssets } from "@/features/upload/audio-asset-builder";
import { buildCompleteAssetAnnouncements } from "@/features/upload/asset-availability";
import {
  buildCachedLibraryTrackUpsertRecord
} from "./cache-library";
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
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  inFlightUploadHashesRef: MutableRefObject<Set<string>>;
  manualCacheAssemblingTrackIdsRef: MutableRefObject<Set<string>>;
  manualCacheChunkIndexesRef: MutableRefObject<Map<string, Set<number>>>;
  manualCacheRetainedPieceTrackIdsRef: MutableRefObject<Set<string>>;
  peerId: string;
  refreshCacheLibrary: () => Promise<void>;
  roomSnapshot: RoomSnapshot | null;
  setStatusMessage: (message: string) => void;
  setUploadedTracks: (updater: (current: Record<string, UploadedTrack>) => Record<string, UploadedTrack>) => void;
  updateManualCacheTask: (trackId: string, patch: ManualCacheTaskPatch) => void;
  uploadedTracks: Record<string, UploadedTrack>;
  onAssetAvailability: (announcement: AssetAvailabilityAnnouncement) => void;
  emitAssetAvailability: (announcement: AssetAvailabilityAnnouncement) => void;
};

export function useUploadPipelineActions({
  activeSession,
  dispatchRoomStateEvent,
  inFlightUploadHashesRef,
  manualCacheAssemblingTrackIdsRef,
  manualCacheChunkIndexesRef,
  manualCacheRetainedPieceTrackIdsRef,
  peerId,
  refreshCacheLibrary,
  roomSnapshot,
  setStatusMessage,
  setUploadedTracks,
  updateManualCacheTask,
  uploadedTracks,
  onAssetAvailability,
  emitAssetAvailability
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
    async (trackId: string, _options?: { force?: boolean }) => {
      const roomId = roomSnapshot?.room.id;
      const track = roomSnapshot?.tracks.find((candidate) => candidate.id === trackId);
      if (!roomId || !activeSession || !peerId || !track?.originalAsset || !track.playbackAsset) {
        return false;
      }
      let announced = false;
      for (const asset of [track.playbackAsset, track.originalAsset]) {
        const owned = await getAssetUnitIndexes(asset.assetId);
        const availableRanges = unitIndexesToRanges(owned, asset.unitCount);
        if (availableRanges.length === 0) {
          continue;
        }
        const announcement: AssetAvailabilityAnnouncement = {
          protocolVersion: 4,
          roomId,
          assetId: asset.assetId,
          assetKind: asset.kind,
          ownerPeerId: peerId,
          nickname: activeSession.nickname,
          totalUnits: asset.unitCount,
          availableRanges,
          complete: owned.length === asset.unitCount,
          source: uploadedTracks[trackId] ? "live_upload" : "local_cache",
          announcedAt: new Date().toISOString()
        };
        onAssetAvailability(announcement);
        emitAssetAvailability(announcement);
        announced = true;
      }
      return announced;
    },
    [
      activeSession,
      emitAssetAvailability,
      onAssetAvailability,
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
        manualTrackCachingEnabled: enableManualTrackCaching,
        inFlightUploadHashes: inFlightUploadHashesRef.current,
        createObjectUrl: (file) => URL.createObjectURL(file),
        revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl),
        buildTrackMeta: async (file, objectUrl) => {
          const assets = await prepareAudioAssets({
            file,
            onProgress: ({ stage, completed, total }) => {
              const labels = {
                inspecting: "正在检查音频资源",
                hashing: "正在校验源文件",
                "persisting-original": "正在保存源文件",
                decoding: "正在解码音频",
                encoding: "正在生成播放分片",
                "persisting-playback": "正在保存播放分片"
              } as const;
              const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
              setStatusMessage(`${labels[stage]} ${percent}%`);
            }
          });
          return buildTrackMeta(file, objectUrl, activeSession, assets);
        },
        buildRegisterTrackPayload,
        registerTrack: (registerRoomId, payload) =>
          musicRoomApi.registerTrack(
            registerRoomId,
            payload as Parameters<typeof musicRoomApi.registerTrack>[1]
          ),
        persistTrackIntoLibrary,
        onTrackReady: (trackId, upload, registeredTrack) => {
          setUploadedTracks((current) => ({
            ...current,
            [trackId]: upload
          }));
          if (registeredTrack.originalAsset && registeredTrack.playbackAsset) {
            void linkTrackAssets({
              trackId,
              originalAssetId: registeredTrack.originalAsset.assetId,
              playbackAssetId: registeredTrack.playbackAsset.assetId
            });
            for (const announcement of buildCompleteAssetAnnouncements({
              roomId,
              peerId,
              nickname: activeSession.nickname,
              source: "live_upload",
              originalAsset: registeredTrack.originalAsset,
              playbackAsset: registeredTrack.playbackAsset
            })) {
              onAssetAvailability(announcement);
              emitAssetAvailability(announcement);
            }
          }
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
      emitAssetAvailability,
      inFlightUploadHashesRef,
      onAssetAvailability,
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
