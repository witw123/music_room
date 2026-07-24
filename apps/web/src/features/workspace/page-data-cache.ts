import type {
  NeteaseAccountStatus,
  Playlist,
  ProviderAlbumFavorite,
  QqMusicAccountStatus,
  RoomSnapshot
} from "@music-room/shared";
import type { LocalAudioStorageState } from "@/features/upload/local-audio-storage";
import type { LocalPlaylistRecord } from "@/features/playlist/local-playlist";
import type { LocalPlaylistTrackRecord } from "@/lib/indexeddb";

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

export type LocalStoragePageData = {
  state: LocalAudioStorageState;
  cachedTrackCount: number;
  cacheBytes: number;
};

const roomsByUser = new Map<string, RoomSnapshot[]>();
const playlistsByUser = new Map<string, PlaylistPageData>();
const favoritesByUser = new Map<string, ProviderAlbumFavorite[]>();
const providerAccountsByUser = new Map<string, ProviderAccount>();
let localStorageData: LocalStoragePageData | undefined;

export function getCachedRooms(userId: string) {
  return roomsByUser.get(userId);
}

export function setCachedRooms(userId: string, rooms: RoomSnapshot[]) {
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

export function getCachedLocalStorageData() {
  return localStorageData;
}

export function setCachedLocalStorageData(data: LocalStoragePageData) {
  localStorageData = data;
}
