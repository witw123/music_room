import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { GuestSession, NeteaseTrackCandidate, RoomSnapshot } from "@music-room/shared";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import {
  deleteLocalTrackDataForTracks,
  linkTrackAssets,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import { buildTrackMeta, type UploadedTrack } from "./audio-utils";
import { prepareAudioAssets } from "./audio-asset-builder";
import {
  applySelectedTrackFilesResult,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
import { buildCachedLibraryTrackUpsertRecord } from "./cache-library";

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
    async (candidate: NeteaseTrackCandidate) => {
      if (!activeSession || !roomSnapshot) {
        throw new Error("请先进入一个房间后再导入网易云歌曲。");
      }

      const importKey = `${activeSession.userId}:netease:${candidate.providerTrackId}`;
      const importLock = `${activeSession.userId}:netease:active`;
      if (
        inFlightUploadHashesRef.current.has(importLock) ||
        inFlightUploadHashesRef.current.has(importKey)
      ) {
        return;
      }

      inFlightUploadHashesRef.current.add(importLock);
      inFlightUploadHashesRef.current.add(importKey);
      let objectUrl: string | null = null;
      let retainedObjectUrl = false;
      let registeredTrackId: string | null = null;
      let shouldRollbackRegisteredTrack = false;
      try {
        setStatusMessage(`正在获取《${candidate.title}》音频…`);
        const source = await musicRoomApi.downloadNeteaseTrack(candidate.providerTrackId, "exhigh");
        const mimeType = normalizeImportedMimeType(source.contentType);
        const extension = mimeType === "audio/flac" ? "flac" : "mp3";
        const file = new File([source.blob], `${sanitizeFileName(candidate.title)}.${extension}`, {
          type: mimeType
        });
        objectUrl = URL.createObjectURL(file);
        const assets = await prepareAudioAssets({
          file,
          onProgress: ({ stage, completed, total }) => {
            const labels = {
              inspecting: "正在检查网易云音频",
              hashing: "正在校验网易云音频",
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
          type: "netease",
          metadata: candidate,
          sourceRef: {
            provider: "netease",
            trackId: candidate.providerTrackId
          }
        });
        const existingTrack = roomSnapshot.tracks.find(
          (track) =>
            track.ownerSessionId === activeSession.userId &&
            ((track.sourceType === "netease" &&
              track.sourceRef?.provider === "netease" &&
              track.sourceRef.trackId === candidate.providerTrackId) ||
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
          [registered.id]: {
            file,
            objectUrl: objectUrl!,
            origin: "netease-import"
          }
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
        throw error;
      } finally {
        inFlightUploadHashesRef.current.delete(importLock);
        inFlightUploadHashesRef.current.delete(importKey);
        if (objectUrl && !retainedObjectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      }
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

  return {
    syncRoomSnapshot,
    persistTrackIntoLibrary,
    handleFilesSelected,
    handleNeteaseTrackImport
  };
}

function normalizeImportedMimeType(value: string) {
  const baseType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (baseType === "audio/flac" || baseType === "audio/x-flac") {
    return "audio/flac";
  }
  return "audio/mpeg";
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, " ").trim() || "netease-track";
}
