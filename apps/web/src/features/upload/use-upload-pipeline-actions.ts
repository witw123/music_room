import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  GuestSession,
  MetingTrackCandidate,
  NeteaseTrackCandidate,
  RemoteTrackSourceRef,
  RoomSnapshot,
  TrackSourceType
} from "@music-room/shared";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  deleteLocalTrackDataForTracks,
  linkTrackAssets,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";
import { buildTrackMeta, type UploadedTrack } from "./audio-utils";
import { prepareAudioAssets } from "./audio-asset-builder";
import {
  applySelectedTrackFilesResult,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
import { buildCachedLibraryTrackUpsertRecord } from "./cache-library";
import { saveCachedAudioFileToLocalDirectory } from "./local-audio-storage";

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
      >;
      roomId: string;
      file: File | Blob;
    }) => {
      await upsertCachedLibraryTrack(buildCachedLibraryTrackUpsertRecord(input));
      try {
        await saveCachedAudioFileToLocalDirectory({
          file: input.file,
          fileHash: input.track.fileHash,
          title: input.track.title,
          mimeType: input.track.mimeType || input.file.type || "audio/mpeg"
        });
      } catch {
        // IndexedDB remains the fallback when the selected folder is unavailable.
      }
      await refreshCacheLibrary();
    },
    [refreshCacheLibrary]
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
        inFlightUploadHashes: inFlightUploadHashesRef.current,
        createObjectUrl: (file) => URL.createObjectURL(file),
        revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl),
        buildTrackMeta: async (file, objectUrl) => {
          const assets = await prepareAudioAssets({
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
          return buildTrackMeta(file, objectUrl, activeSession, assets);
        },
        buildRegisterTrackPayload,
        registerTrack: (registerRoomId, payload) =>
          musicRoomApi.registerTrack(
            registerRoomId,
            payload as Parameters<typeof musicRoomApi.registerTrack>[1]
          ),
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
    },
    [
      activeSession,
      inFlightUploadHashesRef,
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      setUploadedTracks,
      syncRoomSnapshot
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
      syncRoomSnapshot
    }),
    [
      activeSession,
      inFlightUploadHashesRef,
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      setUploadedTracks,
      syncRoomSnapshot
    ]
  );

  const handleMetingTrackImport = useCallback(
    (candidate: MetingTrackCandidate) => importProviderTrack({
      activeSession,
      candidate,
      download: () => musicRoomApi.downloadMetingTrack(candidate.provider, candidate.providerTrackId, "exhigh"),
      inFlightUploadHashesRef,
      origin: "meting-import",
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      setUploadedTracks,
      sourceType: candidate.provider,
      syncRoomSnapshot
    }),
    [
      activeSession,
      inFlightUploadHashesRef,
      persistTrackIntoLibrary,
      roomSnapshot,
      setStatusMessage,
      setUploadedTracks,
      syncRoomSnapshot
    ]
  );

  return {
    syncRoomSnapshot,
    persistTrackIntoLibrary,
    handleFilesSelected,
    handleNeteaseTrackImport,
    handleMetingTrackImport
  };
}

type ProviderTrackCandidate = NeteaseTrackCandidate | MetingTrackCandidate;

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
    syncRoomSnapshot
  } = input;
  if (!activeSession || !roomSnapshot) {
    throw new Error(`请先进入一个房间后再导入${sourceTypeLabel(sourceType)}歌曲。`);
  }

  const importKey = `${activeSession.userId}:${sourceType}:${candidate.providerTrackId}`;
  const importLock = `${activeSession.userId}:${sourceType}:active`;
  if (
    inFlightUploadHashesRef.current.has(importLock) ||
    inFlightUploadHashesRef.current.has(importKey)
  ) return;

  inFlightUploadHashesRef.current.add(importLock);
  inFlightUploadHashesRef.current.add(importKey);
  let objectUrl: string | null = null;
  let retainedObjectUrl = false;
  let registeredTrackId: string | null = null;
  let shouldRollbackRegisteredTrack = false;
  try {
    setStatusMessage(`正在获取《${candidate.title}》音频…`);
    const source = await download();
    const mimeType = normalizeImportedMimeType(source.contentType);
    const extension = mimeType === "audio/flac" ? "flac" : "mp3";
    const file = new File([source.blob], `${sanitizeFileName(candidate.title, sourceType)}.${extension}`, {
      type: mimeType
    });
    objectUrl = URL.createObjectURL(file);
    const assets = await prepareAudioAssets({
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
    const sourceRef = buildProviderSourceRef(sourceType, candidate.providerTrackId);
    const draft = await buildTrackMeta(file, objectUrl, activeSession, assets, {
      type: sourceType,
      metadata: candidate,
      sourceRef
    });
    const existingTrack = roomSnapshot.tracks.find(
      (track) =>
        track.ownerSessionId === activeSession.userId &&
        ((track.sourceType === sourceType &&
          track.sourceRef?.provider === sourceRef.provider &&
          track.sourceRef.trackId === sourceRef.trackId) ||
          track.fileHash === assets.fileHash)
    );
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
    setStatusMessage(`《${candidate.title}》已导入曲库。`);
  } catch (error) {
    if (registeredTrackId && shouldRollbackRegisteredTrack) {
      await Promise.allSettled([
        musicRoomApi.deleteTrack(roomSnapshot.room.id, registeredTrackId),
        deleteLocalTrackDataForTracks([registeredTrackId])
      ]);
    }
    setStatusMessage(`导入失败：${toProviderImportErrorMessage(error)}`);
    throw error;
  } finally {
    inFlightUploadHashesRef.current.delete(importLock);
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
    qqmusic: "QQ音乐",
    kugou: "酷狗音乐",
    kuwo: "酷我音乐",
    taihe: "千千音乐",
    migu: "咪咕音乐",
    baidu: "百度音乐"
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
    if (error.code === "METING_TRACK_NOT_FOUND") {
      return "该歌曲没有可用的公开音频，可能受付费、VIP 或版权限制。";
    }
    if (error.code === "METING_AUDIO_UNSUPPORTED") {
      return "平台返回了当前播放器不支持的音频格式。";
    }
    if (error.code === "METING_IMPORT_TOO_LARGE") {
      return "歌曲文件过大，无法导入。";
    }
    if (error.code === "METING_UNAVAILABLE") {
      return "平台接口暂时不可用，请稍后重试或切换平台。";
    }
    if (error.code === "RATE_LIMITED") {
      return "请求过于频繁，请稍后再试。";
    }
  }
  return error instanceof Error ? error.message : "音乐平台导入失败，请稍后重试。";
}
