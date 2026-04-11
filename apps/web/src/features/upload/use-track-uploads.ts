"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import type { GuestSession, RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import {
  assembleTrackFileFromPieces,
  buildCanonicalTrackPieceManifest,
  buildTrackAvailabilityFromCache,
  buildTrackAvailabilityFromFile,
  resolveTrackPieceManifest,
  type ResolvedTrackPieceManifest
} from "@/features/p2p";
import {
  cacheTrackAsset,
  deleteCachedLibraryTrack as deleteCachedLibraryTrackRecord,
  deleteCachedPiecesForTrack,
  deleteCachedPiecesForTracks,
  getCachedLibraryTrackCount,
  getCachedPiecesForTrack,
  getCachedTrackAsset,
  getTrackPieceManifest,
  listCachedLibraryTracks,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import { removeTracksFromUploads } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  buildTrackMeta,
  type CachedLibraryTrack,
  type UploadedTrack
} from "@/features/upload/audio-utils";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import { enableManualTrackCaching } from "@/features/playback/track-cache-policy";

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
};

export function useTrackUploads(options: {
  maxCachedTracks: number;
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

  const manualCacheTrackIds = useMemo(
    () =>
      Object.values(manualCacheTasks)
        .filter((task) =>
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
    if (!activeSession?.userId || !roomSnapshot) {
      return;
    }

    const ownedRoomTracks = roomSnapshot.tracks.filter(
      (track) => track.ownerSessionId === activeSession.userId
    );
    if (ownedRoomTracks.length === 0) {
      setUploadedTracks((current) => {
        const staleCacheLibraryTrackIds = Object.entries(current)
          .filter(([, upload]) => upload.origin === "cache-library")
          .map(([trackId]) => trackId);
        if (staleCacheLibraryTrackIds.length === 0) {
          return current;
        }
        return removeTracksFromUploads(current, staleCacheLibraryTrackIds);
      });
      return;
    }

    setUploadedTracks((current) => {
      const nextUploads = { ...current };
      let changed = false;
      const recoverableTrackIds = new Set<string>();
      const ownedTrackIds = new Set<string>();

      for (const track of ownedRoomTracks) {
        ownedTrackIds.add(track.id);
        const cachedLibraryTrack = cacheLibraryTracksRef.current.get(track.fileHash);
        if (!cachedLibraryTrack) {
          continue;
        }

        recoverableTrackIds.add(track.id);
        const existingUpload = current[track.id];
        if (existingUpload && existingUpload.origin !== "cache-library") {
          continue;
        }
        if (existingUpload?.origin === "cache-library") {
          continue;
        }

        nextUploads[track.id] = {
          file: cachedLibraryTrack.file,
          objectUrl: URL.createObjectURL(cachedLibraryTrack.file),
          origin: "cache-library"
        };
        changed = true;
      }

      for (const [trackId, upload] of Object.entries(current)) {
        if (upload.origin !== "cache-library") {
          continue;
        }
        if (!ownedTrackIds.has(trackId) || !recoverableTrackIds.has(trackId)) {
          delete nextUploads[trackId];
          changed = true;
        }
      }

      return changed ? nextUploads : current;
    });
  }, [activeSession?.userId, roomSnapshot, cacheLibraryTracks]);

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

  async function syncRoomSnapshot(roomId: string) {
    try {
      const latestSnapshot = await musicRoomApi.getRoom(roomId);
      dispatchRoomStateEvent({
        type: "recover-snapshot",
        snapshot: latestSnapshot
      });
    } catch {
      // Later snapshot resync remains the source of truth.
    }
  }

  function updateManualCacheTask(
    trackId: string,
    status: ManualCacheTaskStatus,
    errorMessage: string | null = null
  ) {
    setManualCacheTasks((current) => ({
      ...current,
      [trackId]: {
        trackId,
        status,
        updatedAt: new Date().toISOString(),
        errorMessage
      }
    }));
  }

  async function persistTrackIntoLibrary(input: {
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
  }) {
    const file = input.file instanceof File ? input.file : toCachedLibraryFileFromBlob(input.file, input.track);
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
  }

  async function handleFilesSelected(files: FileList | File[] | null) {
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
        await cacheTrackAsset({
          trackId: registered.id,
          fileHash: registered.fileHash,
          title: registered.title,
          mimeType: registered.mimeType || file.type || "audio/mpeg",
          file
        });
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
  }

  async function startManualCacheDownload(trackId: string) {
    if (!enableManualTrackCaching || !roomSnapshot) {
      return;
    }

    const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
    if (!track) {
      return;
    }

    if (cacheLibraryTracksRef.current.has(track.fileHash)) {
      updateManualCacheTask(trackId, "ready");
      return;
    }

    const cachedAsset = await getCachedTrackAsset(trackId);
    if (cachedAsset) {
      await persistTrackIntoLibrary({
        track,
        roomId: roomSnapshot.room.id,
        file: cachedAsset.file
      });
      updateManualCacheTask(trackId, "ready");
      return;
    }

    updateManualCacheTask(trackId, "queued");
    setStatusMessage(`已开始缓存《${track.title}》。`);
  }

  function pauseManualCacheDownload(trackId: string) {
    setManualCacheTasks((current) => {
      const existing = current[trackId];
      if (!existing) {
        return current;
      }

      if (
        existing.status !== "queued" &&
        existing.status !== "downloading"
      ) {
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
  }

  function markManualCacheTrackDownloading(trackId: string) {
    setManualCacheTasks((current) => {
      const existing = current[trackId];
      if (
        !existing ||
        existing.status === "paused" ||
        existing.status === "assembling" ||
        existing.status === "ready"
      ) {
        return current;
      }

      return {
        ...current,
        [trackId]: {
          ...existing,
          status: "downloading",
          updatedAt: new Date().toISOString()
        }
      };
    });
  }

  async function announceLocalCache(trackId: string, totalChunks?: number) {
    if (!enableManualTrackCaching) {
      return;
    }

    if (!roomSnapshot || !activeSession || !peerId) {
      return;
    }

    const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
    const uploadedTrack = uploadedTracks[trackId];
    const cachedAsset = uploadedTrack ? null : await getCachedTrackAsset(trackId);
    const fallbackFile = uploadedTrack?.file ?? cachedAsset?.file ?? null;
    const cachedPieceManifest = (await getTrackPieceManifest(trackId)) ?? null;
    const canonicalManifest = resolveCanonicalTrackManifest({
      track,
      cachedPieceManifest,
      fallbackFile,
      fallbackMimeType: track?.mimeType ?? cachedAsset?.mimeType ?? null
    });
    const shouldRebuildCachedPieces =
      !!fallbackFile &&
      !!cachedPieceManifest &&
      !!canonicalManifest &&
      canonicalManifest.source !== "cache" &&
      hasManifestGeometryMismatch(cachedPieceManifest, canonicalManifest);
    if (shouldRebuildCachedPieces) {
      await deleteCachedPiecesForTrack(trackId);
    }
    const cachedAvailability = await buildTrackAvailabilityFromCache({
      roomId: roomSnapshot.room.id,
      trackId,
      peerId,
      nickname: activeSession.nickname
    });
    const source =
      uploadedTrack && (uploadedTrack.origin === "live-upload" || uploadedTrack.origin === "cache-library")
        ? "live_upload"
        : "local_cache";
    const availability =
      (!shouldRebuildCachedPieces ? cachedAvailability : null) ??
      (fallbackFile && track
        ? await buildTrackAvailabilityFromFile({
            roomId: roomSnapshot.room.id,
            trackId,
            fileHash: track.fileHash,
            file: fallbackFile,
            peerId,
            nickname: activeSession.nickname,
            source,
            mimeType: track.mimeType,
            codec: track.codec ?? null,
            sizeBytes: track.sizeBytes ?? fallbackFile.size,
            durationMs: track.durationMs,
            totalChunks: canonicalManifest?.totalChunks ?? totalChunks,
            chunkSize: canonicalManifest?.chunkSize
          })
        : null);

    if (!availability) {
      return;
    }

    onAvailability(availability);
    emitAvailability(availability);
  }

  async function hydrateTrackFromPieces(trackId: string, mimeType: string, totalChunks: number) {
    if (!enableManualTrackCaching || !roomSnapshot) {
      return;
    }

    const cachedPieceManifest = (await getTrackPieceManifest(trackId)) ?? null;
    const resolvedTotalChunks = cachedPieceManifest?.totalChunks ?? totalChunks;
    const pieces = await getCachedPiecesForTrack(trackId, peerId);
    if (pieces.length < resolvedTotalChunks) {
      return;
    }

    const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
    if (!track) {
      return;
    }

    updateManualCacheTask(trackId, "assembling");

    const assembled = await assembleTrackFileFromPieces({
      pieces,
      totalChunks: resolvedTotalChunks,
      mimeType: mimeType || track.mimeType || "audio/mpeg",
      title: track.title,
      expectedFileHash: track.fileHash
    });

    if (!assembled) {
      updateManualCacheTask(trackId, "failed", "文件组装失败");
      setStatusMessage(`曲目 ${track.title} 的缓存组装失败。`);
      return;
    }

    await cacheTrackAsset({
      trackId,
      fileHash: track.fileHash,
      title: track.title,
      mimeType: mimeType || track.mimeType || "audio/mpeg",
      file: assembled.blob
    });

    await persistTrackIntoLibrary({
      track,
      roomId: roomSnapshot.room.id,
      file: assembled.file
    });

    updateManualCacheTask(trackId, "ready");
    setStatusMessage(`已缓存《${track.title}》。`);
  }

  const deleteUploadedTrackArtifacts = useCallback(async (trackId: string) => {
    await deleteCachedPiecesForTrack(trackId);
    setUploadedTracks((current) => removeTracksFromUploads(current, [trackId]));
  }, []);

  const deleteRoomTrackArtifacts = useCallback(async (trackIds: string[]) => {
    const uniqueTrackIds = [...new Set(trackIds.filter(Boolean))];
    if (uniqueTrackIds.length === 0) {
      return;
    }

    await deleteCachedPiecesForTracks(uniqueTrackIds);
    setUploadedTracks((current) => removeTracksFromUploads(current, uniqueTrackIds));
    setManualCacheTasks((current) => {
      const next = { ...current };
      for (const trackId of uniqueTrackIds) {
        delete next[trackId];
      }
      return next;
    });
  }, []);

  async function deleteCachedLibraryTrackEntry(fileHash: string) {
    const record = await deleteCachedLibraryTrackRecord(fileHash);
    if (record?.sourceTrackIds.length) {
      await deleteCachedPiecesForTracks(record.sourceTrackIds);
    }
    await refreshCacheLibrary();
  }

  async function exportCachedLibraryTrack(fileHash: string) {
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
  }

  async function importCachedLibraryTrackToRoom(fileHash: string) {
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
        origin: "cache-library"
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
  }

  return {
    uploadedTracks,
    setUploadedTracks,
    cachedTrackCount,
    cacheLibraryTracks,
    manualCacheTasks,
    manualCacheTrackIds,
    handleFilesSelected,
    startManualCacheDownload,
    pauseManualCacheDownload,
    markManualCacheTrackDownloading,
    announceLocalCache,
    hydrateTrackFromPieces,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    deleteCachedLibraryTrackEntry,
    exportCachedLibraryTrack,
    importCachedLibraryTrackToRoom
  };
}

function hasManifestGeometryMismatch(
  current:
    | Pick<ResolvedTrackPieceManifest, "totalChunks" | "chunkSize">
    | { totalChunks: number; chunkSize: number },
  expected:
    | Pick<ResolvedTrackPieceManifest, "totalChunks" | "chunkSize">
    | { totalChunks: number; chunkSize: number }
) {
  return (
    current.totalChunks !== expected.totalChunks || current.chunkSize !== expected.chunkSize
  );
}

function resolveCanonicalTrackManifest(input: {
  track: TrackMeta | null | undefined;
  cachedPieceManifest: {
    totalChunks: number;
    chunkSize: number;
    mimeType?: string | null;
  } | null;
  fallbackFile: Blob | null;
  fallbackMimeType?: string | null;
}) {
  const computedManifest = input.fallbackFile
    ? buildCanonicalTrackPieceManifest({
        file: input.fallbackFile,
        mimeType: input.fallbackMimeType ?? input.track?.mimeType ?? null,
        codec: input.track?.codec ?? null,
        sizeBytes: input.track?.sizeBytes ?? input.fallbackFile.size
      })
    : null;

  if (
    input.cachedPieceManifest &&
    computedManifest &&
    hasManifestGeometryMismatch(input.cachedPieceManifest, computedManifest)
  ) {
    return {
      ...computedManifest,
      source: "computed" as const
    };
  }

  const snapshotManifest = input.track?.relayManifest ?? input.track?.pieceManifest ?? null;
  if (
    computedManifest &&
    snapshotManifest &&
    hasManifestGeometryMismatch(snapshotManifest, computedManifest)
  ) {
    return {
      ...computedManifest,
      source: "computed" as const
    };
  }

  return resolveTrackPieceManifest({
    track: input.track,
    cacheManifest: input.cachedPieceManifest,
    file: input.fallbackFile,
    mimeType: input.fallbackMimeType ?? input.track?.mimeType ?? null,
    codec: input.track?.codec ?? null,
    sizeBytes: input.track?.sizeBytes ?? input.fallbackFile?.size ?? null
  });
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
