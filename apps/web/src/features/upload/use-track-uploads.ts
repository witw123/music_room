"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
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
  getTrackPieceManifest,
  deleteCachedPiecesForTrack,
  deleteCachedPiecesForTracks,
  getCachedTrackAsset,
  getCachedTrackAssetCount,
  getCachedPiecesForTrack,
  getCachedTrackAssets,
  pruneCachedTracks
} from "@/lib/indexeddb";
import { removeTracksFromUploads } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { buildTrackMeta, type UploadedTrack } from "@/features/upload/audio-utils";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";

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
    maxCachedTracks,
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
  const uploadedTrackUrlsRef = useRef<Map<string, string>>(new Map());
  const inFlightUploadHashesRef = useRef<Set<string>>(new Set());

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
    return () => {
      for (const objectUrl of uploadedTrackUrlsRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      uploadedTrackUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!roomSnapshot) {
      return;
    }

    void trimLocalCache(roomSnapshot.tracks.map((track) => track.id));
  }, [roomSnapshot?.tracks]);

  useEffect(() => {
    if (!roomSnapshot?.tracks.length) {
      setCachedTrackCount(0);
      return;
    }

    let disposed = false;

    const restoreCachedAssets = async () => {
      const uploadedTrackIds = new Set(uploadedTrackUrlsRef.current.keys());
      const uncachedTrackIds = roomSnapshot.tracks
        .filter((track) => !uploadedTrackIds.has(track.id))
        .map((track) => track.id);

      if (uncachedTrackIds.length === 0) {
        if (!disposed) {
          setCachedTrackCount(uploadedTrackIds.size);
        }
        return;
      }

      const cachedAssets = await getCachedTrackAssets(uncachedTrackIds);
      if (disposed || cachedAssets.length === 0) {
        if (!disposed) {
          setCachedTrackCount(uploadedTrackIds.size);
        }
        return;
      }

      setUploadedTracks((current) => {
        let didAdd = false;
        const next = { ...current };
        for (const asset of cachedAssets) {
          if (!next[asset.trackId]) {
            next[asset.trackId] = {
              file: new File([asset.file], `${asset.title}.bin`, {
                type: asset.mimeType || "audio/mpeg"
              }),
              objectUrl: URL.createObjectURL(asset.file)
            };
            didAdd = true;
          }
        }

        if (!didAdd) {
          setCachedTrackCount(Object.keys(current).length);
          return current;
        }

        setCachedTrackCount(Object.keys(next).length);
        return next;
      });

      if (roomSnapshot && peerId && activeSession) {
        for (const asset of cachedAssets) {
          const track = roomSnapshot.tracks.find((entry) => entry.id === asset.trackId);
          const cachedPieceManifest = (await getTrackPieceManifest(asset.trackId)) ?? null;
          const canonicalManifest = buildCanonicalTrackPieceManifest({
            file: asset.file,
            mimeType: asset.mimeType,
            codec: track?.codec ?? null,
            sizeBytes: track?.sizeBytes ?? asset.file.size
          });
          const shouldRebuildCachedPieces =
            !!cachedPieceManifest &&
            hasManifestGeometryMismatch(cachedPieceManifest, canonicalManifest);
          if (shouldRebuildCachedPieces) {
            await deleteCachedPiecesForTrack(asset.trackId);
          }

          const availability =
            shouldRebuildCachedPieces
              ? await buildTrackAvailabilityFromFile({
                  roomId: roomSnapshot.room.id,
                  trackId: asset.trackId,
                  fileHash: asset.fileHash,
                  file: asset.file,
                  peerId,
                  nickname: activeSession.nickname,
                  source: "local_cache",
                  mimeType: asset.mimeType,
                  codec: track?.codec ?? null,
                  sizeBytes: track?.sizeBytes ?? asset.file.size,
                  durationMs: track?.durationMs ?? 0,
                  totalChunks: canonicalManifest.totalChunks,
                  chunkSize: canonicalManifest.chunkSize
                })
              : ((await buildTrackAvailabilityFromCache({
                  roomId: roomSnapshot.room.id,
                  trackId: asset.trackId,
                  peerId,
                  nickname: activeSession.nickname
                })) ??
                  (await buildTrackAvailabilityFromFile({
                    roomId: roomSnapshot.room.id,
                    trackId: asset.trackId,
                    fileHash: asset.fileHash,
                    file: asset.file,
                    peerId,
                    nickname: activeSession.nickname,
                    source: "local_cache",
                    mimeType: asset.mimeType,
                    codec: track?.codec ?? null,
                    sizeBytes: track?.sizeBytes ?? asset.file.size,
                    durationMs: track?.durationMs ?? 0,
                    totalChunks: canonicalManifest.totalChunks,
                    chunkSize: canonicalManifest.chunkSize
                  })));
          onAvailability(availability);
          emitAvailability(availability);
        }
      }
    };

    void restoreCachedAssets();

    return () => {
      disposed = true;
    };
  }, [roomSnapshot, peerId, activeSession, onAvailability, emitAvailability]);

  async function trimLocalCache(protectedTrackIds: string[]) {
    const removedTrackIds = await pruneCachedTracks(maxCachedTracks, protectedTrackIds);
    const nextCount = await getCachedTrackAssetCount();
    setCachedTrackCount(nextCount);

    if (removedTrackIds.length === 0) {
      return;
    }

    setUploadedTracks((current) => removeTracksFromUploads(current, removedTrackIds));
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
        registered = await musicRoomApi.registerTrack(roomSnapshot.room.id, {
          sessionId: activeSession.userId,
          ...track
        });
      } finally {
        inFlightUploadHashesRef.current.delete(uploadHashKey);
      }

      nextUploads[registered.id] = {
        file,
        objectUrl
      };
      nextTracks.push(registered);
      currentTracksByHash.set(registered.fileHash, registered);
      await cacheTrackAsset({
        trackId: registered.id,
        fileHash: registered.fileHash,
        title: registered.title,
        mimeType: registered.mimeType || file.type || "audio/mpeg",
        file
      });

      if (peerId) {
        const availability = await buildTrackAvailabilityFromFile({
          roomId: roomSnapshot.room.id,
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
      try {
        const latestSnapshot = await musicRoomApi.getRoom(roomId);
        dispatchRoomStateEvent({
          type: "recover-snapshot",
          snapshot: latestSnapshot
        });
      } catch {
        // Realtime snapshot or later resync remains the source of truth for shared room state.
      }
    }
    await trimLocalCache([
      ...roomSnapshot.tracks.map((track) => track.id),
      ...Object.keys(nextUploads)
    ]);
    setStatusMessage(`${Object.keys(nextUploads).length} 首本地歌曲已导入房间曲库。`);
  }

  async function announceLocalCache(trackId: string, totalChunks?: number) {
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
            source: uploadedTrack ? "live_upload" : "local_cache",
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
    if (!roomSnapshot) {
      return;
    }

    const cachedPieceManifest = (await getTrackPieceManifest(trackId)) ?? null;
    const resolvedTotalChunks = cachedPieceManifest?.totalChunks ?? totalChunks;
    const pieces = await getCachedPiecesForTrack(trackId, peerId);
    if (pieces.length < resolvedTotalChunks) {
      return;
    }

    const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
    if (!track || uploadedTracks[trackId]) {
      return;
    }

    const assembled = await assembleTrackFileFromPieces({
      pieces,
      totalChunks: resolvedTotalChunks,
      mimeType: mimeType || track.mimeType || "audio/mpeg",
      title: track.title,
      expectedFileHash: track.fileHash
    });

    if (!assembled) {
      setStatusMessage(`曲目 ${track.title} 的下载分片不完整或校验失败。`);
      return;
    }

    const objectUrl = URL.createObjectURL(assembled.blob);

    await cacheTrackAsset({
      trackId,
      fileHash: track.fileHash,
      title: track.title,
      mimeType: mimeType || track.mimeType || "audio/mpeg",
      file: assembled.blob
    });

    setUploadedTracks((current) => ({
      ...current,
      [trackId]: {
        file: assembled.file,
        objectUrl
      }
    }));
    const canonicalManifest = buildCanonicalTrackPieceManifest({
      file: assembled.file,
      mimeType: mimeType || track.mimeType || "audio/mpeg",
      codec: track.codec ?? null,
      sizeBytes: track.sizeBytes ?? assembled.file.size
    });
    const shouldRebuildHydratedPieces =
      !!cachedPieceManifest &&
      hasManifestGeometryMismatch(cachedPieceManifest, canonicalManifest);
    if (shouldRebuildHydratedPieces) {
      await deleteCachedPiecesForTrack(trackId);
    }

    const availability =
      (!shouldRebuildHydratedPieces
        ? await buildTrackAvailabilityFromCache({
            roomId: roomSnapshot.room.id,
            trackId,
            peerId,
            nickname: activeSession?.nickname ?? track.ownerNickname
          })
        : null) ??
      (peerId
        ? await buildTrackAvailabilityFromFile({
            roomId: roomSnapshot.room.id,
            trackId,
            fileHash: track.fileHash,
            file: assembled.file,
            peerId,
            nickname: activeSession?.nickname ?? track.ownerNickname,
            source: "local_cache",
            mimeType: mimeType || track.mimeType || "audio/mpeg",
            codec: track.codec ?? null,
            sizeBytes: track.sizeBytes ?? assembled.file.size,
            durationMs: track.durationMs,
            totalChunks: canonicalManifest.totalChunks,
            chunkSize: canonicalManifest.chunkSize
          })
        : null);
    if (availability) {
      onAvailability(availability);
      emitAvailability(availability);
    }
    await trimLocalCache(roomSnapshot.tracks.map((entry) => entry.id));
    setStatusMessage(`已从房间其他成员恢复曲目 ${track.title} 的本地缓存。`);
  }

  const deleteUploadedTrackArtifacts = useCallback(async (trackId: string) => {
    await deleteCachedPiecesForTrack(trackId);
    setUploadedTracks((current) => removeTracksFromUploads(current, [trackId]));
    setCachedTrackCount(await getCachedTrackAssetCount());
  }, []);

  const deleteRoomTrackArtifacts = useCallback(async (trackIds: string[]) => {
    const uniqueTrackIds = [...new Set(trackIds.filter(Boolean))];
    if (uniqueTrackIds.length === 0) {
      return;
    }

    await deleteCachedPiecesForTracks(uniqueTrackIds);
    setUploadedTracks((current) => removeTracksFromUploads(current, uniqueTrackIds));
    setCachedTrackCount(await getCachedTrackAssetCount());
  }, []);

  return {
    uploadedTracks,
    setUploadedTracks,
    cachedTrackCount,
    handleFilesSelected,
    announceLocalCache,
    hydrateTrackFromPieces,
    trimLocalCache,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts
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
