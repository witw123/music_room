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
  upsertCachedLibraryTrack
} from "@/features/library/indexeddb";
import {
  musicRoomApi
} from "@/lib/network/music-room-api";
import { buildTrackMeta, type CachedLibraryTrack, type UploadedTrack } from "@/features/library/audio-utils";
import {
  getReusableAudioAssets,
  prepareAudioAssets
} from "@/features/library/audio-asset-builder";
import {
  applySelectedTrackFilesResult,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
import {
  buildCachedLibraryTrackUpsertRecord
} from "@/features/library/cache-library";
import { resolveProviderTrackSource } from "@/features/library/provider-track-identity";
import {
  getConfiguredLocalRepository,
  saveAudioFileToLocalDirectory
} from "@/features/library/local-audio-storage";
import { persistRoomSnapshotToLocalRepository } from "@/features/library/local-room-storage";
import { hasRoomPermission } from "@/features/room/room-permissions";
import {
  resolveImportedLyrics
} from "./upload-import-helpers";
import { importProviderTracks } from "./provider-import-pipeline";

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
          "album" | "artworkUrl" | "sourceType" | "sourceRef" | "loudness" | "originalAsset" | "playbackAsset"
        >
      >;
      roomId: string;
      file: File | Blob;
      refreshCache?: boolean;
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
      const localRepository = await getConfiguredLocalRepository();
      if (localRepository) {
        await saveAudioFileToLocalDirectory({
          file: input.file,
          fileHash: input.track.fileHash,
          title: input.track.title,
          mimeType: input.track.mimeType ?? "audio/mpeg",
          trackId: input.track.id,
          track: {
            artist: input.track.artist,
            album: input.track.album,
            artworkUrl: input.track.artworkUrl,
            lyrics: input.lyrics ?? null,
            provider: resolveProviderTrackSource(input.track)?.provider ?? "local_upload",
            providerTrackId: resolveProviderTrackSource(input.track)?.trackId ?? null,
            loudness: input.track.loudness,
            durationMs: input.track.durationMs,
            sizeBytes: input.track.sizeBytes ?? input.file.size,
            originalAsset: input.track.originalAsset,
            playbackAsset: input.track.playbackAsset
          }
        }).then(() => input.refreshCache !== false ? refreshCacheLibrary() : undefined).catch(() => undefined);
      }
      if (roomSnapshot?.room.id === input.roomId) {
        const tracks = roomSnapshot.tracks.some((track) => track.id === input.track.id)
          ? roomSnapshot.tracks
          : [...roomSnapshot.tracks, input.track as TrackMeta];
        void persistRoomSnapshotToLocalRepository({
          ...roomSnapshot,
          tracks
        }).catch(() => undefined);
      }
    },
    [refreshCacheLibrary, roomSnapshot]
  );

  const handleFilesSelected = useCallback(
    async (
      files: FileList | File[] | null,
      metadataByFileHash?: ReadonlyMap<string, CachedLibraryTrack>
    ) => {
      if (!files || !activeSession || !roomSnapshot) {
        return;
      }
      if (!hasRoomPermission(roomSnapshot, activeSession.userId, "library")) {
        setStatusMessage("你没有修改房间曲库的权限。请联系房主。");
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
                ...(sourceRef ? { sourceRef } : {}),
                ...(resolvedCachedMetadata?.loudness
                  ? { loudness: resolvedCachedMetadata.loudness }
                  : {})
              }
            : undefined);
          const lyrics = draft.lyrics?.trim()
            || resolvedCachedMetadata?.lyrics?.trim()
            || await resolveImportedLyrics({
              title: draft.title,
              artist: draft.artist,
              sourceType,
              sourceTrackId: sourceRef?.trackId
            });
          return { ...draft, lyrics: lyrics || null };
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
      void refreshCacheLibrary();
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
    (candidate: NeteaseTrackCandidate) => importProviderTracks({
      activeSession, candidates: [candidate], inFlightUploadHashesRef,
      origin: "netease-import", persistTrackIntoLibrary, roomSnapshot,
      deleteTrack: (roomId, trackId) => musicRoomApi.deleteTrack(roomId, trackId),
      deleteLocalTrackData: deleteLocalTrackDataForTracks,
      setStatusMessage, setUploadedTracks, sourceType: "netease",
      syncRoomSnapshot, refreshCacheLibrary
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
    (candidate: QqMusicTrackCandidate) => importProviderTracks({
      activeSession, candidates: [candidate], inFlightUploadHashesRef,
      origin: "qqmusic-import", persistTrackIntoLibrary, roomSnapshot,
      deleteTrack: (roomId, trackId) => musicRoomApi.deleteTrack(roomId, trackId),
      deleteLocalTrackData: deleteLocalTrackDataForTracks,
      setStatusMessage, setUploadedTracks, sourceType: "qqmusic",
      syncRoomSnapshot, refreshCacheLibrary
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
    handleQqMusicTrackImport,
    handleNeteaseTrackImports: (candidates: NeteaseTrackCandidate[]) => importProviderTracks({
      activeSession, candidates, inFlightUploadHashesRef, origin: "netease-import",
      persistTrackIntoLibrary, roomSnapshot, setStatusMessage, setUploadedTracks,
      deleteTrack: (roomId, trackId) => musicRoomApi.deleteTrack(roomId, trackId),
      deleteLocalTrackData: deleteLocalTrackDataForTracks,
      sourceType: "netease", syncRoomSnapshot, refreshCacheLibrary
    }),
    handleQqMusicTrackImports: (candidates: QqMusicTrackCandidate[]) => importProviderTracks({
      activeSession, candidates, inFlightUploadHashesRef, origin: "qqmusic-import",
      persistTrackIntoLibrary, roomSnapshot, setStatusMessage, setUploadedTracks,
      deleteTrack: (roomId, trackId) => musicRoomApi.deleteTrack(roomId, trackId),
      deleteLocalTrackData: deleteLocalTrackDataForTracks,
      sourceType: "qqmusic", syncRoomSnapshot, refreshCacheLibrary
    })
  };
}
export { importProviderTracks, prefetchProviderAudio, type ProviderTrackCandidate } from "./provider-import-pipeline";


