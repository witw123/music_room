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
  upsertLocalPlaylistTrack,
  type CachedLibraryTrackSummaryRecord,
  type LocalPlaylistTrackRecord
} from "@/lib/indexeddb";
import { listSelectedLocalAudioFiles } from "@/features/upload/local-audio-storage";
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
  createdAt: string;
  updatedAt: string;
};

const removedDefaultLocalPlaylistId = "local-default";
const directoryScanSource = "directory-scan" as const;
let localPlaylistPersistencePromise: Promise<void> = Promise.resolve();
let localPlaylists: LocalPlaylistRecord[] = [];

export function listLocalPlaylists(): LocalPlaylistRecord[] {
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
    const removedDefault = persisted.find((playlist) => playlist.id === removedDefaultLocalPlaylistId);
    if (removedDefault) {
      await repository.deletePlaylist(removedDefault.id);
    }
    localPlaylists = persisted
      .filter((playlist) => playlist.id !== removedDefaultLocalPlaylistId)
      .map(fromRepositoryPlaylist);
    return localPlaylists;
  } catch {
    localPlaylists = [];
    return localPlaylists;
  }
}

export async function flushLocalPlaylistPersistence() {
  await localPlaylistPersistencePromise.catch(() => undefined);
}

export function createLocalPlaylist(input: {
  title: string;
  description?: string | null;
  trackIds?: string[];
}) {
  const now = new Date().toISOString();
  const playlist: LocalPlaylistRecord = {
    id: createLocalPlaylistId(),
    title: input.title.trim(),
    description: input.description?.trim() || null,
    trackIds: [...new Set(input.trackIds ?? [])],
    createdAt: now,
    updatedAt: now
  };
  writeLocalPlaylists([...listLocalPlaylists(), playlist]);
  return playlist;
}

export function deleteLocalPlaylist(playlistId: string) {
  writeLocalPlaylists(listLocalPlaylists().filter((playlist) => playlist.id !== playlistId));
}

export function updateLocalPlaylist(playlistId: string, input: { trackIds?: string[]; title?: string; description?: string | null }) {
  const current = listLocalPlaylists().find((playlist) => playlist.id === playlistId);
  if (!current) return null;
  const updated: LocalPlaylistRecord = {
    ...current,
    title: input.title?.trim() || current.title,
    description: input.description === undefined ? current.description : input.description?.trim() || null,
    trackIds: input.trackIds ?? current.trackIds,
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

  const scannedTracks = await Promise.all(
    selectedFiles.map(async ({ file, fileName }) => {
      const fileHash = await hashAudioBlob(file);
      const metadata = await readDirectoryTrackMetadata(file);
      const now = new Date().toISOString();
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
          createdAt: now,
          updatedAt: now
        } satisfies LocalPlaylistTrackRecord,
        fileHash,
        fileName
      };
    })
  );

  const currentHashes = new Set(scannedTracks.map((item) => item.fileHash));
  const [existingTracks, existingFiles] = await Promise.all([
    listLocalPlaylistTracks(),
    listLocalAudioFiles("saved")
  ]);
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

function writeLocalPlaylists(playlists: LocalPlaylistRecord[]) {
  const nextPlaylists = playlists.filter((playlist) => playlist.id !== removedDefaultLocalPlaylistId);
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
    trackIds: record.trackRefs.map((trackRef) =>
      trackRef.kind === "provider"
        ? providerTrackKey(trackRef.provider, trackRef.trackId)
        : trackRef.trackId ?? `local:${trackRef.fileHash}`
    ),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}
