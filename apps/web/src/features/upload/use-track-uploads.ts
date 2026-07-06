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
  clearTransientTrackCacheData,
  deleteCachedLibraryTrack as deleteCachedLibraryTrackRecord,
  deleteManualCacheTask,
  deleteManualCacheTasksForTracks,
  deleteCachedPiecesForTrack,
  deleteCachedPiecesForTracks,
  getCachedLibraryTrack,
  getCachedLibraryTrackCount,
  getCachedLibraryTrackSummary,
  getCachedPieceIndexes,
  getCachedPiecesForTrack,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  listManualCacheTasksForRoom,
  listCachedLibraryTrackSummaries,
  localCacheOwnerKey,
  upsertManualCacheTask,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import { removeTracksFromUploads } from "@/lib/music-room-ui";
import {
  buildTrackMeta,
  type CachedLibraryTrack,
  type UploadedTrack
} from "@/features/upload/audio-utils";
import type { ManualCacheTrackPlan } from "@/features/room/hooks/use-manual-cache-downloader";
import { isCachedLibraryTrackUsableForRoomTrack } from "@/features/upload/cached-library-track-policy";
import { hasActivePlaybackIntent } from "@/features/playback/progressive-playback";
import { isCurrentPlaybackSourceDevice } from "@/features/playback/playback-source-identity";
import {
  buildCachedLibraryTrackUpsertRecord,
  createInFlightCachedLibraryTrackFileLoader,
  deleteRoomTrackArtifacts as deleteRoomTrackArtifactsFromLibrary,
  deleteCachedLibraryTrackEntry as deleteCachedLibraryTrackEntryFromLibrary,
  deleteUploadedTrackArtifacts as deleteUploadedTrackArtifactsFromLibrary,
  exportCachedLibraryTrackFile,
  importCachedLibraryTrackToRoom as importCachedLibraryTrackToRoomFromLibrary,
  loadCacheLibrarySnapshot,
  startCacheDownload as startCacheDownloadFromLibrary,
  toCachedLibraryFile,
  toCachedLibraryTrackFile
} from "./cache-library";
import {
  announceRoomTrackAvailability as announceRoomTrackAvailabilityFromSources,
  resolveMissingOwnedUploadedTracks,
  shouldAnnounceTrackAvailability
} from "./track-availability";
import {
  buildNextManualCacheTask,
  mergeHydratedManualCacheTasks,
  pruneManualCacheChunkIndexesByActiveTracks,
  resolveAutomaticPlaybackCacheTaskMode,
  resolveManualCachePieceReceivedAction,
  resolveManualCachePlanReceivedAction,
  resolveStalePlaybackDemandTaskIds,
  shouldEnsurePlaybackDemandCacheTask,
  shouldHydrateCacheTaskPieceIndexes,
  type ManualCacheTask
} from "./upload-ui-state";
import {
  buildCachedLibraryTrackRegisterPayload,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
import { assembleManualCacheTrackFromPieces } from "./manual-cache-assembly";

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

  useEffect(() => {
    const nextUrls = new Map(
      Object.entries(uploadedTracks).map(([trackId, upload]) => [trackId, upload.objectUrl])
    );

    for (const [trackId, objectUrl] of uploadedTrackUrlsRef.current.entries()) {
      if (nextUrls.get(trackId) !== objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }

    uploadedTrackUrlsRef.current = nextUrls;
  }, [uploadedTracks]);

  useEffect(() => {
    void refreshCacheLibrary();
  }, [refreshCacheLibrary]);

  useEffect(() => {
    if (!roomSnapshot?.room.id) {
      return;
    }
    let cancelled = false;
    void listManualCacheTasksForRoom(roomSnapshot.room.id).then((tasks) => {
      if (cancelled) {
        return;
      }
      const currentPlaybackTrackId = roomSnapshot.room.playback.currentTrackId ?? null;
      for (const task of tasks) {
        if (
          (task.mode !== "manual" && task.mode !== "playback-demand") ||
          (task.mode === "playback-demand" && task.trackId !== currentPlaybackTrackId)
        ) {
          void deleteManualCacheTask(task.roomId, task.trackId);
        }
      }
      setManualCacheTasks((current) =>
        mergeHydratedManualCacheTasks({
          currentTasks: current,
          hydratedTasks: tasks,
          currentPlaybackTrackId
        })
      );
      for (const task of tasks) {
        if (shouldHydrateCacheTaskPieceIndexes(task)) {
          const track = roomSnapshot.tracks.find((entry) => entry.id === task.trackId) ?? null;
          const expectedManifest = track?.relayManifest ?? track?.pieceManifest ?? null;
          void getCachedPieceIndexes(task.trackId, peerId, {
            fileHash: task.fileHash,
            ownerKey: localCacheOwnerKey,
            chunkSize: expectedManifest?.chunkSize
          }).then((indexes) => {
            if (cancelled) {
              return;
            }
            manualCacheChunkIndexesRef.current.set(task.trackId, new Set(indexes));
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    peerId,
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.tracks
  ]);

  useEffect(() => {
    manualCacheChunkIndexesRef.current.clear();
    manualCacheAssemblingTrackIdsRef.current.clear();
    if (!roomSnapshot?.room.id) {
      void clearTransientTrackCacheData();
      return;
    }
    void clearTransientTrackCacheData();
  }, [roomSnapshot?.room.id]);

  useEffect(() => {
    if (!roomSnapshot?.room.id) {
      return;
    }
    const activeTrackIds = new Set(roomTrackIdsKey ? roomTrackIdsKey.split("|") : []);
    pruneManualCacheChunkIndexesByActiveTracks(
      manualCacheChunkIndexesRef.current,
      activeTrackIds
    );
    for (const trackId of manualCacheAssemblingTrackIdsRef.current.keys()) {
      if (!activeTrackIds.has(trackId)) {
        manualCacheAssemblingTrackIdsRef.current.delete(trackId);
      }
    }
    setUploadedTracks((current) => {
      const next = { ...current };
      for (const trackId of Object.keys(current)) {
        if (!activeTrackIds.has(trackId)) {
          delete next[trackId];
        }
      }
      return next;
    });
  }, [roomSnapshot?.room.id, roomTrackIdsKey]);

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
      const rehydratedUploads: Record<string, UploadedTrack> = {};

      for (const track of missingOwnedTracks) {
        const cachedSummary =
          cacheLibraryTracksRef.current.get(track.fileHash) ??
          (await getCachedLibraryTrackSummary(track.fileHash));
        if (
          !isCachedLibraryTrackUsableForRoomTrack({
            cachedTrack: cachedSummary,
            roomTrack: track
          })
        ) {
          continue;
        }

        const cachedRecord = await getCachedLibraryTrack(track.fileHash);
        const usableCachedRecord = isCachedLibraryTrackUsableForRoomTrack({
          cachedTrack: cachedRecord,
          roomTrack: track
        })
          ? cachedRecord
          : null;
        if (!usableCachedRecord) {
          continue;
        }
        const cachedFile = toCachedLibraryFile({
          file: usableCachedRecord.file,
          title: usableCachedRecord.title,
          mimeType: usableCachedRecord.mimeType,
          fileHash: usableCachedRecord.fileHash
        });

        rehydratedUploads[track.id] = {
          file: cachedFile,
          objectUrl: URL.createObjectURL(cachedFile),
          origin: "live-upload"
        };
      }

      if (cancelled || Object.keys(rehydratedUploads).length === 0) {
        for (const upload of Object.values(rehydratedUploads)) {
          URL.revokeObjectURL(upload.objectUrl);
        }
        return;
      }

      setUploadedTracks((current) => {
        let changed = false;
        const next = { ...current };
        for (const [trackId, upload] of Object.entries(rehydratedUploads)) {
          if (next[trackId]) {
            URL.revokeObjectURL(upload.objectUrl);
            continue;
          }
          next[trackId] = upload;
          changed = true;
        }
        return changed ? next : current;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeSession,
    cacheLibraryTracks,
    roomSnapshot?.room.id,
    roomSnapshot?.tracks,
    uploadedTracks
  ]);

  useEffect(() => {
    return () => {
      for (const objectUrl of uploadedTrackUrlsRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      uploadedTrackUrlsRef.current.clear();
      cacheLibraryTracksRef.current.clear();
    };
  }, []);

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
      setManualCacheTasks((current) => {
        const existing = current[trackId] ?? null;
        const track = roomSnapshot?.tracks.find((entry) => entry.id === trackId) ?? null;
        const nextTask = buildNextManualCacheTask({
          trackId,
          existing,
          track,
          patch,
          updatedAt: new Date().toISOString()
        });
        if (!nextTask) {
          return current;
        }
        if (roomSnapshot?.room.id && nextTask.fileHash) {
          void upsertManualCacheTask({
            roomId: roomSnapshot.room.id,
            trackId,
            fileHash: nextTask.fileHash,
            status: nextTask.status,
            mode: nextTask.mode,
            errorMessage: nextTask.errorMessage,
            completedChunks: nextTask.completedChunks,
            totalChunks: nextTask.totalChunks,
            mimeType: nextTask.mimeType,
            manifestSource: nextTask.manifestSource,
            blockedReason: nextTask.blockedReason,
            integrityMode: nextTask.integrityMode,
            providerPeerIds: nextTask.providerPeerIds,
            connectedProviderPeerIds: nextTask.connectedProviderPeerIds,
            selectedProviderPeerId: nextTask.selectedProviderPeerId,
            requestableChunkCount: nextTask.requestableChunkCount,
            pendingChunkCount: nextTask.pendingChunkCount,
            lastRequestedChunks: nextTask.lastRequestedChunks,
            lastPieceReceivedAt: nextTask.lastPieceReceivedAt,
            lastError: nextTask.lastError,
            updatedAt: nextTask.updatedAt
          });
        }

        return {
          ...current,
          [trackId]: nextTask
        };
      });
    },
    [roomSnapshot]
  );

  const dropManualCacheTask = useCallback((trackId: string) => {
    manualCacheChunkIndexesRef.current.delete(trackId);
    manualCacheAssemblingTrackIdsRef.current.delete(trackId);
    if (roomSnapshot?.room.id) {
      void deleteManualCacheTask(roomSnapshot.room.id, trackId);
    }
    setManualCacheTasks((current) => {
      if (!(trackId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[trackId];
      return next;
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

      setUploadedTracks((current) => ({ ...current, ...result.uploads }));
      if (result.registeredTracks.length > 0) {
        await syncRoomSnapshot(roomId);
      }
      setStatusMessage(`${result.importedCount} 首本地歌曲已导入房间曲库。`);
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
      if (result.shouldClearChunkIndexes) {
        manualCacheChunkIndexesRef.current.delete(trackId);
      }
      if (result.chunkIndexes) {
        manualCacheChunkIndexesRef.current.set(trackId, result.chunkIndexes);
      }
      if (result.taskPatch) {
        updateManualCacheTask(trackId, result.taskPatch);
      }
      if (result.statusMessage) {
        setStatusMessage(result.statusMessage);
      }
      if (result.assembleRequest) {
        void assembleManualCacheTrack(
          result.assembleRequest.trackId,
          result.assembleRequest.mimeType,
          result.assembleRequest.totalChunks
        );
      }
    },
    [assembleManualCacheTrack, peerId, roomSnapshot, setStatusMessage, updateManualCacheTask]
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
    manualCacheTasks,
    peerId,
    roomSnapshot?.room.playback,
    roomSnapshot?.tracks,
    startPlaybackDemandCacheDownload,
    uploadedTracks
  ]);

  const pauseManualCacheDownload = useCallback(
    (trackId: string) => {
      updateManualCacheTask(trackId, (current) => {
        if (
          !current ||
          (current.status !== "queued" &&
            current.status !== "downloading" &&
            current.status !== "blocked")
        ) {
          return null;
        }

        return {
          status: "paused",
          blockedReason: null,
          selectedProviderPeerId: null,
          requestableChunkCount: 0,
          pendingChunkCount: 0,
          lastRequestedChunks: [],
          lastError: null
        };
      });
    },
    [updateManualCacheTask]
  );

  const handleManualCachePieceReceived = useCallback(
    (input: {
      trackId: string;
      chunkIndex: number;
      totalChunks: number;
      chunkSize: number;
      mimeType: string;
    }) => {
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

      if (!result.accepted) {
        return;
      }

      manualCacheChunkIndexesRef.current.set(input.trackId, result.nextChunkIndexes);

      if (result.availability) {
        onAvailability(result.availability);
        emitAvailability(result.availability);
      }

      if (result.taskPatch) {
        updateManualCacheTask(input.trackId, result.taskPatch);
      }

      if (result.assembleRequest) {
        void assembleManualCacheTrack(
          result.assembleRequest.trackId,
          result.assembleRequest.mimeType,
          result.assembleRequest.totalChunks
        );
      }
    },
    [
      activeSession,
      assembleManualCacheTrack,
      emitAvailability,
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
      manualCacheChunkIndexesRef.current.set(plan.trackId, result.nextChunkIndexes);

      if (result.taskPatch) {
        updateManualCacheTask(plan.trackId, result.taskPatch);
      }

      if (result.assembleRequest) {
        void assembleManualCacheTrack(
          result.assembleRequest.trackId,
          result.assembleRequest.mimeType,
          result.assembleRequest.totalChunks
        );
      }
    },
    [
      activeSession?.userId,
      assembleManualCacheTrack,
      manualCacheTasks,
      peerId,
      roomSnapshot,
      updateManualCacheTask,
      uploadedTracks
    ]
  );

  const deleteUploadedTrackArtifacts = useCallback(
    async (trackId: string) => {
      const result = await deleteUploadedTrackArtifactsFromLibrary({
        trackId,
        roomId: roomSnapshot?.room.id,
        deleteCachedPiecesForTrack,
        deleteManualCacheTask
      });
      for (const removedTrackId of result.removedTrackIds) {
        manualCacheChunkIndexesRef.current.delete(removedTrackId);
        manualCacheAssemblingTrackIdsRef.current.delete(removedTrackId);
      }
      setUploadedTracks((current) => removeTracksFromUploads(current, result.removedTrackIds));
    },
    [roomSnapshot?.room.id]
  );

  const deleteRoomTrackArtifacts = useCallback(
    async (trackIds: string[]) => {
      const result = await deleteRoomTrackArtifactsFromLibrary({
        trackIds,
        roomId: roomSnapshot?.room.id,
        deleteCachedPiecesForTracks,
        deleteManualCacheTasksForTracks
      });
      for (const trackId of result.removedTrackIds) {
        manualCacheChunkIndexesRef.current.delete(trackId);
        manualCacheAssemblingTrackIdsRef.current.delete(trackId);
      }
      setUploadedTracks((current) => removeTracksFromUploads(current, result.removedTrackIds));
      setManualCacheTasks((current) => {
        const next = { ...current };
        for (const trackId of result.removedTrackIds) {
          delete next[trackId];
        }
        return next;
      });
    },
    [roomSnapshot?.room.id]
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
      if (!result) {
        return null;
      }

      setUploadedTracks((current) => ({
        ...current,
        [result.trackId]: result.upload
      }));
      return result.trackId;
    },
    [
      activeSession,
      emitAvailability,
      onAvailability,
      peerId,
      roomSnapshot,
      syncRoomSnapshot,
      loadCachedLibraryTrackFile
    ]
  );

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
