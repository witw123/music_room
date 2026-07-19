"use client";

import {
  deleteCachedLibraryTrackFile,
  deleteOriginalAssetForTrack,
  deleteLocalAudioCacheFileRecord,
  getLocalAudioDirectory,
  getLocalAudioFileRecord,
  getLocalAudioCacheFileRecord,
  getAssetManifest,
  getAssetUnits,
  listCachedLibraryTracks,
  listCachedLibraryTrackSummaries,
  listLocalAudioCacheFiles,
  listLocalAudioFiles,
  saveLocalAudioCacheFileRecord,
  saveLocalAudioDirectory,
  saveLocalAudioFileRecord
} from "@/lib/indexeddb";

export const localAudioSubdirectories = {
  local: "local",
  cache: "cache",
  saved: "saved"
} as const;

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionedDirectoryHandle>;
};

type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

export type LocalAudioStorageState = {
  supported: boolean;
  directoryName: string | null;
  savedFileHashes: string[];
  cachedFileHashes: string[];
  permission: PermissionState | null;
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
  await ensureLocalAudioSubdirectories(handle);
  await saveLocalAudioDirectory({ handle, name: handle.name });
  await migrateIndexedDbCacheToLocalDirectory();
  return handle.name;
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
    filterReadableLocalFiles(directory.handle, files, ["local", "saved"], true),
    filterReadableLocalFiles(directory.handle, cachedFiles, ["local", "cache"], false)
  ]);
  return {
    supported: supportsLocalAudioDirectory(),
    directoryName: directory?.name ?? null,
    savedFileHashes: availableSavedFiles,
    cachedFileHashes: availableCachedFiles,
    permission
  };
}

export async function ensureLocalAudioDirectoryWriteAccess() {
  return !!(await getWritableLocalAudioDirectory());
}

export async function getLocalAudioFile(fileHash: string) {
  const [directory, fileRecord] = await Promise.all([
    getLocalAudioDirectory(),
    getLocalAudioFileRecord(fileHash, "saved")
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

  const savedFile = await readLocalAudioFile(directory.handle, fileRecord.fileName, "local")
    ?? await readLocalAudioFile(directory.handle, fileRecord.fileName, "saved");
  if (savedFile) {
    return savedFile;
  }

  // Records created before the subfolder layout point directly at the old
  // selected directory. Keep them readable until the user saves them again.
  try {
    const fileHandle = await directory.handle.getFileHandle(fileRecord.fileName);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

export async function getOriginalAssetFile(input: {
  assetId: string;
  fileHash: string;
  title: string;
  mimeType: string;
}) {
  const assetRecord = await getAssetManifest(input.assetId);
  if (
    !assetRecord ||
    assetRecord.manifest.kind !== "original" ||
    !assetRecord.complete ||
    assetRecord.manifest.fileHash !== input.fileHash
  ) {
    return null;
  }

  const unitIndexes = Array.from({ length: assetRecord.manifest.unitCount }, (_, index) => index);
  const units = await getAssetUnits(input.assetId, unitIndexes);
  if (units.length !== unitIndexes.length) {
    return null;
  }

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

  const localFile = await readLocalAudioFile(directory.handle, fileRecord.fileName, "local");
  return localFile ?? await readLocalAudioFile(directory.handle, fileRecord.fileName, "cache");
}

export async function saveAudioFileToLocalDirectory(input: {
  file: Blob;
  fileHash: string;
  title: string;
  mimeType: string;
  trackId?: string;
}) {
  const directory = await getWritableLocalAudioDirectory();
  if (!directory) {
    throw new Error("请先选择本地音频文件夹。 ");
  }

  const fileName = buildLocalAudioFileName(input);
  await deleteLocalAudioCacheFile(input.fileHash);
  await writeLocalAudioFile(directory.handle, "local", fileName, input.file);

  await saveLocalAudioFileRecord({
    fileHash: input.fileHash,
    fileName,
    storageKind: "saved"
  });
  await deleteCachedLibraryTrackFile(input.fileHash);
  if (input.trackId) {
    await deleteOriginalAssetForTrack(input.trackId);
  }
  return { fileName };
}

export async function saveCachedAudioFileToLocalDirectory(input: {
  file: Blob;
  fileHash: string;
  title: string;
  mimeType: string;
}) {
  const directory = await getWritableLocalAudioDirectory();
  if (!directory) {
    return null;
  }

  const fileName = buildLocalAudioFileName(input);
  await writeLocalAudioFile(directory.handle, "local", fileName, input.file);
  await saveLocalAudioCacheFileRecord({
    fileHash: input.fileHash,
    fileName
  });
  await deleteCachedLibraryTrackFile(input.fileHash);
  return { fileName };
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

  for (const kind of ["local", "cache"] as const) {
    const cacheDirectory = await getStorageSubdirectory(directory.handle, kind, false);
    if (!cacheDirectory) continue;
    try {
      await cacheDirectory.removeEntry(fileRecord.fileName);
    } catch (error) {
      if ((error as DOMException).name !== "NotFoundError") return false;
    }
  }
  await deleteLocalAudioCacheFileRecord(fileHash);
  return true;
}

async function migrateIndexedDbCacheToLocalDirectory() {
  const records = await listCachedLibraryTracks();
  for (const record of records) {
    try {
      await saveCachedAudioFileToLocalDirectory({
        file: record.file,
        fileHash: record.fileHash,
        title: record.title,
        mimeType: record.mimeType
      });
    } catch {
      // Keep the IndexedDB copy when a single file cannot be migrated.
    }
  }
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

async function ensureLocalAudioSubdirectories(handle: FileSystemDirectoryHandle) {
  await handle.getDirectoryHandle(localAudioSubdirectories.local, { create: true });
  await handle.getDirectoryHandle(localAudioSubdirectories.cache, { create: true });
  await handle.getDirectoryHandle(localAudioSubdirectories.saved, { create: true });
}

async function getStorageSubdirectory(
  handle: FileSystemDirectoryHandle,
  kind: keyof typeof localAudioSubdirectories,
  create: boolean
) {
  try {
    return await handle.getDirectoryHandle(localAudioSubdirectories[kind], { create });
  } catch {
    return null;
  }
}

async function writeLocalAudioFile(
  root: FileSystemDirectoryHandle,
  kind: keyof typeof localAudioSubdirectories,
  fileName: string,
  file: Blob
) {
  const directory = await getStorageSubdirectory(root, kind, true);
  if (!directory) {
    throw new Error("无法创建 Music Room 本地存储子文件夹。 ");
  }
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(file);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

async function readLocalAudioFile(
  root: FileSystemDirectoryHandle,
  fileName: string,
  kind: keyof typeof localAudioSubdirectories
) {
  try {
    const directory = await getStorageSubdirectory(root, kind, false);
    if (!directory) {
      return null;
    }
    const fileHandle = await directory.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

async function filterReadableLocalFiles(
  root: FileSystemDirectoryHandle,
  records: ReadonlyArray<{ fileHash: string; fileName: string }>,
  kinds: ReadonlyArray<keyof typeof localAudioSubdirectories>,
  checkRootFallback: boolean
) {
  const available = await Promise.all(records.map(async (record) => {
    for (const kind of kinds) {
      if (await readLocalAudioFile(root, record.fileName, kind)) {
        return record.fileHash;
      }
    }

    if (checkRootFallback) {
      try {
        await root.getFileHandle(record.fileName);
        return record.fileHash;
      } catch {
        // The record points to a file that is no longer present.
      }
    }
    return null;
  }));
  return available.filter((fileHash): fileHash is string => !!fileHash);
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
