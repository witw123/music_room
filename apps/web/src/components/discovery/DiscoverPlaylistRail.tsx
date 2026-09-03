"use client";

import React, { useState } from "react";
import type { DiscoverPlaylistCard } from "./discover-types";
import { providerPlaylistKey } from "./discover-types";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import { PlayIcon } from "@/components/icons/DiscoverIcons";

function providerLabel(provider: string) {
  return provider === "netease" ? "网易云音乐" : "QQ 音乐";
}

export function DiscoverPlaylistRail({
  items,
  onOpen,
  loadingKey
}: {
  items: DiscoverPlaylistCard[];
  onOpen: (card: DiscoverPlaylistCard) => Promise<void>;
  loadingKey: string | null;
}) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => {
        const { playlist } = item;
        const loading = !item.tracks && loadingKey === `playlist:${playlist.provider}:${playlist.providerPlaylistId}`;
        const isDailyMix = playlist.providerPlaylistId.startsWith("music-room-curated:daily-mix-");
        const mixNumber = isDailyMix ? playlist.providerPlaylistId.replace("music-room-curated:daily-mix-", "") : null;
        return (
          <button
            aria-label={`打开歌单《${playlist.title}》`}
            className="group flex min-w-0 max-w-full flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-[#12141c]/80 to-[#0c0e15]/90 p-2.5 text-left transition-all duration-200 hover:-translate-y-1 hover:border-white/[0.14] hover:bg-[#181a26]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            disabled={loading}
            key={providerPlaylistKey(playlist.provider, playlist.providerPlaylistId)}
            onClick={() => void onOpen(item)}
            type="button"
          >
            <div className="relative aspect-square min-w-0 w-full max-w-full overflow-hidden rounded-xl bg-surface-elevated border border-white/10 shadow-md">
              <Artwork
                alt={playlist.title}
                className="absolute inset-0 h-full w-full object-cover block transition duration-300 group-hover:scale-105"
                src={playlist.artworkUrl}
              />
              <span className="absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/25" />
              {isDailyMix && mixNumber ? (
                <div className="absolute top-2 left-2 z-10 rounded-md bg-black/70 backdrop-blur-md px-2 py-0.5 text-[9px] font-black tracking-widest uppercase text-white border border-white/20 shadow-md">
                  MIX {mixNumber}
                </div>
              ) : null}
              <span className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white opacity-100 shadow-[0_4px_16px_var(--accent-glow)] transition-all duration-200 sm:opacity-0 sm:group-hover:opacity-100 scale-100 sm:scale-95 sm:group-hover:scale-100">
                {loading ? <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <PlayIcon className="w-4 h-4" />}
              </span>
            </div>
            <p className="mt-2.5 line-clamp-2 text-xs sm:text-sm font-semibold leading-tight text-white group-hover:text-accent transition-colors" title={playlist.title}>
              {playlist.title}
            </p>
            <p className="mt-1 truncate text-[11px] text-foreground-muted" title={playlist.description ?? playlist.creatorName ?? ""}>
              {playlist.description || (playlist.providerPlaylistId.startsWith("music-room-curated:") ? "Music Room 精选" : `${providerLabel(playlist.provider)}${playlist.creatorName ? ` · ${playlist.creatorName}` : ""}`)}
            </p>
          </button>
        );
      })}
    </div>
  );
}

export function Artwork({ alt, src, className = "" }: { alt: string; src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const source = src ? getArtworkSourceUrl(src) : null;
  if (!source || failed) return <span aria-label={alt || undefined} className={`flex min-w-0 max-w-full items-center justify-center overflow-hidden bg-white/[0.06] text-xl text-foreground-muted ${className}`}>♪</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className={`block min-w-0 max-w-full object-cover ${className}`} loading="lazy" onError={() => setFailed(true)} src={source} style={{ display: "block", height: "100%", maxHeight: "100%", maxWidth: "100%", width: "100%" }} />;
}
