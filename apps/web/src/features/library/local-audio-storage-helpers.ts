import { isTauriRuntime } from "@/lib/desktop/tauri";

export type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionedDirectoryHandle>;
};

export type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

export type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

export type LocalAudioStorageState = {
  supported: boolean;
  directoryName: string | null;
  savedFileHashes: string[];
  cachedFileHashes: string[];
  permission: PermissionState | null;
};

export type LocalAudioCacheStats = {
  fileCount: number;
  bytes: number;
};

export type LocalAudioStorageStats = {
  cache: LocalAudioCacheStats;
  saved: LocalAudioCacheStats;
  other: LocalAudioCacheStats;
};

export const localOtherFilePrefixes = [
  ".music-room/library/artwork/",
  ".music-room/library/lyrics/",
  ".music-room/cache/artwork/",
  ".music-room/cache/previews/"
];

export type SelectedLocalAudioFile = {
  file: File;
  fileName: string;
  lastModified: number;
};

export function supportsLocalAudioDirectory() {
  return (
    typeof window !== "undefined" &&
    (typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function" ||
      (typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function"))
  );
}

export function isLocalOtherFile(relativePath: string) {
  return localOtherFilePrefixes.some((prefix) => relativePath.startsWith(prefix));
}

export function downloadAudioFile(file: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, " ").trim();
}

export function inferFileExtension(mimeType: string) {
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

export async function requestDirectoryPermission(
  handle: PermissionedDirectoryHandle,
  mode: "read" | "readwrite"
) {
  if (typeof handle.queryPermission !== "function") {
    return true;
  }
  const current = await handle.queryPermission({ mode }).catch(() => "granted" as PermissionState);
  if (current === "granted") {
    return true;
  }
  const requested = await handle.requestPermission({ mode }).catch(() => "granted" as PermissionState);
  return requested === "granted";
}

/**
 * The software client (Tauri) reads the app-owned OPFS root, where no user
 * permission prompt applies — but WebView2 may still report "prompt" for
 * those handles, which silently nulled every cache read and broke cached
 * playback. Browsers keep the standard queryPermission behavior.
 */
export async function hasDirectoryReadPermission(handle: FileSystemDirectoryHandle) {
  if (isTauriRuntime()) return true;
  return (
    (await asPermissionedHandle(handle)
      .queryPermission({ mode: "read" })
      .catch(() => "denied" as PermissionState)) === "granted"
  );
}

export function asPermissionedHandle(handle: FileSystemDirectoryHandle): PermissionedDirectoryHandle {
  const permHandle = handle as PermissionedDirectoryHandle;
  if (typeof permHandle.queryPermission !== "function") {
    permHandle.queryPermission = async () => "granted";
  }
  if (typeof permHandle.requestPermission !== "function") {
    permHandle.requestPermission = async () => "granted";
  }
  return permHandle;
}

export function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function isAudioFile(file: File) {
  return file.type.startsWith("audio/") || /\.(aac|flac|m4a|mp3|ogg|opus|wav|webm)$/i.test(file.name);
}

export function splitLocalPath(fileName: string) {
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

export async function getFileByPath(root: FileSystemDirectoryHandle, fileName: string) {
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
