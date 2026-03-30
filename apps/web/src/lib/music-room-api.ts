import { apiBaseUrl } from "./api-client";
import type {
  AuthSession,
  PlaybackSnapshot,
  Playlist,
  QueueItem,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";

const sessionStorageKey = "music-room-session";

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
    const message = await response.text();
    if (response.status === 401 && typeof window !== "undefined") {
      window.localStorage.removeItem(sessionStorageKey);
      window.dispatchEvent(
        new CustomEvent("music-room-auth-expired", {
          detail: { message }
        })
      );
    }
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
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
    request<QueueItem>(`/v1/rooms/${roomId}/queue`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  reorderQueue: (roomId: string, payload: { queueItemIds: string[] }) =>
    request<QueueItem[]>(`/v1/rooms/${roomId}/queue/reorder`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  removeQueueItem: (roomId: string, queueItemId: string) =>
    request<QueueItem[]>(`/v1/rooms/${roomId}/queue/${queueItemId}`, {
      method: "DELETE"
    }),
  updatePlayback: (
    roomId: string,
    payload: {
      action: "play" | "pause" | "seek" | "next" | "prev";
      trackId?: string;
      queueItemId?: string;
      positionMs?: number;
    }
  ) =>
    request<PlaybackSnapshot>(`/v1/rooms/${roomId}/playback`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
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
    request<{ ok: boolean }>(`/v1/playlists/${playlistId}/import-to-room`, {
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
