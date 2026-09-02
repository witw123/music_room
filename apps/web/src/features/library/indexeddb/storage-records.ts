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

export async function getLocalAudioDirectory(): Promise<LocalAudioDirectoryRecord | null> {
  const existing = await musicRoomDatabase.localAudioDirectory.get("default");
  if (existing) {
    return existing;
  }

  if (typeof navigator !== "undefined" && navigator.storage && typeof navigator.storage.getDirectory === "function") {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const appDir = await opfsRoot.getDirectoryHandle("music_room", { create: true });
      const record: LocalAudioDirectoryRecord = {
        id: "default",
        handle: appDir,
        name: "应用安装数据目录 (自动创建)",
        updatedAt: new Date().toISOString()
      };
      await musicRoomDatabase.localAudioDirectory.put(record);
      return record;
    } catch {
      return null;
    }
  }

  return null;
}

export async function saveLocalAudioDirectory(input: {
  handle: FileSystemDirectoryHandle;
  name: string;
  repositoryId?: string;
  schemaVersion?: number;
}) {
  await musicRoomDatabase.localAudioDirectory.put({
    id: "default",
    handle: input.handle,
    name: input.name,
    repositoryId: input.repositoryId,
    schemaVersion: input.schemaVersion,
    updatedAt: new Date().toISOString()
  });
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
    const directory = await musicRoomDatabase.localAudioDirectory.get("default");
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

