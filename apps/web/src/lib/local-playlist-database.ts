import type { Playlist } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";
import type { LocalPlaylistRecord } from "@/features/playlist/local-playlist";

export const localPlaylistMirrorTagPrefix = "local-playlist:";

export function isLocalPlaylistMirror(playlist: Playlist) {
  return playlist.tags.includes("local") || playlist.tags.some((tag) => tag.startsWith(localPlaylistMirrorTagPrefix));
}

export function localPlaylistIdFromMirror(playlist: Playlist) {
  return playlist.tags.find((tag) => tag.startsWith(localPlaylistMirrorTagPrefix))?.slice(localPlaylistMirrorTagPrefix.length) ?? null;
}

export async function syncLocalPlaylistToDatabase(
  playlist: LocalPlaylistRecord,
  databasePlaylistId?: string,
  existing?: Playlist
) {
  const tags = ["local", `${localPlaylistMirrorTagPrefix}${playlist.id}`];
  if (databasePlaylistId) {
    if (
      existing &&
      existing.title === playlist.title &&
      existing.description === playlist.description &&
      sameStringArray(existing.trackIds, playlist.trackIds) &&
      sameStringArray(existing.tags, tags)
    ) {
      return existing;
    }
    return musicRoomApi.updatePlaylist(databasePlaylistId, {
      title: playlist.title,
      description: playlist.description,
      trackIds: playlist.trackIds,
      tags
    });
  }
  return musicRoomApi.createPlaylist({
    title: playlist.title,
    description: playlist.description,
    trackIds: playlist.trackIds,
    tags,
    isCollaborative: false
  });
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
