"use client";

import { useState } from "react";
import type {
  NeteaseTrackCandidate,
  ProviderAlbumDetail,
  QqMusicTrackCandidate
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/music-room-ui";
import { getAnchoredDialogAnchor, type AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";

type Track = NeteaseTrackCandidate | QqMusicTrackCandidate;

export type ProviderAlbumTrackActions = {
  isDownloaded?: (track: Track) => boolean;
  isPlayable?: (track: Track) => boolean;
  isQueued?: (track: Track) => boolean;
  isDownloading?: (track: Track) => boolean;
  onDownload?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  onPlay?: (track: Track) => void;
  onAddToPlaylist?: (track: Track, anchor: AnchoredDialogAnchor) => void;
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
    <section className="mt-7">
      <button className="inline-flex items-center gap-2 text-xs font-semibold text-white/50 transition hover:text-white" onClick={onBack} type="button">
        <Icon name="arrow-left" />
        返回专辑
      </button>
      <div className="mt-5 grid gap-8 border-b border-white/[0.1] pb-9 lg:grid-cols-[280px_minmax(0,1fr)]">
        <AlbumArtwork alt={album.title} src={album.artworkUrl} />
        <div className="flex min-w-0 flex-col justify-end">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">Album</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">{album.title}</h1>
          <p className="mt-3 text-sm text-white/55">{album.artist} · {album.releaseTime || "发行时间未知"}</p>
          <DescriptionDisclosure description={album.description} />
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button aria-pressed={isFavorite} disabled={pending !== null} onClick={() => void onToggleFavorite()} size="sm" type="button">
              <Icon name="heart" filled={isFavorite} />
              {isFavorite ? "已收藏" : "收藏专辑"}
            </Button>
            {onAddAlbumToPlaylist ? (
              <Button aria-label="将专辑加入歌单" disabled={pending !== null} onClick={(event) => onAddAlbumToPlaylist(getAnchoredDialogAnchor(event.currentTarget))} size="icon" title="将专辑加入歌单" type="button" variant="ghost">
                <Icon name="plus" />
              </Button>
            ) : null}
            <span className="px-2 text-xs text-white/35">{album.tracks.length} 首歌曲</span>
          </div>
        </div>
      </div>
      <ProviderAlbumTrackTable tracks={album.tracks} actions={trackActions} />
    </section>
  );
}

function DescriptionDisclosure({ description }: { description: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const text = description || "暂无专辑简介";
  const canExpand = text.length > 120;

  return (
    <div className="mt-5 max-w-3xl">
      <p className={`text-sm leading-7 text-white/45 ${canExpand && !expanded ? "line-clamp-3" : ""}`}>{text}</p>
      {canExpand ? (
        <button className="mt-2 text-xs font-medium text-accent/80 transition hover:text-accent" onClick={() => setExpanded((current) => !current)} type="button">
          {expanded ? "收起介绍" : "展开介绍"}
        </button>
      ) : null}
    </div>
  );
}

export function ProviderAlbumTrackTable({ tracks, actions }: { tracks: Track[]; actions?: ProviderAlbumTrackActions }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTracks = normalizedQuery
    ? tracks.filter((track) => `${track.title} ${track.artist} ${track.album ?? ""}`.toLowerCase().includes(normalizedQuery))
    : tracks;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.1]">
        <div className="flex items-center gap-6">
          <span className="relative pb-4 text-sm font-semibold text-white">歌曲 <span className="text-white/35">{tracks.length}</span><span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" /></span>
          <span className="pb-4 text-sm text-white/35">详情</span>
        </div>
        <label className="mb-2 flex h-11 w-full max-w-[220px] items-center gap-2 rounded-full border border-white/[0.1] bg-black px-3 text-white/45 sm:h-9 sm:w-auto">
          <Icon name="search" />
          <span className="sr-only">搜索专辑歌曲</span>
          <input aria-label="搜索专辑歌曲" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/35" onChange={(event) => setQuery(event.target.value)} placeholder="搜索" type="search" value={query} />
        </label>
      </div>
      <div className={`mt-4 hidden gap-5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30 md:grid ${actions ? "md:grid-cols-[84px_minmax(0,1.5fr)_minmax(180px,0.8fr)_76px_minmax(180px,auto)]" : "md:grid-cols-[84px_minmax(0,1.6fr)_minmax(180px,0.8fr)_76px]"}`}>
        <span>#</span><span>单曲</span><span>专辑</span><span className="text-right">时长</span>{actions ? <span className="text-right">操作</span> : null}
      </div>
      <div className="mt-2 divide-y divide-white/[0.07]">
        {visibleTracks.length ? visibleTracks.map((track, index) => (
          <div className={`group grid gap-x-3 gap-y-3 px-3 py-4 transition-colors hover:bg-white/[0.035] md:items-center md:gap-5 md:px-3 md:py-5 ${actions ? "md:grid-cols-[84px_minmax(0,1.5fr)_minmax(180px,0.8fr)_76px_minmax(180px,auto)]" : "md:grid-cols-[84px_minmax(0,1.6fr)_minmax(180px,0.8fr)_76px]"}`} key={`${track.provider}:${track.providerTrackId}`}>
            <div className="flex items-center gap-3 text-xs tabular-nums text-white/35 md:text-sm">
              <GripIcon />
              <span>{String(index + 1).padStart(2, "0")}</span>
            </div>
            <div className="flex min-w-0 items-center gap-3 md:gap-5"><TrackArtwork alt={track.album ?? track.title} src={track.artworkUrl} /><div className="min-w-0"><p className="truncate text-sm font-medium text-white/90 md:text-[17px]">{track.title}</p><p className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs text-white/45"><span className="truncate">{track.artist}</span><span aria-hidden="true" className="shrink-0 text-white/25">·</span><span className="shrink-0">{actions?.isDownloaded?.(track) ? "已下载" : "未下载"}</span></p></div></div>
            <span className="hidden truncate text-sm text-white/55 md:block">{track.album ?? "未知专辑"}</span>
            <span className="col-start-2 text-xs tabular-nums text-white/40 md:col-auto md:text-right">{formatDuration(track.durationMs)}</span>
            {actions ? <TrackActions track={track} actions={actions} /> : null}
          </div>
        )) : <p className="px-4 py-10 text-center text-xs text-white/35">没有匹配的歌曲。</p>}
      </div>
    </section>
  );
}

function TrackActions({ track, actions }: { track: Track; actions: ProviderAlbumTrackActions }) {
  const downloaded = actions.isDownloaded?.(track) ?? false;
  const playable = actions.isPlayable?.(track) ?? false;
  const queued = actions.isQueued?.(track) ?? false;
  const downloading = actions.isDownloading?.(track) ?? false;
  const disabled = downloading;
  return (
    <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-1 md:col-auto md:flex-nowrap">
      {actions.onDownload ? <Button aria-label={downloaded ? `《${track.title}》已下载` : `下载《${track.title}》`} className="h-10 w-10 md:h-8 md:w-8" disabled={disabled || downloaded} onClick={() => actions.onDownload?.(track)} size="icon" title={downloaded ? "已下载" : downloading ? "下载中" : "下载到本地"} type="button" variant="ghost"><TrackActionIcon name={downloading ? "loading" : "download"} /></Button> : null}
      {actions.onAddToQueue ? <Button aria-label={queued ? `《${track.title}》已在队列中` : `将《${track.title}》加入队列`} className="h-10 w-10 md:h-8 md:w-8" disabled={disabled || queued || !playable} onClick={() => actions.onAddToQueue?.(track)} size="icon" title={queued ? "已在队列中" : playable ? "加入队列" : "需要下载后加入队列"} type="button" variant="ghost"><TrackActionIcon name="queue" /></Button> : null}
      {actions.onPlay ? <Button aria-label={playable ? `播放《${track.title}》` : `《${track.title}》需要下载后播放`} className="h-10 w-10 md:h-8 md:w-8" disabled={disabled || !playable} onClick={() => actions.onPlay?.(track)} size="icon" title={playable ? "播放" : "需要下载后播放"} type="button" variant="ghost"><TrackActionIcon name="play" /></Button> : null}
      {actions.onAddToPlaylist ? <Button aria-label={`将《${track.title}》加入歌单`} className="h-10 w-10 md:h-8 md:w-8" disabled={disabled} onClick={(event) => actions.onAddToPlaylist?.(track, getAnchoredDialogAnchor(event.currentTarget))} size="icon" title="加入歌单" type="button" variant="ghost"><TrackActionIcon name="plus" /></Button> : null}
    </div>
  );
}

function AlbumArtwork({ alt, src }: { alt: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span aria-label={alt} className="flex aspect-square w-full items-center justify-center rounded-2xl bg-black text-3xl text-white/20">♪</span>;
  }
  // External provider artwork is intentionally rendered without Next image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className="aspect-square w-full rounded-2xl object-cover" decoding="async" loading="lazy" onError={() => setFailed(true)} src={getArtworkSourceUrl(src)} />;
}

function TrackArtwork({ alt, src }: { alt: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span aria-label={alt} className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.07] text-sm text-white/35 md:h-[76px] md:w-[76px] md:rounded-xl">♪</span>;
  }
  // Provider artwork URLs are external and intentionally bypass Next image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className="h-12 w-12 shrink-0 rounded-lg object-cover md:h-[76px] md:w-[76px] md:rounded-xl" decoding="async" loading="lazy" onError={() => setFailed(true)} src={getArtworkSourceUrl(src)} />;
}

function GripIcon() {
  return <svg aria-hidden="true" className="h-4 w-3 shrink-0 text-white/25" fill="currentColor" viewBox="0 0 12 24"><circle cx="3" cy="5" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="3" cy="12" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="3" cy="19" r="1" /><circle cx="9" cy="19" r="1" /></svg>;
}

function Icon({ name, filled = false }: { name: "arrow-left" | "heart" | "search" | "plus"; filled?: boolean }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: filled ? "currentColor" : "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "arrow-left") return <svg {...common}><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" /></svg>;
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
