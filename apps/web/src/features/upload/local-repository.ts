"use client";

import type {
  AssetUnitDescriptor,
  OriginalAssetManifest,
  PlaybackAssetManifest
} from "@music-room/shared";

export const localRepositoryDirectoryName = ".music-room";
export const localRepositoryFormat = "music-room-local-repository" as const;
export const localRepositorySchemaVersion = 1 as const;

const repositoryManifestFileName = "repository.json";
const repositoryDirectories = [
  "catalog/tracks",
  "catalog/provider-tracks",
  "catalog/playlists",
  "library/sources",
  "library/artwork",
  "library/lyrics",
  "assets/original",
  "assets/playback",
  "cache/provider",
  "cache/artwork",
  "cache/previews",
  "jobs",
  "tmp",
  "trash"
] as const;
const playbackWriteConcurrency = 4;

export type LocalRepositoryManifest = {
  format: typeof localRepositoryFormat;
  schemaVersion: typeof localRepositorySchemaVersion;
  repositoryId: string;
  hashAlgorithm: "sha256";
  playbackProfiles: Record<string, {
    encoderVersion: string;
    segmentDurationMs: number;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type LocalRepositoryTrackRecord = {
  schemaVersion: 1;
  fileHash: string;
  title: string;
  artist: string;
  album?: string | null;
  artworkUrl?: string | null;
  lyrics?: string | null;
  durationMs: number;
  mimeType: string;
  sizeBytes: number;
  sourceType?: "netease" | "qqmusic" | "local_upload";
  sourceRef?: { provider: "netease" | "qqmusic"; trackId: string } | null;
  source: {
    kind: "managed" | "external";
    relativePath: string;
    sizeBytes?: number;
    lastModified?: number;
  };
  originalAsset?: {
    assetId: string;
    manifestPath: string;
  } | null;
  playbackAsset?: {
    assetId: string;
    profileId: string;
    manifestPath: string;
  } | null;
  artworkPath?: string | null;
  lyricsPath?: string | null;
  retention: "library" | "cache";
  createdAt: string;
  updatedAt: string;
};

export type LocalRepositoryPlaylistRecord = {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string | null;
  sourceDirectoryId?: string | null;
  sourceDirectoryName?: string | null;
  trackRefs: Array<
    | { kind: "content"; fileHash: string; trackId?: string }
    | { kind: "provider"; provider: "netease" | "qqmusic"; trackId: string }
  >;
  createdAt: string;
  updatedAt: string;
};

type LocalRepositoryPlaybackUnit = {
  descriptor: AssetUnitDescriptor;
  relativePath: string;
};

type LocalRepositoryPlaybackManifest = {
  storageSchemaVersion: 1;
  manifest: PlaybackAssetManifest;
  units: LocalRepositoryPlaybackUnit[];
};

type LocalRepositoryOriginalManifest = {
  storageSchemaVersion: 1;
  manifest: OriginalAssetManifest;
  sourcePath: string;
};

type DirectoryHandleWithValues = FileSystemDirectoryHandle & {
  values?: () => AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

export class LocalRepository {
  private constructor(
    public readonly root: FileSystemDirectoryHandle,
    public readonly dataDirectory: FileSystemDirectoryHandle,
    public readonly manifest: LocalRepositoryManifest
  ) {}

  static async open(root: FileSystemDirectoryHandle) {
    const dataDirectory = await root.getDirectoryHandle(localRepositoryDirectoryName, {
      create: true
    });
    for (const directory of repositoryDirectories) {
      await getDirectoryByPath(dataDirectory, directory, true);
    }

    const existing = await readJsonFile<LocalRepositoryManifest>(
      dataDirectory,
      repositoryManifestFileName
    );
    const manifest = existing ?? createRepositoryManifest();
    validateRepositoryManifest(manifest);
    if (!existing) {
      await writeJsonFile(dataDirectory, repositoryManifestFileName, manifest);
    }
    return new LocalRepository(root, dataDirectory, manifest);
  }

  async touch() {
    this.manifest.updatedAt = new Date().toISOString();
    await writeJsonFile(this.dataDirectory, repositoryManifestFileName, this.manifest);
  }

  async writeManagedSource(input: {
    file: Blob;
    fileHash: string;
    mimeType: string;
  }) {
    const relativePath = this.getManagedSourcePath(input);
    await this.writeBlob(relativePath, input.file);
    return relativePath;
  }

  getManagedSourcePath(input: { fileHash: string; mimeType: string }) {
    const extension = inferFileExtension(input.mimeType);
    return `${localRepositoryDirectoryName}/library/sources/${input.fileHash.slice(0, 2)}/${input.fileHash}${extension ? `.${extension}` : ""}`;
  }

  async writeCachedSource(input: {
    file: Blob;
    fileHash: string;
    mimeType: string;
  }, options?: { reuseExisting?: boolean }) {
    const relativePath = this.getCachedSourcePath(input);
    if (options?.reuseExisting && await getFileByPath(this.root, relativePath, false)) {
      return relativePath;
    }
    await this.writeBlob(relativePath, input.file);
    return relativePath;
  }

  getCachedSourcePath(input: { fileHash: string; mimeType: string }) {
    const extension = inferFileExtension(input.mimeType);
    return `${localRepositoryDirectoryName}/cache/provider/local_upload/${input.fileHash.slice(0, 2)}/${input.fileHash}${extension ? `.${extension}` : ""}`;
  }

  async readPath(relativePath: string) {
    const fileHandle = await getFileByPath(this.root, relativePath, false);
    return fileHandle ? fileHandle.getFile() : null;
  }

  async removePath(relativePath: string) {
    const parts = splitSafePath(relativePath);
    const fileName = parts.pop();
    if (!fileName) return;
    const directory = await getDirectoryByParts(this.root, parts, false);
    if (!directory) return;
    try {
      await directory.removeEntry(fileName);
    } catch (error) {
      if ((error as DOMException).name !== "NotFoundError") throw error;
    }
  }

  async removeDirectory(relativePath: string) {
    const parts = splitSafePath(relativePath);
    const directoryName = parts.pop();
    if (!directoryName) return;
    const parent = await getDirectoryByParts(this.root, parts, false);
    if (!parent) return;
    try {
      await parent.removeEntry(directoryName, { recursive: true });
    } catch (error) {
      if ((error as DOMException).name !== "NotFoundError") throw error;
    }
  }

  async deleteOriginalAsset(assetId: string) {
    await this.removeDirectory(`${localRepositoryDirectoryName}/assets/original/${assetId}`);
    await this.touch();
  }

  async writeTrack(record: LocalRepositoryTrackRecord) {
    await this.writeJson(
      `${localRepositoryDirectoryName}/catalog/tracks/${record.fileHash}.json`,
      record
    );
    await this.writeCatalogIndex();
    await this.touch();
  }

  async readTrack(fileHash: string) {
    return this.readJson<LocalRepositoryTrackRecord>(
      `${localRepositoryDirectoryName}/catalog/tracks/${fileHash}.json`
    );
  }

  async deleteTrack(fileHash: string) {
    await this.removePath(`${localRepositoryDirectoryName}/catalog/tracks/${fileHash}.json`);
    await this.writeCatalogIndex();
    await this.touch();
  }

  async listTracks() {
    return this.listJsonFiles<LocalRepositoryTrackRecord>(
      `${localRepositoryDirectoryName}/catalog/tracks`
    );
  }

  async writeProviderTrack(id: string, record: unknown) {
    await this.writeJson(
      `${localRepositoryDirectoryName}/catalog/provider-tracks/${encodeURIComponent(id)}.json`,
      record
    );
    await this.touch();
  }

  async listProviderTracks<T>() {
    return this.listJsonFiles<T>(
      `${localRepositoryDirectoryName}/catalog/provider-tracks`
    );
  }

  async writePlaylist(record: LocalRepositoryPlaylistRecord) {
    await this.writeJson(
      `${localRepositoryDirectoryName}/catalog/playlists/${record.id}.json`,
      record
    );
    await this.writeCatalogIndex();
    await this.touch();
  }

  async readPlaylist(id: string) {
    return this.readJson<LocalRepositoryPlaylistRecord>(
      `${localRepositoryDirectoryName}/catalog/playlists/${id}.json`
    );
  }

  async listPlaylists() {
    return this.listJsonFiles<LocalRepositoryPlaylistRecord>(
      `${localRepositoryDirectoryName}/catalog/playlists`
    );
  }

  async deletePlaylist(id: string) {
    await this.removePath(`${localRepositoryDirectoryName}/catalog/playlists/${id}.json`);
    await this.writeCatalogIndex();
    await this.touch();
  }

  async writeOriginalManifest(
    manifest: OriginalAssetManifest,
    sourcePath: string
  ) {
    const relativePath = this.getOriginalManifestPath(manifest.assetId);
    await this.writeJson(relativePath, {
      storageSchemaVersion: 1,
      manifest,
      sourcePath
    } satisfies LocalRepositoryOriginalManifest);
    return relativePath;
  }

  getOriginalManifestPath(assetId: string) {
    return `${localRepositoryDirectoryName}/assets/original/${assetId}/manifest.json`;
  }

  async readOriginalManifest(assetId: string) {
    return this.readJson<LocalRepositoryOriginalManifest>(
      `${localRepositoryDirectoryName}/assets/original/${assetId}/manifest.json`
    );
  }

  async listOriginalAssets() {
    return this.listJsonFilesRecursively<LocalRepositoryOriginalManifest>(
      `${localRepositoryDirectoryName}/assets/original`
    );
  }

  async writePlaybackAsset(input: {
    manifest: PlaybackAssetManifest;
    units: Array<{ descriptor: AssetUnitDescriptor; payload: ArrayBuffer }>;
  }) {
    const basePath = this.getPlaybackAssetPath(input.manifest.assetId, input.manifest.profileId);
    const unitDescriptors: LocalRepositoryPlaybackUnit[] = new Array(input.units.length);
    let nextUnitIndex = 0;
    await Promise.all(
      Array.from({ length: Math.min(playbackWriteConcurrency, input.units.length) }, async () => {
        while (true) {
          const unitIndex = nextUnitIndex++;
          if (unitIndex >= input.units.length) return;
          const unit = input.units[unitIndex]!;
          const fileName = `${String(unit.descriptor.unitIndex).padStart(6, "0")}.opus`;
          const relativePath = `${basePath}/units/${fileName}`;
          await this.writeBlob(relativePath, new Blob([new Uint8Array(unit.payload)], {
            type: "audio/ogg"
          }));
          unitDescriptors[unitIndex] = {
            descriptor: unit.descriptor,
            relativePath
          };
        }
      })
    );
    await this.writeJson(`${basePath}/manifest.json`, {
      storageSchemaVersion: 1,
      manifest: input.manifest,
      units: unitDescriptors
    } satisfies LocalRepositoryPlaybackManifest);
    await this.touch();
    return `${basePath}/manifest.json`;
  }

  getPlaybackAssetPath(assetId: string, profileId: string) {
    return `${localRepositoryDirectoryName}/assets/playback/${profileId}/${assetId}`;
  }

  getPlaybackManifestPath(assetId: string, profileId: string) {
    return `${this.getPlaybackAssetPath(assetId, profileId)}/manifest.json`;
  }

  async readPlaybackAsset(assetId: string, profileId: string) {
    return this.readJson<LocalRepositoryPlaybackManifest>(
      `${localRepositoryDirectoryName}/assets/playback/${profileId}/${assetId}/manifest.json`
    );
  }

  async deletePlaybackAsset(assetId: string, profileId: string) {
    await this.removeDirectory(
      `${localRepositoryDirectoryName}/assets/playback/${profileId}/${assetId}`
    );
    await this.touch();
  }

  async listPlaybackAssets() {
    return this.listJsonFilesRecursively<LocalRepositoryPlaybackManifest>(
      `${localRepositoryDirectoryName}/assets/playback`
    );
  }

  async readPlaybackUnit(unit: LocalRepositoryPlaybackUnit) {
    return this.readPath(unit.relativePath);
  }

  private async writeBlob(relativePath: string, blob: Blob) {
    const parts = splitSafePath(relativePath);
    const fileName = parts.pop();
    if (!fileName) throw new Error("本地仓库文件路径为空。");
    const directory = await getDirectoryByParts(this.root, parts, true);
    if (!directory) throw new Error("无法创建本地仓库目录。");
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  private async writeJson(relativePath: string, value: unknown) {
    await this.writeBlob(
      relativePath,
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
    );
  }

  private async writeCatalogIndex() {
    const [tracks, playlists] = await Promise.all([this.listTracks(), this.listPlaylists()]);
    await this.writeJson(`${localRepositoryDirectoryName}/catalog/index.json`, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      trackHashes: tracks.map((track) => track.fileHash).sort(),
      playlistIds: playlists.map((playlist) => playlist.id).sort()
    });
  }

  private async readJson<T>(relativePath: string) {
    const file = await this.readPath(relativePath);
    if (!file) return null;
    try {
      return JSON.parse(await file.text()) as T;
    } catch {
      return null;
    }
  }

  private async listJsonFiles<T>(relativeDirectory: string) {
    const directory = await getDirectoryByPath(this.root, relativeDirectory, false);
    if (!directory || !("values" in directory)) return [];
    const records: T[] = [];
    for await (const entry of (directory as DirectoryHandleWithValues).values!()) {
      if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
      try {
        records.push(JSON.parse(await entry.getFile().then((file) => file.text())) as T);
      } catch {
        // Ignore one corrupt record and allow the rest of the repository to load.
      }
    }
    return records;
  }

  private async listJsonFilesRecursively<T>(relativeDirectory: string) {
    const directory = await getDirectoryByPath(this.root, relativeDirectory, false);
    if (!directory || !("values" in directory)) return [];
    const records: T[] = [];
    for await (const entry of (directory as DirectoryHandleWithValues).values!()) {
      if (entry.kind === "file" && entry.name.endsWith(".json")) {
        try {
          records.push(JSON.parse(await entry.getFile().then((file) => file.text())) as T);
        } catch {
          // Ignore one corrupt record and allow the rest of the repository to load.
        }
        continue;
      }
      if (entry.kind !== "directory") continue;
      const childRecords = await listJsonFilesFromDirectory<T>(entry);
      records.push(...childRecords);
    }
    return records;
  }
}

export function createRepositoryTrackRecord(input: {
  fileHash: string;
  title: string;
  artist: string;
  album?: string | null;
  artworkUrl?: string | null;
  lyrics?: string | null;
  provider?: "netease" | "qqmusic" | "local_upload";
  providerTrackId?: string | null;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  source: LocalRepositoryTrackRecord["source"];
  originalAsset?: LocalRepositoryTrackRecord["originalAsset"];
  playbackAsset?: LocalRepositoryTrackRecord["playbackAsset"];
  retention: LocalRepositoryTrackRecord["retention"];
  createdAt?: string;
  updatedAt?: string;
}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    fileHash: input.fileHash,
    title: input.title,
    artist: input.artist,
    ...(input.album !== undefined ? { album: input.album } : {}),
    ...(input.artworkUrl !== undefined ? { artworkUrl: input.artworkUrl } : {}),
    ...(input.lyrics !== undefined ? { lyrics: input.lyrics } : {}),
    durationMs: input.durationMs,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    ...(input.provider !== undefined ? { sourceType: input.provider } : {}),
    ...(input.providerTrackId && (input.provider === "netease" || input.provider === "qqmusic")
      ? { sourceRef: { provider: input.provider, trackId: input.providerTrackId } }
      : { sourceRef: null }),
    source: input.source,
    originalAsset: input.originalAsset ?? null,
    playbackAsset: input.playbackAsset ?? null,
    artworkPath: null,
    lyricsPath: null,
    retention: input.retention,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  } satisfies LocalRepositoryTrackRecord;
}

function createRepositoryManifest(): LocalRepositoryManifest {
  const now = new Date().toISOString();
  return {
    format: localRepositoryFormat,
    schemaVersion: localRepositorySchemaVersion,
    repositoryId: globalThis.crypto?.randomUUID?.() ?? `repository-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    hashAlgorithm: "sha256",
    playbackProfiles: {
      "opus-music-v2": {
        encoderVersion: "2.0.0",
        segmentDurationMs: 2_000
      }
    },
    createdAt: now,
    updatedAt: now
  };
}

function validateRepositoryManifest(manifest: LocalRepositoryManifest) {
  if (
    manifest.format !== localRepositoryFormat ||
    manifest.schemaVersion !== localRepositorySchemaVersion ||
    manifest.hashAlgorithm !== "sha256" ||
    typeof manifest.repositoryId !== "string"
  ) {
    throw new Error("所选文件夹不是兼容的 Music Room 本地仓库，或仓库版本过旧。 ");
  }
}

async function writeJsonFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  value: unknown
) {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(JSON.stringify(value, null, 2));
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

async function readJsonFile<T>(directory: FileSystemDirectoryHandle, fileName: string) {
  try {
    const handle = await directory.getFileHandle(fileName);
    return JSON.parse(await (await handle.getFile()).text()) as T;
  } catch {
    return null;
  }
}

async function getDirectoryByPath(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean
) {
  return getDirectoryByParts(root, splitSafePath(path), create);
}

async function getDirectoryByParts(
  root: FileSystemDirectoryHandle,
  parts: string[],
  create: boolean
) {
  let directory = root;
  for (const part of parts) {
    try {
      directory = await directory.getDirectoryHandle(part, { create });
    } catch {
      return null;
    }
  }
  return directory;
}

async function getFileByPath(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean
) {
  const parts = splitSafePath(path);
  const fileName = parts.pop();
  if (!fileName) throw new Error("本地仓库文件路径为空。");
  const directory = await getDirectoryByParts(root, parts, create);
  if (!directory) return null;
  try {
    return await directory.getFileHandle(fileName, { create });
  } catch {
    return null;
  }
}

async function listJsonFilesFromDirectory<T>(directory: FileSystemDirectoryHandle) {
  const iterable = directory as DirectoryHandleWithValues;
  if (!iterable.values) return [] as T[];
  const records: T[] = [];
  for await (const entry of iterable.values()) {
    if (entry.kind === "file" && entry.name.endsWith(".json")) {
      try {
        records.push(JSON.parse(await entry.getFile().then((file) => file.text())) as T);
      } catch {
        // Ignore one corrupt record and allow the rest of the repository to load.
      }
      continue;
    }
    if (entry.kind === "directory") {
      records.push(...await listJsonFilesFromDirectory<T>(entry));
    }
  }
  return records;
}

function splitSafePath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error("本地仓库路径必须是相对路径。");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error("本地仓库路径包含非法片段。");
  }
  return parts;
}

function inferFileExtension(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/flac":
      return "flac";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mp4":
    case "audio/aac":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    default:
      return "";
  }
}
