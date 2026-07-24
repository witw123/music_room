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
  getAssetManifest,
  getAssetUnit,
  linkTrackAssets,
  getCachedLibraryTrackByProviderTrack,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import {
  MusicRoomApiError,
  musicRoomApi,
  resolveDownloadedAudioMimeType
} from "@/lib/music-room-api";
import { buildTrackMeta, type CachedLibraryTrack, type UploadedTrack } from "./audio-utils";
import {
  getReusableAudioAssets,
  playbackProfileId,
  prepareAudioAssets
} from "./audio-asset-builder";
import {
  applySelectedTrackFilesResult,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
import {
  buildCachedLibraryTrackUpsertRecord,
  toCachedLibraryFile
} from "./cache-library";
import {
  getConfiguredLocalRepository,
  saveAudioFileToLocalDirectory
} from "./local-audio-storage";
import { persistRoomSnapshotToLocalRepository } from "./local-room-storage";

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
            provider: input.track.sourceType,
            providerTrackId: input.track.sourceRef?.trackId ?? null,
            loudness: input.track.loudness,
            durationMs: input.track.durationMs,
            sizeBytes: input.track.sizeBytes ?? input.file.size,
            originalAsset: input.track.originalAsset,
            playbackAsset: input.track.playbackAsset
          }
        }).then(() => refreshCacheLibrary()).catch(() => undefined);
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
    if (existingTrack && await hasUsableLocalPlaybackAsset(existingTrack)) {
      setStatusMessage(`《${candidate.title}》已在当前房间曲库中。`);
      return;
    }

    const lyricsPromise = resolveImportedLyrics({
      title: candidate.title,
      artist: candidate.artist,
      sourceType,
      sourceTrackId: candidate.providerTrackId
    });

    let cachedTrack: Awaited<ReturnType<typeof getCachedLibraryTrackByProviderTrack>> | null = await getCachedLibraryTrackByProviderTrack(
      sourceType,
      candidate.providerTrackId
    );
    let file: File | null = null;
    let assets: Awaited<ReturnType<typeof prepareAudioAssets>> | null = null;
    if (cachedTrack) {
      setStatusMessage(`正在使用《${candidate.title}》的浏览器缓存…`);
      const cachedFile = toCachedLibraryFile({
        file: cachedTrack.file,
        title: candidate.title,
        mimeType: cachedTrack.mimeType,
        fileHash: cachedTrack.fileHash
      });
      try {
        file = new File(
          [cachedFile],
          cachedFile.name,
          { type: await resolveCachedAudioMimeType(cachedFile) }
        );
        assets = await getReusableAudioAssets({
          fileHash: cachedTrack.fileHash,
          sizeBytes: cachedTrack.sizeBytes
        });
      } catch {
        // A previous interrupted import may have left an HTML/JSON response in
        // the cache. Drop it and fetch a fresh provider response below.
        cachedTrack = null;
        file = null;
        assets = null;
      }
    }
    if (!file) {
      setStatusMessage(`正在获取《${candidate.title}》音频…`);
      const source = await download();
      const mimeType = source.contentType;
      const extension = extensionForImportedMimeType(mimeType);
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
    const lyrics = cachedTrack?.lyrics?.trim() || await lyricsPromise;
    const registered = await musicRoomApi.registerTrack(
      roomSnapshot.room.id,
      buildRegisterTrackPayload({ ...draft, lyrics: lyrics || null })
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
    void refreshCacheLibrary().catch(() => undefined);
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

async function hasUsableLocalPlaybackAsset(track: TrackMeta) {
  const playbackAsset = track.playbackAsset;
  if (!playbackAsset || playbackAsset.profileId !== playbackProfileId || playbackAsset.unitCount <= 0) {
    return false;
  }

  const manifest = await getAssetManifest(playbackAsset.assetId).catch(() => null);
  if (!manifest?.complete) {
    return false;
  }

  return !!(await getAssetUnit(playbackAsset.assetId, 0).catch(() => null));
}

async function resolveCachedAudioMimeType(file: File) {
  return resolveDownloadedAudioMimeType(file, file.type);
}

function extensionForImportedMimeType(mimeType: string) {
  if (mimeType === "audio/flac") return "flac";
  if (mimeType === "audio/wav") return "wav";
  return "mp3";
}

function sanitizeFileName(value: string, sourceType: TrackSourceType) {
  return value.replace(/[\\/:*?"<>|]+/g, " ").trim() || `${sourceType}-track`;
}

async function resolveImportedLyrics(input: {
  title: string;
  artist: string;
  sourceType: TrackSourceType;
  sourceTrackId?: string;
}) {
  const preferredProviders = input.sourceType === "local_upload"
    ? (["netease", "qqmusic"] as const)
    : ([input.sourceType] as const);

  if (input.sourceTrackId && input.sourceType !== "local_upload") {
    const direct = await requestProviderLyrics(input.sourceType, input.sourceTrackId);
    if (direct) return direct;
  }

  const keyword = `${input.title} ${input.artist}`.trim();
  const searchResults = await Promise.all(
    preferredProviders.map(async (provider) => {
      try {
        const response = provider === "netease"
          ? await musicRoomApi.searchNeteaseTracks(keyword, { limit: 10 })
          : await musicRoomApi.searchQqMusicTracks(keyword, { limit: 10 });
        return {
          provider,
          track: findMatchingProviderTrack(response.items, input)
        };
      } catch {
        return { provider, track: null };
      }
    })
  );

  const matches = searchResults
    .filter((result): result is typeof result & { track: NonNullable<typeof result.track> } => !!result.track)
    .sort((left, right) => right.track.score - left.track.score);
  const lyricResults = await Promise.all(
    matches.map(async ({ provider, track }) => ({
      lyrics: await requestProviderLyrics(provider, track.providerTrackId),
      score: track.score
    }))
  );
  return lyricResults
    .sort((left, right) => right.score - left.score)
    .find((result) => result.lyrics)?.lyrics ?? null;
}

async function requestProviderLyrics(
  provider: "netease" | "qqmusic",
  trackId: string
) {
  try {
    const response = provider === "netease"
      ? await musicRoomApi.getNeteaseLyrics(trackId)
      : await musicRoomApi.getQqMusicLyrics(trackId);
    const lyrics = response.plainLyric?.trim();
    return lyrics ? lyrics.slice(0, 100_000) : null;
  } catch {
    return null;
  }
}

function findMatchingProviderTrack(
  tracks: Array<{ title: string; artist: string; providerTrackId: string }>,
  input: Pick<Parameters<typeof resolveImportedLyrics>[0], "title" | "artist">
) {
  const normalizedTitle = normalizeLyricsMatchText(input.title);
  const normalizedArtist = normalizeLyricsMatchText(input.artist);
  return tracks
    .map((track) => {
      const titleMatches = normalizeLyricsMatchText(track.title) === normalizedTitle;
      const artistMatches = normalizeLyricsMatchText(track.artist) === normalizedArtist;
      return {
        ...track,
        score: titleMatches ? 10 + (artistMatches ? 5 : 0) : 0
      };
    })
    .filter((track) => track.score > 0)
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function normalizeLyricsMatchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
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
