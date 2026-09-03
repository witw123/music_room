import { apiBaseUrl } from "./api-client";
import { importBandwidthGovernor } from "./import-bandwidth-governor";
import {
  errorCodes,
  type ApiErrorResponse,
  type PlaybackSnapshot,
  type ProviderAudioResolveResponse,
  type QueueItem,
  type RoomType
} from "@music-room/shared";

export class MusicRoomApiError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorResponse["code"] | null,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export type QueueMutationResponse = {
  queue: QueueItem[];
  playback: PlaybackSnapshot;
};

export type RadioAutopilotNextTrackMutationResponse = QueueMutationResponse & {
  insertedQueueItemId: string;
};

export type RoomActivitySummary = {
  roomId: string;
  roomName: string;
  joinCode: string;
  durationMs: number;
  lastJoinedAt: string;
  isActive: boolean;
  roomType: RoomType;
};

export type RoomInteractionStats = {
  sentLikes: number;
  sentApplause: number;
  receivedReactions: number;
};

export type AuthConfig = {
  enabled: boolean;
  siteKey: string;
};

export const playlistsChangedEventName = "music-room-playlists-changed";
export const playlistsChangedStorageKey = "music-room-playlists-version";

let playlistsChangeSequence = 0;

export function notifyPlaylistsChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(playlistsChangedEventName));
  try {
    window.localStorage.setItem(
      playlistsChangedStorageKey,
      `${Date.now()}-${++playlistsChangeSequence}`
    );
  } catch {
    // The same-tab event still keeps the current page in sync when storage is unavailable.
  }
}

export function extractApiErrorMessage(rawBody: string) {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown } | string;
    if (typeof parsed === "string") {
      return parsed;
    }

    if (Array.isArray(parsed.message)) {
      return parsed.message.join(", ");
    }

    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    // Fall back to the raw response body when the backend returns plain text.
  }

  return trimmed;
}

export function extractApiError(rawBody: string): ApiErrorResponse | null {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<ApiErrorResponse>;
    if (typeof parsed.code === "string" && typeof parsed.message === "string") {
      return {
        code: parsed.code as ApiErrorResponse["code"],
        message: parsed.message,
        details: parsed.details
      };
    }
  } catch {
    return null;
  }

  return null;
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  options?: { notifyAuthExpired?: boolean }
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    const rawErrorBody = await response.text();
    const apiError = extractApiError(rawErrorBody);
    const message = apiError?.message ?? extractApiErrorMessage(rawErrorBody);
    const shouldExpireSession =
      response.status === 401 &&
      apiError?.code === errorCodes.unauthorized &&
      options?.notifyAuthExpired !== false &&
      typeof window !== "undefined";
    if (shouldExpireSession) {
      window.dispatchEvent(
        new CustomEvent("music-room-auth-expired", {
          detail: { message }
        })
      );
    }
    throw new MusicRoomApiError(
      message || `Request failed: ${response.status}`,
      apiError?.code ?? null,
      apiError?.details
    );
  }

  if (response.status === 204) {
    return null as T;
  }

  const rawBody = await response.text();
  if (!rawBody.trim()) {
    return null as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(rawBody) as T;
  }

  return rawBody as T;
}

export async function requestBlob(
  path: string,
  init?: RequestInit,
  options?: { throttleImport?: boolean }
) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    ...(options?.throttleImport ? { priority: "low" as const } : {}),
    headers: {
      ...(init?.headers ?? {})
    },
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    const rawErrorBody = await response.text();
    const apiError = extractApiError(rawErrorBody);
    const message = apiError?.message ?? extractApiErrorMessage(rawErrorBody);
    if (
      response.status === 401 &&
      apiError?.code === errorCodes.unauthorized &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(
        new CustomEvent("music-room-auth-expired", {
          detail: { message }
        })
      );
    }
    throw new MusicRoomApiError(
      message || `Request failed: ${response.status}`,
      apiError?.code ?? null,
      apiError?.details
    );
  }

  return {
    blob: options?.throttleImport
      ? await importBandwidthGovernor.readResponse(response, init?.signal ?? undefined)
      : await response.blob(),
    contentType: response.headers.get("content-type") ?? "application/octet-stream"
  };
}

export async function resolveDownloadedAudioMimeType(blob: Blob, declaredType: string) {
  if (blob.size <= 0) {
    throw new Error("下载到的音频为空，请稍后重试。");
  }

  const normalizedDeclaredType = declaredType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    normalizedDeclaredType === "application/json" ||
    normalizedDeclaredType === "text/html" ||
    normalizedDeclaredType.startsWith("text/")
  ) {
    throw new Error("音乐平台返回了错误信息，未获得可播放音频。");
  }

  const probe = new Uint8Array(
    await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer()
  );
  if (
    probe.length >= 4 &&
    probe[0] === 0x66 &&
    probe[1] === 0x4c &&
    probe[2] === 0x61 &&
    probe[3] === 0x43
  ) {
    return "audio/flac";
  }

  if (
    probe.length >= 12 &&
    probe[0] === 0x52 &&
    probe[1] === 0x49 &&
    probe[2] === 0x46 &&
    probe[3] === 0x46 &&
    probe[8] === 0x57 &&
    probe[9] === 0x41 &&
    probe[10] === 0x56 &&
    probe[11] === 0x45
  ) {
    return "audio/wav";
  }

  if (
    probe.length >= 3 &&
    probe[0] === 0x49 &&
    probe[1] === 0x44 &&
    probe[2] === 0x33
  ) {
    return "audio/mpeg";
  }

  for (let index = 0; index + 2 < probe.length; index += 1) {
    if (probe[index] !== 0xff || (probe[index + 1]! & 0xe0) !== 0xe0) {
      continue;
    }
    const layer = (probe[index + 1]! >> 1) & 0x03;
    const bitrateIndex = (probe[index + 2]! >> 4) & 0x0f;
    const sampleRateIndex = (probe[index + 2]! >> 2) & 0x03;
    if (layer !== 0 && bitrateIndex !== 0 && bitrateIndex !== 0x0f && sampleRateIndex !== 0x03) {
      return "audio/mpeg";
    }
  }

  throw new Error("下载内容不是有效的 MP3 或 FLAC 音频，请重试或更换音质。");
}

export async function downloadWithDirectFallback(input: {
  resolve: () => Promise<ProviderAudioResolveResponse>;
  fallback: () => Promise<{ blob: Blob; contentType: string }>;
  signal?: AbortSignal;
}) {
  try {
    const resolved = await input.resolve();
    const response = await fetch(resolved.url, {
      signal: input.signal,
      mode: "cors",
      credentials: "omit",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`Direct provider download failed: ${response.status}`);
    }
    const blob = await response.blob();
    const contentType = await resolveDownloadedAudioMimeType(
      blob,
      response.headers.get("content-type") ?? resolved.mimeType ?? ""
    );
    return {
      blob,
      contentType
    };
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
    const fallback = await input.fallback();
    return {
      ...fallback,
      contentType: await resolveDownloadedAudioMimeType(
        fallback.blob,
        fallback.contentType
      )
    };
  }
}
