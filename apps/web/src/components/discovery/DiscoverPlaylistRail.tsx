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
  onPlay,
  loadingKey
}: {
  items: DiscoverPlaylistCard[];
  onOpen: (card: DiscoverPlaylistCard) => Promise<void> | void;
  onPlay?: (card: DiscoverPlaylistCard) => Promise<void> | void;
  loadingKey: string | null;
}) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => {
        const { playlist } = item;
        const itemKey = providerPlaylistKey(playlist.provider, playlist.providerPlaylistId);
        const isOpenLoading = loadingKey === `playlist:${playlist.provider}:${playlist.providerPlaylistId}`;
        const isPlayLoading = loadingKey === `play:playlist:${playlist.provider}:${playlist.providerPlaylistId}`;
        const loading = isOpenLoading || isPlayLoading;
        return (
          <div
            aria-label={`打开歌单《${playlist.title}》`}
            className="group relative flex min-w-0 max-w-full cursor-pointer flex-col text-left transition-transform duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent select-none"
            key={itemKey}
            onClick={() => void onOpen(item)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void onOpen(item);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="relative aspect-square min-w-0 w-full max-w-full overflow-hidden rounded-xl bg-surface border border-white/[0.08] shadow-sm">
              <Artwork
                alt={playlist.title}
                className="absolute inset-0 h-full w-full object-cover block transition duration-300 group-hover:scale-105"
                src={playlist.artworkUrl}
              />
              <span className="absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/20" />
              <button
                aria-label={`播放歌单《${playlist.title}》`}
                className="absolute bottom-2 right-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white shadow-md transition-all duration-200 hover:scale-105 active:scale-90 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                disabled={loading}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onPlay) {
                    void onPlay(item);
                  } else {
                    void onOpen(item);
                  }
                }}
                type="button"
              >
                {loading ? (
                  <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <PlayIcon className="w-3.5 h-3.5 ml-0.5" />
                )}
              </button>
            </div>
            <p className="mt-2 line-clamp-2 text-xs font-medium leading-tight text-foreground group-hover:text-accent transition-colors" title={playlist.title}>
              {playlist.title}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-foreground-muted" title={playlist.description ?? playlist.creatorName ?? ""}>
              {playlist.description || (playlist.providerPlaylistId.startsWith("music-room-curated:") ? "精选歌单" : `${providerLabel(playlist.provider)}${playlist.creatorName ? ` · ${playlist.creatorName}` : ""}`)}
            </p>
          </div>
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
