"use client";

import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

type LayoutProps = {
  isPlaying: boolean;
  canControlPlayback: boolean;
  playbackTrackId: string | null | undefined;
  title: string;
  artist: string;
  boundedProgressMs: number;
  currentTrackDuration: number;
  volume: number;
  setSeekDraft: (value: number | null) => void;
  commitSeek: () => void;
  applyVolume: (value: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
};

export function VinylBadge({
  isPlaying,
  compact = false
}: {
  isPlaying: boolean;
  compact?: boolean;
}) {
  const shellSize = compact ? "h-10 w-10" : "h-12 w-12";
  const centerSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div className={`relative flex ${shellSize} shrink-0 items-center justify-center`}>
      <div
        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-all duration-700 ${
          isPlaying ? "animate-spin-slow" : ""
        }`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.1),transparent_40%)]" />
        <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,rgba(0,112,243,0.1)_0deg,rgba(0,0,0,0)_90deg,rgba(0,112,243,0.1)_180deg,rgba(0,0,0,0)_270deg,rgba(0,112,243,0.1)_360deg)]" />
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="absolute rounded-full border border-white/[0.03]"
            style={{ width: `${100 - index * 18}%`, height: `${100 - index * 18}%` }}
          />
        ))}
        <div
          className={`relative z-10 flex ${centerSize} items-center justify-center rounded-full border border-accent/20 bg-gradient-to-br from-accent/20 to-blue-500/20 shadow-inner`}
        >
          <div className="h-1.5 w-1.5 rounded-full border border-white/5 bg-black shadow-inner" />
        </div>
      </div>
    </div>
  );
}

export function MobileBottomPlayerLayout({
  isPlaying,
  canControlPlayback,
  playbackTrackId,
  title,
  artist,
  boundedProgressMs,
  currentTrackDuration,
  volume,
  setSeekDraft,
  commitSeek,
  applyVolume,
  onPrev,
  onNext,
  onTogglePlay
}: LayoutProps) {
  return (
    <div className="mx-auto w-full max-w-[1400px] lg:hidden">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
        <VinylBadge isPlaying={isPlaying} compact />

        <div className="min-w-0">
          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-accent">
            {isPlaying ? "正在播放" : "已暂停"}
          </p>
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          <p className="truncate text-[11px] text-foreground-muted">{artist}</p>
        </div>

        <div className="col-span-2 flex items-center gap-2">
          <span className="min-w-[36px] text-right text-[11px] tabular-nums text-foreground-muted">
            {formatDuration(boundedProgressMs)}
          </span>
          <div className="flex-1">
            <Slider
              value={boundedProgressMs}
              max={currentTrackDuration || 1}
              disabled={!currentTrackDuration || !canControlPlayback}
              onChange={(event) => setSeekDraft(Number(event.target.value))}
              onMouseUp={commitSeek}
              onTouchEnd={commitSeek}
            />
          </div>
          <span className="min-w-[36px] text-[11px] tabular-nums text-foreground-muted">
            {formatDuration(currentTrackDuration)}
          </span>
        </div>

        <div className="col-span-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div />

          <div className="flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              disabled={!canControlPlayback || !playbackTrackId}
              onClick={onPrev}
              title="上一曲"
              className="h-9 w-9"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </Button>

            <button
              className={`inline-grid h-10 w-10 place-items-center rounded-full outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                canControlPlayback
                  ? "bg-foreground text-background shadow-xl hover:scale-105 active:scale-95"
                  : "cursor-not-allowed bg-surface text-foreground-muted opacity-50"
              }`}
              disabled={!canControlPlayback}
              onClick={onTogglePlay}
              title={isPlaying ? "暂停" : "播放"}
              type="button"
            >
              {isPlaying ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6zm8-14v14h4V5z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <Button
              variant="ghost"
              size="icon"
              disabled={!canControlPlayback || !playbackTrackId}
              onClick={onNext}
              title="下一曲"
              className="h-9 w-9"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" />
              </svg>
            </Button>
          </div>

          <div className="flex min-w-[96px] items-center justify-end gap-2">
            <span className="text-foreground-muted">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.14v7.72A4.49 4.49 0 0016.5 12zM14 3.23v2.06a6.51 6.51 0 010 13.42v2.06A8.51 8.51 0 0014 3.23z" />
              </svg>
            </span>
            <Slider
              className="w-[72px]"
              value={volume}
              max={1}
              min={0}
              step={0.01}
              onChange={(event) => applyVolume(Number(event.target.value))}
              onInput={(event) =>
                applyVolume(Number((event.target as HTMLInputElement).value))
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function DesktopBottomPlayerLayout({
  isPlaying,
  canControlPlayback,
  playbackTrackId,
  title,
  artist,
  boundedProgressMs,
  currentTrackDuration,
  volume,
  setSeekDraft,
  commitSeek,
  applyVolume,
  onPrev,
  onNext,
  onTogglePlay
}: LayoutProps) {
  return (
    <div className="mx-auto hidden w-full max-w-[1400px] lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <VinylBadge isPlaying={isPlaying} />

        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.22em] text-accent">
            {isPlaying ? "正在播放" : "已暂停"}
          </p>
          <div className="min-h-[2.2rem]">
            <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
            <p className="truncate text-xs text-foreground-muted">{artist}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          disabled={!canControlPlayback || !playbackTrackId}
          onClick={onPrev}
          title="上一曲"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </Button>

        <button
          className={`inline-grid h-12 w-12 place-items-center rounded-full outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            canControlPlayback
              ? "bg-foreground text-background shadow-xl hover:scale-105 active:scale-95"
              : "cursor-not-allowed bg-surface text-foreground-muted opacity-50"
          }`}
          disabled={!canControlPlayback}
          onClick={onTogglePlay}
          title={isPlaying ? "暂停" : "播放"}
          type="button"
        >
          {isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6zm8-14v14h4V5z" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <Button
          variant="ghost"
          size="icon"
          disabled={!canControlPlayback || !playbackTrackId}
          onClick={onNext}
          title="下一曲"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" />
          </svg>
        </Button>
      </div>

      <div className="flex items-center justify-end gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="min-w-[40px] text-right text-xs tabular-nums text-foreground-muted">
            {formatDuration(boundedProgressMs)}
          </span>
          <div className="flex h-8 flex-1 items-center">
            <Slider
              value={boundedProgressMs}
              max={currentTrackDuration || 1}
              disabled={!currentTrackDuration || !canControlPlayback}
              onChange={(event) => setSeekDraft(Number(event.target.value))}
              onMouseUp={commitSeek}
              onTouchEnd={commitSeek}
            />
          </div>
          <span className="min-w-[40px] text-xs tabular-nums text-foreground-muted">
            {formatDuration(currentTrackDuration)}
          </span>
        </div>

        <div className="flex min-w-[146px] items-center justify-center gap-3">
          <span className="text-foreground-muted">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.14v7.72A4.49 4.49 0 0016.5 12zM14 3.23v2.06a6.51 6.51 0 010 13.42v2.06A8.51 8.51 0 0014 3.23z" />
            </svg>
          </span>
          <Slider
            className="w-full max-w-[124px]"
            value={volume}
            max={1}
            min={0}
            step={0.01}
            onChange={(event) => applyVolume(Number(event.target.value))}
            onInput={(event) =>
              applyVolume(Number((event.target as HTMLInputElement).value))
            }
          />
        </div>
      </div>
    </div>
  );
}
