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
  getCachedPieceIndexes,
  getCachedPiecesForTrack,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  listManualCacheTasksForRoom,
  listCachedLibraryTracks,
  localCacheOwnerKey,
  upsertManualCacheTask,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import { removeTracksFromUploads } from "@/lib/music-room-ui";
import { buildTrackMeta, type CachedLibraryTrack, type UploadedTrack } from "@/features/upload/audio-utils";
import type { ManualCacheTrackPlan } from "@/features/room/hooks/use-manual-cache-downloader";
import type { ManualCacheTaskRecord } from "@/lib/indexeddb";

export type ManualCacheTaskStatus =
  | "idle"
  | "queued"
  | "downloading"
  | "paused"
  | "blocked"
  | "assembling"
  | "ready"
  | "failed"
  | "failed-integrity";

export type ManualCacheTask = {
  trackId: string;
  status: ManualCacheTaskStatus;
  mode: "manual" | "playback-demand";
  fileHash: string;
  updatedAt: string;
  errorMessage: string | null;
  completedChunks: number;
  totalChunks: number;
  mimeType: string | null;
  manifestSource: string | null;
  blockedReason: string | null;
  integrityMode: "strong" | "weak" | null;
  providerPeerIds: string[];
  connectedProviderPeerIds: string[];
  selectedProviderPeerId: string | null;
  requestableChunkCount: number;
  pendingChunkCount: number;
  lastRequestedChunks: number[];
  lastPieceReceivedAt: string | null;
  lastError: string | null;
};

type RehydratableRoomTrack = Pick<TrackMeta, "id" | "fileHash" | "ownerSessionId">;
type TrackPieceManifestGeometry = {
  totalChunks: number;
  chunkSize: number;
};

export function buildRegisterTrackPayload(track: Omit<TrackMeta, "id"> & { id?: string }) {
  return {
    ...(track.id ? { id: track.id } : {}),
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    bitrate: track.bitrate,
    sizeBytes: track.sizeBytes,
    codec: track.codec,
    mimeType: track.mimeType,
    fileHash: track.fileHash,
    artworkUrl: track.artworkUrl,
    ownerSessionId: track.ownerSessionId,
    ownerNickname: track.ownerNickname,
    sourceType: track.sourceType,
    pieceManifest: track.pieceManifest,
    relayManifest: track.relayManifest
  };
}

export function buildCachedLibraryTrackRegisterPayload(track: Omit<TrackMeta, "id"> & { id?: string }) {
  return buildRegisterTrackPayload(track);
}

export function shouldAnnounceTrackAvailability(input: {
  peerId: string | null | undefined;
}) {
  return Boolean(input.peerId);
}

export function resolveReusableCachedPieceManifest<T extends TrackPieceManifestGeometry>(input: {
  cachedManifest: T | null | undefined;
  expectedManifest: TrackPieceManifestGeometry | null | undefined;
}) {
  if (!input.cachedManifest) {
    return null;
  }

  if (
    input.expectedManifest &&
    (input.cachedManifest.totalChunks !== input.expectedManifest.totalChunks ||
      input.cachedManifest.chunkSize !== input.expectedManifest.chunkSize)
  ) {
    return null;
  }

  return input.cachedManifest;
}

export function isManualCachePieceCompatible(input: {
  piece: TrackPieceManifestGeometry;
  expectedManifest: TrackPieceManifestGeometry | null | undefined;
}) {
  if (!input.expectedManifest) {
    return true;
  }

  return (
    input.piece.totalChunks === input.expectedManifest.totalChunks &&
    input.piece.chunkSize === input.expectedManifest.chunkSize
  );
}

export function buildManualCachePieceAvailabilityAnnouncement(input: {
  existing?: TrackAvailabilityAnnouncement | null;
  roomId: string;
  trackId: string;
  fileHash: string;
  peerId: string;
  nickname: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  availableChunks?: number[];
}) {
  const existing = input.existing ?? null;
  const availableChunks = new Set(
    [...(existing?.availableChunks ?? []), ...(input.availableChunks ?? [])].filter(
      (chunkIndex) => chunkIndex >= 0 && chunkIndex < input.totalChunks
    )
  );
  availableChunks.add(input.chunkIndex);

  return {
    roomId: input.roomId,
    trackId: input.trackId,
    ownerPeerId: input.peerId,
    nickname: input.nickname,
    assetKind: "relay",
    assetHash: input.fileHash,
    totalChunks: input.totalChunks,
    chunkSize: input.chunkSize,
    availableChunks: [...availableChunks].sort((left, right) => left - right),
    source: "local_cache",
    announcedAt: new Date().toISOString()
  } satisfies TrackAvailabilityAnnouncement;
}

export function mergeHydratedManualCacheTasks(input: {
  currentTasks: Record<string, ManualCacheTask>;
  hydratedTasks: ManualCacheTaskRecord[];
  currentPlaybackTrackId: string | null;
}) {
  const hydrated = Object.fromEntries(
    input.hydratedTasks
      .filter(isManualCacheTaskRecord)
      .filter((task) => task.mode === "manual" || task.trackId === input.currentPlaybackTrackId)
      .map((task) => {
        const status = task.status;
        return [
          task.trackId,
          {
            trackId: task.trackId,
            status,
            mode: task.mode,
            fileHash: task.fileHash,
            updatedAt: task.updatedAt,
            errorMessage: task.errorMessage,
            completedChunks: task.completedChunks,
            totalChunks: task.totalChunks,
            mimeType: task.mimeType,
            manifestSource: task.manifestSource,
            blockedReason: task.blockedReason,
            integrityMode: task.integrityMode,
            providerPeerIds: task.providerPeerIds,
            connectedProviderPeerIds: task.connectedProviderPeerIds,
            selectedProviderPeerId: task.selectedProviderPeerId,
            requestableChunkCount: task.requestableChunkCount,
            pendingChunkCount: task.pendingChunkCount,
            lastRequestedChunks: task.lastRequestedChunks,
            lastPieceReceivedAt: task.lastPieceReceivedAt,
            lastError: task.lastError
          } satisfies ManualCacheTask
        ];
      })
  );

  const preservedCurrent = Object.fromEntries(
    Object.entries(input.currentTasks).filter(([, task]) => {
      if (task.mode === "manual") {
        return true;
      }

      return task.mode === "playback-demand" && task.trackId === input.currentPlaybackTrackId;
    })
  );

  return {
    ...hydrated,
    ...preservedCurrent
  };
}

function isManualCacheTaskRecord(
  task: ManualCacheTaskRecord
): task is ManualCacheTaskRecord & { mode: "manual" | "playback-demand" } {
  return task.mode === "manual" || task.mode === "playback-demand";
}

export function resolveMissingOwnedUploadedTracks(input: {
  roomTracks: RehydratableRoomTrack[];
  activeSessionId: string | null | undefined;
  uploadedTracks: Record<string, UploadedTrack>;
}) {
  if (!input.activeSessionId) {
    return [];
  }

  return input.roomTracks.filter(
    (track) =>
      track.ownerSessionId === input.activeSessionId &&
      !input.uploadedTracks[track.id] &&
      !!track.fileHash
  );
}

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
  const availabilityAnnouncementInFlightRef = useRef<Set<string>>(new Set());
  const availabilityAnnouncementTtlRef = useRef<Map<string, number>>(new Map());
  const manualCacheChunkIndexesRef = useRef<Map<string, Set<number>>>(new Map());
  const manualCacheAssemblingTrackIdsRef = useRef<Set<string>>(new Set());

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
        if (
          task.mode === "manual" &&
          (task.status === "queued" || task.status === "downloading" || task.status === "blocked")
        ) {
          const track = roomSnapshot.tracks.find((entry) => entry.id === task.trackId) ?? null;
          const expectedManifest = track?.relayManifest ?? track?.pieceManifest ?? null;
          void getCachedPieceIndexes(task.trackId, peerId, {
            fileHash: task.fileHash,
            ownerKey: localCacheOwnerKey,
            chunkSize: expectedManifest?.chunkSize
          }).then((indexes) => {
            manualCacheChunkIndexesRef.current.set(task.trackId, new Set(indexes));
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [peerId, roomSnapshot?.room.id]);

  useEffect(() => {
    manualCacheChunkIndexesRef.current.clear();
    manualCacheAssemblingTrackIdsRef.current.clear();
    if (!roomSnapshot?.room.id) {
      void clearTransientTrackCacheData();
      return;
    }

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
  }, [roomSnapshot?.room.id, roomSnapshot?.tracks]);

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
        const cachedTrack =
          cacheLibraryTracksRef.current.get(track.fileHash) ??
          (await getCachedLibraryTrack(track.fileHash));
        if (!cachedTrack) {
          continue;
        }
        const cachedFile = toCachedLibraryFile({
          file: cachedTrack.file,
          title: cachedTrack.title,
          mimeType: cachedTrack.mimeType,
          fileHash: cachedTrack.fileHash
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
        const track = roomSnapshot?.tracks.find((entry) => entry.id === trackId) ?? null;
        const nextTask: ManualCacheTask = {
          trackId,
          status: existing?.status ?? "idle",
          mode: existing?.mode ?? "manual",
          fileHash: existing?.fileHash ?? track?.fileHash ?? "",
          errorMessage: existing?.errorMessage ?? null,
          completedChunks: existing?.completedChunks ?? 0,
          totalChunks: existing?.totalChunks ?? 0,
          mimeType: existing?.mimeType ?? null,
          manifestSource: existing?.manifestSource ?? null,
          blockedReason: existing?.blockedReason ?? null,
          integrityMode: existing?.integrityMode ?? null,
          providerPeerIds: existing?.providerPeerIds ?? [],
          connectedProviderPeerIds: existing?.connectedProviderPeerIds ?? [],
          selectedProviderPeerId: existing?.selectedProviderPeerId ?? null,
          requestableChunkCount: existing?.requestableChunkCount ?? 0,
          pendingChunkCount: existing?.pendingChunkCount ?? 0,
          lastRequestedChunks: existing?.lastRequestedChunks ?? [],
          lastPieceReceivedAt: existing?.lastPieceReceivedAt ?? null,
          lastError: existing?.lastError ?? null,
          ...nextPatch,
          updatedAt: new Date().toISOString()
        };
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
      if (!roomSnapshot || !activeSession || !peerId || !shouldAnnounceTrackAvailability({ peerId })) {
        return;
      }

      const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
      const uploadedTrack = uploadedTracks[trackId] ?? null;
      if (!track) {
        return;
      }
      const cachedLibraryTrack = await getCachedLibraryTrack(track.fileHash);
      const fallbackFile = uploadedTrack?.file ?? cachedLibraryTrack?.file ?? null;
      const announcementKey = [
        roomSnapshot.room.id,
        trackId,
        track.fileHash,
        peerId
      ].join("|");
      const now = Date.now();
      const lastAnnouncedAt = availabilityAnnouncementTtlRef.current.get(announcementKey) ?? 0;
      if (
        availabilityAnnouncementInFlightRef.current.has(announcementKey) ||
        now - lastAnnouncedAt < 5_000
      ) {
        return;
      }
      availabilityAnnouncementInFlightRef.current.add(announcementKey);

      try {
        const expectedManifest = track.relayManifest ?? track.pieceManifest ?? null;
        const rawCachedManifest =
          (await getTrackPieceManifestByFileHash(track.fileHash)) ??
          (await getTrackPieceManifest(trackId));
        const cachedManifest = resolveReusableCachedPieceManifest({
          cachedManifest: rawCachedManifest,
          expectedManifest
        });
        if (!fallbackFile) {
          const availabilityFromPieces = await buildTrackAvailabilityFromCache({
            roomId: roomSnapshot.room.id,
            trackId,
            fileHash: track.fileHash,
            peerId,
            nickname: activeSession.nickname,
            totalChunks: cachedManifest?.totalChunks ?? expectedManifest?.totalChunks,
            chunkSize: cachedManifest?.chunkSize ?? expectedManifest?.chunkSize,
            assetHash: track.fileHash
          });
          if (
            availabilityFromPieces &&
            availabilityFromPieces.availableChunks.length >= availabilityFromPieces.totalChunks
          ) {
            availabilityAnnouncementTtlRef.current.set(announcementKey, Date.now());
            onAvailability(availabilityFromPieces);
            emitAvailability(availabilityFromPieces);
          }
          return;
        }

        const availability = buildTrackAvailabilityFromManifest({
          roomId: roomSnapshot.room.id,
          trackId,
          fileHash: track.fileHash,
          track,
          file: fallbackFile,
          cacheManifest: cachedManifest,
          peerId,
          nickname: activeSession.nickname,
          source: uploadedTrack ? "live_upload" : "local_cache",
          mimeType: track.mimeType,
          codec: track.codec ?? null,
          sizeBytes: track.sizeBytes ?? fallbackFile.size,
          durationMs: track.durationMs,
          totalChunks: track.relayManifest?.totalChunks ?? track.pieceManifest?.totalChunks,
          chunkSize: track.relayManifest?.chunkSize ?? track.pieceManifest?.chunkSize
        });
        if (availability) {
          availabilityAnnouncementTtlRef.current.set(announcementKey, Date.now());
          onAvailability(availability);
          emitAvailability(availability);
        }
      } finally {
        availabilityAnnouncementInFlightRef.current.delete(announcementKey);
      }
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

        const pieces = await getCachedPiecesForTrack(trackId, peerId, {
          fileHash: track.fileHash,
          ownerKey: localCacheOwnerKey
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
          registered = await musicRoomApi.registerTrack(roomId, buildRegisterTrackPayload(track));
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

        if (peerId && shouldAnnounceTrackAvailability({ peerId })) {
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

      if (cacheLibraryTracksRef.current.has(track.fileHash) || (await getCachedLibraryTrack(track.fileHash))) {
        updateManualCacheTask(trackId, {
          status: "ready",
          mode: "manual",
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
        await deleteCachedPiecesForTrack(trackId);
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
        mode: "manual",
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
      setStatusMessage(`已开始缓存《${track.title}》。`);

      if (totalChunks > 0 && completedChunks >= totalChunks) {
        void assembleManualCacheTrack(trackId, mimeType, totalChunks);
      }
    },
    [assembleManualCacheTrack, peerId, roomSnapshot, setStatusMessage, updateManualCacheTask]
  );

  const startPlaybackDemandCacheDownload = useCallback(
    async (trackId: string) => {
      if (!enableManualTrackCaching || !roomSnapshot) {
        return;
      }

      const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
      if (!track) {
        return;
      }

      if (cacheLibraryTracksRef.current.has(track.fileHash) || (await getCachedLibraryTrack(track.fileHash))) {
        updateManualCacheTask(trackId, (current) => {
          if (current?.mode === "manual") {
            return null;
          }

          return {
            status: "ready",
            mode: "playback-demand",
            fileHash: track.fileHash,
            errorMessage: null,
            completedChunks: resolveTrackTotalChunks(track),
            totalChunks: resolveTrackTotalChunks(track),
            mimeType: track.mimeType ?? null,
            blockedReason: null,
            lastError: null
          };
        });
        return;
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
        await deleteCachedPiecesForTrack(trackId);
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
      const completedChunks = chunkIndexes.size;
      const mimeType = cachedManifest?.mimeType ?? track.mimeType ?? null;
      updateManualCacheTask(trackId, (current) => {
        if (current?.mode === "manual") {
          return null;
        }

        return {
          status: completedChunks > 0 ? "downloading" : "queued",
          mode: "playback-demand",
          fileHash: track.fileHash,
          errorMessage: null,
          completedChunks,
          totalChunks,
          mimeType,
          manifestSource: cachedManifest ? "cache" : expectedManifest ? "snapshot" : null,
          blockedReason: null,
          integrityMode: cachedManifest?.pieceHashes?.length === totalChunks ? "strong" : "weak",
          lastError: null
        };
      });

      if (totalChunks > 0 && completedChunks >= totalChunks) {
        void assembleManualCacheTrack(trackId, mimeType, totalChunks);
      }
    },
    [assembleManualCacheTrack, peerId, roomSnapshot, updateManualCacheTask]
  );

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
      updateManualCacheTask
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
      updateManualCacheTask(plan.trackId, (current) => {
        if (!current || current.status === "paused" || current.status === "ready") {
          return null;
        }

        const pendingWindowFull = plan.blockedReason === "pending-window-full";
        const actuallyBlocked =
          !!plan.blockedReason && plan.blockedReason !== "complete" && !pendingWindowFull;

        return {
          status:
            actuallyBlocked
              ? "blocked"
              : current.status === "queued" || current.status === "blocked"
                ? "downloading"
                : current.status,
          fileHash: track.fileHash,
          completedChunks: plan.localPieceIndexes.length,
          totalChunks: plan.manifest?.totalChunks ?? current.totalChunks,
          mimeType: plan.manifest?.pieceMimeType ?? current.mimeType,
          manifestSource: plan.manifestSource === "none" ? null : plan.manifestSource,
          blockedReason: plan.blockedReason === "complete" ? null : plan.blockedReason,
          integrityMode: plan.integrityMode,
          providerPeerIds: plan.providerPeerIds,
          connectedProviderPeerIds: plan.connectedProviderPeerIds,
          selectedProviderPeerId: plan.selectedProviderPeerId,
          requestableChunkCount: plan.requestableChunks.length,
          pendingChunkCount: plan.pendingChunkCount,
          lastRequestedChunks: plan.requestableChunks,
          lastError: actuallyBlocked ? plan.blockedReason : null
        };
      });
    },
    [roomSnapshot, updateManualCacheTask]
  );

  const deleteUploadedTrackArtifacts = useCallback(async (trackId: string) => {
    await deleteCachedPiecesForTrack(trackId);
    if (roomSnapshot?.room.id) {
      await deleteManualCacheTask(roomSnapshot.room.id, trackId);
    }
    manualCacheChunkIndexesRef.current.delete(trackId);
    manualCacheAssemblingTrackIdsRef.current.delete(trackId);
    setUploadedTracks((current) => removeTracksFromUploads(current, [trackId]));
  }, [roomSnapshot?.room.id]);

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
      if (roomSnapshot?.room.id) {
        await deleteManualCacheTasksForTracks(roomSnapshot.room.id, uniqueTrackIds);
      }
    },
    [roomSnapshot?.room.id]
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
          registeredTrack = await musicRoomApi.registerTrack(
            roomId,
            buildCachedLibraryTrackRegisterPayload(trackMeta)
          );
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

      if (peerId && shouldAnnounceTrackAvailability({ peerId })) {
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
    startPlaybackDemandCacheDownload,
    pauseManualCacheDownload,
    handleManualCachePieceReceived,
    handleManualCachePlan,
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
