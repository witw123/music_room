/* eslint-disable @next/next/no-img-element */
import React, { useEffect, useState } from "react";
import type { Playlist } from "@music-room/shared";
import type { LocalPlaylistRecord, LocalPlaylistTrackRecord } from "@/features/playlist/local-playlist";
import { toProviderTrackRecord, upsertLocalPlaylistTrack } from "@/features/playlist/local-playlist";
import { musicRoomApi } from "@/lib/network/music-room-api";

export type NetworkPlaylistSource = { provider: "netease" | "qqmusic"; playlistId: string };

export function Artwork({
  artworkUrl,
  artworkUrls,
  title,
  size = "sm"
}: {
  artworkUrl?: string | null;
  artworkUrls?: readonly (string | null | undefined)[];
  title: string;
  size?: "sm" | "lg" | "row" | "cover";
}) {
  const sizeClass =
    size === "cover"
      ? "aspect-square w-full rounded-none"
      : size === "lg"
        ? "h-24 w-24 rounded-xl"
        : size === "row"
          ? "h-16 w-16 rounded-lg"
          : "h-10 w-10 rounded-lg";
  const sources = uniqueArtworkUrls([...(artworkUrls ?? []), artworkUrl]);
  const sourceKey = sources.join("\u001f");
  const [failedSourceIndex, setFailedSourceIndex] = useState(0);

  useEffect(() => {
    setFailedSourceIndex(0);
  }, [sourceKey]);

  const activeArtworkUrl = sources[failedSourceIndex] ?? null;

  return (
    <div
      aria-label={`${title} 封面`}
      className={`${sizeClass} flex shrink-0 items-center justify-center overflow-hidden border border-surface-border bg-surface text-lg font-bold text-foreground-muted`}
    >
      {activeArtworkUrl ? (
        <img
          alt=""
          className="h-full w-full object-cover"
          decoding="async"
          draggable={false}
          onError={() => setFailedSourceIndex((current) => current + 1)}
          src={activeArtworkUrl}
        />
      ) : (
        title.slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

export function getTrackArtworkUrls(tracks: readonly Pick<LocalPlaylistTrackRecord, "artworkUrl">[]) {
  return uniqueArtworkUrls(tracks.map((track) => track.artworkUrl));
}

export function getPlaylistArtworkCandidates(
  playlist: Playlist,
  roomTrackIndex: ReadonlyMap<string, LocalPlaylistTrackRecord>,
  localTracks: readonly LocalPlaylistTrackRecord[] = []
) {
  const localTrackIndex = new Map(localTracks.map((track) => [track.id, track]));
  return uniqueArtworkUrls([
    playlist.coverUrl,
    ...playlist.trackIds.flatMap((trackId) => [
      roomTrackIndex.get(trackId)?.artworkUrl,
      localTrackIndex.get(trackId)?.artworkUrl
    ])
  ]);
}

export function uniqueArtworkUrls(urls: readonly (string | null | undefined)[]) {
  const result: string[] = [];
  for (const value of urls) {
    if (typeof value !== "string") continue;
    const url = value.trim();
    if (!url) continue;
    const secureUrl = url.replace(/^http:\/\//i, "https://");
    if (!result.includes(secureUrl)) result.push(secureUrl);
    if (secureUrl !== url && !result.includes(url)) result.push(url);
  }
  return result;
}

export async function resolveLegacyNetworkPlaylistArtwork(
  playlist: Playlist,
  roomTrackIndex: ReadonlyMap<string, LocalPlaylistTrackRecord>
) {
  const sources = playlist.trackIds
    .map((trackId) => parseProviderTrackSource(trackId))
    .filter((source): source is { provider: "netease" | "qqmusic"; trackId: string } => !!source)
    .slice(0, 4);
  if (sources.length === 0) return [];

  const resolvedArtwork = await Promise.all(
    sources.map(async (source) => {
      const cached = [...roomTrackIndex.values()].find(
        (track) => track.provider === source.provider && track.providerTrackId === source.trackId
      );
      if (cached?.artworkUrl) return cached.artworkUrl;
      try {
        const track =
          source.provider === "netease"
            ? await musicRoomApi.getNeteaseTrack(source.trackId)
            : await musicRoomApi.getQqMusicTrack(source.trackId);
        const resolved = toProviderTrackRecord(track, cached);
        if (resolved.artworkUrl) {
          try {
            await upsertLocalPlaylistTrack(resolved);
          } catch {
            // The remote candidate is still usable for the current render.
          }
        }
        return resolved.artworkUrl;
      } catch {
        return null;
      }
    })
  );
  return uniqueArtworkUrls(resolvedArtwork);
}

export function parseProviderTrackSource(trackId: string) {
  const [, provider, ...trackIdParts] = trackId.split(":");
  if (provider !== "netease" && provider !== "qqmusic") return null;
  const resolvedTrackId = trackIdParts.join(":").trim();
  return resolvedTrackId ? { provider, trackId: resolvedTrackId } : null;
}

export function getNetworkPlaylistSource(playlist: Playlist): NetworkPlaylistSource | null {
  const sourceTag = playlist.tags.find((tag) => tag.startsWith("network:"));
  if (!sourceTag) return null;
  const [, provider, ...playlistIdParts] = sourceTag.split(":");
  if (provider !== "netease" && provider !== "qqmusic") return null;
  const playlistId = playlistIdParts.join(":").trim();
  return playlistId ? { provider, playlistId } : null;
}

export function tracksForLocalPlaylist(
  playlist: LocalPlaylistRecord,
  tracks: LocalPlaylistTrackRecord[]
) {
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  return playlist.trackIds
    .map((trackId) => trackMap.get(trackId))
    .filter((track): track is LocalPlaylistTrackRecord => Boolean(track));
}

export async function resolveProviderArtwork(
  track: LocalPlaylistTrackRecord,
  provider: "netease" | "qqmusic"
) {
  if (track.artworkUrl || !track.providerTrackId) return track;
  try {
    const providerTrack =
      provider === "netease"
        ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
        : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
    return toProviderTrackRecord(providerTrack, track);
  } catch {
    return track;
  }
}
