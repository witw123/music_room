import type {
  AuthSession,
  IceConfigResponse,
  NeteaseAccountStatus,
  NeteaseQrStartResponse,
  NeteaseQrStatusResponse,
  NeteaseSearchResponse,
  NeteaseTrackCandidate,
  ProviderAlbumListResponse,
  ProviderAlbumDetail,
  ProviderAlbumFavorite,
  ProviderArtistFavorite,
  ProviderArtistSummary,
  ProviderAudioResolveResponse,
  ProviderLyrics,
  ProviderLibrarySnapshot,
  ProviderPlaylistDetail,
  ProviderPlaylistListResponse,
  ProviderSearchSuggestionListResponse,
  ProviderTrackCandidate,
  ProviderTrackFavorite,
  QqMusicAccountStatus,
  QqMusicQrStartResponse,
  QqMusicQrStatusResponse,
  QqMusicSearchResponse,
  QqMusicTrackCandidate,
  PlaybackMode,
  PlaybackSnapshot,
  Playlist,
  RoomChatHistoryResponse,
  RoomDirectoryItem,
  RoomJoinResponse,
  RoomMemberPermissions,
  RoomSnapshot,
  RoomRequest,
  RoomType,
  PersonalizationFeedback,
  PersonalizationExclusion,
  PersonalizationProfileResponse,
  PersonalizationRecommendationsQuery,
  PersonalizationRecommendationsResponse,
  PersonalizationTrack,
  TrackRadioQuery,
  ColdStartTasteInput,
  RecordPersonalizationEvent,
  RoomSyncResponse,
  TrackMeta,
  UpdateRoomRequest
} from "@music-room/shared";
import {
  downloadWithDirectFallback,
  notifyPlaylistsChanged,
  request,
  requestBlob,
  type AuthConfig,
  type QueueMutationResponse,
  type RadioAutopilotNextTrackMutationResponse,
  type RoomActivitySummary,
  type RoomInteractionStats
} from "./music-room-api.base";

export * from "./music-room-api.base";

export const musicRoomApi = {
  getAuthConfig: () => request<AuthConfig>("/v1/auth/config"),
  register: (
    username: string,
    password: string,
    nickname: string,
    turnstileToken?: string
  ) =>
    request<AuthSession>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, nickname, turnstileToken })
    }),
  login: (username: string, password: string, turnstileToken?: string) =>
    request<AuthSession>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, turnstileToken })
    }),
  logout: () =>
    request<{ ok: boolean }>("/v1/auth/logout", {
      method: "POST"
    }),
  me: () => request<AuthSession>("/v1/auth/me", undefined, { notifyAuthExpired: false }),
  getPersonalizationProfile: () =>
    request<PersonalizationProfileResponse>("/v1/personalization/profile"),
  recordPersonalizationEvent: (input: RecordPersonalizationEvent) =>
    request<{ ok: boolean }>("/v1/personalization/events", {
      method: "POST",
      body: JSON.stringify(input),
      keepalive: true
    }),
  getPersonalizationRecommendations: (input: PersonalizationRecommendationsQuery) => {
    const params = new URLSearchParams({ surface: input.surface });
    if (input.provider) params.set("provider", input.provider);
    if (input.currentTrackKey) params.set("currentTrackKey", input.currentTrackKey);
    if (input.query) params.set("query", input.query);
    if (input.excludedTrackKeys?.length) params.set("excludedTrackKeys", input.excludedTrackKeys.join(","));
    return request<PersonalizationRecommendationsResponse>(`/v1/personalization/recommendations?${params.toString()}`);
  },
  recordPersonalizationFeedback: (input: PersonalizationFeedback) =>
    request<{ ok: boolean }>("/v1/personalization/feedback", { method: "POST", body: JSON.stringify(input) }),
  listPersonalizationExclusions: () =>
    request<PersonalizationExclusion[]>("/v1/personalization/exclusions"),
  removePersonalizationExclusion: (kind: "track" | "artist", key: string) =>
    request<{ ok: boolean }>(`/v1/personalization/exclusions/${kind}/${encodeURIComponent(key)}`, { method: "DELETE" }),
  getTrackRadio: (input: TrackRadioQuery) =>
    request<PersonalizationTrack[]>("/v1/personalization/radio", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  bootstrapColdStartProfile: (input: ColdStartTasteInput) =>
    request<{ ok: boolean }>("/v1/personalization/cold-start", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  clearPersonalizationProfile: () =>
    request<{ ok: boolean }>("/v1/personalization/profile", { method: "DELETE" }),
  createRoom: (input: {
    visibility?: "private" | "public";
    roomType: RoomType;
    name?: string;
    description?: string | null;
    password?: string;
    newMemberPermissions?: RoomMemberPermissions;
  }) =>
    request<RoomSnapshot>("/v1/rooms", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  getRecentRoom: () => request<RoomSnapshot | null>("/v1/rooms/recent/active"),
  getRecentRooms: () => request<RoomSnapshot[]>("/v1/rooms/recent"),
  getRoomActivity: () => request<RoomActivitySummary[]>("/v1/rooms/activity"),
  listOwnedRooms: () => request<RoomSnapshot[]>("/v1/rooms/owned"),
  getRoomInteractionStats: () => request<RoomInteractionStats>("/v1/rooms/stats"),
  recoverRoom: (roomId: string) =>
    request<RoomSnapshot | null>(`/v1/rooms/${roomId}/recover`),
  listRooms: () => request<RoomDirectoryItem[]>("/v1/rooms"),
  joinRoomByCode: (joinCode: string, password?: string) =>
    request<RoomJoinResponse>("/v1/rooms/join-by-code", {
      method: "POST",
      body: JSON.stringify({ joinCode, ...(password ? { password } : {}) })
    }),
  joinRoom: (roomId: string, password?: string) =>
    request<RoomSnapshot>(`/v1/rooms/${roomId}/join`, {
      method: "POST",
      body: password ? JSON.stringify({ password }) : undefined
    }),
  getRoom: (roomId: string) =>
    request<RoomSnapshot>(`/v1/rooms/${roomId}`),
  listRoomChatHistory: (roomId: string, before?: string) =>
    request<RoomChatHistoryResponse>(
      `/v1/rooms/${roomId}/chat${before ? `?before=${encodeURIComponent(before)}` : ""}`
    ),
  deleteRoomChatMessage: (roomId: string, messageId: string) =>
    request<{ roomId: string; messageId: string }>(`/v1/rooms/${roomId}/chat/${messageId}`, {
      method: "DELETE"
    }),
  syncRoom: (roomId: string, sinceRevision = 0) =>
    request<RoomSyncResponse>(`/v1/rooms/${roomId}/sync`, {
      headers: { "x-room-revision": String(Math.max(0, Math.floor(sinceRevision))) }
    }),
  updateRoom: (roomId: string, input: UpdateRoomRequest) =>
    request<RoomSnapshot>(`/v1/rooms/${roomId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  listRoomRequests: (roomId: string) => request<RoomRequest[]>(`/v1/rooms/${roomId}/requests`),
  createRoomRequest: (roomId: string, input: Omit<RoomRequest, "id" | "roomId" | "requesterId" | "requesterName" | "status" | "createdAt">) =>
    request<RoomRequest>(`/v1/rooms/${roomId}/requests`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  approveRoomRequest: (roomId: string, requestId: string) =>
    request<RoomRequest>(`/v1/rooms/${roomId}/requests/${requestId}/approve`, { method: "POST" }),
  rejectRoomRequest: (roomId: string, requestId: string) =>
    request<RoomRequest>(`/v1/rooms/${roomId}/requests/${requestId}/reject`, { method: "POST" }),
  getRoomReactionCounts: (roomId: string, trackId?: string | null) =>
    request<{ like: number; applause: number; fire?: number; sparkle?: number }>(`/v1/rooms/${roomId}/reactions${trackId ? `?trackId=${encodeURIComponent(trackId)}` : ""}`),
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
  registerTracks: (roomId: string, payload: { tracks: object[] }) =>
    request<TrackMeta[]>(`/v1/rooms/${roomId}/tracks/batch`, {
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
  updateRadioAutopilot: (roomId: string, payload: { enabled: boolean }) =>
    request<RoomSnapshot>(`/v1/rooms/${roomId}/radio-autopilot`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  insertRadioAutopilotNextTrack: (roomId: string, payload: { trackId: string }) =>
    request<RadioAutopilotNextTrackMutationResponse>(`/v1/rooms/${roomId}/radio-autopilot/next`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  reorderQueue: (roomId: string, payload: { queueItemIds: string[] }) =>
    request<QueueMutationResponse>(`/v1/rooms/${roomId}/queue/reorder`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  setNextQueueItem: (roomId: string, payload: { queueItemId: string }) =>
    request<QueueMutationResponse>(`/v1/rooms/${roomId}/queue/next`, {
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
  searchNeteaseSuggestions: (keywords: string) => {
    const params = new URLSearchParams({ keywords });
    return request<ProviderSearchSuggestionListResponse>(`/v1/providers/netease/search/suggest?${params.toString()}`);
  },
  getNeteaseSearchHot: () =>
    request<ProviderSearchSuggestionListResponse>("/v1/providers/netease/search/hot"),
  getNeteaseTrack: (trackId: string) =>
    request<NeteaseTrackCandidate>(`/v1/providers/netease/tracks/${encodeURIComponent(trackId)}`),
  getNeteaseLyrics: (trackId: string) =>
    request<ProviderLyrics>(`/v1/providers/netease/tracks/${encodeURIComponent(trackId)}/lyrics`),
  getNeteaseLibrary: () => request<ProviderLibrarySnapshot>("/v1/providers/netease/library"),
  listNeteaseRelatedPlaylists: (trackId: string) =>
    request<ProviderPlaylistListResponse>(`/v1/providers/netease/tracks/${encodeURIComponent(trackId)}/related-playlists`),
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
  searchQqMusicSuggestions: (keywords: string) => {
    const params = new URLSearchParams({ keywords });
    return request<ProviderSearchSuggestionListResponse>(`/v1/providers/qqmusic/search/suggest?${params.toString()}`);
  },
  getQqMusicSearchHot: () =>
    request<ProviderSearchSuggestionListResponse>("/v1/providers/qqmusic/search/hot"),
  searchQqMusicPlaylists: (keywords: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams({
      keywords,
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0)
    });
    return request<ProviderPlaylistListResponse>(`/v1/providers/qqmusic/search/playlists?${params.toString()}`);
  },
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
  getQqMusicLibrary: () => request<ProviderLibrarySnapshot>("/v1/providers/qqmusic/library"),
  listQqMusicRelatedPlaylists: (trackId: string) =>
    request<ProviderPlaylistListResponse>(`/v1/providers/qqmusic/tracks/${encodeURIComponent(trackId)}/related-playlists`),
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
  listFavoriteArtists: () => request<ProviderArtistFavorite[]>("/v1/favorites/artists"),
  saveFavoriteArtist: (artist: ProviderArtistSummary) =>
    request<ProviderArtistFavorite>("/v1/favorites/artists", {
      method: "PUT",
      body: JSON.stringify(artist)
    }),
  deleteFavoriteArtist: (provider: "netease" | "qqmusic", providerArtistId: string) =>
    request<{ ok: boolean }>(
      `/v1/favorites/artists/${provider}/${encodeURIComponent(providerArtistId)}`,
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
  downloadQqMusicArtwork: (artworkUrl: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ url: artworkUrl });
    return requestBlob(`/v1/providers/qqmusic/artwork?${params.toString()}`, { signal });
  },
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
}
