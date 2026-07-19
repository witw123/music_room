import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  GuestSession,
  NeteaseTrackCandidate,
  QqMusicTrackCandidate,
  RemoteTrackSourceRef,
  RoomSnapshot,
  TrackMeta,
  TrackSourceType
} from "@music-room/shared";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  deleteLocalTrackDataForTracks,
  linkTrackAssets,
  getCachedLibraryTrackByProviderTrack,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";
import { buildTrackMeta, type CachedLibraryTrack, type UploadedTrack } from "./audio-utils";
import { getReusableAudioAssets, prepareAudioAssets } from "./audio-asset-builder";
import {
  applySelectedTrackFilesResult,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
import {
  buildCachedLibraryTrackUpsertRecord,
  toCachedLibraryFile
} from "./cache-library";
import { cleanupLocalAudioCacheFiles } from "./local-audio-storage";

type UploadPipelineActionsInput = {
  activeSession: GuestSession | null;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  inFlightUploadHashesRef: MutableRefObject<Set<string>>;
  refreshCacheLibrary: () => Promise<void>;
  roomSnapshot: RoomSnapshot | null;
  setStatusMessage: (message: string) => void;
  setUploadedTracks: Dispatch<
    SetStateAction<Record<string, UploadedTrack>>
  >;
  uploadedTracks: Record<string, UploadedTrack>;
};

export function useUploadPipelineActions({
  activeSession,
  dispatchRoomStateEvent,
  inFlightUploadHashesRef,
  refreshCacheLibrary,
  roomSnapshot,
  setStatusMessage,
  setUploadedTracks
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
        // The realtime snapshot remains the source of truth.
      }
    },
    [dispatchRoomStateEvent]
  );

  const persistTrackIntoLibrary = useCallback(
    async (input: {
      track: Pick<
        import("@music-room/shared").TrackMeta,
        | "id"
        | "title"
        | "artist"
        | "mimeType"
        | "durationMs"
        | "sizeBytes"
        | "fileHash"
        | "ownerNickname"
      > & Partial<
        Pick<
          TrackMeta,
          "album" | "artworkUrl" | "sourceType" | "sourceRef" | "originalAsset" | "playbackAsset"
        >
      >;
      roomId: string;
      file: File | Blob;
      lyrics?: string | null;
    }) => {
      const cachedRecord = buildCachedLibraryTrackUpsertRecord({
        ...input,
        track: {
          ...input.track,
          lyrics: input.lyrics ?? null
        }
      });
      await upsertCachedLibraryTrack(cachedRecord);
    },
    []
  );

  const handleFilesSelected = useCallback(
    async (
      files: FileList | File[] | null,
      metadataByFileHash?: ReadonlyMap<string, CachedLibraryTrack>
    ) => {
      if (!files || !activeSession || !roomSnapshot) {
        return;
      }

      const roomId = roomSnapshot.room.id;
      const result = await processSelectedTrackFiles({
        files: Array.from(files),
        activeSession,
        roomId,
        roomTracks: roomSnapshot.tracks,
        inFlightUploadHashes: inFlightUploadHashesRef.current,
        createObjectUrl: (file) => URL.createObjectURL(file),
        revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl),
        buildTrackMeta: async (file, objectUrl) => {
          const cachedMetadata = files.length === 1 && metadataByFileHash?.size === 1
            ? metadataByFileHash.values().next().value
            : undefined;
          const reusedAssets = cachedMetadata
            ? await getReusableAudioAssets({
                fileHash: cachedMetadata.fileHash,
                sizeBytes: cachedMetadata.sizeBytes
              })
            : null;
          const assets = reusedAssets ?? await prepareAudioAssets({
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
          const resolvedCachedMetadata = metadataByFileHash?.get(assets.fileHash);
          const provider = resolvedCachedMetadata?.provider;
          const providerTrackId = resolvedCachedMetadata?.providerTrackId;
          let sourceType: TrackSourceType = "local_upload";
          let sourceRef: RemoteTrackSourceRef | undefined;
          if (
            (provider === "netease" || provider === "qqmusic") &&
            providerTrackId
          ) {
            sourceType = provider;
            sourceRef = { provider, trackId: providerTrackId };
          }
          const draft = await buildTrackMeta(file, objectUrl, activeSession, assets, resolvedCachedMetadata
            ? {
                type: sourceType,
                metadata: {
                  title: resolvedCachedMetadata.title,
                  artist: resolvedCachedMetadata.artist,
                  album: resolvedCachedMetadata.album ?? null,
                  artworkUrl: resolvedCachedMetadata.artworkUrl ?? null
                },
                ...(sourceRef ? { sourceRef } : {})
              }
            : undefined);
          return resolvedCachedMetadata
            ? { ...draft, lyrics: resolvedCachedMetadata.lyrics ?? null }
            : draft;
        },
        buildRegisterTrackPayload,
        registerTrack: (registerRoomId, payload) =>
          musicRoomApi.registerTrack(
            registerRoomId,
            payload as Parameters<typeof musicRoomApi.registerTrack>[1]
          ),
        deleteTrack: (registerRoomId, trackId) =>
          musicRoomApi.deleteTrack(registerRoomId, trackId),
        deleteLocalTrackData: deleteLocalTrackDataForTracks,
        cleanupLocalTrackData: cleanupLocalAudioCacheFiles,
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
      await refreshCacheLibrary();
    },
    [
      activeSession,
      inFlightUploadHashesRef,
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      setUploadedTracks,
      syncRoomSnapshot,
      refreshCacheLibrary
    ]
  );

  const handleNeteaseTrackImport = useCallback(
    (candidate: NeteaseTrackCandidate) => importProviderTrack({
      activeSession,
      candidate,
      download: () => musicRoomApi.downloadNeteaseTrack(candidate.providerTrackId, "exhigh"),
      inFlightUploadHashesRef,
      origin: "netease-import",
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      setUploadedTracks,
      sourceType: "netease",
      syncRoomSnapshot,
      refreshCacheLibrary
    }),
    [
      activeSession,
      inFlightUploadHashesRef,
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      setUploadedTracks,
      syncRoomSnapshot,
      refreshCacheLibrary
    ]
  );

  const handleQqMusicTrackImport = useCallback(
    (candidate: QqMusicTrackCandidate) => importProviderTrack({
      activeSession,
      candidate,
      download: () => musicRoomApi.downloadQqMusicTrack(candidate.providerTrackId, "exhigh"),
      inFlightUploadHashesRef,
      origin: "qqmusic-import",
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      setUploadedTracks,
      sourceType: candidate.provider,
      syncRoomSnapshot,
      refreshCacheLibrary
    }),
    [
      activeSession,
      inFlightUploadHashesRef,
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      setUploadedTracks,
      syncRoomSnapshot,
      refreshCacheLibrary
    ]
  );

  return {
    syncRoomSnapshot,
    persistTrackIntoLibrary,
    handleFilesSelected,
    handleNeteaseTrackImport,
    handleQqMusicTrackImport
  };
}

type ProviderTrackCandidate = NeteaseTrackCandidate | QqMusicTrackCandidate;

async function importProviderTrack(input: {
  activeSession: GuestSession | null;
  candidate: ProviderTrackCandidate;
  download: () => Promise<{ blob: Blob; contentType: string }>;
  inFlightUploadHashesRef: MutableRefObject<Set<string>>;
  origin: UploadedTrack["origin"];
  persistTrackIntoLibrary: (input: {
    track: import("@music-room/shared").TrackMeta;
    roomId: string;
    file: File;
  }) => Promise<void>;
  roomSnapshot: RoomSnapshot | null;
  setStatusMessage: (message: string) => void;
  setUploadedTracks: Dispatch<SetStateAction<Record<string, UploadedTrack>>>;
  sourceType: Exclude<TrackSourceType, "local_upload">;
  syncRoomSnapshot: (roomId: string) => Promise<void>;
  refreshCacheLibrary: () => Promise<void>;
}) {
  const {
    activeSession,
    candidate,
    download,
    inFlightUploadHashesRef,
    origin,
    persistTrackIntoLibrary,
    roomSnapshot,
    setStatusMessage,
    setUploadedTracks,
    sourceType,
    syncRoomSnapshot,
    refreshCacheLibrary
  } = input;
  if (!activeSession || !roomSnapshot) {
    throw new Error(`请先进入一个房间后再导入${sourceTypeLabel(sourceType)}歌曲。`);
  }

  const importKey = `${activeSession.userId}:${sourceType}:${candidate.providerTrackId}`;
  if (inFlightUploadHashesRef.current.has(importKey)) return;

  inFlightUploadHashesRef.current.add(importKey);
  let objectUrl: string | null = null;
  let retainedObjectUrl = false;
  let registeredTrackId: string | null = null;
  let shouldRollbackRegisteredTrack = false;
  try {
    const sourceRef = buildProviderSourceRef(sourceType, candidate.providerTrackId);
    const existingTrack = roomSnapshot.tracks.find(
      (track) =>
        track.ownerSessionId === activeSession.userId &&
        track.sourceType === sourceType &&
        track.sourceRef?.provider === sourceRef.provider &&
        track.sourceRef.trackId === sourceRef.trackId
    );
    if (existingTrack) {
      setStatusMessage(`《${candidate.title}》已在当前房间曲库中。`);
      return;
    }

    const cachedTrack = await getCachedLibraryTrackByProviderTrack(
      sourceType,
      candidate.providerTrackId
    );
    let file: File;
    let assets: Awaited<ReturnType<typeof prepareAudioAssets>> | null = null;
    if (cachedTrack) {
      setStatusMessage(`正在使用《${candidate.title}》的浏览器缓存…`);
      file = toCachedLibraryFile({
        file: cachedTrack.file,
        title: candidate.title,
        mimeType: cachedTrack.mimeType,
        fileHash: cachedTrack.fileHash
      });
      assets = await getReusableAudioAssets({
        fileHash: cachedTrack.fileHash,
        sizeBytes: cachedTrack.sizeBytes
      });
    } else {
      setStatusMessage(`正在获取《${candidate.title}》音频…`);
      const source = await download();
      const mimeType = normalizeImportedMimeType(source.contentType);
      const extension = mimeType === "audio/flac" ? "flac" : "mp3";
      file = new File([source.blob], `${sanitizeFileName(candidate.title, sourceType)}.${extension}`, {
        type: mimeType
      });
    }
    objectUrl = URL.createObjectURL(file);
    assets ??= await prepareAudioAssets({
      file,
      onProgress: ({ stage, completed, total }) => {
        const labels = {
          inspecting: "正在检查音频资源",
          hashing: "正在校验音频",
          "persisting-original": "正在保存源文件",
          decoding: "正在解码音频",
          encoding: "正在生成播放分片",
          "persisting-playback": "正在保存播放分片"
        } as const;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        setStatusMessage(`${labels[stage]} ${percent}%`);
      }
    });
    const draft = await buildTrackMeta(file, objectUrl, activeSession, assets, {
      type: sourceType,
      metadata: candidate,
      sourceRef
    });
    const registered = await musicRoomApi.registerTrack(
      roomSnapshot.room.id,
      buildRegisterTrackPayload(draft)
    );
    registeredTrackId = registered.id;
    shouldRollbackRegisteredTrack = !existingTrack;
    if (registered.originalAsset && registered.playbackAsset) {
      await linkTrackAssets({
        trackId: registered.id,
        originalAssetId: registered.originalAsset.assetId,
        playbackAssetId: registered.playbackAsset.assetId
      });
    }
    await persistTrackIntoLibrary({
      track: registered,
      roomId: roomSnapshot.room.id,
      file
    });
    setUploadedTracks((current) => ({
      ...current,
      [registered.id]: { file, objectUrl: objectUrl!, origin }
    }));
    retainedObjectUrl = true;
    await syncRoomSnapshot(roomSnapshot.room.id);
    await refreshCacheLibrary().catch(() => undefined);
    setStatusMessage(`《${candidate.title}》已导入曲库。`);
  } catch (error) {
    if (registeredTrackId && shouldRollbackRegisteredTrack) {
      await Promise.allSettled([
        musicRoomApi.deleteTrack(roomSnapshot.room.id, registeredTrackId),
        deleteLocalTrackDataForTracks([registeredTrackId])
      ]);
      await cleanupLocalAudioCacheFiles();
    }
    setStatusMessage(`导入失败：${toProviderImportErrorMessage(error)}`);
    throw error;
  } finally {
    inFlightUploadHashesRef.current.delete(importKey);
    if (objectUrl && !retainedObjectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function buildProviderSourceRef(
  sourceType: Exclude<TrackSourceType, "local_upload">,
  trackId: string
): RemoteTrackSourceRef {
  return { provider: sourceType, trackId } as RemoteTrackSourceRef;
}

function sourceTypeLabel(sourceType: Exclude<TrackSourceType, "local_upload">) {
  return {
    netease: "网易云",
    qqmusic: "QQ 音乐"
  }[sourceType];
}

function normalizeImportedMimeType(value: string) {
  const baseType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (baseType === "audio/flac" || baseType === "audio/x-flac") {
    return "audio/flac";
  }
  return "audio/mpeg";
}

function sanitizeFileName(value: string, sourceType: TrackSourceType) {
  return value.replace(/[\\/:*?"<>|]+/g, " ").trim() || `${sourceType}-track`;
}

function toProviderImportErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "QQMUSIC_TRACK_NOT_FOUND") {
      return "该歌曲没有可用的公开音频，可能受付费、VIP 或版权限制。";
    }
    if (error.code === "QQMUSIC_AUDIO_UNSUPPORTED") {
      return "平台返回了当前播放器不支持的音频格式。";
    }
    if (error.code === "QQMUSIC_IMPORT_TOO_LARGE") {
      return "歌曲文件过大，无法导入。";
    }
    if (error.code === "QQMUSIC_UNAVAILABLE") {
      return "平台接口暂时不可用，请稍后重试或切换平台。";
    }
    if (error.code === "RATE_LIMITED") {
      return "请求过于频繁，请稍后再试。";
    }
  }
  return error instanceof Error ? error.message : "音乐平台导入失败，请稍后重试。";
}
