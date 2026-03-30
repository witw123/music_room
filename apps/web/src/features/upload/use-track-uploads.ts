"use client";

import { useEffect, useRef, useState } from "react";
import type { GuestSession, RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import {
  assembleTrackFileFromPieces,
  buildTrackAvailabilityFromCache,
  buildTrackAvailabilityFromFile
} from "@/features/p2p";
import {
  cacheTrackAsset,
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
  setStatusMessage: (message: string) => void;
  onAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  emitAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  refreshRoom: (roomId: string) => Promise<void>;
}) {
  const {
    maxCachedTracks,
    peerId,
    activeSession,
    roomSnapshot,
    setStatusMessage,
    onAvailability,
    emitAvailability,
    refreshRoom
  } = options;
  const [uploadedTracks, setUploadedTracks] = useState<Record<string, UploadedTrack>>({});
  const [cachedTrackCount, setCachedTrackCount] = useState(0);
  const uploadedTrackUrlsRef = useRef<Map<string, string>>(new Map());

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
      const uncachedTrackIds = roomSnapshot.tracks
        .filter((track) => !uploadedTracks[track.id])
        .map((track) => track.id);

      if (uncachedTrackIds.length === 0) {
        if (!disposed) {
          setCachedTrackCount(Object.keys(uploadedTracks).length);
        }
        return;
      }

      const cachedAssets = await getCachedTrackAssets(uncachedTrackIds);
      if (disposed || cachedAssets.length === 0) {
        if (!disposed) {
          setCachedTrackCount(Object.keys(uploadedTracks).length);
        }
        return;
      }

      setUploadedTracks((current) => {
        const next = { ...current };
        for (const asset of cachedAssets) {
          if (!next[asset.trackId]) {
            next[asset.trackId] = {
              file: new File([asset.file], `${asset.title}.bin`, {
                type: asset.mimeType || "audio/mpeg"
              }),
              objectUrl: URL.createObjectURL(asset.file)
            };
          }
        }

        setCachedTrackCount(Object.keys(next).length);
        return next;
      });

      if (roomSnapshot && peerId && activeSession) {
        for (const asset of cachedAssets) {
          const availability = await buildTrackAvailabilityFromFile({
            roomId: roomSnapshot.room.id,
            trackId: asset.trackId,
            fileHash: asset.fileHash,
            file: asset.file,
            peerId,
            nickname: activeSession.nickname,
            source: "local_cache"
          });
          onAvailability(availability);
          emitAvailability(availability);
        }
      }
    };

    void restoreCachedAssets();

    return () => {
      disposed = true;
    };
  }, [roomSnapshot, uploadedTracks, peerId, activeSession, onAvailability, emitAvailability]);

  async function trimLocalCache(protectedTrackIds: string[]) {
    const removedTrackIds = await pruneCachedTracks(maxCachedTracks, protectedTrackIds);
    const nextCount = await getCachedTrackAssetCount();
    setCachedTrackCount(nextCount);

    if (removedTrackIds.length === 0) {
      return;
    }

    setUploadedTracks((current) => removeTracksFromUploads(current, removedTrackIds));
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || !activeSession || !roomSnapshot) {
      return;
    }

    const nextUploads: Record<string, UploadedTrack> = {};

    for (const file of Array.from(files)) {
      const objectUrl = URL.createObjectURL(file);
      const track = await buildTrackMeta(file, objectUrl, activeSession);
      const registered = await musicRoomApi.registerTrack(roomSnapshot.room.id, {
        sessionId: activeSession.id,
        ...track
      });

      nextUploads[registered.id] = {
        file,
        objectUrl
      };
      await cacheTrackAsset({
        trackId: registered.id,
        fileHash: registered.fileHash,
        title: registered.title,
        mimeType: file.type || "audio/mpeg",
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
          source: "live_upload"
        });
        onAvailability(availability);
        emitAvailability(availability);
      }
    }

    setUploadedTracks((current) => ({ ...current, ...nextUploads }));
    await trimLocalCache([
      ...roomSnapshot.tracks.map((track) => track.id),
      ...Object.keys(nextUploads)
    ]);
    await refreshRoom(roomSnapshot.room.id);
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
      mimeType: mimeType || "audio/mpeg",
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
      mimeType: mimeType || "audio/mpeg",
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

  return {
    uploadedTracks,
    setUploadedTracks,
    cachedTrackCount,
    handleFilesSelected,
    announceLocalCache,
    hydrateTrackFromPieces,
    trimLocalCache
  };
}
