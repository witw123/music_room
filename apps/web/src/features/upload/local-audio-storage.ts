"use client";

import type {
  OriginalAssetManifest,
  PlaybackAssetManifest
} from "@music-room/shared";
import {
  deleteAudioAsset,
  deleteCachedLibraryTrackFile,
  deleteOriginalAssetForTrack,
  deleteLocalAudioCacheFileRecord,
  getLocalAudioDirectory,
  getLocalAudioFileRecord,
  getLocalPlaylistDirectory,
  getLocalAudioCacheFileRecord,
  getCachedLibraryTrack,
  getAssetManifest,
  getAssetUnits,
  getTrackAssetLink,
  getCachedLibraryTrackSummary,
  listCachedLibraryTrackSummaries,
  listLocalAudioCacheFiles,
  listLocalAudioFiles,
  saveLocalAudioCacheFileRecord,
  saveLocalAudioDirectory,
  saveLocalAudioFileRecord
} from "@/lib/indexeddb";
import { createRepositoryTrackRecord, LocalRepository } from "./local-repository";
import { hydrateLocalRepository } from "./local-repository-hydration";
import { enqueueLocalRepositoryWrite } from "./local-repository-queue";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionedDirectoryHandle>;
};

type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

export type LocalAudioStorageState = {
  supported: boolean;
  directoryName: string | null;
  savedFileHashes: string[];
  cachedFileHashes: string[];
  permission: PermissionState | null;
};

export type SelectedLocalAudioFile = {
  file: File;
  fileName: string;
};

export function supportsLocalAudioDirectory() {
  return typeof window !== "undefined" &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export async function chooseLocalAudioDirectory() {
  const picker = typeof window === "undefined"
    ? undefined
    : (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error("当前浏览器不支持选择本地文件夹，请使用 Chrome 或 Edge。 ");
  }

  const handle = await picker({ mode: "readwrite" });
  const repository = await LocalRepository.open(handle);
  await saveLocalAudioDirectory({
    handle,
    name: handle.name,
    repositoryId: repository.manifest.repositoryId,
    schemaVersion: repository.manifest.schemaVersion
  });
  await hydrateLocalRepository(repository);
  return handle.name;
}

export async function getConfiguredLocalRepository() {
  const directory = await getLocalAudioDirectory();
  if (!directory) return null;
  try {
    return await LocalRepository.open(directory.handle, { recover: false });
  } catch {
    // A directory handle can become unavailable after the folder is moved or deleted.
    // Browser storage remains usable until the user selects a new folder.
    return null;
  }
}

export async function getLocalAudioStorageState(): Promise<LocalAudioStorageState> {
  const [directory, files, cachedFiles] = await Promise.all([
    getLocalAudioDirectory(),
    listLocalAudioFiles("saved"),
    listLocalAudioCacheFiles()
  ]);
  let permission: PermissionState | null = null;
  if (directory) {
    permission = await asPermissionedHandle(directory.handle)
      .queryPermission({ mode: "read" })
      .catch(() => null);
  }
  if (!directory || permission !== "granted") {
    return {
      supported: supportsLocalAudioDirectory(),
      directoryName: directory?.name ?? null,
      savedFileHashes: [],
      cachedFileHashes: [],
      permission
    };
  }

  const [availableSavedFiles, availableCachedFiles] = await Promise.all([
    filterReadableLocalFiles(directory.handle, files, true),
    filterReadableLocalFiles(directory.handle, cachedFiles, false)
  ]);
  return {
    supported: supportsLocalAudioDirectory(),
    directoryName: directory?.name ?? null,
    savedFileHashes: availableSavedFiles,
    cachedFileHashes: availableCachedFiles,
    permission
  };
}

export async function listSelectedLocalAudioFiles(): Promise<SelectedLocalAudioFile[] | null> {
  const directory = await getLocalAudioDirectory();
  if (!directory) return [];

  const permission = await asPermissionedHandle(directory.handle)
    .queryPermission({ mode: "read" })
    .catch(() => "denied" as PermissionState);
  if (permission !== "granted") return null;

  const files: SelectedLocalAudioFile[] = [];
  try {
    await collectSelectedLocalAudioFiles(directory.handle, "", files);
  } catch {
    return null;
  }
  return files;
}

export async function chooseLocalAudioSourceDirectory() {
  const picker = typeof window === "undefined"
    ? undefined
    : (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error("当前浏览器不支持选择本地文件夹，请使用 Chrome 或 Edge。 ");
  }
  return picker({ mode: "read" });
}

export async function listLocalAudioFilesInDirectory(directory: FileSystemDirectoryHandle): Promise<SelectedLocalAudioFile[] | null> {
  const permission = await asPermissionedHandle(directory)
    .queryPermission({ mode: "read" })
    .catch(() => "denied" as PermissionState);
  if (permission !== "granted") return null;

  const files: SelectedLocalAudioFile[] = [];
  try {
    await collectSelectedLocalAudioFiles(directory, "", files);
  } catch {
    return null;
  }
  return files;
}

export async function ensureLocalAudioDirectoryWriteAccess() {
  return !!(await getWritableLocalAudioDirectory());
}

export async function getLocalAudioFile(
  fileHash: string,
  sourceDirectoryId?: string | null,
  sourceFileName?: string | null
) {
  const fileRecord = await getLocalAudioFileRecord(fileHash, "saved");

  if (sourceDirectoryId) {
    const sourceDirectory = await getLocalPlaylistDirectory(sourceDirectoryId);
    if (!sourceDirectory) return null;
    const permission = await asPermissionedHandle(sourceDirectory.handle)
      .queryPermission({ mode: "read" })
      .catch(() => "denied" as PermissionState);
    if (permission !== "granted") return null;
    const fileName = sourceFileName ?? fileRecord?.fileName;
    return fileName
      ? getFileByPath(sourceDirectory.handle, fileName).catch(() => null)
      : null;
  }

  if (!fileRecord) {
    return null;
  }

  if (fileRecord.sourceDirectoryId) {
    const rootDirectory = await getLocalAudioDirectory();
    if (!rootDirectory) return null;
    const permission = await asPermissionedHandle(rootDirectory.handle)
      .queryPermission({ mode: "read" })
      .catch(() => "denied" as PermissionState);
    if (permission !== "granted") return null;
    return getFileByPath(rootDirectory.handle, sourceFileName ?? fileRecord.fileName).catch(() => null);
  }

  const directory = await getLocalAudioDirectory();
  if (!directory) return null;

  const permission = await asPermissionedHandle(directory.handle)
    .queryPermission({ mode: "read" })
    .catch(() => "denied" as PermissionState);
  if (permission !== "granted") {
    return null;
  }

  const repository = await LocalRepository.open(directory.handle, { recover: false }).catch(() => null);
  const repositoryFile = fileRecord.relativePath && repository
    ? await repository.readPath(fileRecord.relativePath)
    : null;
  if (repositoryFile) return repositoryFile;
  if (fileRecord.source !== "directory-scan") return null;
  return getFileByPath(directory.handle, fileRecord.fileName).catch(() => null);
}

export async function getOriginalAssetFile(input: {
  assetId: string;
  fileHash: string;
  title: string;
  mimeType: string;
}) {
  const repository = await getConfiguredLocalRepository();
  const persisted = repository ? await repository.readOriginalManifest(input.assetId) : null;
  if (
    repository &&
    persisted?.manifest.kind === "original" &&
    persisted.manifest.fileHash === input.fileHash
  ) {
    const source = await repository.readPath(persisted.sourcePath);
    if (source) {
      return new File(
        [source],
        buildLocalAudioFileName({
          title: input.title,
          mimeType: input.mimeType,
          fileHash: input.fileHash
        }),
        { type: input.mimeType }
      );
    }
  }

  const assetRecord = await getAssetManifest(input.assetId);
  if (
    assetRecord?.manifest.kind === "original" &&
    assetRecord.complete &&
    assetRecord.manifest.fileHash === input.fileHash
  ) {
    const unitIndexes = Array.from({ length: assetRecord.manifest.unitCount }, (_, index) => index);
    const units = await getAssetUnits(input.assetId, unitIndexes);
    if (units.length === unitIndexes.length) {
      units.sort((left, right) => left.unitIndex - right.unitIndex);
      return new File(
        units.map((unit) => unit.payload),
        buildLocalAudioFileName({
          title: input.title,
          mimeType: input.mimeType,
          fileHash: input.fileHash
        }),
        { type: input.mimeType }
      );
    }
  }

  return null;
}

/** Resolve a room track to the original local file without decoding or transcoding it. */
export async function getRoomLocalAudioFile(input: {
  trackId: string;
  fileHash: string;
  title: string;
  mimeType: string;
  originalAssetId?: string | null;
}) {
  const [savedFile, cachedFile] = await Promise.all([
    getLocalAudioFile(input.fileHash).catch(() => null),
    getLocalAudioCacheFile(input.fileHash).catch(() => null)
  ]);
  if (savedFile) return savedFile;
  if (cachedFile) return cachedFile;

  const browserCache = await getCachedLibraryTrack(input.fileHash).catch(() => null);
  if (browserCache?.file) return browserCache.file;

  const linkedAssets = await getTrackAssetLink(input.trackId).catch(() => null);
  const originalAssetId = input.originalAssetId ?? linkedAssets?.originalAssetId ?? null;
  if (!originalAssetId) return null;

  return getOriginalAssetFile({
    assetId: originalAssetId,
    fileHash: input.fileHash,
    title: input.title,
    mimeType: input.mimeType
  });
}

export async function getLocalAudioCacheFile(fileHash: string) {
  const [directory, fileRecord] = await Promise.all([
    getLocalAudioDirectory(),
    getLocalAudioCacheFileRecord(fileHash)
  ]);
  if (!directory || !fileRecord) {
    return null;
  }

  const permission = await asPermissionedHandle(directory.handle)
    .queryPermission({ mode: "read" })
    .catch(() => "denied" as PermissionState);
  if (permission !== "granted") {
    return null;
  }

  const repository = await LocalRepository.open(directory.handle, { recover: false }).catch(() => null);
  const repositoryFile = fileRecord.relativePath && repository
    ? await repository.readPath(fileRecord.relativePath)
    : null;
  return repositoryFile;
}

export async function saveAudioFileToLocalDirectory(input: {
  file: Blob;
  fileHash: string;
  title: string;
  mimeType: string;
  trackId?: string;
  track?: {
    artist: string;
    album?: string | null;
    artworkUrl?: string | null;
    lyrics?: string | null;
    provider?: "netease" | "qqmusic" | "local_upload";
    providerTrackId?: string | null;
    durationMs: number;
    sizeBytes?: number;
    originalAsset?: OriginalAssetManifest;
    playbackAsset?: PlaybackAssetManifest;
  };
}) {
  return enqueueLocalRepositoryWrite(async () => {
    const directory = await getWritableLocalAudioDirectory();
    if (!directory) {
      throw new Error("请先选择本地音频文件夹。 ");
    }

  const fileName = buildLocalAudioFileName(input);
    const repository = await LocalRepository.open(directory.handle, { recover: false });
  const existingTrack = await repository.readTrack(input.fileHash);
  await deleteLocalAudioCacheFile(input.fileHash);
  const relativePath = await repository.writeManagedSource({
    file: input.file,
    fileHash: input.fileHash,
    mimeType: input.mimeType
  });

  const originalAsset = input.track?.originalAsset
    ?? (input.trackId
    ? await getTrackOriginalAssetManifest(input.trackId)
    : null)
    ?? (existingTrack?.originalAsset
      ? (await getAssetManifest(existingTrack.originalAsset.assetId).catch(() => null))?.manifest.kind === "original"
        ? (await getAssetManifest(existingTrack.originalAsset.assetId))?.manifest as OriginalAssetManifest
        : null
      : null);
  let savedOriginalAsset = existingTrack?.originalAsset ?? null;
  if (originalAsset) {
    savedOriginalAsset = {
      assetId: originalAsset.assetId,
      manifestPath: await repository.writeOriginalManifest(originalAsset, relativePath)
    };
  }
  let savedPlaybackAsset = existingTrack?.playbackAsset ?? null;
  const playbackAsset = input.track?.playbackAsset
    ?? (existingTrack?.playbackAsset
      ? (await getAssetManifest(existingTrack.playbackAsset.assetId).catch(() => null))?.manifest.kind === "playback"
        ? (await getAssetManifest(existingTrack.playbackAsset.assetId))?.manifest as PlaybackAssetManifest
        : null
      : null);
  if (playbackAsset) {
    const manifestPath = await persistPlaybackAssetToRepository(
      repository,
      playbackAsset
    );
    if (manifestPath) {
      savedPlaybackAsset = {
        assetId: playbackAsset.assetId,
        profileId: playbackAsset.profileId,
        manifestPath
      };
      await deleteAudioAsset(playbackAsset.assetId).catch(() => undefined);
    }
  }
  const artworkPath = input.track?.artworkUrl?.trim()
    ? await repository.writeArtworkFromUrl({
        fileHash: input.fileHash,
        artworkUrl: input.track.artworkUrl,
        retention: "library",
        provider: input.track.provider === "netease" || input.track.provider === "qqmusic"
          ? input.track.provider
          : "local_upload"
      }) ?? existingTrack?.artworkPath ?? null
    : existingTrack?.artworkPath ?? null;
  const lyricsPath = input.track?.lyrics?.trim()
    ? await repository.writeLyrics(input.fileHash, input.track.lyrics)
    : existingTrack?.lyricsPath ?? null;
  if (!lyricsPath && existingTrack?.lyricsPath) {
    await repository.removePath(existingTrack.lyricsPath);
  }

  await saveLocalAudioFileRecord({
    fileHash: input.fileHash,
    fileName,
    relativePath,
    storageKind: "saved"
  });
  if (input.track) {
    const sizeBytes = input.track.sizeBytes ?? input.file.size;
    await repository.writeTrack(createRepositoryTrackRecord({
      fileHash: input.fileHash,
      title: input.title,
      artist: input.track.artist,
      album: input.track.album,
      artworkUrl: input.track.artworkUrl,
      lyrics: input.track.lyrics,
      provider: input.track.provider,
      providerTrackId: input.track.providerTrackId,
      mimeType: input.mimeType,
      durationMs: input.track.durationMs,
      sizeBytes,
      source: { kind: "managed", relativePath, sizeBytes },
      originalAsset: savedOriginalAsset,
      playbackAsset: savedPlaybackAsset,
      artworkPath,
      lyricsPath,
      retention: "library",
      createdAt: existingTrack?.createdAt
    }));
  } else {
    await persistCachedTrackRecord(input.fileHash, relativePath, "library");
  }
  await deleteCachedLibraryTrackFile(input.fileHash);
  if (input.trackId) {
    await deleteOriginalAssetForTrack(input.trackId);
  }
    return { fileName };
  });
}

export async function saveCachedAudioFileToLocalDirectory(input: {
  file: Blob;
  fileHash: string;
  title: string;
  mimeType: string;
  provider?: "netease" | "qqmusic" | "local_upload";
  originalAsset?: OriginalAssetManifest;
  playbackAsset?: PlaybackAssetManifest;
}) {
  return enqueueLocalRepositoryWrite(async () => {
    const directory = await getWritableLocalAudioDirectory();
    if (!directory) {
      return null;
    }

  const fileName = buildLocalAudioFileName(input);
    const repository = await LocalRepository.open(directory.handle, { recover: false });
  const relativePath = await repository.writeCachedSource({
    file: input.file,
    fileHash: input.fileHash,
    mimeType: input.mimeType,
    provider: input.provider
  }, { reuseExisting: true });
  await saveLocalAudioCacheFileRecord({
    fileHash: input.fileHash,
    fileName,
    relativePath
  });
  await persistCachedTrackRecord(input.fileHash, relativePath, "cache", {
    provider: input.provider,
    originalAsset: input.originalAsset,
    playbackAsset: input.playbackAsset
  });
  await deleteCachedLibraryTrackFile(input.fileHash);
    return { fileName };
  });
}

async function persistCachedTrackRecord(
  fileHash: string,
  relativePath: string,
  retention: "library" | "cache",
  assets?: {
    provider?: "netease" | "qqmusic" | "local_upload";
    originalAsset?: OriginalAssetManifest;
    playbackAsset?: PlaybackAssetManifest;
  }
) {
  const summary = await getCachedLibraryTrackSummary(fileHash);
  if (!summary) return;
  const repository = await getConfiguredLocalRepository();
  if (!repository) return;
  const existing = await repository.readTrack(fileHash);
  let originalAsset = existing?.originalAsset ?? null;
  if (assets?.originalAsset) {
    originalAsset = {
      assetId: assets.originalAsset.assetId,
      manifestPath: await repository.writeOriginalManifest(
        assets.originalAsset,
        relativePath
      )
    };
  }
  let playbackAsset = existing?.playbackAsset ?? null;
  if (assets?.playbackAsset) {
    const manifestPath = await persistPlaybackAssetToRepository(
      repository,
      assets.playbackAsset
    );
    if (manifestPath) {
      playbackAsset = {
        assetId: assets.playbackAsset.assetId,
        profileId: assets.playbackAsset.profileId,
        manifestPath
      };
      await deleteAudioAsset(assets.playbackAsset.assetId).catch(() => undefined);
    }
  }
  const artworkPath = summary.artworkUrl?.trim()
    ? await repository.writeArtworkFromUrl({
        fileHash,
        artworkUrl: summary.artworkUrl,
        retention,
        provider: summary.provider === "netease" || summary.provider === "qqmusic"
          ? summary.provider
          : assets?.provider ?? "local_upload"
      }) ?? existing?.artworkPath ?? null
    : existing?.artworkPath ?? null;
  const record = {
    schemaVersion: 1 as const,
    fileHash: summary.fileHash,
    title: summary.title,
    artist: summary.artist,
    ...(summary.album !== undefined ? { album: summary.album } : {}),
    ...(summary.artworkUrl !== undefined ? { artworkUrl: summary.artworkUrl } : {}),
    ...(summary.lyrics !== undefined ? { lyrics: summary.lyrics } : {}),
    durationMs: summary.durationMs,
    mimeType: summary.mimeType,
    sizeBytes: summary.sizeBytes,
    ...(summary.provider !== undefined ? { sourceType: summary.provider } : {}),
    ...(summary.providerTrackId && (summary.provider === "netease" || summary.provider === "qqmusic")
      ? { sourceRef: { provider: summary.provider, trackId: summary.providerTrackId } }
      : { sourceRef: null }),
    source: {
      kind: "managed" as const,
      relativePath,
      sizeBytes: summary.sizeBytes
    },
    originalAsset,
    playbackAsset,
    artworkPath,
    lyricsPath: existing?.lyricsPath ?? null,
    retention,
    createdAt: existing?.createdAt ?? summary.cachedAt,
    updatedAt: new Date().toISOString()
  };
  await repository.writeTrack(record);
}

async function persistPlaybackAssetToRepository(
  repository: LocalRepository,
  manifest: PlaybackAssetManifest
) {
  const existing = await repository.readPlaybackAsset(manifest.assetId, manifest.profileId);
  if (existing && existing.units.length === manifest.unitCount) {
    return repository.getPlaybackManifestPath(manifest.assetId, manifest.profileId);
  }

  const unitIndexes = Array.from({ length: manifest.unitCount }, (_, index) => index);
  const units = await getAssetUnits(manifest.assetId, unitIndexes);
  if (units.length !== unitIndexes.length) {
    return null;
  }

  try {
    return await repository.writePlaybackAsset({
      manifest,
      units: units.map((unit) => ({
        descriptor: stripAssetUnitRecord(unit),
        payload: unit.payload
      }))
    });
  } catch (error) {
    await repository.removeDirectory(
      repository.getPlaybackAssetPath(manifest.assetId, manifest.profileId)
    ).catch(() => undefined);
    throw error;
  }
}

function stripAssetUnitRecord(unit: Awaited<ReturnType<typeof getAssetUnits>>[number]) {
  const {
    unitId: _unitId,
    payload: _payload,
    lastAccessedAt: _lastAccessedAt,
    protectedUntil: _protectedUntil,
    ...descriptor
  } = unit;
  return descriptor;
}

export async function deleteLocalAudioCacheFile(fileHash: string) {
  const fileRecord = await getLocalAudioCacheFileRecord(fileHash);
  if (!fileRecord) {
    return false;
  }

  const directory = await getLocalAudioDirectory();
  if (!directory) {
    return false;
  }

  const permission = await requestDirectoryPermission(
    asPermissionedHandle(directory.handle),
    "readwrite"
  );
  if (!permission) {
    return false;
  }

  const repository = await LocalRepository.open(directory.handle, { recover: false }).catch(() => null);
  if (repository && fileRecord.relativePath) {
    await repository.removePath(fileRecord.relativePath);
  }
  await deleteLocalAudioCacheFileRecord(fileHash);
  if (!(await getLocalAudioFileRecord(fileHash, "saved"))) {
    if (repository) {
      await repository.deleteTrack(fileHash).catch(() => undefined);
    }
  }
  return true;
}

async function getTrackOriginalAssetManifest(trackId: string) {
  const link = await getTrackAssetLink(trackId);
  if (!link) return null;
  const originalRecord = await getAssetManifest(link.originalAssetId);
  return originalRecord?.manifest.kind === "original"
    ? originalRecord.manifest as OriginalAssetManifest
    : null;
}

export async function cleanupLocalAudioCacheFiles() {
  const [directory, cachedFiles, cachedSummaries] = await Promise.all([
    getLocalAudioDirectory(),
    listLocalAudioCacheFiles(),
    listCachedLibraryTrackSummaries()
  ]);
  if (!directory || cachedFiles.length === 0) {
    return 0;
  }

  const activeHashes = new Set(cachedSummaries.map((summary) => summary.fileHash));
  const orphaned = cachedFiles.filter((file) => !activeHashes.has(file.fileHash));
  let deleted = 0;
  for (const file of orphaned) {
    if (await deleteLocalAudioCacheFile(file.fileHash)) {
      deleted += 1;
    }
  }
  return deleted;
}

export function downloadAudioFile(file: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function buildLocalAudioFileName(input: {
  title: string;
  mimeType: string;
  fileHash: string;
}) {
  const baseName = sanitizeFileName(input.title) || input.fileHash;
  const extension = inferFileExtension(input.mimeType);
  const suffix = input.fileHash.slice(0, 8);
  return `${baseName} [${suffix}]${extension ? `.${extension}` : ""}`;
}

export function normalizeLocalAudioMimeType(value: string | undefined) {
  const type = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (!type?.startsWith("audio/")) return "audio/mpeg";
  if (type === "audio/x-flac") return "audio/flac";
  if (type === "audio/mp3") return "audio/mpeg";
  return type;
}

async function requestDirectoryPermission(
  handle: PermissionedDirectoryHandle,
  mode: "read" | "readwrite"
) {
  const current = await handle.queryPermission({ mode }).catch(() => "denied" as PermissionState);
  if (current === "granted") {
    return true;
  }
  const requested = await handle.requestPermission({ mode }).catch(() => "denied" as PermissionState);
  return requested === "granted";
}

async function getWritableLocalAudioDirectory() {
  const directory = await getLocalAudioDirectory();
  if (!directory) {
    return null;
  }

  const permission = await requestDirectoryPermission(
    asPermissionedHandle(directory.handle),
    "readwrite"
  );
  if (!permission) {
    throw new Error("没有获得 Music Room 本地存储文件夹写入权限，请重新选择根文件夹。 ");
  }
  return directory;
}

function asPermissionedHandle(handle: FileSystemDirectoryHandle) {
  return handle as PermissionedDirectoryHandle;
}

async function collectSelectedLocalAudioFiles(
  directory: FileSystemDirectoryHandle,
  parentPath: string,
  files: SelectedLocalAudioFile[]
) {
  for await (const entry of (directory as IterableDirectoryHandle).values()) {
    const fileName = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.kind === "file") {
      const file = await entry.getFile();
      if (isAudioFile(file)) {
        files.push({ file, fileName });
      }
      continue;
    }

    // Music Room's managed files are indexed separately.
    if (!parentPath && entry.name === ".music-room") {
      continue;
    }
    await collectSelectedLocalAudioFiles(entry, fileName, files);
  }
}

function isAudioFile(file: File) {
  return file.type.startsWith("audio/") || /\.(aac|flac|m4a|mp3|ogg|opus|wav|webm)$/i.test(file.name);
}

async function filterReadableLocalFiles(
  root: FileSystemDirectoryHandle,
  records: ReadonlyArray<{
    fileHash: string;
    fileName: string;
    relativePath?: string;
    source?: "directory-scan";
  }>,
  allowExternalRootFiles: boolean
) {
  const repository = await LocalRepository.open(root, { recover: false }).catch(() => null);
  const available = await Promise.all(records.map(async (record) => {
    if (record.relativePath && repository && await repository.readPath(record.relativePath)) {
      return record.fileHash;
    }
    if (allowExternalRootFiles && record.source === "directory-scan") {
      try {
        await getFileByPath(root, record.fileName);
        return record.fileHash;
      } catch {
        // The record points to a file that is no longer present.
      }
    }
    return null;
  }));
  return available.filter((fileHash): fileHash is string => !!fileHash);
}

async function getFileByPath(root: FileSystemDirectoryHandle, fileName: string) {
  const parts = splitLocalPath(fileName);
  if (parts.length === 0) {
    throw new Error("本地文件路径为空。");
  }

  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(part);
  }
  return directory.getFileHandle(parts[parts.length - 1]).then((handle) => handle.getFile());
}

function splitLocalPath(fileName: string) {
  const normalized = fileName.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error("本地文件路径必须是相对路径。");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error("本地文件路径包含非法片段。");
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

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, " ").trim();
}
