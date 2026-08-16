"use client";

import type { ListeningTrack, ListeningTrackMetadata, TrackMeta } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";

const pendingMetadataLookups = new Map<string, Promise<ListeningTrackMetadata>>();

export function ensureListeningTrackMetadata(track: TrackMeta) {
  const listeningTrack = toListeningTrack(track);
  if (!listeningTrack) return Promise.resolve(null);

  const pending = pendingMetadataLookups.get(listeningTrack.key);
  if (pending) return pending;

  const lookup = musicRoomApi.resolveListeningTrackMetadata(listeningTrack)
    .finally(() => pendingMetadataLookups.delete(listeningTrack.key));
  pendingMetadataLookups.set(listeningTrack.key, lookup);
  return lookup;
}

export function toListeningTrack(track: TrackMeta | null): ListeningTrack | null {
  if (!track) return null;
  const provider = track.sourceRef?.provider ?? track.sourceType;
  if (provider !== "local_upload" && provider !== "netease" && provider !== "qqmusic") return null;
  const providerTrackId = track.sourceRef?.trackId ?? track.fileHash ?? track.id;
  if (!providerTrackId) return null;
  return {
    key: `${provider}:${providerTrackId}`,
    provider,
    providerTrackId,
    title: track.title.trim() || "未命名歌曲",
    artist: track.artist.trim() || "未知艺人",
    album: track.album?.trim() || null,
    durationMs: Math.max(0, Math.round(track.durationMs)),
    artworkUrl: /^https?:\/\//i.test(track.artworkUrl ?? "") ? track.artworkUrl : null
  };
}
