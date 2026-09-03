"use client";

import { useState } from "react";
import type {
  NeteaseTrackCandidate,
  ProviderAlbumDetail,
  ProviderTrackCandidate,
  QqMusicTrackCandidate
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { FavoriteTrackButton } from "@/components/ui/FavoriteTrackButton";
import { MobileTrackActionsMenu, type MobileTrackAction } from "@/components/ui/MobileTrackActionsMenu";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { getAnchoredDialogAnchor, type AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import {
  PlayIcon,
  HeartIcon,
  SparklesIcon,
  ChevronLeftIcon
} from "@/components/icons/DiscoverIcons";

type Track = NeteaseTrackCandidate | QqMusicTrackCandidate;

export type ProviderAlbumTrackActions = {
  isDownloaded?: (track: Track) => boolean;
  isPlayable?: (track: Track) => boolean;
  isQueueable?: (track: Track) => boolean;
  isQueued?: (track: Track) => boolean;
  isDownloading?: (track: Track) => boolean;
  isPreparingPlayback?: (track: Track) => boolean;
  onDownload?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  onPlay?: (track: Track) => void;
  onAddToPlaylist?: (track: Track, anchor: AnchoredDialogAnchor) => void;
  isFavorite?: (track: Track) => boolean;
  onToggleFavorite?: (track: Track) => void | Promise<void>;
  isTogglingFavorite?: (track: Track) => boolean;
};

type ProviderAlbumDetailViewProps = {
  album: ProviderAlbumDetail;
  isFavorite: boolean;
  onBack: () => void;
  onToggleFavorite: () => Promise<void>;
  pending: string | null;
  onAddAlbumToPlaylist?: (anchor: AnchoredDialogAnchor) => void;
  trackActions?: ProviderAlbumTrackActions;
};

export function ProviderAlbumDetailView({
  album,
  isFavorite,
  onBack,
  onToggleFavorite,
  pending,
  onAddAlbumToPlaylist,
  trackActions
}: ProviderAlbumDetailViewProps) {
  return (
    <section className="mt-3 sm:mt-6 animate-in fade-in duration-300">
      {/* Sleek Vector Back Button */}
      <button
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-foreground-muted transition-all hover:bg-white/[0.08] hover:text-white mb-4 sm:mb-6 border border-white/[0.06] backdrop-blur-md"
        onClick={onBack}
        type="button"
      >
        <ChevronLeftIcon className="w-3.5 h-3.5" />
        <span>返回</span>
      </button>

      {/* Atmospheric Album Hero Stage */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#131622]/90 to-[#0b0d14]/95 p-4 sm:p-6 md:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl grid gap-5 sm:gap-8 grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)] items-center sm:items-end">
        {/* Ambient Glow Aura */}
        <div className="absolute -top-12 -right-12 w-64 h-64 rounded-full bg-[radial-gradient(circle,#38bdf818_0%,transparent_70%)] blur-2xl pointer-events-none" />

        <div className="w-36 sm:w-44 md:w-full max-w-[240px] mx-auto sm:mx-0 shrink-0">
          <AlbumArtwork alt={album.title} src={album.artworkUrl} />
        </div>
        <div className="relative z-10 flex min-w-0 flex-col justify-end text-center sm:text-left">
          <div className="flex items-center justify-center sm:justify-start gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-accent/15 text-accent border border-accent/20">
              <SparklesIcon className="w-3 h-3" />
              <span>ALBUM</span>
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white">{album.title}</h1>
          <p className="mt-2 text-xs sm:text-sm text-foreground-muted font-medium">
            {album.artist} · {album.releaseTime || "发行时间未知"} · {album.tracks.length} 首歌曲
          </p>
          <DescriptionDisclosure description={album.description} />
          <div className="mt-5 flex flex-wrap items-center justify-center sm:justify-start gap-3">
            {album.tracks[0] && trackActions?.onPlay ? (
              <button
                type="button"
                onClick={() => trackActions.onPlay?.(album.tracks[0])}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-[0_4px_16px_var(--accent-glow)] transition-all active:scale-95"
              >
                <PlayIcon className="w-3.5 h-3.5" />
                <span>播放专辑</span>
              </button>
            ) : null}
            <Button
              aria-pressed={isFavorite}
              disabled={pending !== null}
              onClick={() => void onToggleFavorite()}
              size="sm"
              type="button"
              className={`rounded-xl text-xs font-medium border border-white/10 ${
                isFavorite
                  ? "bg-[#fa233b]/15 text-[#fa233b] hover:bg-[#fa233b]/25 border-[#fa233b]/30"
                  : "bg-white/[0.06] hover:bg-white/[0.12] text-white"
              }`}
            >
              <HeartIcon className="w-3.5 h-3.5" />
              <span>{isFavorite ? "已收藏" : "收藏专辑"}</span>
            </Button>
            {onAddAlbumToPlaylist ? (
              <Button
                aria-label="将专辑加入歌单"
                disabled={pending !== null}
                onClick={(event) => onAddAlbumToPlaylist(getAnchoredDialogAnchor(event.currentTarget))}
                size="icon"
                title="将专辑加入歌单"
                type="button"
                variant="ghost"
                className="rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.12]"
              >
                <Icon name="plus" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Tracklist Table */}
      <ProviderAlbumTrackTable tracks={album.tracks} actions={trackActions} />
    </section>
  );
}

function DescriptionDisclosure({ description }: { description: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const text = description || "暂无专辑简介";
  const canExpand = text.length > 120;

  return (
    <div className="mt-4 max-w-3xl">
      <p className={`text-xs sm:text-sm leading-relaxed text-foreground-muted/90 ${canExpand && !expanded ? "line-clamp-2" : ""}`}>{text}</p>
      {canExpand ? (
        <button className="mt-1.5 text-xs font-semibold text-accent hover:text-accent-hover transition-colors" onClick={() => setExpanded((current) => !current)} type="button">
          {expanded ? "收起介绍" : "展开介绍"}
        </button>
      ) : null}
    </div>
  );
}

export function ProviderAlbumTrackTable({
  tracks,
  actions,
  showToolbar = true
}: {
  tracks: Track[];
  actions?: ProviderAlbumTrackActions;
  showToolbar?: boolean;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTracks = normalizedQuery
    ? tracks.filter((track) => `${track.title} ${track.artist} ${track.album ?? ""}`.toLowerCase().includes(normalizedQuery))
    : tracks;

  return (
    <section className={showToolbar ? "mt-8" : "mt-2"}>
      {showToolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 mb-2">
          <div className="flex items-center gap-3">
            <span className="text-base font-bold text-white tracking-tight">歌曲列表</span>
            <span className="text-xs font-medium text-foreground-muted px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08]">
              {tracks.length} 首
            </span>
          </div>
          <label className="flex h-9 w-full max-w-[240px] items-center gap-2 rounded-xl border border-white/[0.08] bg-[#11131c]/80 px-3 text-foreground-muted sm:w-auto shadow-inner">
            <Icon name="search" />
            <span className="sr-only">搜索曲目</span>
            <input
              aria-label="搜索曲目"
              className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-foreground-muted/50"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="在列表中搜索..."
              type="search"
              value={query}
            />
          </label>
        </div>
      ) : null}

      {/* Borderless Smooth Tracklist Rows */}
      <div className="space-y-1">
        {visibleTracks.length ? (
          visibleTracks.map((track, index) => (
            <div
              className={`group flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl transition-all hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] ${
                actions ? "cursor-pointer" : ""
              }`}
              key={`${track.provider}:${track.providerTrackId}`}
              onClick={() => {
                if (!actions?.onPlay || !actions.isPlayable?.(track) || actions.isDownloading?.(track) || actions.isPreparingPlayback?.(track)) return;
                actions.onPlay(track);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                if (!actions?.onPlay || !actions.isPlayable?.(track) || actions.isDownloading?.(track) || actions.isPreparingPlayback?.(track)) return;
                event.preventDefault();
                actions.onPlay(track);
              }}
              tabIndex={actions?.onPlay ? 0 : undefined}
            >
              {/* Index number or Play Icon on hover */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-6 shrink-0 flex items-center justify-center text-xs font-semibold tabular-nums text-foreground-muted">
                  <span className="group-hover:hidden">{String(index + 1).padStart(2, "0")}</span>
                  <PlayIcon className="hidden group-hover:block w-3.5 h-3.5 text-accent animate-fade-in" />
                </div>

                {/* Track Artwork Thumbnail */}
                <TrackArtwork alt={track.album ?? track.title} src={track.artworkUrl} />

                {/* Title & Artist */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white group-hover:text-accent transition-colors">
                    {track.title}
                  </p>
                  <p className="truncate text-xs text-foreground-muted mt-0.5">
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ""}
                  </p>
                </div>
              </div>

              {/* Album (Desktop only) */}
              <span className="hidden lg:block min-w-0 max-w-[200px] truncate text-xs text-foreground-muted/70">
                {track.album ?? "未知专辑"}
              </span>

              {/* Duration */}
              <span className="shrink-0 text-xs font-mono text-foreground-muted tabular-nums px-2">
                {formatDuration(track.durationMs)}
              </span>

              {/* Action Buttons */}
              {actions ? <TrackActions track={track} actions={actions} /> : null}
            </div>
          ))
        ) : (
          <p className="px-4 py-12 text-center text-xs text-foreground-muted">没有匹配的歌曲。</p>
        )}
      </div>
    </section>
  );
}

function TrackActions({ track, actions }: { track: Track; actions: ProviderAlbumTrackActions }) {
  const [menuAnchor, setMenuAnchor] = useState<AnchoredDialogAnchor | null>(null);
  const downloaded = actions.isDownloaded?.(track) ?? false;
  const playable = actions.isPlayable?.(track) ?? false;
  const queueable = actions.isQueueable?.(track) ?? playable;
  const queued = actions.isQueued?.(track) ?? false;
  const downloading = actions.isDownloading?.(track) ?? false;
  const preparingPlayback = actions.isPreparingPlayback?.(track) ?? false;
  const disabled = downloading || preparingPlayback;
  const menuItems: MobileTrackAction[] = [
    ...(actions.onPlay ? [{ id: "play", label: preparingPlayback ? "准备播放中" : playable ? "播放" : "需要下载后播放", icon: "play" as const, disabled: disabled || !playable, onSelect: () => actions.onPlay?.(track) }] : []),
    ...(actions.onDownload ? [{ id: "download", label: downloaded ? "已下载" : downloading ? "下载中" : "下载到本地", icon: "download" as const, disabled: disabled || downloaded, onSelect: () => actions.onDownload?.(track) }] : []),
    ...(actions.onAddToQueue ? [{ id: "queue", label: queued ? "已在队列中" : queueable ? "加入队列" : "需要下载后加入队列", icon: "queue" as const, disabled: disabled || queued || !queueable, onSelect: () => actions.onAddToQueue?.(track) }] : []),
    ...(actions.onAddToPlaylist ? [{ id: "playlist", label: "加入歌单", icon: "plus" as const, disabled, onSelect: () => { if (menuAnchor) actions.onAddToPlaylist?.(track, menuAnchor); } }] : []),
    ...(actions.onToggleFavorite ? [{ id: "favorite", label: actions.isFavorite?.(track) ? "取消收藏" : "收藏歌曲", icon: "heart" as const, disabled: actions.isTogglingFavorite?.(track) ?? false, onSelect: () => void actions.onToggleFavorite?.(track) }] : [])
  ];

  return (
    <div className="flex items-center gap-1 shrink-0" onClick={(event) => event.stopPropagation()}>
      <div className="hidden items-center gap-1 sm:flex">
        {actions.onDownload ? (
          <Button
            aria-label={downloaded ? `《${track.title}》已下载` : `下载《${track.title}》`}
            className="h-8 w-8 rounded-lg text-foreground-muted hover:text-white hover:bg-white/[0.08]"
            disabled={disabled || downloaded}
            onClick={() => actions.onDownload?.(track)}
            size="icon"
            title={downloaded ? "已下载" : downloading ? "下载中" : "下载到本地"}
            type="button"
            variant="ghost"
          >
            {downloading ? (
              <svg aria-hidden="true" className="animate-spin" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
                <path d="M12 3a9 9 0 1 0 9 9" />
              </svg>
            ) : (
              <TrackActionIcon name="download" />
            )}
          </Button>
        ) : null}
        {actions.onAddToQueue ? (
          <Button
            aria-label={queued ? `《${track.title}》已在队列中` : `将《${track.title}》加入队列`}
            className="h-8 w-8 rounded-lg text-foreground-muted hover:text-white hover:bg-white/[0.08]"
            disabled={disabled || queued || !queueable}
            onClick={() => actions.onAddToQueue?.(track)}
            size="icon"
            title={queued ? "已在队列中" : queueable ? "加入队列" : "需要下载后加入队列"}
            type="button"
            variant="ghost"
          >
            <TrackActionIcon name="queue" />
          </Button>
        ) : null}
        {actions.onAddToPlaylist ? (
          <Button
            aria-label={`将《${track.title}》加入歌单`}
            className="h-8 w-8 rounded-lg text-foreground-muted hover:text-white hover:bg-white/[0.08]"
            disabled={disabled}
            onClick={(event) => actions.onAddToPlaylist?.(track, getAnchoredDialogAnchor(event.currentTarget))}
            size="icon"
            title="加入歌单"
            type="button"
            variant="ghost"
          >
            <TrackActionIcon name="plus" />
          </Button>
        ) : null}
        {actions.onToggleFavorite ? (
          <FavoriteTrackButton
            isFavorite={actions.isFavorite?.(track) ?? false}
            onToggle={() => actions.onToggleFavorite?.(track)}
            pending={actions.isTogglingFavorite?.(track) ?? false}
            size="compact"
            track={track as ProviderTrackCandidate}
          />
        ) : null}
      </div>
      {actions.onDownload ? (
        <Button
          aria-label={downloaded ? `《${track.title}》已下载` : `下载《${track.title}》`}
          className="h-8 w-8 rounded-lg text-foreground-muted hover:text-white sm:hidden"
          disabled={disabled || downloaded}
          onClick={() => actions.onDownload?.(track)}
          size="icon"
          title={downloaded ? "已下载" : downloading ? "下载中" : "下载到本地"}
          type="button"
          variant="ghost"
        >
          {downloading ? (
            <svg aria-hidden="true" className="animate-spin" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
          ) : (
            <TrackActionIcon name="download" />
          )}
        </Button>
      ) : null}
      <Button
        aria-label={`打开《${track.title}》的操作菜单`}
        className="h-8 w-8 sm:hidden text-foreground-muted hover:text-white"
        onClick={(event) => { event.stopPropagation(); setMenuAnchor(getAnchoredDialogAnchor(event.currentTarget)); }}
        size="icon"
        title="更多操作"
        type="button"
        variant="ghost"
      >
        <MoreIcon />
      </Button>
      {menuAnchor ? (
        <MobileTrackActionsMenu
          anchor={menuAnchor}
          items={menuItems}
          onClose={() => setMenuAnchor(null)}
          subtitle={`${track.artist} · ${track.album ?? "未知专辑"}`}
          title={track.title}
        />
      ) : null}
    </div>
  );
}

function MoreIcon() {
  return <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>;
}

function AlbumArtwork({ alt, src }: { alt: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="relative aspect-square w-full rounded-2xl bg-gradient-to-tr from-[#1a1d2e] to-[#0a0c16] border border-white/10 flex items-center justify-center text-3xl text-white/20 shadow-2xl">
        ♪
      </div>
    );
  }
  return (
    <div className="relative aspect-square w-full rounded-2xl overflow-hidden border border-white/10 shadow-[0_16px_36px_rgba(0,0,0,0.6)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={alt} className="aspect-square w-full h-full object-cover" decoding="async" loading="lazy" onError={() => setFailed(true)} src={getArtworkSourceUrl(src)} />
    </div>
  );
}

function TrackArtwork({ alt, src }: { alt: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span aria-label={alt} className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06] border border-white/[0.08] text-xs text-foreground-muted">♪</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} className="h-10 w-10 shrink-0 rounded-xl object-cover border border-white/10 shadow-sm" decoding="async" loading="lazy" onError={() => setFailed(true)} src={getArtworkSourceUrl(src)} />
  );
}

function Icon({ name }: { name: "search" | "plus" }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
}

function TrackActionIcon({ name }: { name: "download" | "queue" | "play" | "plus" | "loading" }) {
  if (name === "download") return <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>;
  if (name === "queue") return <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M4 6h11M4 12h11M4 18h6M18 14v7M14.5 17.5h7" /></svg>;
  if (name === "play") return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M8 5v14l11-7z" /></svg>;
  if (name === "plus") return <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 5v14M5 12h14" /></svg>;
  return <svg aria-hidden="true" className="animate-spin" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
}
