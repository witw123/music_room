import React from "react";
import type { LocalPlaylistTrackRecord } from "@/features/playlist/local-playlist";
import { formatDuration } from "@/lib/domain/music-room-ui";
import type { AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { getAnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { FavoriteTrackButton } from "@/components/ui/FavoriteTrackButton";
import { Button } from "@/components/ui/button";
import {
  Artwork,
  Icon,
  SearchEmptyState,
  TrackAlbumLink,
  type Track
} from "./search-ui-primitives";

export function SongsResults({
  results,
  pending,
  localTracks,
  onAlbum,
  onDownload,
  onImportPlaylist,
  isFavorite,
  isTogglingFavorite,
  onToggleFavorite
}: {
  results: Track[];
  pending: string | null;
  localTracks: LocalPlaylistTrackRecord[];
  onAlbum: (track: Track) => Promise<void>;
  onDownload: (track: Track) => Promise<void>;
  onImportPlaylist: (track: Track, anchor: AnchoredDialogAnchor) => Promise<void>;
  isFavorite: (track: Track) => boolean;
  isTogglingFavorite: (track: Track) => boolean;
  onToggleFavorite: (track: Track) => void;
}) {
  return (
    <section className="mt-7">
      {results.length ? (
        <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-black">
          <div className="hidden grid-cols-[42px_minmax(0,1.4fr)_minmax(120px,0.75fr)_minmax(140px,1fr)_90px_64px] gap-3 border-b border-white/[0.08] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30 md:grid">
            <span>#</span>
            <span>单曲</span>
            <span>歌手</span>
            <span>专辑</span>
            <span>时长</span>
            <span className="text-right">操作</span>
          </div>
          {results.map((track, index) => (
            <article
              className="grid gap-3 border-b border-white/[0.07] px-4 py-4 last:border-0 md:grid-cols-[42px_minmax(0,1.4fr)_minmax(120px,0.75fr)_minmax(140px,1fr)_90px_64px] md:items-center md:gap-3 md:px-5"
              key={`${track.provider}-${track.providerTrackId}`}
            >
              <span className="hidden text-sm tabular-nums text-white/25 md:block">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="flex min-w-0 items-center gap-3">
                <Artwork alt={track.album ?? track.title} size="sm" src={track.artworkUrl} />
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium text-white/90">{track.title}</h3>
                  <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs text-white/40 md:hidden">
                    {track.artist}
                    <span aria-hidden="true">·</span>
                    <TrackAlbumLink onAlbum={onAlbum} pending={pending} track={track} />
                  </p>
                </div>
              </div>
              <span className="hidden truncate text-xs text-white/55 md:block">{track.artist}</span>
              <TrackAlbumLink className="hidden truncate text-xs md:block" onAlbum={onAlbum} pending={pending} track={track} />
              <span className="hidden text-xs tabular-nums text-white/35 md:block">{formatDuration(track.durationMs)}</span>
              <div className="flex items-center justify-start md:justify-end">
                {(() => {
                  const downloaded = localTracks.some(
                    (item) =>
                      item.provider === track.provider &&
                      item.providerTrackId === track.providerTrackId &&
                      item.availableOffline
                  );
                  const downloading = pending === `download:${track.provider}:${track.providerTrackId}`;
                  return (
                    <Button
                      aria-label={downloaded ? `《${track.title}》已下载` : `下载《${track.title}》`}
                      className="h-10 w-10"
                      disabled={pending !== null || downloaded || downloading}
                      onClick={() => void onDownload(track)}
                      size="icon"
                      title={downloaded ? "已下载" : downloading ? "下载中" : "下载到本地歌单"}
                      type="button"
                      variant="ghost"
                    >
                      <Icon name={downloading ? "loading" : "download"} />
                    </Button>
                  );
                })()}
                <Button
                  aria-label={`加入歌单 ${track.title}`}
                  disabled={pending !== null}
                  onClick={(event) => void onImportPlaylist(track, getAnchoredDialogAnchor(event.currentTarget))}
                  size="icon"
                  title="加入歌单"
                  type="button"
                  variant="ghost"
                >
                  <Icon name="playlist-add" />
                </Button>
                <FavoriteTrackButton
                  isFavorite={isFavorite(track)}
                  onToggle={() => onToggleFavorite(track)}
                  pending={isTogglingFavorite(track)}
                  track={track}
                />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <SearchEmptyState description="输入关键词后按回车开始搜索。" title="还没有搜索结果" />
      )}
    </section>
  );
}
