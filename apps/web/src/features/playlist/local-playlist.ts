import { createSHA256 } from "hash-wasm";
import type { NeteaseTrackCandidate, ProviderLyrics, QqMusicTrackCandidate } from "@music-room/shared";
import {
  deleteLocalAudioFileRecord,
  deleteLocalPlaylistTrack,
  listCachedLibraryTrackHashes,
  listCachedLibraryTrackSummaries,
  listLocalAudioCacheFiles,
  listLocalAudioFiles,
  listLocalPlaylistTracks,
  saveLocalAudioFileRecord,
  saveLocalPlaylistDirectory,
  upsertLocalPlaylistTrack,
  type CachedLibraryTrackSummaryRecord,
  type LocalPlaylistTrackRecord
} from "@/lib/indexeddb";
import {
  chooseLocalAudioSourceDirectory,
  listLocalAudioFilesInDirectory,
  listSelectedLocalAudioFiles
} from "@/features/upload/local-audio-storage";
import { readEmbeddedAudioMetadata } from "@/features/upload/audio-metadata";
import { getConfiguredLocalRepository } from "@/features/upload/local-audio-storage";
import {
  createRepositoryTrackRecord,
  type LocalRepositoryPlaylistRecord
} from "@/features/upload/local-repository";

export type ProviderTrack = NeteaseTrackCandidate | QqMusicTrackCandidate;

export type LocalPlaylistRecord = {
  id: string;
  title: string;
  description: string | null;
  trackIds: string[];
  sourceDirectoryId?: string | null;
  sourceDirectoryName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const defaultLocalPlaylistId = "local-default";
const defaultLocalPlaylistTitle = "项目根目录";
const directoryScanSource = "directory-scan" as const;
let localPlaylistPersistencePromise: Promise<void> = Promise.resolve();
let localPlaylists: LocalPlaylistRecord[] = [];

export function listLocalPlaylists(): LocalPlaylistRecord[] {
  return localPlaylists;
}

/** Keep playlist cards stable across repository restores and both playlist views. */
export function sortLocalPlaylists(playlists: readonly LocalPlaylistRecord[]) {
  return [...playlists].sort((left, right) => {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder !== 0) return createdOrder;

    const updatedOrder = left.updatedAt.localeCompare(right.updatedAt);
    if (updatedOrder !== 0) return updatedOrder;
    return left.id.localeCompare(right.id);
  });
}

export function mergeLocalPlaylists(records: LocalPlaylistRecord[]) {
  const byId = new Map(localPlaylists.map((playlist) => [playlist.id, playlist]));
  for (const record of records) {
    if (!byId.has(record.id)) byId.set(record.id, record);
  }
  localPlaylists = sortLocalPlaylists([...byId.values()]);
  return localPlaylists;
}

export async function restoreLocalPlaylistsFromRepository() {
  await flushLocalPlaylistPersistence();
  const repository = await getConfiguredLocalRepository();
  if (!repository) {
    localPlaylists = [];
    return localPlaylists;
  }

  try {
    const persisted = await repository.listPlaylists();
    localPlaylists = sortLocalPlaylists(persisted.map(fromRepositoryPlaylist));
    return localPlaylists;
  } catch {
    localPlaylists = [];
    return localPlaylists;
  }
}

export function ensureDefaultLocalPlaylist(input: {
  trackIds: string[];
  sourceDirectoryName: string | null;
}) {
  const current = listLocalPlaylists().find((playlist) => playlist.id === defaultLocalPlaylistId);
  if (!current) {
    const now = new Date().toISOString();
    const playlist: LocalPlaylistRecord = {
      id: defaultLocalPlaylistId,
      title: defaultLocalPlaylistTitle,
      description: "项目根目录中的本地歌曲",
      trackIds: [...new Set(input.trackIds)],
      sourceDirectoryId: null,
      sourceDirectoryName: input.sourceDirectoryName,
      createdAt: now,
      updatedAt: now
    };
    writeLocalPlaylists([...listLocalPlaylists(), playlist]);
    return sortLocalPlaylists(listLocalPlaylists());
  }

  const nextTrackIds = [...new Set(input.trackIds)];
  const nextTrackIdSet = new Set(nextTrackIds);
  // Keep the user's established order stable; only append files that appeared since the last scan.
  const orderedTrackIds = [
    ...current.trackIds.filter((trackId) => nextTrackIdSet.has(trackId)),
    ...nextTrackIds.filter((trackId) => !current.trackIds.includes(trackId))
  ];
  const tracksChanged = !sameStringArray(current.trackIds, orderedTrackIds);
  const sourceChanged = current.sourceDirectoryName !== input.sourceDirectoryName;
  const updated: LocalPlaylistRecord = {
    ...current,
    sourceDirectoryId: null,
    trackIds: orderedTrackIds,
    sourceDirectoryName: input.sourceDirectoryName,
    updatedAt: tracksChanged || sourceChanged
      ? new Date().toISOString()
      : current.updatedAt
  };
  if (tracksChanged || sourceChanged) {
    writeLocalPlaylists(listLocalPlaylists().map((playlist) => playlist.id === current.id ? updated : playlist));
  }
  return sortLocalPlaylists(listLocalPlaylists());
}

export function getDefaultLocalPlaylistTrackIds(
  tracks: readonly LocalPlaylistTrackRecord[],
  savedFileHashes: ReadonlySet<string>
) {
  return tracks
    .filter((track) =>
      track.availableOffline &&
      !!track.fileHash &&
      !track.sourceDirectoryId &&
      savedFileHashes.has(track.fileHash)
    )
    .map((track) => track.id);
}

export async function flushLocalPlaylistPersistence() {
  await localPlaylistPersistencePromise.catch(() => undefined);
}

export function createLocalPlaylist(input: {
  title: string;
  description?: string | null;
  trackIds?: string[];
  sourceDirectoryId?: string | null;
  sourceDirectoryName?: string | null;
}) {
  const now = new Date().toISOString();
  const playlist: LocalPlaylistRecord = {
    id: createLocalPlaylistId(),
    title: input.title.trim(),
    description: input.description?.trim() || null,
    trackIds: [...new Set(input.trackIds ?? [])],
    sourceDirectoryId: input.sourceDirectoryId ?? null,
    sourceDirectoryName: input.sourceDirectoryName ?? null,
    createdAt: now,
    updatedAt: now
  };
  writeLocalPlaylists([...listLocalPlaylists(), playlist]);
  return playlist;
}

export function deleteLocalPlaylist(playlistId: string) {
  writeLocalPlaylists(listLocalPlaylists().filter((playlist) => playlist.id !== playlistId));
}

export function updateLocalPlaylist(playlistId: string, input: {
  trackIds?: string[];
  title?: string;
  description?: string | null;
  sourceDirectoryId?: string | null;
  sourceDirectoryName?: string | null;
}) {
  const current = listLocalPlaylists().find((playlist) => playlist.id === playlistId);
  if (!current) return null;
  const updated: LocalPlaylistRecord = {
    ...current,
    title: input.title?.trim() || current.title,
    description: input.description === undefined ? current.description : input.description?.trim() || null,
    trackIds: input.trackIds ?? current.trackIds,
    sourceDirectoryId: input.sourceDirectoryId === undefined
      ? current.sourceDirectoryId ?? null
      : input.sourceDirectoryId,
    sourceDirectoryName: input.sourceDirectoryName === undefined
      ? current.sourceDirectoryName ?? null
      : input.sourceDirectoryName,
    updatedAt: new Date().toISOString()
  };
  writeLocalPlaylists(listLocalPlaylists().map((playlist) => playlist.id === playlistId ? updated : playlist));
  return updated;
}

export async function hashAudioBlob(blob: Blob) {
  const hasher = await createSHA256();
  hasher.init();
  const chunkSize = 4 * 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    hasher.update(new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer()));
  }
  return hasher.digest("hex");
}

export function localPlaylistTrackId(track: ProviderTrack) {
  return providerTrackKey(track.provider, track.providerTrackId);
}

export function providerTrackKey(provider: ProviderTrack["provider"], providerTrackId: string) {
  return `provider:${provider}:${providerTrackId}`;
}

export function toLocalPlaylistTrackInput(input: {
  track: ProviderTrack;
  lyrics?: ProviderLyrics | null;
  fileHash?: string | null;
  fileName?: string | null;
  sizeBytes?: number;
  mimeType?: string;
  availableOffline?: boolean;
}) {
  const { track, lyrics } = input;
  return {
    id: localPlaylistTrackId(track),
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    mimeType: input.mimeType ?? "audio/mpeg",
    sizeBytes: input.sizeBytes ?? 0,
    artworkUrl: track.artworkUrl,
    lyrics: lyrics?.plainLyric ?? null,
    provider: track.provider,
    providerTrackId: track.providerTrackId,
    fileHash: input.fileHash ?? null,
    fileName: input.fileName ?? null,
    availableOffline: input.availableOffline ?? false
  } satisfies Omit<LocalPlaylistTrackRecord, "createdAt" | "updatedAt">;
}

export function toProviderTrackRecord(
  track: ProviderTrack,
  existing?: LocalPlaylistTrackRecord
): LocalPlaylistTrackRecord {
  const now = new Date().toISOString();
  const metadata = toLocalPlaylistTrackInput({ track, availableOffline: false });
  return {
    ...(existing ?? metadata),
    id: metadata.id,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    durationMs: metadata.durationMs,
    artworkUrl: track.artworkUrl ?? existing?.artworkUrl ?? null,
    provider: metadata.provider,
    providerTrackId: metadata.providerTrackId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

export function toCachedProviderTrack(record: LocalPlaylistTrackRecord): ProviderTrack | null {
  if ((record.provider !== "netease" && record.provider !== "qqmusic") || !record.providerTrackId) {
    return null;
  }

  return {
    provider: record.provider,
    providerTrackId: record.providerTrackId,
    access: "unknown",
    quality: null,
    title: record.title,
    artist: record.artist,
    album: record.album,
    durationMs: record.durationMs,
    artworkUrl: record.artworkUrl
  };
}

export async function listMergedLocalPlaylistTracks() {
  const [explicit, summaries, cachedFileHashes, savedFiles, cacheFiles] = await Promise.all([
    listLocalPlaylistTracks(),
    listCachedLibraryTrackSummaries(),
    listCachedLibraryTrackHashes(),
    listLocalAudioFiles("saved"),
    listLocalAudioCacheFiles()
  ]);
  const fileNames = new Map<string, string>();
  for (const file of [...savedFiles, ...cacheFiles]) {
    fileNames.set(file.fileHash, file.fileName);
  }
  const availableHashes = new Set([
    ...fileNames.keys(),
    ...cachedFileHashes
  ]);
  const reconciledExplicit = explicit.map((track) => reconcileTrackAvailability(track, fileNames, availableHashes));
  const explicitByHash = new Set(reconciledExplicit.map((track) => track.fileHash).filter(Boolean));

  const derived = summaries
    .filter((summary) => availableHashes.has(summary.fileHash) && !explicitByHash.has(summary.fileHash))
    .map((summary) => fromCachedSummary(summary, fileNames.get(summary.fileHash) ?? null, true));
  return [...reconciledExplicit, ...derived];
}

export async function syncSelectedLocalDirectoryTracks() {
  const selectedFiles = await listSelectedLocalAudioFiles();
  if (!selectedFiles) return 0;

  const [existingTracks, existingFiles] = await Promise.all([
    listLocalPlaylistTracks(),
    listLocalAudioFiles("saved")
  ]);
  const existingByHash = new Map(
    existingTracks
      .filter((track) => !!track.fileHash)
      .map((track) => [track.fileHash!, track])
  );
  const scanTimestamp = Date.now();

  const scannedTracks = await Promise.all(
    selectedFiles.map(async ({ file, fileName }, index) => {
      const fileHash = await hashAudioBlob(file);
      const metadata = await readDirectoryTrackMetadata(file);
      const existing = existingByHash.get(fileHash);
      // IndexedDB returns tracks by updatedAt descending, so earlier scan entries get later timestamps.
      const now = existing?.updatedAt ?? new Date(scanTimestamp - index).toISOString();
      return {
        track: {
          id: `local-file:${fileHash}`,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          durationMs: metadata.durationMs,
          mimeType: file.type || inferAudioMimeType(file.name),
          sizeBytes: file.size,
          artworkUrl: metadata.artworkUrl,
          lyrics: metadata.lyrics,
          provider: "local_upload" as const,
          providerTrackId: null,
          fileHash,
          fileName,
          availableOffline: true,
          source: directoryScanSource,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        } satisfies LocalPlaylistTrackRecord,
        fileHash,
        fileName
      };
    })
  );

  const currentHashes = new Set(scannedTracks.map((item) => item.fileHash));
  const staleTracks = existingTracks.filter((track) =>
    track.source === directoryScanSource && !!track.fileHash && !currentHashes.has(track.fileHash)
  );
  const staleFiles = existingFiles.filter((file) =>
    file.source === directoryScanSource && !currentHashes.has(file.fileHash)
  );

  await Promise.all([
    ...staleTracks.map((track) => deleteLocalPlaylistTrack(track.id)),
    ...staleFiles.map((file) => deleteLocalAudioFileRecord(file.fileHash, "saved"))
  ]);
  await Promise.all(
    scannedTracks.flatMap(({ track, fileHash, fileName }) => [
      upsertLocalPlaylistTrack(track),
      saveLocalAudioFileRecord({
        fileHash,
        fileName,
        storageKind: "saved",
        source: directoryScanSource
      })
    ])
  );

  const repository = await getConfiguredLocalRepository();
  if (repository) {
    for (const { track, fileName } of scannedTracks) {
      await repository.writeTrack(createRepositoryTrackRecord({
        fileHash: track.fileHash!,
        title: track.title,
        artist: track.artist,
        album: track.album,
        artworkUrl: track.artworkUrl,
        lyrics: track.lyrics,
        provider: track.provider,
        mimeType: track.mimeType,
        durationMs: track.durationMs,
        sizeBytes: track.sizeBytes,
        source: {
          kind: "external",
          relativePath: fileName,
          sizeBytes: track.sizeBytes
        },
        retention: "library"
      }));
    }
  }

  return scannedTracks.length;
}

export async function importLocalPlaylistDirectoryTracks(existingSourceDirectoryId?: string | null) {
  const directory = await chooseLocalAudioSourceDirectory();
  const selectedFiles = await listLocalAudioFilesInDirectory(directory);
  if (!selectedFiles) {
    throw new Error("无法读取所选本地目录，请重新授权后重试。 ");
  }

  const sourceDirectoryId = existingSourceDirectoryId || createLocalPlaylistSourceId();
  await saveLocalPlaylistDirectory({
    id: sourceDirectoryId,
    handle: directory,
    name: directory.name
  });

  const selectedFilesWithHashes = await Promise.all(
    selectedFiles.map(async (entry) => ({
      ...entry,
      fileHash: await hashAudioBlob(entry.file)
    }))
  );
  const currentHashes = new Set(selectedFilesWithHashes.map((entry) => entry.fileHash));
  const [existingTracks, existingFiles] = await Promise.all([
    listLocalPlaylistTracks(),
    listLocalAudioFiles("saved")
  ]);
  const staleFileHashes = new Set(
    existingFiles
      .filter((file) =>
        file.sourceDirectoryId === sourceDirectoryId &&
        !currentHashes.has(file.fileHash)
      )
      .map((file) => file.fileHash)
  );
  const sharedStaleFileHashes = new Set(
    existingTracks
      .filter((track) =>
        !!track.fileHash &&
        staleFileHashes.has(track.fileHash) &&
        track.sourceDirectoryId !== sourceDirectoryId
      )
      .map((track) => track.fileHash!)
  );
  await Promise.all([
    ...existingTracks
      .filter((track) =>
        track.sourceDirectoryId === sourceDirectoryId &&
        !!track.fileHash &&
        !currentHashes.has(track.fileHash)
      )
      .map((track) => deleteLocalPlaylistTrack(track.id)),
    ...existingFiles
      .filter((file) =>
        file.sourceDirectoryId === sourceDirectoryId &&
        !currentHashes.has(file.fileHash) &&
        !sharedStaleFileHashes.has(file.fileHash)
      )
      .map((file) => deleteLocalAudioFileRecord(file.fileHash, "saved"))
  ]);

  const importedTracks: LocalPlaylistTrackRecord[] = [];
  for (const { file, fileName, fileHash } of selectedFilesWithHashes) {
    const metadata = await readDirectoryTrackMetadata(file);
    const mimeType = file.type || inferAudioMimeType(file.name);
    const now = new Date().toISOString();
    const track: LocalPlaylistTrackRecord = {
      id: `local-file:${sourceDirectoryId}:${fileHash}`,
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      durationMs: metadata.durationMs,
      mimeType,
      sizeBytes: file.size,
      artworkUrl: metadata.artworkUrl,
      lyrics: metadata.lyrics,
      provider: "local_upload",
      providerTrackId: null,
      fileHash,
      fileName,
      sourceDirectoryId,
      availableOffline: true,
      createdAt: now,
      updatedAt: now
    };
    await saveLocalAudioFileRecord({
      fileHash,
      fileName,
      storageKind: "saved",
      sourceDirectoryId
    });
    await upsertLocalPlaylistTrack(track);
    importedTracks.push(track);
  }
  return {
    sourceDirectoryId,
    directoryName: directory.name,
    tracks: importedTracks
  };
}

export async function listRoomPlaylistTrackIndex() {
  const [explicit, summaries, cachedFileHashes, savedFiles, cacheFiles] = await Promise.all([
    listLocalPlaylistTracks(),
    listCachedLibraryTrackSummaries(),
    listCachedLibraryTrackHashes(),
    listLocalAudioFiles("saved"),
    listLocalAudioCacheFiles()
  ]);
  const fileNames = new Map<string, string>();
  for (const file of [...savedFiles, ...cacheFiles]) {
    fileNames.set(file.fileHash, file.fileName);
  }
  const availableHashes = new Set([
    ...fileNames.keys(),
    ...cachedFileHashes
  ]);

  const byTrackId = new Map<string, LocalPlaylistTrackRecord>();
  for (const track of explicit.map((item) => reconcileTrackAvailability(item, fileNames, availableHashes))) {
    byTrackId.set(track.id, track);
  }
  for (const summary of summaries) {
    const record = fromCachedSummary(
      summary,
      fileNames.get(summary.fileHash) ?? null,
      availableHashes.has(summary.fileHash)
    );
    for (const trackId of summary.sourceTrackIds) {
      if (!byTrackId.has(trackId)) {
        byTrackId.set(trackId, record);
      }
    }
  }
  return byTrackId;
}

function reconcileTrackAvailability(
  track: LocalPlaylistTrackRecord,
  fileNames: ReadonlyMap<string, string>,
  availableHashes: ReadonlySet<string>
) {
  if (!track.fileHash) {
    return track.availableOffline ? { ...track, availableOffline: false } : track;
  }

  const hasAvailableFile = availableHashes.has(track.fileHash);
  return {
    ...track,
    fileName: hasAvailableFile ? fileNames.get(track.fileHash) ?? track.fileName : null,
    availableOffline: hasAvailableFile
  };
}

function fromCachedSummary(
  summary: CachedLibraryTrackSummaryRecord,
  fileName: string | null,
  availableOffline: boolean
): LocalPlaylistTrackRecord {
  return {
    id: `local:${summary.fileHash}`,
    title: summary.title,
    artist: summary.artist,
    album: summary.album ?? null,
    durationMs: summary.durationMs,
    mimeType: summary.mimeType,
    sizeBytes: summary.sizeBytes,
    artworkUrl: summary.artworkUrl ?? null,
    lyrics: summary.lyrics ?? null,
    provider: summary.provider ?? "local_upload",
    providerTrackId: summary.providerTrackId ?? null,
    fileHash: summary.fileHash,
    fileName,
    availableOffline,
    createdAt: summary.cachedAt,
    updatedAt: summary.cachedAt
  };
}

async function readDirectoryTrackMetadata(file: File) {
  const fallback = {
    title: file.name.replace(/\.[^/.]+$/, ""),
    artist: "本地歌曲",
    album: null as string | null,
    durationMs: 0,
    artworkUrl: null as string | null,
    lyrics: null as string | null
  };

  const metadata = await readEmbeddedAudioMetadata(file);
  return {
    title: metadata.title ?? fallback.title,
    artist: metadata.artist ?? fallback.artist,
    album: metadata.album ?? fallback.album,
    durationMs: metadata.durationMs ?? fallback.durationMs,
    artworkUrl: metadata.artworkUrl ?? fallback.artworkUrl,
    lyrics: metadata.lyrics ?? fallback.lyrics
  };
}

function inferAudioMimeType(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "flac") return "audio/flac";
  if (extension === "wav") return "audio/wav";
  if (extension === "m4a" || extension === "aac") return "audio/mp4";
  if (extension === "ogg" || extension === "opus") return "audio/ogg";
  return "audio/mpeg";
}

function createLocalPlaylistId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `local-playlist-${randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function createLocalPlaylistSourceId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `local-playlist-source-${randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function writeLocalPlaylists(playlists: LocalPlaylistRecord[]) {
  const nextPlaylists = sortLocalPlaylists(playlists);
  localPlaylists = nextPlaylists;
  localPlaylistPersistencePromise = localPlaylistPersistencePromise
    .catch(() => undefined)
    .then(() => mirrorLocalPlaylistsToRepository(nextPlaylists))
    .catch(() => undefined);
}

async function mirrorLocalPlaylistsToRepository(playlists: LocalPlaylistRecord[]) {
  const repository = await getConfiguredLocalRepository();
  if (!repository) return;
  const activeIds = new Set(playlists.map((playlist) => playlist.id));
  const persisted = await repository.listPlaylists();
  for (const playlist of persisted) {
    if (!activeIds.has(playlist.id)) {
      await repository.deletePlaylist(playlist.id);
    }
  }
  for (const playlist of playlists) {
    await repository.writePlaylist(toRepositoryPlaylist(playlist));
  }
}

function toRepositoryPlaylist(playlist: LocalPlaylistRecord): LocalRepositoryPlaylistRecord {
  return {
    schemaVersion: 1,
    id: playlist.id,
    title: playlist.title,
    description: playlist.description,
    sourceDirectoryId: playlist.sourceDirectoryId ?? null,
    sourceDirectoryName: playlist.sourceDirectoryName ?? null,
    trackRefs: playlist.trackIds.map((trackId) => {
      const providerMatch = /^provider:(netease|qqmusic):(.+)$/.exec(trackId);
      if (providerMatch) {
        return {
          kind: "provider" as const,
          provider: providerMatch[1] as "netease" | "qqmusic",
          trackId: providerMatch[2]!
        };
      }
      return {
        kind: "content" as const,
        fileHash: trackId.startsWith("local:") ? trackId.slice("local:".length) : trackId,
        trackId
      };
    }),
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt
  };
}

function fromRepositoryPlaylist(record: LocalRepositoryPlaylistRecord): LocalPlaylistRecord {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    sourceDirectoryId: record.sourceDirectoryId ?? null,
    sourceDirectoryName: record.sourceDirectoryName ?? null,
    trackIds: record.trackRefs.map((trackRef) =>
      trackRef.kind === "provider"
        ? providerTrackKey(trackRef.provider, trackRef.trackId)
        : trackRef.trackId ?? `local:${trackRef.fileHash}`
    ),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
