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
      <button className="inline-flex items-center gap-2 text-sm font-semibold text-white/60 transition hover:text-white" onClick={onBack} type="button">
        <Icon name="arrow-left" />
        返回歌单
      </button>
      <div className="mt-8 grid gap-8 border-b border-white/[0.1] pb-14 lg:grid-cols-[minmax(360px,528px)_minmax(0,1fr)] lg:items-end lg:gap-14">
        <PlaylistArtwork alt={playlist.title} src={playlist.artworkUrl} />
        <div className="flex min-w-0 flex-col justify-end lg:pb-1">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">Playlist</p>
          <h1 className="mt-4 text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl">{playlist.title}</h1>
          <p className="mt-5 text-base text-white/55">{playlist.creatorName || "网络歌单"} · {playlist.tracks.length} 首歌曲</p>
          <p className="mt-8 max-w-5xl text-base leading-8 text-white/45 sm:text-lg">{playlist.description || "暂无歌单简介"}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Button aria-pressed={isFavorite} className="h-12 rounded-2xl px-6 text-base" disabled={pending !== null} onClick={() => void onToggleFavorite()} type="button">
              <Icon name="heart" filled={isFavorite} />
              {isFavorite ? "已收藏" : "收藏歌单"}
            </Button>
            <span className="px-1 text-base text-white/35">{playlist.tracks.length} 首歌曲</span>
          </div>
        </div>
      </div>
      <ProviderAlbumTrackTable tracks={playlist.tracks} actions={trackActions} />
    </section>
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
