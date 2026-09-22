"use client";

import { useState } from "react";
import type { BilibiliTrackCandidate } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import { PlayIcon, ChevronLeftIcon } from "@/components/icons/DiscoverIcons";
import { Icon } from "./search-ui-primitives";
import type { AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { getAnchoredDialogAnchor } from "@/components/ui/anchored-dialog";

export type BilibiliPartDetail = {
  bvid: string;
  title: string;
  rawTitle: string;
  artist: string;
  artworkUrl: string | null;
  pageCount: number;
  parts: BilibiliTrackCandidate[];
};

type BilibiliPartDetailViewProps = {
  detail: BilibiliPartDetail;
  onBack: () => void;
  onPlayTrack: (track: BilibiliTrackCandidate) => void;
  onQueueTrack?: (track: BilibiliTrackCandidate) => void;
  onDownloadTrack?: (track: BilibiliTrackCandidate) => void;
  onImportPlaylist?: (track: BilibiliTrackCandidate, anchor: AnchoredDialogAnchor) => void;
  onPlayAll: (tracks: BilibiliTrackCandidate[]) => void;
  pendingTrackId?: string | null;
  isFavorite?: (track: BilibiliTrackCandidate) => boolean;
  onToggleFavorite?: (track: BilibiliTrackCandidate) => void;
};

export function BilibiliPartDetailView({
  detail,
  onBack,
  onPlayTrack,
  onQueueTrack,
  onDownloadTrack,
  onImportPlaylist,
  onPlayAll,
  pendingTrackId,
  isFavorite,
  onToggleFavorite
}: BilibiliPartDetailViewProps) {
  const [imageError, setImageError] = useState(false);
  const totalDurationMs = detail.parts.reduce((acc, curr) => acc + (curr.durationMs || 0), 0);

  return (
    <section className="mt-3 sm:mt-6 animate-in fade-in duration-300">
      {/* Back Button */}
      <button
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-foreground-muted transition-all hover:bg-white/[0.08] hover:text-white mb-4 sm:mb-6 border border-white/[0.06] backdrop-blur-md"
        onClick={onBack}
        type="button"
      >
        <ChevronLeftIcon className="w-3.5 h-3.5" />
        <span>返回搜索列表</span>
      </button>

      {/* Video Hero Stage */}
      <div className="relative overflow-hidden rounded-2xl border border-surface-border bg-surface/50 p-4 sm:p-6 md:p-8 backdrop-blur-xl grid gap-5 sm:gap-8 grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] items-center sm:items-end">
        <div className="w-36 sm:w-44 md:w-full max-w-[220px] mx-auto sm:mx-0 shrink-0 aspect-video sm:aspect-square rounded-2xl overflow-hidden bg-surface-hover relative border border-white/10 shadow-lg">
          {detail.artworkUrl && !imageError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={detail.title}
              className="h-full w-full object-cover"
              loading="eager"
              referrerPolicy="no-referrer"
              src={getArtworkSourceUrl(detail.artworkUrl)}
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-foreground-muted/40">
              <Icon name="music" />
            </div>
          )}
        </div>

        <div className="relative z-10 flex min-w-0 flex-col justify-end text-center sm:text-left">
          <div className="inline-flex items-center justify-center sm:justify-start gap-2 mb-2">
            <span className="rounded-md bg-[#00aeec]/20 text-[#00aeec] border border-[#00aeec]/30 px-2 py-0.5 text-[11px] font-semibold tracking-wide">
              哔哩哔哩 · 视频分P合集
            </span>
            <span className="text-xs text-foreground-muted">BV号: {detail.bvid}</span>
          </div>

          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white line-clamp-2">
            {detail.title}
          </h1>

          <p className="mt-2 text-xs sm:text-sm text-foreground-muted/90 flex items-center justify-center sm:justify-start gap-2">
            <span>UP主: <strong className="text-foreground font-medium">{detail.artist}</strong></span>
            <span>·</span>
            <span>共 {detail.parts.length} 首分P单曲</span>
            {totalDurationMs > 0 && (
              <>
                <span>·</span>
                <span>总时长 {formatDuration(totalDurationMs)}</span>
              </>
            )}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center sm:justify-start gap-3">
            <Button
              size="sm"
              variant="default"
              onClick={() => onPlayAll(detail.parts)}
              className="rounded-full px-5 py-2 text-xs font-semibold flex items-center gap-2 bg-accent text-white hover:bg-accent/90 shadow-md transition-all active:scale-95"
            >
              <PlayIcon className="w-3.5 h-3.5 fill-current" />
              <span>播放全部</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Part Tracks List */}
      <div className="mt-6 rounded-2xl border border-surface-border bg-surface/60 backdrop-blur-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border/60 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            分P列表 ({detail.parts.length})
          </h2>
          <span className="text-[11px] text-foreground-muted/70">
            点击单曲播放对应分P音频
          </span>
        </div>

        <div className="divide-y divide-surface-border/40">
          {detail.parts.map((part, index) => {
            const isPending = pendingTrackId === part.providerTrackId;
            const fav = isFavorite ? isFavorite(part) : false;

            return (
              <div
                key={part.providerTrackId}
                className="group flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-surface-hover"
              >
                <div
                  className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                  onClick={() => onPlayTrack(part)}
                >
                  <span className="w-6 text-center text-xs tabular-nums text-foreground-muted/70 group-hover:text-foreground font-mono">
                    {isPending ? (
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent align-middle" />
                    ) : (
                      String(index + 1).padStart(2, "0")
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate group-hover:text-accent transition-colors">
                      {part.title}
                    </p>
                    <p className="text-xs text-foreground-muted truncate">
                      {part.artist}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-foreground-muted/60 tabular-nums font-mono mr-1">
                    {formatDuration(part.durationMs)}
                  </span>

                  <button
                    type="button"
                    title="播放这首"
                    disabled={Boolean(pendingTrackId)}
                    onClick={() => onPlayTrack(part)}
                    className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface transition disabled:opacity-40"
                  >
                    {isPending ? (
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    ) : (
                      <PlayIcon className="w-3.5 h-3.5 fill-current" />
                    )}
                  </button>

                  {onQueueTrack && (
                    <button
                      type="button"
                      title="加入播放队列"
                      disabled={Boolean(pendingTrackId)}
                      onClick={() => onQueueTrack(part)}
                      className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface transition disabled:opacity-40"
                    >
                      <Icon name="playlist-add" />
                    </button>
                  )}

                  {onDownloadTrack && (
                    <button
                      type="button"
                      title="下载到本地"
                      disabled={Boolean(pendingTrackId)}
                      onClick={() => onDownloadTrack(part)}
                      className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface transition disabled:opacity-40"
                    >
                      <Icon name="download" />
                    </button>
                  )}

                  {onImportPlaylist && (
                    <button
                      type="button"
                      title="保存到歌单"
                      disabled={Boolean(pendingTrackId)}
                      onClick={(e) => onImportPlaylist(part, getAnchoredDialogAnchor(e.currentTarget))}
                      className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface transition disabled:opacity-40"
                    >
                      <Icon name="playlist-add" />
                    </button>
                  )}

                  {onToggleFavorite && (
                    <button
                      type="button"
                      title={fav ? "取消收藏" : "收藏"}
                      onClick={() => onToggleFavorite(part)}
                      className={`p-1.5 rounded-lg transition ${
                        fav ? "text-rose-500" : "text-foreground-muted hover:text-rose-500 hover:bg-surface"
                      }`}
                    >
                      <Icon name="heart" filled={fav} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
