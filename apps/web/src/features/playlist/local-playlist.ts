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
  isAggregate?: boolean;
  createdAt: string;
  updatedAt: string;
};

const localPlaylistsStorageKey = "music-room-local-playlists";
const defaultLocalPlaylistId = "local-default";
const directoryScanSource = "directory-scan" as const;

export function listLocalPlaylists(): LocalPlaylistRecord[] {
  const fallback = [createDefaultLocalPlaylist()];
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(localPlaylistsStorageKey);
    if (!raw) {
      writeLocalPlaylists(fallback);
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const records = parsed.filter(isLocalPlaylistRecord);
    return records;
  } catch {
    return fallback;
  }
}

export async function restoreLocalPlaylistsFromRepository() {
  const repository = await getConfiguredLocalRepository();
  if (!repository) return listLocalPlaylists();

  const persisted = await repository.listPlaylists();
  if (persisted.length > 0) {
    const playlists = persisted.map(fromRepositoryPlaylist);
    writeLocalPlaylistsToBrowser(playlists);
    return playlists;
  }

  const existing = listLocalPlaylists();
  await Promise.all(existing.map((playlist) =>
    repository.writePlaylist(toRepositoryPlaylist(playlist))
  ));
  return existing;
}

export function createLocalPlaylist(input: { title: string; description?: string | null }) {
  const now = new Date().toISOString();
  const playlist: LocalPlaylistRecord = {
    id: createLocalPlaylistId(),
    title: input.title.trim(),
    description: input.description?.trim() || null,
    trackIds: [],
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
    isAggregate: input.trackIds === undefined ? current.isAggregate : false,
    updatedAt: new Date().toISOString()
  };
  writeLocalPlaylists(listLocalPlaylists().map((playlist) => playlist.id === playlistId ? updated : playlist));
  return updated;
}

export function isDefaultLocalPlaylist(playlist: LocalPlaylistRecord) {
  return playlist.id === defaultLocalPlaylistId;
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
          artworkUrl: null,
          lyrics: null,
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
    await Promise.all(scannedTracks.map(({ track, fileName }) =>
      repository.writeTrack(createRepositoryTrackRecord({
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
      }))
    ));
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

function createDefaultLocalPlaylist(): LocalPlaylistRecord {
  const timestamp = new Date(0).toISOString();
  return {
    id: defaultLocalPlaylistId,
    title: "本地歌单",
    description: "本地目录中保存的歌曲",
    trackIds: [],
    isAggregate: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function readDirectoryTrackMetadata(file: File) {
  const fallback = {
    title: file.name.replace(/\.[^/.]+$/, ""),
    artist: "本地歌曲",
    album: null as string | null,
    durationMs: 0
  };

  try {
    const { parseBlob } = await import("music-metadata");
    const metadata = await parseBlob(file, { duration: true, skipCovers: true });
    return {
      title: metadata.common.title?.trim() || fallback.title,
      artist: metadata.common.artist?.trim()
        || metadata.common.artists?.join(" / ").trim()
        || fallback.artist,
      album: metadata.common.album?.trim() || fallback.album,
      durationMs: Number.isFinite(metadata.format.duration)
        ? Math.round((metadata.format.duration ?? 0) * 1_000)
        : fallback.durationMs
    };
  } catch {
    return fallback;
  }
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

function isLocalPlaylistRecord(value: unknown): value is LocalPlaylistRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LocalPlaylistRecord>;
  return typeof item.id === "string"
    && typeof item.title === "string"
    && (typeof item.description === "string" || item.description === null)
    && Array.isArray(item.trackIds)
    && item.trackIds.every((trackId) => typeof trackId === "string")
    && (item.isAggregate === undefined || typeof item.isAggregate === "boolean")
    && typeof item.createdAt === "string"
    && typeof item.updatedAt === "string";
}

function writeLocalPlaylists(playlists: LocalPlaylistRecord[]) {
  writeLocalPlaylistsToBrowser(playlists);
  void mirrorLocalPlaylistsToRepository(playlists);
}

function writeLocalPlaylistsToBrowser(playlists: LocalPlaylistRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(localPlaylistsStorageKey, JSON.stringify(playlists));
  } catch {
    // Private browsing or storage quotas can reject local metadata writes.
  }
}

async function mirrorLocalPlaylistsToRepository(playlists: LocalPlaylistRecord[]) {
  const repository = await getConfiguredLocalRepository();
  if (!repository) return;
  const activeIds = new Set(playlists.map((playlist) => playlist.id));
  const persisted = await repository.listPlaylists();
  await Promise.all(
    persisted
      .filter((playlist) => !activeIds.has(playlist.id))
      .map((playlist) => repository.deletePlaylist(playlist.id))
  );
  await Promise.all(playlists.map((playlist) =>
    repository.writePlaylist(toRepositoryPlaylist(playlist))
  ));
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
