import type {
  NeteaseAccountStatus,
  Playlist,
  ProviderAlbumFavorite,
  QqMusicAccountStatus,
  RoomDirectoryItem
} from "@music-room/shared";
import type { LocalPlaylistRecord } from "@/features/playlist/local-playlist";
import type { LocalPlaylistTrackRecord } from "@/features/library/indexeddb";
import type { ProfileProviderRecommendations } from "@/features/discovery/profile-provider-recommendations";

type Provider = "netease" | "qqmusic";
type ProviderAccount = NeteaseAccountStatus | QqMusicAccountStatus;

export type PlaylistPageData = {
  localTracks: LocalPlaylistTrackRecord[];
  localPlaylists: LocalPlaylistRecord[];
  networkPlaylists: Playlist[];
  localPlaylistDatabaseIds: Record<string, string>;
  roomTrackIndex: Map<string, LocalPlaylistTrackRecord>;
  localLoaded: boolean;
  networkLoaded: boolean;
};

const roomsByUser = new Map<string, RoomDirectoryItem[]>();
const playlistsByUser = new Map<string, PlaylistPageData>();
const favoritesByUser = new Map<string, ProviderAlbumFavorite[]>();
const providerAccountsByUser = new Map<string, ProviderAccount>();
const discoverByUser = new Map<string, { data: ProfileProviderRecommendations; cachedAt: number }>();

export function getCachedRooms(userId: string) {
  return roomsByUser.get(userId);
}

export function setCachedRooms(userId: string, rooms: RoomDirectoryItem[]) {
  roomsByUser.set(userId, rooms);
}

export function getCachedPlaylistData(userId: string) {
  return playlistsByUser.get(userId);
}

export function setCachedPlaylistData(userId: string, data: Partial<PlaylistPageData>) {
  const current = playlistsByUser.get(userId);
  playlistsByUser.set(userId, {
    localTracks: data.localTracks ?? current?.localTracks ?? [],
    localPlaylists: data.localPlaylists ?? current?.localPlaylists ?? [],
    networkPlaylists: data.networkPlaylists ?? current?.networkPlaylists ?? [],
    localPlaylistDatabaseIds: data.localPlaylistDatabaseIds ?? current?.localPlaylistDatabaseIds ?? {},
    roomTrackIndex: data.roomTrackIndex ?? current?.roomTrackIndex ?? new Map(),
    localLoaded: data.localLoaded ?? current?.localLoaded ?? false,
    networkLoaded: data.networkLoaded ?? current?.networkLoaded ?? false
  });
}

export function getCachedFavorites(userId: string) {
  return favoritesByUser.get(userId);
}

export function setCachedFavorites(userId: string, items: ProviderAlbumFavorite[]) {
  favoritesByUser.set(userId, items);
}

export function getCachedProviderAccount(userId: string, provider: "netease"): NeteaseAccountStatus | undefined;
export function getCachedProviderAccount(userId: string, provider: "qqmusic"): QqMusicAccountStatus | undefined;
export function getCachedProviderAccount(userId: string, provider: Provider): ProviderAccount | undefined;
export function getCachedProviderAccount(userId: string, provider: Provider) {
  return providerAccountsByUser.get(`${userId}:${provider}`);
}

export function setCachedProviderAccount(userId: string, provider: Provider, account: ProviderAccount) {
  providerAccountsByUser.set(`${userId}:${provider}`, account);
}

export function getCachedDiscoverData(userId: string, maxAgeMs = 15 * 60 * 1000): ProfileProviderRecommendations | undefined {
  const entry = discoverByUser.get(userId);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > maxAgeMs) {
    discoverByUser.delete(userId);
    return undefined;
  }
  return entry.data;
}

export function setCachedDiscoverData(userId: string, data: ProfileProviderRecommendations) {
  discoverByUser.set(userId, { data, cachedAt: Date.now() });
}

export function invalidateDiscoverDataCache(userId?: string) {
  if (userId) {
    discoverByUser.delete(userId);
  } else {
    discoverByUser.clear();
  }
}
