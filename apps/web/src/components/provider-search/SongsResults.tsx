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
  onToggleFavorite,
  onPlay
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
  onPlay?: (track: Track) => Promise<void> | void;
}) {
  return (
    <section className="mt-4 sm:mt-6">
      {results.length ? (
        <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-sm">
          {/* Desktop Table Header */}
          <div className="hidden grid-cols-[42px_minmax(0,1.4fr)_minmax(120px,0.75fr)_minmax(140px,1fr)_90px_100px] gap-3 border-b border-white/[0.08] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30 md:grid">
            <span>#</span>
            <span>单曲</span>
            <span>歌手</span>
            <span>专辑</span>
            <span>时长</span>
            <span className="text-right">操作</span>
          </div>

          {/* Track Rows */}
          <div className="divide-y divide-white/[0.05]">
            {results.map((track, index) => {
              const trackPlayKey = `play:${track.provider}:${track.providerTrackId}`;
              const isPlayingThis = pending === trackPlayKey;
              const downloaded = localTracks.some(
                (item) =>
                  item.provider === track.provider &&
                  item.providerTrackId === track.providerTrackId &&
                  item.availableOffline
              );
              const downloading = pending === `download:${track.provider}:${track.providerTrackId}`;

              return (
                <article
                  key={`${track.provider}-${track.providerTrackId}`}
                  className="group relative transition-colors hover:bg-white/[0.04] active:bg-white/[0.07]"
                  data-testid="search-track-row"
                >
                  {/* Mobile Row Design: Modern single-line ergonomic flex layout */}
                  <div
                    className="flex items-center justify-between gap-2.5 px-3 py-2.5 md:hidden cursor-pointer"
                    onClick={() => {
                      if (onPlay && pending === null) {
                        void onPlay(track);
                      }
                    }}
                  >
                    {/* Artwork with play overlay */}
                    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/50">
                      <Artwork alt={track.album ?? track.title} size="sm" src={track.artworkUrl} />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-active:opacity-100 transition-opacity">
                        {isPlayingThis ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        ) : (
                          <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* Meta: Title & Artist/Album */}
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-white/90 leading-tight">
                        {track.title}
                      </h3>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-white/45 truncate">
                        <span className="truncate">{track.artist}</span>
                        {track.album ? (
                          <>
                            <span className="text-white/20 shrink-0">·</span>
                            <span className="truncate max-w-[120px] text-white/40">{track.album}</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {/* Actions Cluster */}
                    <div
                      className="flex shrink-0 items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Play Button */}
                      {onPlay ? (
                        <Button
                          aria-label={`播放《${track.title}》`}
                          className="h-8 w-8 text-white/70 hover:text-white"
                          disabled={pending !== null}
                          onClick={() => void onPlay(track)}
                          size="icon"
                          title="播放"
                          type="button"
                          variant="ghost"
                        >
                          {isPlayingThis ? (
                            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                          ) : (
                            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          )}
                        </Button>
                      ) : null}

                      {/* Download */}
                      <Button
                        aria-label={downloaded ? `《${track.title}》已下载` : `下载《${track.title}》`}
                        className="h-8 w-8 text-white/70 hover:text-white"
                        disabled={pending !== null || downloaded || downloading}
                        onClick={() => void onDownload(track)}
                        size="icon"
                        title={downloaded ? "已下载" : downloading ? "下载中" : "下载到本地"}
                        type="button"
                        variant="ghost"
                      >
                        <Icon name={downloading ? "loading" : "download"} />
                      </Button>

                      {/* Add to Playlist */}
                      <Button
                        aria-label={`加入歌单 ${track.title}`}
                        className="h-8 w-8 text-white/70 hover:text-white"
                        disabled={pending !== null}
                        onClick={(event) => void onImportPlaylist(track, getAnchoredDialogAnchor(event.currentTarget))}
                        size="icon"
                        title="加入歌单"
                        type="button"
                        variant="ghost"
                      >
                        <Icon name="playlist-add" />
                      </Button>

                      {/* Favorite */}
                      <FavoriteTrackButton
                        className="h-8 w-8 text-white/70 hover:text-white"
                        isFavorite={isFavorite(track)}
                        onToggle={() => onToggleFavorite(track)}
                        pending={isTogglingFavorite(track)}
                        track={track}
                      />
                    </div>
                  </div>

                  {/* Desktop Grid Layout */}
                  <div
                    className="hidden cursor-pointer md:grid md:grid-cols-[42px_minmax(0,1.4fr)_minmax(120px,0.75fr)_minmax(140px,1fr)_90px_100px] md:items-center md:gap-3 md:px-5 md:py-3.5"
                    onClick={() => {
                      if (onPlay && pending === null) {
                        void onPlay(track);
                      }
                    }}
                  >
                    <div className="flex items-center text-sm tabular-nums text-white/25">
                      {isPlayingThis ? (
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      ) : (
                        <>
                          <span className="group-hover:hidden">{String(index + 1).padStart(2, "0")}</span>
                          <svg className="hidden h-4 w-4 text-white group-hover:block" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </>
                      )}
                    </div>

                    <div className="flex min-w-0 items-center gap-3">
                      <Artwork alt={track.album ?? track.title} size="sm" src={track.artworkUrl} />
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium text-white/90 group-hover:text-white transition-colors">
                          {track.title}
                        </h3>
                      </div>
                    </div>

                    <span className="truncate text-xs text-white/55">{track.artist}</span>
                    <TrackAlbumLink className="truncate text-xs" onAlbum={onAlbum} pending={pending} track={track} />
                    <span className="text-xs tabular-nums text-white/35">{formatDuration(track.durationMs)}</span>

                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        aria-label={downloaded ? `《${track.title}》已下载` : `下载《${track.title}》`}
                        className="h-8 w-8 text-white/60 hover:text-white"
                        disabled={pending !== null || downloaded || downloading}
                        onClick={() => void onDownload(track)}
                        size="icon"
                        title={downloaded ? "已下载" : downloading ? "下载中" : "下载到本地歌单"}
                        type="button"
                        variant="ghost"
                      >
                        <Icon name={downloading ? "loading" : "download"} />
                      </Button>
                      <Button
                        aria-label={`加入歌单 ${track.title}`}
                        className="h-8 w-8 text-white/60 hover:text-white"
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
                        className="h-8 w-8 text-white/60 hover:text-white"
                        isFavorite={isFavorite(track)}
                        onToggle={() => onToggleFavorite(track)}
                        pending={isTogglingFavorite(track)}
                        track={track}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <SearchEmptyState description="输入关键词后按回车开始搜索。" title="还没有搜索结果" />
      )}
    </section>
  );
}
