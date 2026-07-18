import { apiBaseUrl } from "./api-client";
import { importBandwidthGovernor } from "./import-bandwidth-governor";
import {
  errorCodes,
  type ApiErrorResponse,
  type AuthSession,
  type IceConfigResponse,
  type NeteaseAccountStatus,
  type NeteaseQrStartResponse,
  type NeteaseQrStatusResponse,
  type NeteaseSearchResponse,
  type NeteaseTrackCandidate,
  type QqMusicAccountStatus,
  type QqMusicQrStartResponse,
  type QqMusicQrStatusResponse,
  type QqMusicSearchResponse,
  type QqMusicTrackCandidate,
  type PlaybackMode,
  type PlaybackSnapshot,
  type Playlist,
  type QueueItem,
  type RoomSnapshot,
  type TrackMeta
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

async function request<T>(
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

async function requestBlob(path: string, init?: RequestInit, options?: { throttleImport?: boolean }) {
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

export const musicRoomApi = {
  register: (username: string, password: string, nickname: string) =>
    request<AuthSession>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, nickname })
    }),
  login: (username: string, password: string) =>
    request<AuthSession>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }),
  logout: () =>
    request<{ ok: boolean }>("/v1/auth/logout", {
      method: "POST"
    }),
  me: () => request<AuthSession>("/v1/auth/me", undefined, { notifyAuthExpired: false }),
  createRoom: (input?: {
    visibility?: "private" | "public";
    name?: string;
    description?: string | null;
    password?: string;
  }) =>
    request<RoomSnapshot>("/v1/rooms", {
      method: "POST",
      body: JSON.stringify(input ?? {})
    }),
  getRecentRoom: () => request<RoomSnapshot | null>("/v1/rooms/recent/active"),
  getRecentRooms: () => request<RoomSnapshot[]>("/v1/rooms/recent"),
  recoverRoom: (roomId: string) =>
    request<RoomSnapshot | null>(`/v1/rooms/${roomId}/recover`),
  listRooms: () => request<RoomSnapshot[]>("/v1/rooms"),
  joinRoomByCode: (joinCode: string, password?: string) =>
    request<RoomSnapshot>("/v1/rooms/join-by-code", {
      method: "POST",
      body: JSON.stringify({ joinCode, ...(password ? { password } : {}) })
    }),
  getRoom: (roomId: string) =>
    request<RoomSnapshot>(`/v1/rooms/${roomId}`),
  leaveRoom: (roomId: string) =>
    request(`/v1/rooms/${roomId}/leave`, {
      method: "POST"
    }),
  deleteRoom: (roomId: string) =>
    request<{ ok: boolean }>(`/v1/rooms/${roomId}`, {
      method: "DELETE"
    }),
  registerTrack: (roomId: string, payload: object) =>
    request<TrackMeta>(`/v1/rooms/${roomId}/tracks`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteTrack: (roomId: string, trackId: string) =>
    request<{ ok: boolean }>(`/v1/rooms/${roomId}/tracks/${trackId}`, {
      method: "DELETE"
    }),
  addQueueItem: (roomId: string, payload: { trackId: string }) =>
    request<QueueMutationResponse>(`/v1/rooms/${roomId}/queue`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  reorderQueue: (roomId: string, payload: { queueItemIds: string[] }) =>
    request<QueueMutationResponse>(`/v1/rooms/${roomId}/queue/reorder`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  removeQueueItem: (roomId: string, queueItemId: string) =>
    request<QueueMutationResponse>(`/v1/rooms/${roomId}/queue/${queueItemId}`, {
      method: "DELETE"
    }),
  updatePlayback: (
    roomId: string,
    payload: {
      action: "play" | "pause" | "seek" | "next" | "prev" | "set-mode";
      trackId?: string;
      queueItemId?: string;
      playbackAssetId?: string;
      positionMs?: number;
      playbackMode?: PlaybackMode;
      actorPeerId?: string;
      expectedVersion: number;
    }
  ) =>
    request<PlaybackSnapshot>(`/v1/rooms/${roomId}/playback`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  getIceConfig: () => request<IceConfigResponse>("/v1/realtime/ice-config"),
  getNeteaseAccount: () =>
    request<NeteaseAccountStatus>("/v1/providers/netease/account"),
  startNeteaseQrLogin: () =>
    request<NeteaseQrStartResponse>("/v1/providers/netease/account/qr/start", {
      method: "POST"
    }),
  getNeteaseQrStatus: (attemptId: string) =>
    request<NeteaseQrStatusResponse>(
      `/v1/providers/netease/account/qr/${encodeURIComponent(attemptId)}/status`
    ),
  disconnectNeteaseAccount: () =>
    request<{ ok: boolean }>("/v1/providers/netease/account", {
      method: "DELETE"
    }),
  searchNeteaseTracks: (keywords: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      keywords,
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0)
    });
    return request<NeteaseSearchResponse>(`/v1/providers/netease/search?${params.toString()}`);
  },
  getNeteaseTrack: (trackId: string) =>
    request<NeteaseTrackCandidate>(`/v1/providers/netease/tracks/${encodeURIComponent(trackId)}`),
  downloadNeteaseTrack: (
    trackId: string,
    quality: "standard" | "high" | "exhigh" = "exhigh",
    signal?: AbortSignal
  ) =>
    requestBlob(
      `/v1/providers/netease/tracks/${encodeURIComponent(trackId)}/audio?quality=${quality}`,
      { signal },
      { throttleImport: true }
    ),
  getQqMusicAccount: () => request<QqMusicAccountStatus>("/v1/providers/qqmusic/account"),
  startQqMusicQrLogin: () => request<QqMusicQrStartResponse>("/v1/providers/qqmusic/account/qr/start", { method: "POST" }),
  getQqMusicQrStatus: (attemptId: string) => request<QqMusicQrStatusResponse>(`/v1/providers/qqmusic/account/qr/${encodeURIComponent(attemptId)}/status`),
  disconnectQqMusicAccount: () => request<{ ok: boolean }>("/v1/providers/qqmusic/account", { method: "DELETE" }),
  searchQqMusicTracks: (keywords: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      keywords,
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0)
    });
    return request<QqMusicSearchResponse>(`/v1/providers/qqmusic/search?${params.toString()}`);
  },
  getQqMusicTrack: (trackId: string) => request<QqMusicTrackCandidate>(`/v1/providers/qqmusic/tracks/${encodeURIComponent(trackId)}`),
  downloadQqMusicTrack: (
    trackId: string,
    quality: "standard" | "high" | "exhigh" = "exhigh",
    signal?: AbortSignal
  ) =>
    requestBlob(
      `/v1/providers/qqmusic/tracks/${encodeURIComponent(trackId)}/audio?quality=${quality}`,
      { signal },
      { throttleImport: true }
    ),
  listMyPlaylists: () =>
    request<Playlist[]>("/v1/playlists"),
  updatePlaylist: (
    playlistId: string,
    payload: {
      title?: string;
      description?: string | null;
      tags?: string[];
      coverUrl?: string | null;
      trackIds?: string[];
    }
  ) =>
    request<Playlist>(`/v1/playlists/${playlistId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deletePlaylist: (playlistId: string) =>
    request<{ ok: boolean }>(`/v1/playlists/${playlistId}`, {
      method: "DELETE"
    }),
  importPlaylistToRoom: (playlistId: string, payload: { roomId: string }) =>
    request<QueueMutationResponse>(`/v1/playlists/${playlistId}/import-to-room`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  createPlaylistFromRoom: (payload: {
    roomId: string;
    title: string;
    description?: string | null;
  }) =>
    request<Playlist>("/v1/playlists/from-room", {
      method: "POST",
      body: JSON.stringify(payload)
    })
};
