import { hashAudioBlob, localPlaylistTrackId, toProviderTrackRecord, type ProviderTrack } from "@/features/playlist/local-playlist";
import {
  normalizeLocalAudioMimeType,
  saveCachedAudioFileToLocalDirectory
} from "@/features/upload/local-audio-storage";
import {
  deleteCachedLibraryTrack,
  deleteCachedLibraryTrackFile,
  getCachedLibraryTrack,
  getCachedLibraryTrackSummary,
  getLocalAudioFileRecord,
  getLocalAudioCacheFileRecord,
  listCachedLibraryTrackSummaries,
  listLocalAudioCacheFiles,
  listLocalAudioFiles,
  upsertCachedLibraryTrack,
  type CachedLibraryTrackSummaryRecord,
  type LocalPlaylistTrackRecord
} from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";

export const providerPlaybackCacheChangedEvent = "music-room-provider-playback-cache-changed";

/** Download a provider track into the disposable playback cache, never the saved library. */
export async function cacheProviderTrackForPlayback(track: ProviderTrack): Promise<LocalPlaylistTrackRecord> {
  const resolvedTrack = await resolveProviderTrack(track);
  const existingCache = await findReusableProviderPlaybackCache(resolvedTrack);
  if (existingCache) return existingCache;

  const response = resolvedTrack.provider === "netease"
    ? await musicRoomApi.downloadNeteaseTrack(resolvedTrack.providerTrackId)
    : await musicRoomApi.downloadQqMusicTrack(resolvedTrack.providerTrackId);
  const fileHash = await hashAudioBlob(response.blob);
  const mimeType = normalizeLocalAudioMimeType(response.contentType || response.blob.type);
  const lyricPayload = await (resolvedTrack.provider === "netease"
    ? musicRoomApi.getNeteaseLyrics(resolvedTrack.providerTrackId)
    : musicRoomApi.getQqMusicLyrics(resolvedTrack.providerTrackId)
  ).catch(() => null);
  const lyrics = lyricPayload?.plainLyric ?? null;

  await upsertCachedLibraryTrack({
    fileHash,
    title: resolvedTrack.title,
    artist: resolvedTrack.artist,
    album: resolvedTrack.album,
    artworkUrl: resolvedTrack.artworkUrl,
    lyrics,
    provider: resolvedTrack.provider,
    providerTrackId: resolvedTrack.providerTrackId,
    mimeType,
    durationMs: resolvedTrack.durationMs,
    sizeBytes: response.blob.size,
    file: response.blob,
    sourceTrackIds: [],
    sourceRoomIds: [],
    lastSourceTrackId: null,
    lastSourceRoomId: null,
    lastOwnerNickname: null
  });

  const cachedFile = await saveCachedAudioFileToLocalDirectory({
    file: response.blob,
    fileHash,
    title: resolvedTrack.title,
    mimeType,
    provider: resolvedTrack.provider
  });

  return {
    ...toProviderTrackRecord(resolvedTrack),
    id: localPlaylistTrackId(resolvedTrack),
    fileHash,
    fileName: cachedFile?.fileName ?? null,
    sizeBytes: response.blob.size,
    mimeType,
    lyrics,
    availableOffline: false,
    updatedAt: new Date().toISOString()
  };
}

/** Remove one provider playback cache unless it has become a saved local file. */
export async function releaseProviderTrackPlaybackCache(fileHash: string | null | undefined) {
  if (!fileHash) return false;
  const [cached, summary, savedFile, localCacheFile] = await Promise.all([
    getCachedLibraryTrack(fileHash),
    getCachedLibraryTrackSummary(fileHash),
    getLocalAudioFileRecord(fileHash, "saved"),
    getLocalAudioCacheFileRecord(fileHash)
  ]);
  const record = cached ?? summary;
  if (!isDisposableProviderPlaybackCache(record) || savedFile) return false;

  // Queue lifecycle only owns the browser copy. A configured local cache is
  // intentionally retained so the next playback can reuse it.
  if (cached) {
    await deleteCachedLibraryTrackFile(fileHash);
  }
  if (!localCacheFile && (cached || summary)) {
    await deleteCachedLibraryTrack(fileHash);
  }
  if (cached || (!localCacheFile && summary)) {
    notifyProviderPlaybackCacheChanged([fileHash]);
    return true;
  }
  return false;
}

export async function hasProviderTrackPlaybackCache(fileHash: string | null | undefined) {
  if (!fileHash) return false;
  const [browserCache, localCache] = await Promise.all([
    getCachedLibraryTrack(fileHash).catch(() => null),
    getLocalAudioCacheFileRecord(fileHash).catch(() => null)
  ]);
  return Boolean(browserCache || localCache);
}

/** Remove provider playback caches left behind by a previous page session. */
export async function cleanupProviderTrackPlaybackCache() {
  const [summaries, savedFiles, localCacheFiles] = await Promise.all([
    listCachedLibraryTrackSummaries(),
    listLocalAudioFiles("saved"),
    listLocalAudioCacheFiles()
  ]);
  const savedHashes = new Set(savedFiles.map((file) => file.fileHash));
  const localCacheHashes = new Set(localCacheFiles.map((file) => file.fileHash));
  const removable = summaries.filter((summary) =>
    isDisposableProviderPlaybackCache(summary) && !savedHashes.has(summary.fileHash)
  );
  const removedBrowserHashes: string[] = [];

  await Promise.all(removable.map(async (summary) => {
    const browserCache = await getCachedLibraryTrack(summary.fileHash).catch(() => null);
    if (browserCache) {
      await deleteCachedLibraryTrackFile(summary.fileHash);
      removedBrowserHashes.push(summary.fileHash);
    }
    if (!localCacheHashes.has(summary.fileHash)) {
      await deleteCachedLibraryTrack(summary.fileHash);
      if (!browserCache) removedBrowserHashes.push(summary.fileHash);
    }
  }));
  notifyProviderPlaybackCacheChanged(removedBrowserHashes);
  return removedBrowserHashes.length;
}

async function findReusableProviderPlaybackCache(track: ProviderTrack) {
  const summaries = await listCachedLibraryTrackSummaries().catch(() => []);
  const summary = summaries.find((candidate) =>
    candidate.provider === track.provider &&
    candidate.providerTrackId === track.providerTrackId
  );
  if (!summary) return null;

  const [browserCache, localCacheFile] = await Promise.all([
    getCachedLibraryTrack(summary.fileHash).catch(() => null),
    getLocalAudioCacheFileRecord(summary.fileHash).catch(() => null)
  ]);
  if (!browserCache && !localCacheFile) return null;

  return {
    ...toProviderTrackRecord(track),
    id: localPlaylistTrackId(track),
    fileHash: summary.fileHash,
    fileName: localCacheFile?.fileName ?? null,
    sizeBytes: summary.sizeBytes,
    mimeType: summary.mimeType,
    lyrics: summary.lyrics ?? null,
    availableOffline: false,
    updatedAt: summary.cachedAt
  } satisfies LocalPlaylistTrackRecord;
}

function isDisposableProviderPlaybackCache(
  record: Pick<CachedLibraryTrackSummaryRecord, "provider" | "providerTrackId" | "sourceTrackIds" | "sourceRoomIds"> | null | undefined
) {
  return !!record
    && (record.provider === "netease" || record.provider === "qqmusic")
    && !!record.providerTrackId
    && record.sourceTrackIds.length === 0
    && record.sourceRoomIds.length === 0;
}

function notifyProviderPlaybackCacheChanged(fileHashes: string[]) {
  if (typeof window === "undefined" || fileHashes.length === 0) return;
  window.dispatchEvent(new CustomEvent(providerPlaybackCacheChangedEvent, {
    detail: { fileHashes }
  }));
}

async function resolveProviderTrack(track: ProviderTrack): Promise<ProviderTrack> {
  if (track.artworkUrl) return track;
  try {
    return track.provider === "netease"
      ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
      : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
  } catch {
    return track;
  }
}
