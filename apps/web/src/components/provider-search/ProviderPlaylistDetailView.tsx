"use client";

import { useState } from "react";
import type { ProviderPlaylistDetail } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import {
  ProviderAlbumTrackTable,
  type ProviderAlbumTrackActions
} from "./ProviderAlbumDetailView";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import {
  PlayIcon,
  HeartIcon,
  SparklesIcon,
  ChevronLeftIcon
} from "@/components/icons/DiscoverIcons";

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

      {/* Atmospheric Playlist Hero Stage */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#131622]/90 to-[#0b0d14]/95 p-4 sm:p-6 md:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl grid gap-5 sm:gap-8 grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)] items-center sm:items-end">
        {/* Ambient Glow Aura */}
        <div className="absolute -top-12 -right-12 w-64 h-64 rounded-full bg-[radial-gradient(circle,#c026d318_0%,transparent_70%)] blur-2xl pointer-events-none" />

        <div className="w-36 sm:w-44 md:w-full max-w-[240px] mx-auto sm:mx-0 shrink-0">
          <PlaylistArtwork alt={playlist.title} src={playlist.artworkUrl} />
        </div>
        <div className="relative z-10 flex min-w-0 flex-col justify-end text-center sm:text-left">
          <div className="flex items-center justify-center sm:justify-start gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-accent/15 text-accent border border-accent/20">
              <SparklesIcon className="w-3 h-3" />
              <span>PLAYLIST</span>
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white">{playlist.title}</h1>
          <p className="mt-2 text-xs sm:text-sm text-foreground-muted font-medium">
            {playlist.creatorName || "网络歌单"} · {playlist.tracks.length} 首歌曲
          </p>
          <DescriptionDisclosure description={playlist.description} />
          <div className="mt-5 flex flex-wrap items-center justify-center sm:justify-start gap-3">
            {playlist.tracks[0] && trackActions?.onPlay ? (
              <button
                type="button"
                onClick={() => trackActions.onPlay?.(playlist.tracks[0])}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-[0_4px_16px_var(--accent-glow)] transition-all active:scale-95"
              >
                <PlayIcon className="w-3.5 h-3.5" />
                <span>播放全部</span>
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
              <span>{isFavorite ? "已收藏" : "收藏歌单"}</span>
            </Button>
            <span className="px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-xs font-mono text-foreground-muted">
              {playlist.tracks.length} 首歌曲
            </span>
          </div>
        </div>
      </div>

      {/* Borderless Tracklist Rows */}
      <ProviderAlbumTrackTable tracks={playlist.tracks} actions={trackActions} />
    </section>
  );
}

function DescriptionDisclosure({ description }: { description: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const text = description || "暂无歌单简介";
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

function PlaylistArtwork({ alt, src }: { alt: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="relative aspect-square w-full rounded-2xl bg-gradient-to-tr from-[#1e152a] to-[#0d0914] border border-white/10 flex items-center justify-center text-3xl text-white/20 shadow-2xl">
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
