"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { GuestSession, RoomSnapshot } from "@music-room/shared";
import {
  cacheTrackAsset,
  cacheTrackPieces,
  getCachedTrackAssetCount,
  getCachedTrackAssets,
  getCachedPiecesForTrack,
  pruneCachedTracks
} from "@/lib/indexeddb";
import { assembleTrackFileFromPieces, buildTrackAvailabilityFromCache, buildTrackAvailabilityFromFile, defaultChunkSize, hashArrayBuffer } from "@/features/p2p";
import { musicRoomApi } from "@/lib/music-room-api";

type UploadedTrack = {
  file: File;
  objectUrl: string;
};

type TrackCacheContextValue = {
  uploadedTracks: Record<string, UploadedTrack>;
  cachedTrackCount: number;
  handleFilesSelected: (
    files: FileList | null,
    session: GuestSession,
    roomSnapshot: RoomSnapshot,
    peerId: string,
    socket: { emit: (event: string, payload: unknown) => void } | null,
    statusMessage: string,
    setStatusMessage: (msg: string) => void,
    refreshRoom: () => Promise<void>
  ) => Promise<void>;
  announceLocalCache: (
    trackId: string,
    totalChunks: number | undefined,
    session: GuestSession,
    roomSnapshot: RoomSnapshot,
    peerId: string,
    socket: { emit: (event: string, payload: unknown) => void } | null
  ) => Promise<void>;
  hydrateTrackFromPieces: (
    trackId: string,
    mimeType: string,
    totalChunks: number,
    roomSnapshot: RoomSnapshot,
    peerId: string
  ) => Promise<{ blob: Blob; file: File } | null>;
  getUploadedTrackObjectUrl: (trackId: string) => string | undefined;
};

const TrackCacheContext = createContext<TrackCacheContextValue | null>(null);

const maxCachedTracks = 24;

function readDuration(objectUrl: string) {
  return new Promise<number>((resolve) => {
    const audio = document.createElement("audio");
    audio.src = objectUrl;

    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
      audio.pause();
      audio.src = "";
      audio.load();
    };

    const handleLoadedMetadata = () => {
      cleanup();
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    };

    const handleError = () => {
      cleanup();
      resolve(0);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("error", handleError);
    audio.load();
  });
}

export function TrackCacheProvider({ children }: { children: ReactNode }) {
  const [uploadedTracks, setUploadedTracks] = useState<Record<string, UploadedTrack>>({});
  const [cachedTrackCount, setCachedTrackCount] = useState(0);

  // Track object URLs in a ref so we can revoke them on cleanup
  const uploadedTrackUrlsRef = useRef<Map<string, string>>(new Map());

  // Sync object URLs to ref and revoke stale ones
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

  // Revoke all URLs on unmount
  useEffect(() => {
    return () => {
      for (const objectUrl of uploadedTrackUrlsRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      uploadedTrackUrlsRef.current.clear();
    };
  }, []);

  const handleFilesSelected = useCallback(
    async (
      files: FileList | null,
      session: GuestSession,
      roomSnapshot: RoomSnapshot,
      peerId: string,
      socket: { emit: (event: string, payload: unknown) => void } | null,
      statusMessage: string,
      setStatusMessage: (msg: string) => void,
      refreshRoom: () => Promise<void>
    ) => {
      if (!files) return;

      const nextUploads: Record<string, UploadedTrack> = {};

      for (const file of Array.from(files)) {
        const objectUrl = URL.createObjectURL(file);

        const buffer = await file.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        const fileHash = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const durationMs = await readDuration(objectUrl);
        const title = file.name.replace(/\.[^/.]+$/, "");

        const trackMeta = {
          title,
          artist: "本地上传",
          album: null,
          durationMs,
          bitrate: null,
          fileHash,
          artworkUrl: null,
          sourceType: "local_upload" as const
        };

        const registered = await musicRoomApi.registerTrack(roomSnapshot.room.id, {
          sessionId: session.id,
          ...trackMeta
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

        if (peerId && socket) {
          const availability = await buildTrackAvailabilityFromFile({
            roomId: roomSnapshot.room.id,
            trackId: registered.id,
            fileHash: registered.fileHash,
            file,
            peerId,
            nickname: session.nickname,
            source: "live_upload"
          });
          socket.emit("piece.availability", availability);
        }
      }

      setUploadedTracks((current) => ({ ...current, ...nextUploads }));

      // Prune cache
      const allTrackIds = [
        ...roomSnapshot.tracks.map((t) => t.id),
        ...Object.keys(nextUploads)
      ];
      await pruneCached(maxCachedTracks, allTrackIds);
      const count = await getCachedTrackAssetCount();
      setCachedTrackCount(count);

      await refreshRoom();
      setStatusMessage(`${Object.keys(nextUploads).length} 首本地曲目已导入房间曲目库。`);
    },
    []
  );

  const announceLocalCache = useCallback(
    async (
      trackId: string,
      totalChunks: number | undefined,
      session: GuestSession,
      roomSnapshot: RoomSnapshot,
      peerId: string,
      socket: { emit: (event: string, payload: unknown) => void } | null
    ) => {
      if (!peerId || !socket) return;

      const availability = await buildTrackAvailabilityFromCache({
        roomId: roomSnapshot.room.id,
        trackId,
        peerId,
        nickname: session.nickname,
        totalChunks
      });

      if (!availability) return;

      socket.emit("piece.availability", availability);
    },
    []
  );

  const hydrateTrackFromPieces = useCallback(
    async (
      trackId: string,
      mimeType: string,
      totalChunks: number,
      roomSnapshot: RoomSnapshot,
      peerId: string
    ): Promise<{ blob: Blob; file: File } | null> => {
      const pieces = await getCachedPiecesForTrack(trackId, peerId);
      if (pieces.length < totalChunks) {
        return null;
      }

      const track = roomSnapshot.tracks.find((t) => t.id === trackId);
      if (!track) return null;

      const assembled = await assembleTrackFileFromPieces({
        pieces,
        totalChunks,
        mimeType: mimeType || "audio/mpeg",
        title: track.title,
        expectedFileHash: track.fileHash
      });

      if (!assembled) {
        return null;
      }

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
          objectUrl: URL.createObjectURL(assembled.blob)
        }
      }));

      await pruneCached(maxCachedTracks, roomSnapshot.tracks.map((t) => t.id));
      const count = await getCachedTrackAssetCount();
      setCachedTrackCount(count);

      return { blob: assembled.blob, file: assembled.file };
    },
    []
  );

  const getUploadedTrackObjectUrl = useCallback(
    (trackId: string): string | undefined => {
      return uploadedTracks[trackId]?.objectUrl;
    },
    [uploadedTracks]
  );

  return (
    <TrackCacheContext.Provider
      value={{
        uploadedTracks,
        cachedTrackCount,
        handleFilesSelected,
        announceLocalCache,
        hydrateTrackFromPieces,
        getUploadedTrackObjectUrl
      }}
    >
      {children}
    </TrackCacheContext.Provider>
  );
}

export function useTrackCache(): TrackCacheContextValue {
  const ctx = useContext(TrackCacheContext);
  if (!ctx) {
    throw new Error("useTrackCache must be used within TrackCacheProvider");
  }
  return ctx;
}

async function pruneCached(maxAssets: number, protectedTrackIds: string[]) {
  await pruneCachedTracks(maxAssets, protectedTrackIds);
}
