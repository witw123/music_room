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
} from "@/features/library/indexeddb";
import {
  MusicRoomApiError,
  musicRoomApi,
  resolveDownloadedAudioMimeType
} from "@/lib/network/music-room-api";
import { buildTrackMeta, type CachedLibraryTrack, type UploadedTrack } from "@/features/library/audio-utils";
import {
  getReusableAudioAssets,
  playbackProfileId,
  prepareAudioAssets
} from "@/features/library/audio-asset-builder";
import {
  applySelectedTrackFilesResult,
  buildRegisterTrackPayload,
  processSelectedTrackFiles
} from "./upload-pipeline";
import {
  buildCachedLibraryTrackUpsertRecord,
  toCachedLibraryFile
} from "@/features/library/cache-library";
import { resolveProviderTrackSource } from "@/features/library/provider-track-identity";
import {
  getConfiguredLocalRepository,
  saveAudioFileToLocalDirectory
} from "@/features/library/local-audio-storage";
import { resolveLocalArtworkUrl } from "@/features/library/audio-metadata";
import { persistRoomSnapshotToLocalRepository } from "@/features/library/local-room-storage";
import { hasRoomPermission } from "@/features/room/room-permissions";

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

type PreparedProviderImport = {
  candidate: ProviderTrackCandidate;
  file: File;
  objectUrl: string;
  draft: Omit<TrackMeta, "id"> & { id?: string };
  localArtworkUrl: string | null;
  lyrics: string | null;
};

type PrefetchedProviderAudio = {
  cachedTrack: Awaited<ReturnType<typeof getCachedLibraryTrackByProviderTrack>> | null;
  file: File;
  assets: Awaited<ReturnType<typeof prepareAudioAssets>> | null;
};

type PrefetchedProviderAudioResult =
  | { ok: true; audio: PrefetchedProviderAudio }
  | { ok: false; error: unknown };

async function importProviderTracks(input: {
  activeSession: GuestSession | null;
  candidates: ProviderTrackCandidate[];
  inFlightUploadHashesRef: MutableRefObject<Set<string>>;
  origin: UploadedTrack["origin"];
  persistTrackIntoLibrary: (input: {
    track: TrackMeta;
    roomId: string;
    file: File;
    lyrics?: string | null;
    refreshCache?: boolean;
  }) => Promise<void>;
  roomSnapshot: RoomSnapshot | null;
  setStatusMessage: (message: string) => void;
  setUploadedTracks: Dispatch<SetStateAction<Record<string, UploadedTrack>>>;
  sourceType: Exclude<TrackSourceType, "local_upload">;
  syncRoomSnapshot: (roomId: string) => Promise<void>;
  refreshCacheLibrary: () => Promise<void>;
  deleteTrack?: (roomId: string, trackId: string) => Promise<unknown>;
  deleteLocalTrackData?: (trackIds: readonly string[]) => Promise<void>;
}) {
  const { activeSession, candidates, roomSnapshot, sourceType, inFlightUploadHashesRef } = input;
  if (!activeSession || !roomSnapshot) {
    throw new Error(`请先进入一个房间后再导入${sourceTypeLabel(sourceType)}歌曲。`);
  }
  if (!hasRoomPermission(roomSnapshot, activeSession.userId, "library")) {
    throw new Error("你没有修改房间曲库的权限。请联系房主。");
  }

  const pendingCandidateKeys = new Set<string>();
  const pendingCandidates = candidates.filter((candidate) => {
    const key = `${activeSession.userId}:${candidate.provider}:${candidate.providerTrackId}`;
    if (inFlightUploadHashesRef.current.has(key) || pendingCandidateKeys.has(key)) return false;
    const sourceRef = buildProviderSourceRef(sourceType, candidate.providerTrackId);
    const shouldImport = !roomSnapshot.tracks.some((track) =>
      track.ownerSessionId === activeSession.userId &&
      track.sourceType === sourceType &&
      track.sourceRef?.provider === sourceRef.provider &&
      track.sourceRef.trackId === sourceRef.trackId
    );
    if (shouldImport) pendingCandidateKeys.add(key);
    return shouldImport;
  });
  if (pendingCandidates.length === 0) return;

  const prepared: PreparedProviderImport[] = [];
  const failures: unknown[] = [];
  const heldInFlightKeys: string[] = [];
  for (const key of pendingCandidateKeys) inFlightUploadHashesRef.current.add(key);
  const prefetchedAudio = new Map<number, Promise<PrefetchedProviderAudioResult>>();
  let nextPrefetchIndex = 0;
  const fillPrefetchWindow = (lastIndex: number) => {
    while (nextPrefetchIndex < pendingCandidates.length && nextPrefetchIndex <= lastIndex) {
      const index = nextPrefetchIndex++;
      const candidate = pendingCandidates[index];
      prefetchedAudio.set(
        index,
        prefetchProviderAudio(candidate, sourceType).then(
          (audio) => ({ ok: true as const, audio }),
          (error: unknown) => ({ ok: false as const, error })
        )
      );
    }
  };
  fillPrefetchWindow(1);

  for (let index = 0; index < pendingCandidates.length; index += 1) {
    const candidate = pendingCandidates[index];
    const key = `${activeSession.userId}:${candidate.provider}:${candidate.providerTrackId}`;
    let objectUrl: string | null = null;
    try {
      input.setStatusMessage(`正在按顺序导入 ${index + 1} / ${pendingCandidates.length}：《${candidate.title}》…`);
      const prefetchPromise = prefetchedAudio.get(index);
      if (!prefetchPromise) throw new Error(`歌曲预取任务不存在：${candidate.title}`);
      const prefetchResult = await prefetchPromise;
      prefetchedAudio.delete(index);
      fillPrefetchWindow(index + 2);
      if (!prefetchResult.ok) throw prefetchResult.error;
      const prefetched = prefetchResult.audio;
      if (!prefetched) throw new Error(`歌曲预取结果无效：${candidate.title}`);

      const sourceRef = buildProviderSourceRef(sourceType, candidate.providerTrackId);
      const lyricsPromise = resolveImportedLyrics({
        title: candidate.title,
        artist: candidate.artist,
        sourceType,
        sourceTrackId: candidate.providerTrackId
      });
      const artworkPromise = sourceType === "qqmusic" && candidate.artworkUrl && /^https?:\/\//i.test(candidate.artworkUrl)
        ? musicRoomApi.downloadQqMusicArtwork(candidate.artworkUrl).then((response) => response.blob).catch(() => undefined)
        : Promise.resolve(undefined);
      const createdObjectUrl = URL.createObjectURL(prefetched.file);
      objectUrl = createdObjectUrl;
      const localArtworkPromise = artworkPromise.then((artworkBlob) =>
        resolveLocalArtworkUrl(prefetched.file, candidate.artworkUrl, artworkBlob)
      );
      const assets = prefetched.assets ?? await prepareAudioAssets({
        file: prefetched.file,
        onProgress: ({ stage, completed, total }) => {
          const stageLabel = {
            inspecting: "检查音频",
            hashing: "校验音频",
            "persisting-original": "缓存源文件",
            decoding: "解码音频",
            encoding: "生成播放分片",
            "persisting-playback": "缓存播放分片"
          }[stage];
          const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
          input.setStatusMessage(`${index + 1} / ${pendingCandidates.length}《${candidate.title}》· ${stageLabel} ${percent}%`);
        }
      });
      const localArtworkUrl = await localArtworkPromise;
      const draft = await buildTrackMeta(prefetched.file, createdObjectUrl, activeSession, assets, {
        type: sourceType,
        metadata: { ...candidate, artworkUrl: localArtworkUrl },
        sourceRef
      });
      const lyrics = (await lyricsPromise)?.trim() || null;
      prepared.push({
        candidate,
        file: prefetched.file,
        objectUrl: createdObjectUrl,
        draft: { ...draft, lyrics, artworkUrl: candidate.artworkUrl ?? null },
        localArtworkUrl,
        lyrics
      });
      // The candidate is still being committed below; keep the marker until
      // the whole import finishes so a concurrent run cannot duplicate it.
      heldInFlightKeys.push(key);
    } catch (error) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      failures.push(error);
      inFlightUploadHashesRef.current.delete(key);
    }
  }
  if (prepared.length === 0) {
    throw failures[0] ?? new Error("没有可导入的歌曲。");
  }

  try {
    if (prepared.length === 0) {
      throw failures[0] ?? new Error("没有可导入的歌曲。");
    }

    input.setStatusMessage(`正在提交 ${prepared.length} 首歌曲到曲库…`);
    let registered: TrackMeta[];
    try {
      registered = await musicRoomApi.registerTracks(roomSnapshot.room.id, {
        tracks: prepared.map((item) => buildRegisterTrackPayload(item.draft))
      });
    } catch (error) {
      for (const item of prepared) URL.revokeObjectURL(item.objectUrl);
      throw error;
    }

    const uploadEntries: Record<string, UploadedTrack> = {};
    const persistedObjectUrls = new Set<string>();
    const persistFailures: Array<{ track: TrackMeta; error: unknown }> = [];
    await Promise.all(registered.map(async (track, index) => {
      const item = prepared[index];
      if (!item) return;
      try {
        if (track.originalAsset && track.playbackAsset) {
          await linkTrackAssets({ trackId: track.id, originalAssetId: track.originalAsset.assetId, playbackAssetId: track.playbackAsset.assetId });
        }
        await input.persistTrackIntoLibrary({ track: { ...track, artworkUrl: item.localArtworkUrl }, roomId: roomSnapshot.room.id, file: item.file, lyrics: item.lyrics, refreshCache: false });
        uploadEntries[track.id] = { file: item.file, objectUrl: item.objectUrl, origin: input.origin };
        persistedObjectUrls.add(item.objectUrl);
      } catch (error) {
        persistFailures.push({ track, error });
      }
    }));

    if (persistFailures.length > 0) {
      // Roll back only the tracks whose local cache write failed; they would
      // otherwise sit in the room library with no owner-side asset to stream.
      const failedTrackIds = new Set(persistFailures.map((failure) => failure.track.id));
      await Promise.allSettled(
        [...failedTrackIds].flatMap((trackId) => [
          input.deleteTrack?.(roomSnapshot.room.id, trackId),
          input.deleteLocalTrackData?.([trackId])
        ])
      );
      for (const item of prepared) {
        if (!persistedObjectUrls.has(item.objectUrl)) {
          URL.revokeObjectURL(item.objectUrl);
        }
      }
      if (Object.keys(uploadEntries).length === 0) {
        throw persistFailures[0]!.error;
      }
    }

    input.setUploadedTracks((current) => ({ ...current, ...uploadEntries }));
    await input.syncRoomSnapshot(roomSnapshot.room.id);
    void input.refreshCacheLibrary().catch(() => undefined);
    const failedCount = failures.length + persistFailures.length;
    input.setStatusMessage(`已导入 ${Object.keys(uploadEntries).length} 首歌曲${failedCount ? `，${failedCount} 首失败` : ""}。`);
  } finally {
    for (const heldKey of heldInFlightKeys) {
      inFlightUploadHashesRef.current.delete(heldKey);
    }
  }
}

async function prefetchProviderAudio(
  candidate: ProviderTrackCandidate,
  sourceType: Exclude<TrackSourceType, "local_upload">
): Promise<PrefetchedProviderAudio> {
  let cachedTrack: Awaited<ReturnType<typeof getCachedLibraryTrackByProviderTrack>> | null = (
    await getCachedLibraryTrackByProviderTrack(sourceType, candidate.providerTrackId)
  ) ?? null;
  if (cachedTrack) {
    const cachedFile = toCachedLibraryFile({
      file: cachedTrack.file,
      title: candidate.title,
      mimeType: cachedTrack.mimeType,
      fileHash: cachedTrack.fileHash
    });
    try {
      const file = new File([cachedFile], cachedFile.name, {
        type: await resolveCachedAudioMimeType(cachedFile)
      });
      const assets = await getReusableAudioAssets({
        fileHash: cachedTrack.fileHash,
        sizeBytes: cachedTrack.sizeBytes
      });
      return { cachedTrack, file, assets };
    } catch {
      // Ignore an unreadable cache entry and download a fresh provider copy.
    }
  }

  const source = sourceType === "netease"
    ? await musicRoomApi.downloadNeteaseTrack(candidate.providerTrackId, "exhigh")
    : await musicRoomApi.downloadQqMusicTrack(candidate.providerTrackId, "exhigh");
  const extension = extensionForImportedMimeType(source.contentType);
  return {
    cachedTrack: null,
    file: new File(
      [source.blob],
      `${sanitizeFileName(candidate.title, sourceType)}.${extension}`,
      { type: source.contentType }
    ),
    assets: null
  };
}

type ProviderTrackCandidate = NeteaseTrackCandidate | QqMusicTrackCandidate;

async function _importProviderTrack(input: {
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
  if (!hasRoomPermission(roomSnapshot, activeSession.userId, "library")) {
    throw new Error("你没有修改房间曲库的权限。请联系房主。");
  }

  const importKey = `${activeSession.userId}:${sourceType}:${candidate.providerTrackId}`;
  if (inFlightUploadHashesRef.current.has(importKey)) return;

  inFlightUploadHashesRef.current.add(importKey);
  setStatusMessage(`正在准备导入《${candidate.title}》…`);
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
    const artworkResponse = sourceType === "qqmusic" && candidate.artworkUrl && /^https?:\/\//i.test(candidate.artworkUrl)
      ? await musicRoomApi.downloadQqMusicArtwork(candidate.artworkUrl).catch(() => null)
      : null;
    const localArtworkUrl = await resolveLocalArtworkUrl(
      file,
      candidate.artworkUrl,
      artworkResponse?.blob
    );
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
      metadata: { ...candidate, artworkUrl: localArtworkUrl },
      sourceRef
    });
    const lyrics = await lyricsPromise;
    // Register the provider's remote cover with the room. The local data URL
    // is intentionally kept out of this request because it can exceed the
    // room API's 4096-character artwork limit.
    const registered = await musicRoomApi.registerTrack(
      roomSnapshot.room.id,
      buildRegisterTrackPayload({
        ...draft,
        artworkUrl: candidate.artworkUrl ?? null,
        lyrics: lyrics || null
      })
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
      // Persist the locally resolved cover for playback/color extraction while
      // the room snapshot continues to use the provider URL from `registered`.
      track: { ...registered, artworkUrl: localArtworkUrl },
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
    const lyrics = (response.wordSyncedLyric ?? response.plainLyric)?.trim();
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
