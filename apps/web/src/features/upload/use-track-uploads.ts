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
  hasUsableCachedLibraryFileForRoomTrack,
  importCachedLibraryTrackToRoom as importCachedLibraryTrackToRoomFromLibrary,
  loadCacheLibrarySnapshot,
  toCachedLibraryFile,
  toCachedLibraryTrackFile
} from "./cache-library";
import {
  announceRoomTrackAvailability as announceRoomTrackAvailabilityFromSources,
  buildManualCachePieceAvailabilityAnnouncement,
  isManualCachePieceCompatible,
  resolveMissingOwnedUploadedTracks,
  resolveReusableCachedPieceManifest,
  shouldAnnounceTrackAvailability
} from "./track-availability";
import {
  buildNextManualCacheTask,
  mergeHydratedManualCacheTasks,
  mergeManualCachePieceTaskProgress,
  pruneManualCacheChunkIndexesByActiveTracks,
  resolveAutomaticPlaybackCacheTaskMode,
  resolveManualCachePlanTaskUpdate,
  resolveStalePlaybackDemandTaskIds,
  shouldCreatePlaybackDemandTaskFromCachePiece,
  shouldEnsurePlaybackDemandCacheTask,
  shouldHydrateCacheTaskPieceIndexes,
  shouldIgnoreManualCachePieceTaskUpdate,
  type ManualCacheTask,
  type ManualCacheTaskStatus
} from "./upload-ui-state";
import {
  buildCachedLibraryTrackRegisterPayload,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";

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
      if (!enableManualTrackCaching || !roomSnapshot || manualCacheAssemblingTrackIdsRef.current.has(trackId)) {
        return;
      }

      manualCacheAssemblingTrackIdsRef.current.add(trackId);
      try {
        const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
        if (!track) {
          return;
        }

        updateManualCacheTask(trackId, {
          status: "assembling",
          errorMessage: null,
          blockedReason: null,
          totalChunks,
          completedChunks: totalChunks,
          mimeType
        });

        const expectedManifest = track.relayManifest ?? track.pieceManifest ?? null;
        const pieces = await getCachedPiecesForTrack(trackId, peerId, {
          fileHash: track.fileHash,
          ownerKey: localCacheOwnerKey,
          chunkSize: expectedManifest?.chunkSize
        });
        if (pieces.length < totalChunks) {
          updateManualCacheTask(trackId, (current) =>
            current && current.status !== "paused"
              ? {
                  status: "downloading",
                  completedChunks: pieces.length,
                  totalChunks,
                  mimeType
                }
              : null
          );
          return;
        }

        const assembled = await assembleTrackFileFromPieces({
          pieces,
          totalChunks,
          mimeType: mimeType || track.mimeType || "audio/mpeg",
          title: track.title,
          expectedFileHash: track.fileHash
        });

        if (!assembled) {
          updateManualCacheTask(trackId, {
            status: "failed-integrity",
            errorMessage: "文件组装或完整性校验失败",
            completedChunks: pieces.length,
            totalChunks,
            mimeType,
            lastError: "integrity-mismatch"
          });
          setStatusMessage(`曲目 ${track.title} 的缓存完整性校验失败，等待新的可用来源后重试。`);
          return;
        }

        await persistTrackIntoLibrary({
          track,
          roomId: roomSnapshot.room.id,
          file: assembled.file
        });
        await deleteCachedPiecesForTrack(trackId);
        manualCacheChunkIndexesRef.current.delete(trackId);
        updateManualCacheTask(trackId, {
          status: "ready",
          errorMessage: null,
          blockedReason: null,
          completedChunks: totalChunks,
          totalChunks,
          mimeType: mimeType || assembled.file.type || track.mimeType || null,
          lastError: null
        });
        void announceRoomTrackAvailability(trackId);
        setStatusMessage(`已缓存《${track.title}》。`);
      } finally {
        manualCacheAssemblingTrackIdsRef.current.delete(trackId);
      }
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

      const cachedLibraryTrack =
        cacheLibraryTracksRef.current.get(track.fileHash) ??
        (await getCachedLibraryTrackSummary(track.fileHash));
      if (
        isCachedLibraryTrackUsableForRoomTrack({
          cachedTrack: cachedLibraryTrack,
          roomTrack: track
        })
      ) {
        const cachedLibraryRecord = await getCachedLibraryTrack(track.fileHash);
        if (
          hasUsableCachedLibraryFileForRoomTrack({
            cachedTrack: cachedLibraryRecord,
            roomTrack: track
          })
        ) {
          updateManualCacheTask(trackId, {
            status: "ready",
            mode,
            fileHash: track.fileHash,
            errorMessage: null,
            completedChunks: resolveTrackTotalChunks(track),
            totalChunks: resolveTrackTotalChunks(track),
            mimeType: track.mimeType ?? null,
            blockedReason: null,
            lastError: null
          });
          return;
        }
      }

      const expectedManifest = track.relayManifest ?? track.pieceManifest ?? null;
      const rawCachedManifest =
        (await getTrackPieceManifestByFileHash(track.fileHash)) ??
        (await getTrackPieceManifest(trackId));
      const cachedManifest = resolveReusableCachedPieceManifest({
        cachedManifest: rawCachedManifest,
        expectedManifest
      });
      if (
        rawCachedManifest &&
        !cachedManifest &&
        expectedManifest &&
        (rawCachedManifest.totalChunks !== expectedManifest.totalChunks ||
          rawCachedManifest.chunkSize !== expectedManifest.chunkSize)
      ) {
        await deleteCachedPiecesForTrack(trackId, undefined, {
          fileHash: track.fileHash,
          ownerKey: localCacheOwnerKey
        });
        manualCacheChunkIndexesRef.current.delete(trackId);
      }

      const pieces = await getCachedPiecesForTrack(trackId, peerId, {
        fileHash: track.fileHash,
        ownerKey: localCacheOwnerKey,
        chunkSize: cachedManifest?.chunkSize ?? expectedManifest?.chunkSize
      });
      const chunkIndexes = new Set(pieces.map((piece) => piece.chunkIndex));
      manualCacheChunkIndexesRef.current.set(trackId, chunkIndexes);

      const totalChunks =
        cachedManifest?.totalChunks ??
        expectedManifest?.totalChunks ??
        Math.max(chunkIndexes.size, 0);
      const mimeType = cachedManifest?.mimeType ?? track.mimeType ?? null;
      const completedChunks = chunkIndexes.size;
      const status: ManualCacheTaskStatus =
        completedChunks > 0 ? "downloading" : "queued";

      updateManualCacheTask(trackId, {
        status,
        mode,
        fileHash: track.fileHash,
        errorMessage: null,
        completedChunks,
        totalChunks,
        mimeType,
        manifestSource: cachedManifest ? "cache" : expectedManifest ? "snapshot" : null,
        blockedReason: null,
        integrityMode: cachedManifest?.pieceHashes?.length === totalChunks ? "strong" : "weak",
        lastError: null
      });
      if (mode === "manual") {
        setStatusMessage(`已开始缓存《${track.title}》。`);
      }

      if (totalChunks > 0 && completedChunks >= totalChunks) {
        void assembleManualCacheTrack(trackId, mimeType, totalChunks);
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
      const expectedManifest = track?.relayManifest ?? track?.pieceManifest ?? null;
      if (
        !isManualCachePieceCompatible({
          piece: input,
          expectedManifest
        })
      ) {
        return;
      }

      const chunkIndexes =
        manualCacheChunkIndexesRef.current.get(input.trackId) ?? new Set<number>();
      chunkIndexes.add(input.chunkIndex);
      manualCacheChunkIndexesRef.current.set(input.trackId, chunkIndexes);

      if (roomSnapshot?.room.id && activeSession && peerId && track) {
        const availability = buildManualCachePieceAvailabilityAnnouncement({
          existing: undefined,
          roomId: roomSnapshot.room.id,
          trackId: input.trackId,
          fileHash: track.fileHash,
          peerId,
          nickname: activeSession.nickname,
          chunkIndex: input.chunkIndex,
          totalChunks: input.totalChunks,
          chunkSize: input.chunkSize,
          availableChunks: [...chunkIndexes]
        });
        onAvailability(availability);
        emitAvailability(availability);
      }

      let shouldAssemble = false;
      updateManualCacheTask(input.trackId, (current) => {
        const hasLocalFullTrack =
          !!uploadedTracks[input.trackId] ||
          isCachedLibraryTrackUsableForRoomTrack({
            cachedTrack: track
              ? cacheLibraryTracksRef.current.get(track.fileHash)
              : null,
            roomTrack: track
          });
        if (
          !current &&
          shouldCreatePlaybackDemandTaskFromCachePiece({
            playback: roomSnapshot?.room.playback,
            trackId: input.trackId,
            peerId,
            activeSessionId: activeSession?.userId,
            hasLocalFullTrack,
            hasCurrentTask: false
          })
        ) {
          current = {
            trackId: input.trackId,
            status: "downloading",
            mode: resolveAutomaticPlaybackCacheTaskMode(),
            fileHash: track?.fileHash ?? "",
            updatedAt: new Date().toISOString(),
            errorMessage: null,
            completedChunks: 0,
            totalChunks: input.totalChunks,
            mimeType: input.mimeType || track?.mimeType || null,
            manifestSource: expectedManifest ? "snapshot" : null,
            blockedReason: null,
            integrityMode: "weak",
            providerPeerIds: [],
            connectedProviderPeerIds: [],
            selectedProviderPeerId: null,
            requestableChunkCount: 0,
            pendingChunkCount: 0,
            lastRequestedChunks: [],
            lastPieceReceivedAt: null,
            lastError: null
          };
        }
        if (!current) {
          return null;
        }
        if (shouldIgnoreManualCachePieceTaskUpdate(current.status)) {
          return null;
        }

        const progress = mergeManualCachePieceTaskProgress({
          current,
          knownChunkIndexes: chunkIndexes,
          receivedTotalChunks: input.totalChunks
        });
        const nextCompletedChunks = progress.completedChunks;
        const nextTotalChunks = progress.totalChunks;
        shouldAssemble =
          current.status !== "paused" &&
          nextTotalChunks > 0 &&
          nextCompletedChunks >= nextTotalChunks;

        return {
          status:
            current.status === "paused" || shouldAssemble
              ? current.status
              : progress.status,
          errorMessage: null,
          blockedReason: null,
          completedChunks: nextCompletedChunks,
          totalChunks: nextTotalChunks,
          mimeType: input.mimeType || current.mimeType,
          lastPieceReceivedAt: new Date().toISOString(),
          lastError: null
        };
      });

      if (shouldAssemble) {
        void assembleManualCacheTrack(
          input.trackId,
          input.mimeType,
          Math.max(input.totalChunks, chunkIndexes.size)
        );
      }
    },
    [
      activeSession,
      assembleManualCacheTrack,
      emitAvailability,
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
      const planTotalChunks = plan.manifest?.totalChunks ?? 0;
      for (const chunkIndex of plan.localPieceIndexes) {
        if (
          chunkIndex >= 0 &&
          (planTotalChunks <= 0 || chunkIndex < planTotalChunks)
        ) {
          knownChunkIndexes.add(chunkIndex);
        }
      }
      manualCacheChunkIndexesRef.current.set(plan.trackId, knownChunkIndexes);
      let shouldAssembleFromPlan = false;
      let assembleMimeType: string | null = null;
      let assembleTotalChunks = 0;
      updateManualCacheTask(plan.trackId, (current) => {
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
        if (!current && !isCurrentPlaybackDemand) {
          return null;
        }
        const update = resolveManualCachePlanTaskUpdate({
          current,
          plan,
          track,
          knownChunkIndexes,
          isCurrentPlaybackDemand
        });
        shouldAssembleFromPlan = update.shouldAssemble;
        assembleMimeType = update.assembleMimeType;
        assembleTotalChunks = update.assembleTotalChunks;
        return update.patch;
      });

      if (shouldAssembleFromPlan) {
        void assembleManualCacheTrack(plan.trackId, assembleMimeType, assembleTotalChunks);
      }
    },
    [
      activeSession?.userId,
      assembleManualCacheTrack,
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

function resolveTrackTotalChunks(track: Pick<TrackMeta, "relayManifest" | "pieceManifest">) {
  return track.relayManifest?.totalChunks ?? track.pieceManifest?.totalChunks ?? 0;
}
