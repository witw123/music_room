import { apiBaseUrl } from "./api-client";
import type {
  GuestSession,
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
    const session = JSON.parse(raw) as GuestSession;
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
    }
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const musicRoomApi = {
  createGuestSession: (nickname: string) =>
    request<GuestSession>("/v1/guest-sessions", {
      method: "POST",
      body: JSON.stringify({ nickname })
    }),
  createRoom: (sessionId: string, visibility?: "private" | "public") =>
    request<RoomSnapshot>("/v1/rooms", {
      method: "POST",
      body: JSON.stringify({ sessionId, visibility })
    }),
  getRecentRoom: (sessionId: string) =>
    request<RoomSnapshot | null>(
      `/v1/rooms/recent/active?sessionId=${encodeURIComponent(sessionId)}`
    ),
  recoverRoom: (roomId: string, sessionId: string) =>
    request<RoomSnapshot | null>(
      `/v1/rooms/${roomId}/recover?sessionId=${encodeURIComponent(sessionId)}`
    ),
  listRooms: (sessionId?: string) =>
    request<RoomSnapshot[]>(
      sessionId ? `/v1/rooms?sessionId=${encodeURIComponent(sessionId)}` : "/v1/rooms"
    ),
  joinRoomByCode: (sessionId: string, joinCode: string) =>
    request<RoomSnapshot>("/v1/rooms/join-by-code", {
      method: "POST",
      body: JSON.stringify({ sessionId, joinCode })
    }),
  getRoom: (roomId: string, sessionId?: string) =>
    request<RoomSnapshot>(
      sessionId
        ? `/v1/rooms/${roomId}?sessionId=${encodeURIComponent(sessionId)}`
        : `/v1/rooms/${roomId}`
    ),
  leaveRoom: (roomId: string, sessionId: string) =>
    request(`/v1/rooms/${roomId}/leave`, {
      method: "POST",
      body: JSON.stringify({ sessionId })
    }),
  deleteRoom: (roomId: string, sessionId: string) =>
    request<{ ok: boolean }>(`/v1/rooms/${roomId}?sessionId=${encodeURIComponent(sessionId)}`, {
      method: "DELETE"
    }),
  registerTrack: (roomId: string, payload: object) =>
    request<TrackMeta>(`/v1/rooms/${roomId}/tracks`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  addQueueItem: (roomId: string, payload: object) =>
    request<QueueItem>(`/v1/rooms/${roomId}/queue`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  reorderQueue: (roomId: string, payload: { sessionId: string; queueItemIds: string[] }) =>
    request<QueueItem[]>(`/v1/rooms/${roomId}/queue/reorder`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  removeQueueItem: (roomId: string, queueItemId: string) =>
    request<QueueItem[]>(`/v1/rooms/${roomId}/queue/${queueItemId}`, {
      method: "DELETE"
    }),
  removeQueueItemAs: (roomId: string, queueItemId: string, sessionId: string) =>
    request<QueueItem[]>(
      `/v1/rooms/${roomId}/queue/${queueItemId}?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE"
      }
    ),
  updatePlayback: (roomId: string, payload: object) =>
    request<PlaybackSnapshot>(`/v1/rooms/${roomId}/playback`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  listPlaylists: (ownerId: string) =>
    request<Playlist[]>(`/v1/playlists?ownerId=${encodeURIComponent(ownerId)}`),
  updatePlaylist: (playlistId: string, payload: object) =>
    request<Playlist>(`/v1/playlists/${playlistId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deletePlaylist: (playlistId: string, ownerId: string) =>
    request<{ ok: boolean }>(
      `/v1/playlists/${playlistId}?ownerId=${encodeURIComponent(ownerId)}`,
      {
        method: "DELETE"
      }
    ),
  importPlaylistToRoom: (playlistId: string, payload: object) =>
    request<{ ok: boolean }>(`/v1/playlists/${playlistId}/import-to-room`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  createPlaylistFromRoom: (payload: object) =>
    request<Playlist>("/v1/playlists/from-room", {
      method: "POST",
      body: JSON.stringify(payload)
    })
};
