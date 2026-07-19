"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { QueueItem, TrackMeta } from "@music-room/shared";
import { PlayerQueueDrawer } from "@/components/PlayerQueueDrawer";
import { getNextPlaybackMode, type PlaybackMode } from "./playback-mode";

type LayoutProps = {
  isPlaying: boolean;
  canControlPlayback: boolean;
  canSeekPlayback: boolean;
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
  playbackMode: PlaybackMode;
  onCyclePlaybackMode: () => void;
  queue: QueueItem[];
  tracks: TrackMeta[];
  currentQueueItemId: string | null;
  canReorderQueue: boolean;
  canRemoveQueue: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  availableTracks?: TrackMeta[];
  onAddToQueue?: (trackId: string) => void | Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  isImmersiveOpen: boolean;
  onToggleImmersive: () => void;
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
        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-transform duration-700 will-change-transform ${
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

function PlaybackModeIcon({ mode }: { mode: PlaybackMode }) {
  if (mode === "shuffle") {
    return (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h3.5c3.5 0 4.5 10 9 10H20" />
        <path d="m17 14 3 3-3 3" />
        <path d="M4 17h3c1.4 0 2.4-1.1 3.1-2.4" />
        <path d="M14 9.4C14.8 8 15.8 7 17.2 7H20" />
        <path d="m17 4 3 3-3 3" />
      </svg>
    );
  }

  if (mode === "single") {
    return (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 2l4 4-4 4" />
        <path d="M3 11V9a3 3 0 0 1 3-3h15" />
        <path d="m7 22-4-4 4-4" />
        <path d="M21 13v2a3 3 0 0 1-3 3H3" />
        <path d="M12 10v4" />
        <path d="M10.5 10h1.5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-1.5" />
      </svg>
    );
  }

  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h12" />
      <path d="m13 4 3 3-3 3" />
      <path d="M20 17H8" />
      <path d="m11 14-3 3 3 3" />
    </svg>
  );
}

const playbackModeLabels: Record<PlaybackMode, string> = {
  sequence: "顺序播放",
  shuffle: "随机播放",
  single: "单曲循环"
};

export function PlaybackModeButton({
  mode,
  onCycle,
  disabled = false
}: {
  mode: PlaybackMode;
  onCycle: () => void;
  disabled?: boolean;
}) {
  const label = playbackModeLabels[mode];
  const nextMode = getNextPlaybackMode(mode);

  return (
    <button
      type="button"
      data-testid="playback-mode-button"
      data-playback-mode={mode}
      disabled={disabled}
      aria-label={`当前为${label}，点击切换到${playbackModeLabels[nextMode]}`}
      title={`当前：${label}，点击切换`}
      onClick={onCycle}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <PlaybackModeIcon mode={mode} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

function VolumeIcon({ volume }: { volume: number }) {
  if (volume <= 0.01) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="m19 9-5 6" />
        <path d="m14 9 5 6" />
      </svg>
    );
  }

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function VolumeControl({ volume, onChange }: { volume: number; onChange: (value: number) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const percentage = Math.round(Math.max(0, Math.min(1, volume)) * 100);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      {isOpen ? (
        <div className="absolute bottom-full right-0 z-[60] mb-3 flex h-44 w-8 items-center justify-center bg-transparent">
          <div className="relative flex h-full w-full items-center justify-center">
            <Slider
              aria-label="音量"
              className="h-4 shrink-0 -rotate-90 [&>div:nth-child(2)]:scale-100 [&>div:nth-child(2)]:opacity-100"
              containerStyle={{ width: "10rem" }}
              max={1}
              min={0}
              step={0.01}
              value={volume}
              onChange={(event) => onChange(Number(event.target.value))}
              onInput={(event) => onChange(Number((event.target as HTMLInputElement).value))}
            />
          </div>
        </div>
      ) : null}
      <button
        type="button"
        data-testid="player-volume-button"
        aria-expanded={isOpen}
        aria-label={`音量 ${percentage}%，点击${isOpen ? "收起" : "调整"}`}
        title={`音量 ${percentage}%`}
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-10 sm:w-10"
      >
        <VolumeIcon volume={volume} />
      </button>
    </div>
  );
}

export function MobileBottomPlayerLayout({
  isPlaying,
  canControlPlayback,
  canSeekPlayback,
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
  onTogglePlay,
  playbackMode,
  onCyclePlaybackMode,
  queue,
  tracks,
  currentQueueItemId,
  canReorderQueue,
  canRemoveQueue,
  onPlayQueueItem,
  availableTracks,
  onAddToQueue,
  onRemoveQueueItem,
  onReorderQueue,
  isImmersiveOpen,
  onToggleImmersive
}: LayoutProps) {
  return (
    <div className="mx-auto w-full max-w-[1400px] lg:hidden">
      <div className="grid min-h-[5.5rem] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
        <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={onToggleImmersive} title="打开沉浸式播放" aria-label="打开沉浸式播放" type="button">
          <VinylBadge isPlaying={isPlaying} compact />
        </button>

        <div className="min-w-0">
          <div className="mb-1 flex min-h-[1.1rem] items-center">
            <span className="inline-flex w-[5.4rem] shrink-0 items-center justify-center rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-accent">
              {isPlaying ? "正在播放" : "已暂停"}
            </span>
          </div>
          <div className="min-h-[2.1rem]">
            <h3 className="truncate text-sm font-semibold leading-5 text-foreground">{title}</h3>
            <p className="truncate text-[11px] leading-4 text-foreground-muted">{artist}</p>
          </div>
        </div>

        <div className="col-span-2 flex items-center gap-2">
          <PlayerQueueDrawer
            queue={queue}
            tracks={tracks}
            currentQueueItemId={currentQueueItemId}
            canControlPlayback={canControlPlayback}
            canReorderQueue={canReorderQueue}
            canRemoveQueue={canRemoveQueue}
            onPlayQueueItem={onPlayQueueItem}
            availableTracks={availableTracks}
            onAddToQueue={onAddToQueue}
            onRemoveQueueItem={onRemoveQueueItem}
            onReorderQueue={onReorderQueue}
          />
          <span className="w-[44px] shrink-0 text-right text-[11px] tabular-nums text-foreground-muted">
            {formatDuration(boundedProgressMs)}
          </span>
          <div className="flex-1">
            <Slider
              data-testid="player-seek-slider"
              value={boundedProgressMs}
              max={currentTrackDuration || 1}
              disabled={!currentTrackDuration || !canSeekPlayback}
              onChange={(event) => setSeekDraft(Number(event.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
            />
          </div>
          <span className="w-[44px] shrink-0 text-[11px] tabular-nums text-foreground-muted">
            {formatDuration(currentTrackDuration)}
          </span>
        </div>

        <div className="col-span-2 grid min-h-[2.5rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3">
          <div className="flex shrink-0 justify-start">
            <PlaybackModeButton
              mode={playbackMode}
              onCycle={onCyclePlaybackMode}
              disabled={!canControlPlayback}
            />
          </div>

          <div className="flex min-w-0 items-center justify-center gap-0 sm:gap-1">
            <Button
              data-testid="player-prev-button"
              variant="ghost"
              size="icon"
              disabled={!canControlPlayback || !playbackTrackId}
              onClick={onPrev}
              title="上一首"
              className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </Button>

            <button
              data-testid="player-toggle-button"
              className={`inline-grid h-9 w-9 shrink-0 place-items-center rounded-full outline-none transition-[transform,box-shadow,background-color,color] duration-200 will-change-transform focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-10 sm:w-10 ${
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
              data-testid="player-next-button"
              variant="ghost"
              size="icon"
              disabled={!canControlPlayback || !playbackTrackId}
              onClick={onNext}
              title="下一首"
              className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" />
              </svg>
            </Button>
          </div>

          <VolumeControl volume={volume} onChange={applyVolume} />
          <ImmersiveToggleButton isOpen={isImmersiveOpen} onToggle={onToggleImmersive} />
        </div>
      </div>
    </div>
  );
}

export function DesktopBottomPlayerLayout({
  isPlaying,
  canControlPlayback,
  canSeekPlayback,
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
  onTogglePlay,
  playbackMode,
  onCyclePlaybackMode,
  queue,
  tracks,
  currentQueueItemId,
  canReorderQueue,
  canRemoveQueue,
  onPlayQueueItem,
  availableTracks,
  onAddToQueue,
  onRemoveQueueItem,
  onReorderQueue,
  isImmersiveOpen,
  onToggleImmersive
}: LayoutProps) {
  return (
    <div className="mx-auto hidden w-full max-w-[1400px] lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={onToggleImmersive} title="打开沉浸式播放" aria-label="打开沉浸式播放" type="button">
          <VinylBadge isPlaying={isPlaying} />
        </button>

        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.22em] text-accent">
            {isPlaying ? "正在播放" : "已暂停"}
          </p>
          <div className="min-h-[2rem]">
            <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
            <p className="truncate text-xs text-foreground-muted">{artist}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3">
        <PlaybackModeButton
          mode={playbackMode}
          onCycle={onCyclePlaybackMode}
          disabled={!canControlPlayback}
        />
        <Button
          data-testid="player-prev-button"
          variant="ghost"
          size="icon"
          disabled={!canControlPlayback || !playbackTrackId}
          onClick={onPrev}
          title="上一首"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </Button>

        <button
          data-testid="player-toggle-button"
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
          data-testid="player-next-button"
          variant="ghost"
          size="icon"
          disabled={!canControlPlayback || !playbackTrackId}
          onClick={onNext}
          title="下一首"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" />
          </svg>
        </Button>
      </div>

      <div className="flex items-center justify-end gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <PlayerQueueDrawer
            queue={queue}
            tracks={tracks}
            currentQueueItemId={currentQueueItemId}
            canControlPlayback={canControlPlayback}
            canReorderQueue={canReorderQueue}
            canRemoveQueue={canRemoveQueue}
            onPlayQueueItem={onPlayQueueItem}
            availableTracks={availableTracks}
            onAddToQueue={onAddToQueue}
            onRemoveQueueItem={onRemoveQueueItem}
            onReorderQueue={onReorderQueue}
          />
          <span className="min-w-[40px] text-right text-xs tabular-nums text-foreground-muted">
            {formatDuration(boundedProgressMs)}
          </span>
          <div className="flex h-8 flex-1 items-center">
            <Slider
              data-testid="player-seek-slider"
              value={boundedProgressMs}
              max={currentTrackDuration || 1}
              disabled={!currentTrackDuration || !canSeekPlayback}
              onChange={(event) => setSeekDraft(Number(event.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
            />
          </div>
          <span className="min-w-[40px] text-xs tabular-nums text-foreground-muted">
            {formatDuration(currentTrackDuration)}
          </span>
        </div>

        <VolumeControl volume={volume} onChange={applyVolume} />
        <ImmersiveToggleButton isOpen={isImmersiveOpen} onToggle={onToggleImmersive} />
      </div>
    </div>
  );
}

function ImmersiveToggleButton({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={isOpen ? "退出沉浸式播放" : "打开沉浸式播放"}
      title={isOpen ? "退出沉浸式播放" : "打开沉浸式播放"}
      onClick={onToggle}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-10 sm:w-10 ${isOpen ? "text-accent" : "text-foreground-muted"}`}
    >
      {isOpen ? (
        <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M9 15H4v5" /><path d="m4 20 6-6" /><path d="M15 9h5V4" /><path d="m20 4-6 6" /></svg>
      ) : (
        <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M4 9V4h5" /><path d="m4 4 6 6" /><path d="M20 15v5h-5" /><path d="m20 20-6-6" /></svg>
      )}
    </button>
  );
}
