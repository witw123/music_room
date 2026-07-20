"use client";

import { useState } from "react";
import type {
  NeteaseTrackCandidate,
  ProviderAlbumDetail,
  QqMusicTrackCandidate
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/music-room-ui";

type Track = NeteaseTrackCandidate | QqMusicTrackCandidate;

type ProviderAlbumDetailViewProps = {
  album: ProviderAlbumDetail;
  isFavorite: boolean;
  onBack: () => void;
  onToggleFavorite: () => Promise<void>;
  pending: string | null;
};

export function ProviderAlbumDetailView({
  album,
  isFavorite,
  onBack,
  onToggleFavorite,
  pending
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
            <span className="px-2 text-xs text-white/35">{album.tracks.length} 首歌曲</span>
          </div>
        </div>
      </div>
      <ProviderAlbumTrackTable tracks={album.tracks} />
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

export function ProviderAlbumTrackTable({ tracks }: { tracks: Track[] }) {
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
        <label className="mb-2 flex h-9 w-full max-w-[220px] items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 text-white/45 sm:w-auto">
          <Icon name="search" />
          <span className="sr-only">搜索专辑歌曲</span>
          <input aria-label="搜索专辑歌曲" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/35" onChange={(event) => setQuery(event.target.value)} placeholder="搜索" type="search" value={query} />
        </label>
      </div>
      <div className="mt-4 hidden grid-cols-[42px_minmax(0,1.5fr)_minmax(180px,0.8fr)_90px] gap-4 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30 md:grid">
        <span>#</span><span>标题</span><span>歌手</span><span className="text-right">时长</span>
      </div>
      <div className="mt-2 divide-y divide-white/[0.07]">
        {visibleTracks.length ? visibleTracks.map((track, index) => (
          <div className="grid gap-2 px-4 py-4 md:grid-cols-[42px_minmax(0,1.5fr)_minmax(180px,0.8fr)_90px] md:items-center md:gap-4" key={track.providerTrackId}>
            <span className="text-xs tabular-nums text-white/30">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0"><p className="truncate text-sm text-white/85">{track.title}</p><p className="mt-1 truncate text-xs text-white/35 md:hidden">{track.artist} · {track.album ?? "未知专辑"}</p></div>
            <span className="hidden truncate text-xs text-white/50 md:block">{track.artist}</span>
            <span className="text-xs tabular-nums text-white/40 md:text-right">{formatDuration(track.durationMs)}</span>
          </div>
        )) : <p className="px-4 py-10 text-center text-xs text-white/35">没有匹配的歌曲。</p>}
      </div>
    </section>
  );
}

function AlbumArtwork({ alt, src }: { alt: string; src: string | null }) {
  return src ? (
    // External provider artwork is intentionally rendered without Next image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} className="aspect-square w-full rounded-2xl object-cover" loading="lazy" src={src} />
  ) : <span aria-label={alt} className="flex aspect-square w-full items-center justify-center rounded-2xl bg-white/[0.04] text-3xl text-white/20">♪</span>;
}

function Icon({ name, filled = false }: { name: "arrow-left" | "heart" | "search"; filled?: boolean }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: filled ? "currentColor" : "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "arrow-left") return <svg {...common}><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" /></svg>;
  return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
}
