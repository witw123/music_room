import React from "react";
import type { Playlist } from "@music-room/shared";
import type { LocalPlaylistRecord, LocalPlaylistTrackRecord } from "@/features/playlist/local-playlist";
import { Button } from "@/components/ui/button";
import {
  Artwork,
  getNetworkPlaylistSource,
  getTrackArtworkUrls
} from "./playlist-artwork";

export function LocalPlaylistCard({
  onOpen,
  onDelete,
  playlist,
  tracks
}: {
  onOpen: () => void;
  onDelete?: () => void;
  playlist: LocalPlaylistRecord;
  tracks: LocalPlaylistTrackRecord[];
}) {
  const artworkUrls = getTrackArtworkUrls(tracks);
  const downloadedCount = tracks.filter((track) => track.availableOffline).length;

  return (
    <article className="group relative min-w-0">
      <button
        aria-label={`打开本地歌单 ${playlist.title}`}
        className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        onClick={onOpen}
        type="button"
      >
        <div className="relative aspect-square overflow-hidden rounded-xl bg-surface shadow-[0_12px_28px_rgba(0,0,0,0.18)] transition-transform duration-200 group-hover:-translate-y-1">
          <Artwork artworkUrls={artworkUrls} size="cover" title={playlist.title} />
          <span className="absolute bottom-3 left-3 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-sm">
            本地
          </span>
        </div>
        <div className="min-w-0 px-1 pt-3">
          <strong className="block truncate text-[15px] font-semibold text-foreground">
            {playlist.title}
          </strong>
          <p className="mt-1 truncate text-sm text-foreground-muted">
            {playlist.sourceDirectoryName ? `目录：${playlist.sourceDirectoryName}` : "项目根目录"} · {tracks.length} 首歌曲 · 已下载 {downloadedCount}
          </p>
        </div>
      </button>
      {onDelete ? (
        <Button
          aria-label={`删除本地歌单 ${playlist.title}`}
          className="absolute right-2 top-2 h-10 w-10 bg-black/60 text-white/80 opacity-100 backdrop-blur-sm transition-opacity hover:bg-red-500/80 hover:text-white sm:h-8 sm:w-8 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onDelete}
          size="icon"
          title="删除歌单"
          type="button"
          variant="ghost"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="15"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width="15"
          >
            <path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" />
          </svg>
        </Button>
      ) : null}
    </article>
  );
}

export function NetworkPlaylistCard({
  playlist,
  artworkUrls,
  onOpen,
  onDelete
}: {
  playlist: Playlist;
  artworkUrls: readonly string[];
  onOpen: () => void;
  onDelete: () => void;
}) {
  const source = getNetworkPlaylistSource(playlist);
  const providerName =
    source?.provider === "qqmusic"
      ? "QQ 音乐"
      : source?.provider === "netease"
        ? "网易云音乐"
        : "网络歌单";

  return (
    <article className="group relative min-w-0">
      <button
        aria-label={`打开歌单 ${playlist.title}`}
        className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        onClick={onOpen}
        type="button"
      >
        <div className="relative aspect-square overflow-hidden rounded-xl bg-surface shadow-[0_12px_28px_rgba(0,0,0,0.18)] transition-transform duration-200 group-hover:-translate-y-1">
          <Artwork artworkUrls={artworkUrls} size="cover" title={playlist.title} />
        </div>
        <div className="min-w-0 px-1 pt-3">
          <strong className="block truncate text-[15px] font-semibold text-foreground">
            {playlist.title}
          </strong>
          <p className="mt-1 truncate text-sm text-foreground-muted">
            {providerName} · {playlist.trackIds.length} 首歌曲
          </p>
        </div>
      </button>
      <Button
        aria-label={`删除歌单 ${playlist.title}`}
        className="absolute right-2 top-2 h-10 w-10 bg-black/60 text-white/80 opacity-100 backdrop-blur-sm transition-opacity hover:bg-red-500/80 hover:text-white sm:h-8 sm:w-8 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onDelete}
        size="icon"
        title="删除歌单"
        type="button"
        variant="ghost"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="15"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
          width="15"
        >
          <path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" />
        </svg>
      </Button>
    </article>
  );
}
