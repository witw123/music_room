import {
  musicRoomDatabase,
  type FavoriteProviderAlbumRecord,
  type LocalAudioCacheFileRecord,
  type LocalAudioDirectoryRecord,
  type LocalAudioFileRecord,
  type LocalAudioStorageKind,
  type LocalPlaylistDirectoryRecord,
  type LocalPlaylistTrackRecord
} from "./database";
import { LocalRepository } from "../local-repository";
import { getNativeStorageDirectory, hasNativeStorage } from "../native-storage";
import type { RepositoryDirectoryHandle } from "../directory-handle";

type ActiveDirectory = Omit<LocalAudioDirectoryRecord, "handle"> & { handle: RepositoryDirectoryHandle };
let nativeDirectory: Promise<ActiveDirectory> | null = null;

export async function getLocalAudioDirectory(): Promise<ActiveDirectory | null> {
  if (hasNativeStorage()) {
    nativeDirectory ??= (async () => {
      const directory = await getNativeStorageDirectory();
      const repository = await LocalRepository.initialize(directory.handle);
      const record: LocalAudioDirectoryRecord = {
        id: "default", kind: "native", name: directory.name,
        repositoryId: repository.manifest.repositoryId,
        schemaVersion: repository.manifest.schemaVersion,
        updatedAt: new Date().toISOString()
      };
      const activeRecord = await activateDirectory(record);
      return { ...activeRecord, handle: directory.handle };
    })().catch((error) => {
      nativeDirectory = null;
      throw error;
    });
    return nativeDirectory;
  }
  const existing = await musicRoomDatabase.localAudioDirectory.get("default");
  return existing?.kind === "selected" && existing.handle ? { ...existing, handle: existing.handle } : null;
}

export async function saveLocalAudioDirectory(input: {
  handle: FileSystemDirectoryHandle;
  name: string;
  repositoryId?: string;
  schemaVersion?: number;
}) {
  await activateDirectory({
    id: "default",
    kind: "selected",
    handle: input.handle,
    name: input.name,
    repositoryId: input.repositoryId,
    schemaVersion: input.schemaVersion,
    updatedAt: new Date().toISOString()
  });
}

async function activateDirectory(record: LocalAudioDirectoryRecord) {
  const existing = await musicRoomDatabase.localAudioDirectory.get("default");
  const sameRepository = existing?.repositoryId === record.repositoryId && existing?.kind === record.kind;
  record = { ...record, indexReady: sameRepository && existing?.indexReady === true };
  // These tables are the current repository's working index, not a second root.
  // The old on-disk repository is left untouched.
  const mirrors = [
    musicRoomDatabase.localAudioFiles, musicRoomDatabase.localAudioCacheFiles,
    musicRoomDatabase.cachedTrackLibrary, musicRoomDatabase.cachedTrackLibraryMetadata,
    musicRoomDatabase.assetManifests, musicRoomDatabase.assetUnits,
    musicRoomDatabase.trackAssetLinks, musicRoomDatabase.transcodeJobs,
    musicRoomDatabase.playbackAssetDraftUnits, musicRoomDatabase.localPlaylistTracks
  ];
  await musicRoomDatabase.transaction("rw", [...mirrors, musicRoomDatabase.localAudioDirectory], async () => {
    if (!sameRepository) {
      for (const table of mirrors) await table.clear();
    }
    await musicRoomDatabase.localAudioDirectory.put(record);
  });
  return record;
}

export async function markLocalRepositoryIndexReady(repositoryId: string) {
  const directory = await getLocalAudioDirectory();
  if (directory?.repositoryId !== repositoryId) throw new Error("存储目录已改变，请重新加载。");
  await musicRoomDatabase.localAudioDirectory.update("default", { indexReady: true });
  directory.indexReady = true;
}

export async function getLocalPlaylistDirectory(id: string) {
  return (await musicRoomDatabase.localPlaylistDirectories.get(id)) ?? null;
}

export async function saveLocalPlaylistDirectory(input: Omit<LocalPlaylistDirectoryRecord, "updatedAt"> & {
  updatedAt?: string;
}) {
  await musicRoomDatabase.localPlaylistDirectories.put({
    ...input,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  });
}

export async function deleteLocalPlaylistDirectory(id: string) {
  await musicRoomDatabase.localPlaylistDirectories.delete(id);
}

export async function listLocalAudioFiles(storageKind: LocalAudioStorageKind = "saved") {
  const records = await musicRoomDatabase.localAudioFiles.orderBy("savedAt").reverse().toArray();
  return records.filter((record) => (record.storageKind ?? "saved") === storageKind);
}

export async function listLocalAudioCacheFiles() {
  return musicRoomDatabase.localAudioCacheFiles.orderBy("cachedAt").reverse().toArray();
}

export async function getLocalAudioFileRecord(
  fileHash: string,
  storageKind: LocalAudioStorageKind = "saved"
) {
  const record = await musicRoomDatabase.localAudioFiles.get(fileHash);
  return record && (record.storageKind ?? "saved") === storageKind ? record : null;
}

export async function deleteLocalAudioFileRecord(
  fileHash: string,
  storageKind: LocalAudioStorageKind = "saved"
) {
  const record = await getLocalAudioFileRecord(fileHash, storageKind);
  if (record) {
    await musicRoomDatabase.localAudioFiles.delete(fileHash);
  }
}

export async function getLocalAudioCacheFileRecord(fileHash: string) {
  return (await musicRoomDatabase.localAudioCacheFiles.get(fileHash)) ?? null;
}

export async function saveLocalAudioCacheFileRecord(input: Omit<LocalAudioCacheFileRecord, "cachedAt"> & {
  cachedAt?: string;
}) {
  await musicRoomDatabase.localAudioCacheFiles.put({
    ...input,
    cachedAt: input.cachedAt ?? new Date().toISOString()
  });
}

export async function deleteLocalAudioCacheFileRecord(fileHash: string) {
  await musicRoomDatabase.localAudioCacheFiles.delete(fileHash);
}

export async function applyDirectoryScanIndex(input: {
  repositoryId: string;
  tracks: LocalPlaylistTrackRecord[];
  staleTrackIds: string[];
  staleFileHashes: string[];
}) {
  await musicRoomDatabase.transaction("rw", [
    musicRoomDatabase.localAudioDirectory,
    musicRoomDatabase.localPlaylistTracks,
    musicRoomDatabase.localAudioFiles
  ], async () => {
    const active = await musicRoomDatabase.localAudioDirectory.get("default");
    if (active?.repositoryId !== input.repositoryId) throw new Error("扫描期间根目录已改变。");
    await musicRoomDatabase.localPlaylistTracks.bulkDelete(input.staleTrackIds);
    await musicRoomDatabase.localAudioFiles.bulkDelete(input.staleFileHashes);
    await musicRoomDatabase.localPlaylistTracks.bulkPut(input.tracks);
    await musicRoomDatabase.localAudioFiles.bulkPut(input.tracks.map((track) => ({
      fileHash: track.fileHash!,
      fileName: track.fileName!,
      sizeBytes: track.sizeBytes,
      lastModified: track.lastModified,
      source: "directory-scan" as const,
      storageKind: "saved" as const,
      savedAt: track.updatedAt
    })));
  });
}

export async function upsertLocalPlaylistTrack(
  input: Omit<LocalPlaylistTrackRecord, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  },
  options?: { persistRepository?: boolean }
) {
  const existing = await musicRoomDatabase.localPlaylistTracks.get(input.id);
  const now = new Date().toISOString();
  await musicRoomDatabase.localPlaylistTracks.put({
    ...input,
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  });
  if (options?.persistRepository !== false) {
    const directory = await getLocalAudioDirectory();
    if (directory) {
      await LocalRepository.open(directory.handle, { recover: false })
        .then((repository) => repository.writeProviderTrack(input.id, {
          ...input,
          createdAt: input.createdAt ?? existing?.createdAt ?? now,
          updatedAt: input.updatedAt ?? now
        }))
        .catch(() => undefined);
    }
  }
}

export async function listLocalPlaylistTracks() {
  return musicRoomDatabase.localPlaylistTracks.orderBy("updatedAt").reverse().toArray();
}

export async function deleteLocalPlaylistTrack(id: string) {
  await musicRoomDatabase.localPlaylistTracks.delete(id);
}

export function favoriteProviderAlbumId(
  userId: string,
  provider: FavoriteProviderAlbumRecord["provider"],
  providerAlbumId: string
) {
  return `${userId}:${provider}:${providerAlbumId}`;
}

export async function upsertFavoriteProviderAlbum(
  input: Omit<FavoriteProviderAlbumRecord, "id" | "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  }
) {
  const id = favoriteProviderAlbumId(input.userId, input.provider, input.providerAlbumId);
  const existing = await musicRoomDatabase.favoriteProviderAlbums.get(id);
  const now = new Date().toISOString();
  await musicRoomDatabase.favoriteProviderAlbums.put({
    ...input,
    id,
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  });
}

export async function deleteFavoriteProviderAlbum(
  userId: string,
  provider: FavoriteProviderAlbumRecord["provider"],
  providerAlbumId: string
) {
  await musicRoomDatabase.favoriteProviderAlbums.delete(
    favoriteProviderAlbumId(userId, provider, providerAlbumId)
  );
}

export async function listFavoriteProviderAlbums(userId: string) {
  const records = await musicRoomDatabase.favoriteProviderAlbums
    .where("userId")
    .equals(userId)
    .toArray();
  return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getFavoriteProviderAlbum(
  userId: string,
  provider: FavoriteProviderAlbumRecord["provider"],
  providerAlbumId: string
) {
  return musicRoomDatabase.favoriteProviderAlbums.get(
    favoriteProviderAlbumId(userId, provider, providerAlbumId)
  );
}

export async function saveLocalAudioFileRecord(input: Omit<LocalAudioFileRecord, "savedAt"> & {
  savedAt?: string;
}) {
  await musicRoomDatabase.localAudioFiles.put({
    ...input,
    storageKind: input.storageKind ?? "saved",
    savedAt: input.savedAt ?? new Date().toISOString()
  });
}
