"use client";

import { useState } from "react";
import type { ProviderPlaylistDetail } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import {
  ProviderAlbumTrackTable,
  type ProviderAlbumTrackActions
} from "@/components/ProviderAlbumDetailView";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";

type ProviderPlaylistDetailViewProps = {
  playlist: ProviderPlaylistDetail;
  isFavorite: boolean;
  pending: string | null;
  onBack: () => void;
  onToggleFavorite: () => Promise<void>;
  trackActions?: ProviderAlbumTrackActions;
};

export function ProviderPlaylistDetailView({
  playlist,
  isFavorite,
  pending,
  onBack,
  onToggleFavorite,
  trackActions
}: ProviderPlaylistDetailViewProps) {
  return (
    <section className="mt-7">
      <button className="inline-flex items-center gap-2 text-xs font-semibold text-white/50 transition hover:text-white" onClick={onBack} type="button">
        <Icon name="arrow-left" />
        返回歌单
      </button>
      <div className="mt-5 grid gap-8 border-b border-white/[0.1] pb-9 lg:grid-cols-[280px_minmax(0,1fr)]">
        <PlaylistArtwork alt={playlist.title} src={playlist.artworkUrl} />
        <div className="flex min-w-0 flex-col justify-end">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">Playlist</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">{playlist.title}</h1>
          <p className="mt-3 text-sm text-white/55">{playlist.creatorName || "网络歌单"} · {playlist.tracks.length} 首歌曲</p>
          <DescriptionDisclosure description={playlist.description} />
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button aria-pressed={isFavorite} disabled={pending !== null} onClick={() => void onToggleFavorite()} size="sm" type="button">
              <Icon name="heart" filled={isFavorite} />
              {isFavorite ? "已收藏" : "收藏歌单"}
            </Button>
            <span className="px-2 text-xs text-white/35">{playlist.tracks.length} 首歌曲</span>
          </div>
        </div>
      </div>
      <ProviderAlbumTrackTable tracks={playlist.tracks} actions={trackActions} />
    </section>
  );
}

function DescriptionDisclosure({ description }: { description: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const text = description || "暂无歌单简介";
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

function PlaylistArtwork({ alt, src }: { alt: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span aria-label={alt} className="flex aspect-square w-full items-center justify-center rounded-2xl bg-black text-3xl text-white/20">♪</span>;
  }
  // Provider artwork URLs are external and intentionally bypass Next image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className="aspect-square w-full rounded-2xl object-cover" decoding="async" loading="lazy" onError={() => setFailed(true)} src={getArtworkSourceUrl(src)} />;
}

function Icon({ name, filled = false }: { name: "arrow-left" | "heart"; filled?: boolean }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: filled ? "currentColor" : "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "heart") return <svg {...common}><path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" /></svg>;
  return <svg {...common}><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>;
}
