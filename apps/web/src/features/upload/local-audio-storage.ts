"use client";

import {
  deleteCachedLibraryTrackFile,
  deleteOriginalAssetForTrack,
  getLocalAudioDirectory,
  getLocalAudioFileRecord,
  listLocalAudioFiles,
  saveLocalAudioDirectory,
  saveLocalAudioFileRecord
} from "@/lib/indexeddb";

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
  await saveLocalAudioDirectory({ handle, name: handle.name });
  return handle.name;
}

export async function getLocalAudioStorageState(): Promise<LocalAudioStorageState> {
  const [directory, files] = await Promise.all([
    getLocalAudioDirectory(),
    listLocalAudioFiles()
  ]);
  let permission: PermissionState | null = null;
  if (directory) {
    permission = await asPermissionedHandle(directory.handle)
      .queryPermission({ mode: "read" })
      .catch(() => null);
  }
  return {
    supported: supportsLocalAudioDirectory(),
    directoryName: directory?.name ?? null,
    savedFileHashes: files.map((file) => file.fileHash),
    permission
  };
}

export async function getLocalAudioFile(fileHash: string) {
  const [directory, fileRecord] = await Promise.all([
    getLocalAudioDirectory(),
    getLocalAudioFileRecord(fileHash)
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

  try {
    const fileHandle = await directory.handle.getFileHandle(fileRecord.fileName);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

export async function saveAudioFileToLocalDirectory(input: {
  file: Blob;
  fileHash: string;
  title: string;
  mimeType: string;
  trackId?: string;
}) {
  const directory = await getLocalAudioDirectory();
  if (!directory) {
    throw new Error("请先选择本地音频文件夹。 ");
  }

  const permission = await requestDirectoryPermission(
    asPermissionedHandle(directory.handle),
    "readwrite"
  );
  if (!permission) {
    throw new Error("没有获得本地文件夹写入权限。 ");
  }

  const fileName = buildLocalAudioFileName(input);
  const fileHandle = await directory.handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(input.file);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }

  await saveLocalAudioFileRecord({
    fileHash: input.fileHash,
    fileName
  });
  await deleteCachedLibraryTrackFile(input.fileHash);
  if (input.trackId) {
    await deleteOriginalAssetForTrack(input.trackId);
  }
  return { fileName };
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

function asPermissionedHandle(handle: FileSystemDirectoryHandle) {
  return handle as PermissionedDirectoryHandle;
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
