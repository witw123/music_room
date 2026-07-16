import { apiBaseUrl } from "./api-client";
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
  type SpotifyAccountStatus,
  type SpotifySearchResponse,
  type SpotifyTrackCandidate,
  type PlaybackSnapshot,
  type Playlist,
  type QueueItem,
  type RoomSnapshot,
  type TrackMeta
} from "@music-room/shared";

const sessionStorageKey = "music-room-session";

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

function getSessionToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(sessionStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw) as AuthSession;
    return session.token ?? null;
  } catch {
    return null;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const sessionToken = getSessionToken();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { "x-session-token": sessionToken } : {}),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const rawErrorBody = await response.text();
    const apiError = extractApiError(rawErrorBody);
    const message = apiError?.message ?? extractApiErrorMessage(rawErrorBody);
    const shouldExpireSession =
      response.status === 401 &&
      apiError?.code === errorCodes.unauthorized &&
      typeof window !== "undefined";
    if (shouldExpireSession) {
      window.localStorage.removeItem(sessionStorageKey);
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

async function requestBlob(path: string, init?: RequestInit) {
  const sessionToken = getSessionToken();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(sessionToken ? { "x-session-token": sessionToken } : {}),
      ...(init?.headers ?? {})
    },
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
      window.localStorage.removeItem(sessionStorageKey);
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
    blob: await response.blob(),
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
  me: () => request<AuthSession>("/v1/auth/me"),
  createRoom: (visibility?: "private" | "public") =>
    request<RoomSnapshot>("/v1/rooms", {
      method: "POST",
      body: JSON.stringify({ visibility })
    }),
  getRecentRoom: () => request<RoomSnapshot | null>("/v1/rooms/recent/active"),
  recoverRoom: (roomId: string) =>
    request<RoomSnapshot | null>(`/v1/rooms/${roomId}/recover`),
  listRooms: () => request<RoomSnapshot[]>("/v1/rooms"),
  joinRoomByCode: (joinCode: string) =>
    request<RoomSnapshot>("/v1/rooms/join-by-code", {
      method: "POST",
      body: JSON.stringify({ joinCode })
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
      action: "play" | "pause" | "seek" | "next" | "prev";
      trackId?: string;
      queueItemId?: string;
      playbackAssetId?: string;
      positionMs?: number;
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
      { signal }
    ),
  getSpotifyAccount: () =>
    request<SpotifyAccountStatus>("/v1/providers/spotify/account"),
  saveSpotifyAccount: (payload: {
    clientId: string;
    clientSecret: string;
    credentialsJson: string;
  }) =>
    request<SpotifyAccountStatus>("/v1/providers/spotify/account", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  disconnectSpotifyAccount: () =>
    request<{ ok: boolean }>("/v1/providers/spotify/account", {
      method: "DELETE"
    }),
  searchSpotifyTracks: (query: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      q: query,
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0)
    });
    return request<SpotifySearchResponse>(`/v1/providers/spotify/search?${params.toString()}`);
  },
  getSpotifyTrack: (trackId: string) =>
    request<SpotifyTrackCandidate>(`/v1/providers/spotify/tracks/${encodeURIComponent(trackId)}`),
  downloadSpotifyTrack: (
    trackId: string,
    quality: "normal" | "high" | "very_high" = "high",
    signal?: AbortSignal
  ) =>
    requestBlob(
      `/v1/providers/spotify/tracks/${encodeURIComponent(trackId)}/audio?quality=${quality}`,
      { signal }
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
