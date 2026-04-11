"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import type { GuestSession, RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import { assembleTrackFileFromPieces, buildTrackAvailabilityFromFile } from "@/features/p2p";
import { enableManualTrackCaching } from "@/features/cache/cache-policy";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  clearTransientTrackCacheData,
  deleteCachedLibraryTrack as deleteCachedLibraryTrackRecord,
  deleteCachedPiecesForTrack,
  deleteCachedPiecesForTracks,
  getCachedLibraryTrackCount,
  getCachedPiecesForTrack,
  getTrackPieceManifest,
  listCachedLibraryTracks,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import { removeTracksFromUploads } from "@/lib/music-room-ui";
import { buildTrackMeta, type CachedLibraryTrack, type UploadedTrack } from "@/features/upload/audio-utils";

export type ManualCacheTaskStatus =
  | "idle"
  | "queued"
  | "downloading"
  | "paused"
  | "assembling"
  | "ready"
  | "failed";

export type ManualCacheTask = {
  trackId: string;
  status: ManualCacheTaskStatus;
  updatedAt: string;
  errorMessage: string | null;
  completedChunks: number;
  totalChunks: number;
  mimeType: string | null;
};

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
  const cacheLibraryUrlsRef = useRef<Map<string, string>>(new Map());
  const cacheLibraryTracksRef = useRef<Map<string, CachedLibraryTrack>>(new Map());
  const inFlightUploadHashesRef = useRef<Set<string>>(new Set());
  const manualCacheChunkIndexesRef = useRef<Map<string, Set<number>>>(new Map());
  const manualCacheAssemblingTrackIdsRef = useRef<Set<string>>(new Set());

  const manualCacheTrackIds = useMemo(
    () =>
      Object.values(manualCacheTasks)
        .filter(
          (task) =>
            task.status === "queued" ||
            task.status === "downloading" ||
            task.status === "assembling"
        )
        .map((task) => task.trackId),
    [manualCacheTasks]
  );

  const refreshCacheLibrary = useCallback(async () => {
    const records = await listCachedLibraryTracks();
    const nextUrlMap = new Map<string, string>();
    const nextTracks: CachedLibraryTrack[] = records.map((record) => {
      const existingUrl = cacheLibraryUrlsRef.current.get(record.fileHash);
      const objectUrl = existingUrl ?? URL.createObjectURL(record.file);
      nextUrlMap.set(record.fileHash, objectUrl);
      return {
        fileHash: record.fileHash,
        title: record.title,
        artist: record.artist,
        mimeType: record.mimeType,
        durationMs: record.durationMs,
        sizeBytes: record.sizeBytes,
        cachedAt: record.cachedAt,
        sourceTrackIds: record.sourceTrackIds,
        sourceRoomIds: record.sourceRoomIds,
        lastSourceTrackId: record.lastSourceTrackId,
        lastSourceRoomId: record.lastSourceRoomId,
        lastOwnerNickname: record.lastOwnerNickname,
        objectUrl,
        file: toCachedLibraryFile(record)
      };
    });

    for (const [fileHash, objectUrl] of cacheLibraryUrlsRef.current.entries()) {
      if (!nextUrlMap.has(fileHash)) {
        URL.revokeObjectURL(objectUrl);
      }
    }

    cacheLibraryUrlsRef.current = nextUrlMap;
    cacheLibraryTracksRef.current = new Map(
      nextTracks.map((track) => [track.fileHash, track] as const)
    );
    setCacheLibraryTracks(nextTracks);
    setCachedTrackCount(await getCachedLibraryTrackCount());
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
    manualCacheChunkIndexesRef.current.clear();
    manualCacheAssemblingTrackIdsRef.current.clear();
    setManualCacheTasks({});
    setUploadedTracks((current) => {
      const next = { ...current };
      const activeTrackIds = new Set(roomSnapshot?.tracks.map((track) => track.id) ?? []);
      for (const trackId of Object.keys(current)) {
        if (!activeTrackIds.has(trackId)) {
          delete next[trackId];
        }
      }
      return next;
    });
    void clearTransientTrackCacheData();
  }, [roomSnapshot?.room.id]);

  useEffect(() => {
    return () => {
      for (const objectUrl of uploadedTrackUrlsRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      uploadedTrackUrlsRef.current.clear();
      for (const objectUrl of cacheLibraryUrlsRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      cacheLibraryUrlsRef.current.clear();
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
        const nextPatch = typeof patch === "function" ? patch(existing) : patch;
        if (!nextPatch) {
          return current;
        }

        return {
          ...current,
          [trackId]: {
            trackId,
            status: existing?.status ?? "idle",
            errorMessage: existing?.errorMessage ?? null,
            completedChunks: existing?.completedChunks ?? 0,
            totalChunks: existing?.totalChunks ?? 0,
            mimeType: existing?.mimeType ?? null,
            ...nextPatch,
            updatedAt: new Date().toISOString()
          }
        };
      });
    },
    []
  );

  const dropManualCacheTask = useCallback((trackId: string) => {
    manualCacheChunkIndexesRef.current.delete(trackId);
    manualCacheAssemblingTrackIdsRef.current.delete(trackId);
    setManualCacheTasks((current) => {
      if (!(trackId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[trackId];
      return next;
    });
  }, []);

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
      const file =
        input.file instanceof File ? input.file : toCachedLibraryFileFromBlob(input.file, input.track);
      await upsertCachedLibraryTrack({
        fileHash: input.track.fileHash,
        title: input.track.title,
        artist: input.track.artist ?? "未知艺术家",
        mimeType: input.track.mimeType || file.type || "audio/mpeg",
        durationMs: input.track.durationMs,
        sizeBytes: input.track.sizeBytes ?? file.size,
        file,
        sourceTrackIds: [input.track.id],
        sourceRoomIds: [input.roomId],
        lastSourceTrackId: input.track.id,
        lastSourceRoomId: input.roomId,
        lastOwnerNickname: input.track.ownerNickname ?? null
      });
      await refreshCacheLibrary();
    },
    [refreshCacheLibrary]
  );

  const announceRoomTrackAvailability = useCallback(
    async (trackId: string) => {
      if (!enableManualTrackCaching || !roomSnapshot || !activeSession || !peerId) {
        return;
      }

      const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
      const uploadedTrack = uploadedTracks[trackId] ?? null;
      if (!track || !uploadedTrack) {
        return;
      }

      const availability = await buildTrackAvailabilityFromFile({
        roomId: roomSnapshot.room.id,
        trackId,
        fileHash: track.fileHash,
        file: uploadedTrack.file,
        peerId,
        nickname: activeSession.nickname,
        source: "live_upload",
        mimeType: track.mimeType,
        codec: track.codec ?? null,
        sizeBytes: track.sizeBytes ?? uploadedTrack.file.size,
        durationMs: track.durationMs,
        totalChunks: track.relayManifest?.totalChunks ?? track.pieceManifest?.totalChunks,
        chunkSize: track.relayManifest?.chunkSize ?? track.pieceManifest?.chunkSize
      });
      onAvailability(availability);
      emitAvailability(availability);
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
          totalChunks,
          completedChunks: totalChunks,
          mimeType
        });

        const pieces = await getCachedPiecesForTrack(trackId, peerId);
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
          await deleteCachedPiecesForTrack(trackId);
          manualCacheChunkIndexesRef.current.delete(trackId);
          updateManualCacheTask(trackId, {
            status: "failed",
            errorMessage: "文件组装失败",
            completedChunks: 0,
            totalChunks: 0,
            mimeType
          });
          setStatusMessage(`曲目 ${track.title} 的缓存组装失败。`);
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
          completedChunks: totalChunks,
          totalChunks,
          mimeType: mimeType || assembled.file.type || track.mimeType || null
        });
        setStatusMessage(`已缓存《${track.title}》。`);
      } finally {
        manualCacheAssemblingTrackIdsRef.current.delete(trackId);
      }
    },
    [peerId, persistTrackIntoLibrary, roomSnapshot, setStatusMessage, updateManualCacheTask]
  );

  const handleFilesSelected = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || !activeSession || !roomSnapshot) {
        return;
      }

      const roomId = roomSnapshot.room.id;
      const nextUploads: Record<string, UploadedTrack> = {};
      const nextTracks: TrackMeta[] = [];
      const currentTracksByHash = new Map(
        roomSnapshot.tracks
          .filter((track) => track.ownerSessionId === activeSession.userId)
          .map((track) => [track.fileHash, track] as const)
      );

      for (const file of Array.from(files)) {
        const objectUrl = URL.createObjectURL(file);
        const track = await buildTrackMeta(file, objectUrl, activeSession);
        const uploadHashKey = `${activeSession.userId}:${track.fileHash}`;

        if (inFlightUploadHashesRef.current.has(uploadHashKey)) {
          URL.revokeObjectURL(objectUrl);
          continue;
        }

        const existingTrack = currentTracksByHash.get(track.fileHash);
        if (existingTrack) {
          URL.revokeObjectURL(objectUrl);
          continue;
        }

        inFlightUploadHashesRef.current.add(uploadHashKey);
        let registered: TrackMeta;
        try {
          registered = await musicRoomApi.registerTrack(roomId, {
            sessionId: activeSession.userId,
            ...track
          });
        } finally {
          inFlightUploadHashesRef.current.delete(uploadHashKey);
        }

        nextUploads[registered.id] = {
          file,
          objectUrl,
          origin: "live-upload"
        };
        nextTracks.push(registered);
        currentTracksByHash.set(registered.fileHash, registered);

        if (enableManualTrackCaching) {
          await persistTrackIntoLibrary({
            track: registered,
            roomId,
            file
          });
        }

        if (enableManualTrackCaching && peerId) {
          const availability = await buildTrackAvailabilityFromFile({
            roomId,
            trackId: registered.id,
            fileHash: registered.fileHash,
            file,
            peerId,
            nickname: activeSession.nickname,
            source: "live_upload",
            mimeType: registered.mimeType,
            codec: registered.codec ?? null,
            sizeBytes: registered.sizeBytes ?? file.size,
            durationMs: registered.durationMs,
            totalChunks: registered.pieceManifest?.totalChunks,
            chunkSize: registered.pieceManifest?.chunkSize
          });
          onAvailability(availability);
          emitAvailability(availability);
        }
      }

      setUploadedTracks((current) => ({ ...current, ...nextUploads }));
      if (nextTracks.length > 0) {
        await syncRoomSnapshot(roomId);
      }
      setStatusMessage(`${Object.keys(nextUploads).length} 首本地歌曲已导入房间曲库。`);
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

  const startManualCacheDownload = useCallback(
    async (trackId: string) => {
      if (!enableManualTrackCaching || !roomSnapshot) {
        return;
      }

      const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
      if (!track) {
        return;
      }

      if (cacheLibraryTracksRef.current.has(track.fileHash)) {
        updateManualCacheTask(trackId, {
          status: "ready",
          errorMessage: null,
          completedChunks: resolveTrackTotalChunks(track),
          totalChunks: resolveTrackTotalChunks(track),
          mimeType: track.mimeType ?? null
        });
        return;
      }

      const expectedManifest = track.relayManifest ?? track.pieceManifest ?? null;
      const cachedManifest = await getTrackPieceManifest(trackId);
      if (
        cachedManifest &&
        expectedManifest &&
        (cachedManifest.totalChunks !== expectedManifest.totalChunks ||
          cachedManifest.chunkSize !== expectedManifest.chunkSize)
      ) {
        await deleteCachedPiecesForTrack(trackId);
        manualCacheChunkIndexesRef.current.delete(trackId);
      }

      const pieces = await getCachedPiecesForTrack(trackId, peerId);
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
        errorMessage: null,
        completedChunks,
        totalChunks,
        mimeType
      });
      setStatusMessage(`已开始缓存《${track.title}》。`);

      if (totalChunks > 0 && completedChunks >= totalChunks) {
        void assembleManualCacheTrack(trackId, mimeType, totalChunks);
      }
    },
    [assembleManualCacheTrack, peerId, roomSnapshot, setStatusMessage, updateManualCacheTask]
  );

  const pauseManualCacheDownload = useCallback(
    (trackId: string) => {
      setManualCacheTasks((current) => {
        const existing = current[trackId];
        if (!existing) {
          return current;
        }

        if (existing.status !== "queued" && existing.status !== "downloading") {
          return current;
        }

        return {
          ...current,
          [trackId]: {
            ...existing,
            status: "paused",
            updatedAt: new Date().toISOString()
          }
        };
      });
    },
    []
  );

  const handleManualCachePieceReceived = useCallback(
    (input: {
      trackId: string;
      chunkIndex: number;
      totalChunks: number;
      chunkSize: number;
      mimeType: string;
    }) => {
      const chunkIndexes =
        manualCacheChunkIndexesRef.current.get(input.trackId) ?? new Set<number>();
      chunkIndexes.add(input.chunkIndex);
      manualCacheChunkIndexesRef.current.set(input.trackId, chunkIndexes);

      let shouldAssemble = false;
      updateManualCacheTask(input.trackId, (current) => {
        if (!current) {
          return null;
        }

        const nextCompletedChunks = chunkIndexes.size;
        const nextTotalChunks = Math.max(current.totalChunks, input.totalChunks);
        shouldAssemble =
          current.status !== "paused" &&
          nextTotalChunks > 0 &&
          nextCompletedChunks >= nextTotalChunks;

        return {
          status:
            current.status === "paused" || shouldAssemble
              ? current.status
              : "downloading",
          errorMessage: null,
          completedChunks: nextCompletedChunks,
          totalChunks: nextTotalChunks,
          mimeType: input.mimeType || current.mimeType
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
    [assembleManualCacheTrack, updateManualCacheTask]
  );

  const deleteUploadedTrackArtifacts = useCallback(async (trackId: string) => {
    await deleteCachedPiecesForTrack(trackId);
    manualCacheChunkIndexesRef.current.delete(trackId);
    manualCacheAssemblingTrackIdsRef.current.delete(trackId);
    setUploadedTracks((current) => removeTracksFromUploads(current, [trackId]));
  }, []);

  const deleteRoomTrackArtifacts = useCallback(
    async (trackIds: string[]) => {
      const uniqueTrackIds = [...new Set(trackIds.filter(Boolean))];
      if (uniqueTrackIds.length === 0) {
        return;
      }

      await deleteCachedPiecesForTracks(uniqueTrackIds);
      for (const trackId of uniqueTrackIds) {
        manualCacheChunkIndexesRef.current.delete(trackId);
        manualCacheAssemblingTrackIdsRef.current.delete(trackId);
      }
      setUploadedTracks((current) => removeTracksFromUploads(current, uniqueTrackIds));
      setManualCacheTasks((current) => {
        const next = { ...current };
        for (const trackId of uniqueTrackIds) {
          delete next[trackId];
        }
        return next;
      });
    },
    []
  );

  const deleteCachedLibraryTrackEntry = useCallback(
    async (fileHash: string) => {
      const record = await deleteCachedLibraryTrackRecord(fileHash);
      if (record?.sourceTrackIds.length) {
        await deleteCachedPiecesForTracks(record.sourceTrackIds);
        for (const trackId of record.sourceTrackIds) {
          dropManualCacheTask(trackId);
        }
      }
      await refreshCacheLibrary();
    },
    [dropManualCacheTask, refreshCacheLibrary]
  );

  const exportCachedLibraryTrack = useCallback(
    async (fileHash: string) => {
      const cachedTrack = cacheLibraryTracksRef.current.get(fileHash);
      if (!cachedTrack) {
        return;
      }

      const downloadUrl = URL.createObjectURL(cachedTrack.file);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = buildCachedLibraryFileName(cachedTrack);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    },
    []
  );

  const importCachedLibraryTrackToRoom = useCallback(
    async (fileHash: string) => {
      if (!activeSession || !roomSnapshot) {
        return null;
      }

      const cachedTrack = cacheLibraryTracksRef.current.get(fileHash);
      if (!cachedTrack) {
        return null;
      }

      const roomId = roomSnapshot.room.id;
      const existingTrack =
        roomSnapshot.tracks.find(
          (track) =>
            track.ownerSessionId === activeSession.userId &&
            track.fileHash === fileHash
        ) ?? null;

      let registeredTrack = existingTrack;
      if (!registeredTrack) {
        const tempObjectUrl = URL.createObjectURL(cachedTrack.file);
        try {
          const trackMeta = await buildTrackMeta(cachedTrack.file, tempObjectUrl, activeSession);
          registeredTrack = await musicRoomApi.registerTrack(roomId, {
            sessionId: activeSession.userId,
            ...trackMeta
          });
        } finally {
          URL.revokeObjectURL(tempObjectUrl);
        }
        await syncRoomSnapshot(roomId);
      }

      const uploadedObjectUrl = URL.createObjectURL(cachedTrack.file);
      setUploadedTracks((current) => ({
        ...current,
        [registeredTrack.id]: {
          file: cachedTrack.file,
          objectUrl: uploadedObjectUrl,
          origin: "live-upload"
        }
      }));

      if (enableManualTrackCaching && peerId) {
        const availability = await buildTrackAvailabilityFromFile({
          roomId,
          trackId: registeredTrack.id,
          fileHash: registeredTrack.fileHash,
          file: cachedTrack.file,
          peerId,
          nickname: activeSession.nickname,
          source: "live_upload",
          mimeType: registeredTrack.mimeType,
          codec: registeredTrack.codec ?? null,
          sizeBytes: registeredTrack.sizeBytes ?? cachedTrack.file.size,
          durationMs: registeredTrack.durationMs,
          totalChunks: registeredTrack.pieceManifest?.totalChunks,
          chunkSize: registeredTrack.pieceManifest?.chunkSize
        });
        onAvailability(availability);
        emitAvailability(availability);
      }

      return registeredTrack.id;
    },
    [
      activeSession,
      emitAvailability,
      onAvailability,
      peerId,
      roomSnapshot,
      syncRoomSnapshot
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
    pauseManualCacheDownload,
    handleManualCachePieceReceived,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    deleteCachedLibraryTrackEntry,
    exportCachedLibraryTrack,
    importCachedLibraryTrackToRoom
  };
}

function resolveTrackTotalChunks(track: Pick<TrackMeta, "relayManifest" | "pieceManifest">) {
  return track.relayManifest?.totalChunks ?? track.pieceManifest?.totalChunks ?? 0;
}

function toCachedLibraryFile(input: {
  file: Blob;
  title: string;
  mimeType: string;
  fileHash: string;
}) {
  if (input.file instanceof File) {
    return input.file;
  }

  return new File([input.file], buildCachedLibraryFileName(input), {
    type: input.mimeType || "audio/mpeg"
  });
}

function toCachedLibraryFileFromBlob(
  file: Blob,
  track: Pick<TrackMeta, "title" | "mimeType" | "fileHash">
) {
  return toCachedLibraryFile({
    file,
    title: track.title,
    mimeType: track.mimeType || file.type || "audio/mpeg",
    fileHash: track.fileHash
  });
}

function buildCachedLibraryFileName(input: {
  title: string;
  mimeType: string;
  fileHash: string;
}) {
  const baseName = sanitizeFileName(input.title) || input.fileHash;
  const extension = inferFileExtension(input.mimeType);
  return extension ? `${baseName}.${extension}` : baseName;
}

function inferFileExtension(mimeType: string | null | undefined) {
  switch ((mimeType ?? "").toLowerCase()) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/flac":
      return "flac";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mp4":
    case "audio/aac":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    default:
      return "";
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, " ").trim();
}
