import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  GuestSession,
  NeteaseTrackCandidate,
  QqMusicTrackCandidate,
  RoomSnapshot,
  TrackMeta,
  TrackSourceType
} from "@music-room/shared";
import {
  getCachedLibraryTrackByProviderTrack,
  linkTrackAssets
} from "@/features/library/indexeddb";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { buildTrackMeta, type UploadedTrack } from "@/features/library/audio-utils";
import {
  getReusableAudioAssets,
  prepareAudioAssets
} from "@/features/library/audio-asset-builder";
import { buildRegisterTrackPayload } from "./upload-pipeline";
import { toCachedLibraryFile } from "@/features/library/cache-library";
import { resolveLocalArtworkUrl } from "@/features/library/audio-metadata";
import { hasRoomPermission } from "@/features/room/room-permissions";
import {
  buildProviderSourceRef,
  extensionForImportedMimeType,
  resolveCachedAudioMimeType,
  resolveImportedLyrics,
  sanitizeFileName,
  sourceTypeLabel
} from "./upload-import-helpers";

export type ProviderTrackCandidate = NeteaseTrackCandidate | QqMusicTrackCandidate;

export type PreparedProviderImport = {
  candidate: ProviderTrackCandidate;
  file: File;
  objectUrl: string;
  draft: Omit<TrackMeta, "id"> & { id?: string };
  localArtworkUrl: string | null;
  lyrics: string | null;
};

export type PrefetchedProviderAudio = {
  cachedTrack: Awaited<ReturnType<typeof getCachedLibraryTrackByProviderTrack>> | null;
  file: File;
  assets: Awaited<ReturnType<typeof prepareAudioAssets>> | null;
};

export type PrefetchedProviderAudioResult =
  | { ok: true; audio: PrefetchedProviderAudio }
  | { ok: false; error: unknown };

export async function prefetchProviderAudio(
  candidate: ProviderTrackCandidate,
  sourceType: Exclude<TrackSourceType, "local_upload">
): Promise<PrefetchedProviderAudio> {
  const cachedTrack: Awaited<ReturnType<typeof getCachedLibraryTrackByProviderTrack>> | null = (
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

export async function importProviderTracks(input: {
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
