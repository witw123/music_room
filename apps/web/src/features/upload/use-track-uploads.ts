"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { GuestSession, RoomSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import {
  assembleTrackFileFromPieces,
  buildTrackAvailabilityFromCache,
  buildTrackAvailabilityFromFile
} from "@/features/p2p";
import {
  cacheTrackAsset,
  deleteCachedTrackAsset,
  deleteCachedPiecesForTrack,
  getCachedTrackAssetCount,
  getCachedPiecesForTrack,
  getCachedTrackAssets,
  pruneCachedTracks
} from "@/lib/indexeddb";
import { removeTracksFromUploads } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { buildTrackMeta, type UploadedTrack } from "@/features/upload/audio-utils";

export function useTrackUploads(options: {
  maxCachedTracks: number;
  peerId: string;
  activeSession: GuestSession | null;
  roomSnapshot: RoomSnapshot | null;
  setRoomSnapshot: Dispatch<SetStateAction<RoomSnapshot | null>>;
  setStatusMessage: (message: string) => void;
  onAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  emitAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
}) {
  const {
    maxCachedTracks,
    peerId,
    activeSession,
    roomSnapshot,
    setRoomSnapshot,
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
          const availability =
            (await buildTrackAvailabilityFromCache({
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
              durationMs: track?.durationMs ?? 0
            }));
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
          durationMs: registered.durationMs
        });
        onAvailability(availability);
        emitAvailability(availability);
      }
    }

    setUploadedTracks((current) => ({ ...current, ...nextUploads }));
    setRoomSnapshot((current) =>
      current
        ? {
            ...current,
            tracks: [
              ...nextTracks,
              ...current.tracks.filter(
                (track) => !nextTracks.some((nextTrack) => nextTrack.id === track.id)
              )
            ]
          }
        : current
    );
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

    const availability = await buildTrackAvailabilityFromCache({
      roomId: roomSnapshot.room.id,
      trackId,
      peerId,
      nickname: activeSession.nickname,
      totalChunks
    });

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

    const pieces = await getCachedPiecesForTrack(trackId, peerId);
    if (pieces.length < totalChunks) {
      return;
    }

    const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
    if (!track || uploadedTracks[trackId]) {
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
    await trimLocalCache(roomSnapshot.tracks.map((entry) => entry.id));
    setStatusMessage(`已从房间其他成员恢复曲目 ${track.title} 的本地缓存。`);
  }

  const deleteUploadedTrackArtifacts = useCallback(async (trackId: string) => {
    await deleteCachedTrackAsset(trackId);
    await deleteCachedPiecesForTrack(trackId);
    setUploadedTracks((current) => removeTracksFromUploads(current, [trackId]));
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
    deleteUploadedTrackArtifacts
  };
}
