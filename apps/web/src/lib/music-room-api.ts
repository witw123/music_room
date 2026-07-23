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
  type ProviderAlbumListResponse,
  type ProviderAlbumDetail,
  type ProviderAlbumFavorite,
  type ProviderAudioResolveResponse,
  type ProviderDiscoveryBannerListResponse,
  type ProviderLyrics,
  type ProviderPlaylistCategoryListResponse,
  type ProviderPlaylistDetail,
  type ProviderPlaylistListResponse,
  type ProviderTrackListResponse,
  type ProviderTrackCandidate,
  type ProviderTrackFavorite,
  type QqMusicAccountStatus,
  type QqMusicQrStartResponse,
  type QqMusicQrStatusResponse,
  type QqMusicSearchResponse,
  type QqMusicTrackCandidate,
  type PlaybackMode,
  type PlaybackSnapshot,
  type Playlist,
  type QueueItem,
  type RoomMemberPermissions,
  type RoomSnapshot,
  type RoomSyncResponse,
  type TrackMeta,
  type UpdateRoomRequest
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

export const playlistsChangedEventName = "music-room-playlists-changed";
export const playlistsChangedStorageKey = "music-room-playlists-version";

let playlistsChangeSequence = 0;

function notifyPlaylistsChanged() {
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
    newMemberPermissions?: RoomMemberPermissions;
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
  syncRoom: (roomId: string, sinceRevision = 0) =>
    request<RoomSyncResponse>(`/v1/rooms/${roomId}/sync`, {
      headers: { "x-room-revision": String(Math.max(0, Math.floor(sinceRevision))) }
    }),
  updateRoom: (roomId: string, input: UpdateRoomRequest) =>
    request<RoomSnapshot>(`/v1/rooms/${roomId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateRoomMemberPermissions: (
    roomId: string,
    memberId: string,
    permissions: RoomMemberPermissions
  ) =>
    request<RoomSnapshot>(`/v1/rooms/${roomId}/members/${memberId}/permissions`, {
      method: "PATCH",
      body: JSON.stringify({ permissions })
    }),
  removeRoomMember: (roomId: string, memberId: string) =>
    request<RoomSnapshot>(`/v1/rooms/${roomId}/members/${memberId}`, {
      method: "DELETE"
    }),
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
      action: "play" | "pause" | "seek" | "next" | "prev" | "gapless-next" | "set-mode";
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
  getNeteaseLyrics: (trackId: string) =>
    request<ProviderLyrics>(`/v1/providers/netease/tracks/${encodeURIComponent(trackId)}/lyrics`),
  listNeteasePlaylists: (options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      limit: String(options?.limit ?? 30),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderPlaylistListResponse>(`/v1/providers/netease/playlists?${params.toString()}`);
  },
  searchNeteasePlaylists: (keywords: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      keywords,
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderPlaylistListResponse>(`/v1/providers/netease/search/playlists?${params.toString()}`);
  },
  listNeteaseRecommendedPlaylists: (options?: { limit?: number }) =>
    request<ProviderPlaylistListResponse>(`/v1/providers/netease/discover/playlists/recommended?limit=${options?.limit ?? 30}`),
  listNeteaseDiscoveryPlaylists: (options?: { category?: string; order?: "hot" | "new"; limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      category: options?.category ?? "全部",
      order: options?.order ?? "hot",
      limit: String(options?.limit ?? 30),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderPlaylistListResponse>(`/v1/providers/netease/discover/playlists?${params.toString()}`);
  },
  listNeteasePlaylistCategories: () =>
    request<ProviderPlaylistCategoryListResponse>("/v1/providers/netease/discover/playlist-categories"),
  listNeteaseToplists: () =>
    request<ProviderPlaylistListResponse>("/v1/providers/netease/discover/toplists"),
  listNeteaseNewAlbums: (options?: { area?: "all" | "zh" | "ea" | "kr" | "jp"; limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      area: options?.area ?? "all",
      limit: String(options?.limit ?? 30),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderAlbumListResponse>(`/v1/providers/netease/discover/albums/new?${params.toString()}`);
  },
  listNeteaseDailyPlaylists: () =>
    request<ProviderPlaylistListResponse>("/v1/providers/netease/discover/playlists/daily"),
  listNeteaseDailyTracks: () =>
    request<ProviderTrackListResponse>("/v1/providers/netease/discover/tracks/daily"),
  searchNeteaseAlbums: (keywords: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      keywords,
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderAlbumListResponse>(`/v1/providers/netease/search/albums?${params.toString()}`);
  },
  getNeteasePlaylist: (playlistId: string) =>
    request<ProviderPlaylistDetail>(`/v1/providers/netease/playlists/${encodeURIComponent(playlistId)}`),
  getNeteaseAlbum: (albumId: string) =>
    request<ProviderAlbumDetail>(`/v1/providers/netease/albums/${encodeURIComponent(albumId)}`),
  resolveNeteaseAudio: (
    trackId: string,
    quality: "standard" | "high" | "exhigh" = "exhigh"
  ) =>
    request<ProviderAudioResolveResponse>(
      `/v1/providers/netease/tracks/${encodeURIComponent(trackId)}/audio-url?quality=${quality}`
    ),
  downloadNeteaseTrack: (
    trackId: string,
    quality: "standard" | "high" | "exhigh" = "exhigh",
    signal?: AbortSignal
  ) =>
    downloadWithDirectFallback({
      resolve: () => musicRoomApi.resolveNeteaseAudio(trackId, quality),
      fallback: () => requestBlob(`/v1/providers/netease/tracks/${encodeURIComponent(trackId)}/audio?quality=${quality}`, { signal }, { throttleImport: true }),
      signal
    }),
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
  searchQqMusicPlaylists: (keywords: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      keywords,
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderPlaylistListResponse>(`/v1/providers/qqmusic/search/playlists?${params.toString()}`);
  },
  listQqMusicPlaylistCategories: () =>
    request<ProviderPlaylistCategoryListResponse>("/v1/providers/qqmusic/discover/playlist-categories"),
  listQqMusicDiscoveryPlaylists: (options?: { categoryId?: number; sortId?: number; limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      categoryId: String(options?.categoryId ?? 10_000_000),
      sortId: String(options?.sortId ?? 5),
      limit: String(options?.limit ?? 30),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderPlaylistListResponse>(`/v1/providers/qqmusic/discover/playlists?${params.toString()}`);
  },
  listQqMusicToplists: () =>
    request<ProviderPlaylistListResponse>("/v1/providers/qqmusic/discover/toplists"),
  listQqMusicDigitalAlbums: (options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      limit: String(options?.limit ?? 30),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderAlbumListResponse>(`/v1/providers/qqmusic/discover/albums/digital?${params.toString()}`);
  },
  listQqMusicBanners: () =>
    request<ProviderDiscoveryBannerListResponse>("/v1/providers/qqmusic/discover/banners"),
  searchQqMusicAlbums: (keywords: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      keywords,
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderAlbumListResponse>(`/v1/providers/qqmusic/search/albums?${params.toString()}`);
  },
  getQqMusicTrack: (trackId: string) => request<QqMusicTrackCandidate>(`/v1/providers/qqmusic/tracks/${encodeURIComponent(trackId)}`),
  getQqMusicLyrics: (trackId: string) =>
    request<ProviderLyrics>(`/v1/providers/qqmusic/tracks/${encodeURIComponent(trackId)}/lyrics`),
  listQqMusicPlaylists: (options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      limit: String(options?.limit ?? 30),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderPlaylistListResponse>(`/v1/providers/qqmusic/playlists?${params.toString()}`);
  },
  getQqMusicPlaylist: (playlistId: string) =>
    request<ProviderPlaylistDetail>(`/v1/providers/qqmusic/playlists/${encodeURIComponent(playlistId)}`),
  getQqMusicAlbum: (albumId: string) =>
    request<ProviderAlbumDetail>(`/v1/providers/qqmusic/albums/${encodeURIComponent(albumId)}`),
  listFavoriteAlbums: () => request<ProviderAlbumFavorite[]>("/v1/favorites/albums"),
  saveFavoriteAlbum: (album: Omit<ProviderAlbumFavorite, "id" | "createdAt" | "updatedAt">) =>
    request<ProviderAlbumFavorite>("/v1/favorites/albums", {
      method: "PUT",
      body: JSON.stringify(album)
    }),
  deleteFavoriteAlbum: (provider: "netease" | "qqmusic", providerAlbumId: string) =>
    request<{ ok: boolean }>(
      `/v1/favorites/albums/${provider}/${encodeURIComponent(providerAlbumId)}`,
      { method: "DELETE" }
    ),
  listFavoriteTracks: () => request<ProviderTrackFavorite[]>("/v1/favorites/tracks"),
  saveFavoriteTrack: (track: ProviderTrackCandidate) =>
    request<ProviderTrackFavorite>("/v1/favorites/tracks", {
      method: "PUT",
      body: JSON.stringify(track)
    }),
  deleteFavoriteTrack: (provider: "netease" | "qqmusic", providerTrackId: string) =>
    request<{ ok: boolean }>(
      `/v1/favorites/tracks/${provider}/${encodeURIComponent(providerTrackId)}`,
      { method: "DELETE" }
    ),
  resolveQqMusicAudio: (
    trackId: string,
    quality: "standard" | "high" | "exhigh" = "exhigh"
  ) =>
    request<ProviderAudioResolveResponse>(
      `/v1/providers/qqmusic/tracks/${encodeURIComponent(trackId)}/audio-url?quality=${quality}`
    ),
  downloadQqMusicTrack: (
    trackId: string,
    quality: "standard" | "high" | "exhigh" = "exhigh",
    signal?: AbortSignal
  ) =>
    downloadWithDirectFallback({
      resolve: () => musicRoomApi.resolveQqMusicAudio(trackId, quality),
      fallback: () => requestBlob(`/v1/providers/qqmusic/tracks/${encodeURIComponent(trackId)}/audio?quality=${quality}`, { signal }, { throttleImport: true }),
      signal
    }),
  listMyPlaylists: () =>
    request<Playlist[]>("/v1/playlists"),
  createPlaylist: (payload: {
    title: string;
    description?: string | null;
    trackIds?: string[];
    tags?: string[];
    coverUrl?: string | null;
    isCollaborative?: boolean;
  }) =>
    request<Playlist>("/v1/playlists", {
      method: "POST",
      body: JSON.stringify(payload)
    }).then((playlist) => {
      notifyPlaylistsChanged();
      return playlist;
    }),
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
    }).then((playlist) => {
      notifyPlaylistsChanged();
      return playlist;
    }),
  deletePlaylist: (playlistId: string) =>
    request<{ ok: boolean }>(`/v1/playlists/${playlistId}`, {
      method: "DELETE"
    }).then((result) => {
      notifyPlaylistsChanged();
      return result;
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
    }).then((playlist) => {
      notifyPlaylistsChanged();
      return playlist;
    })
};

async function downloadWithDirectFallback(input: {
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
