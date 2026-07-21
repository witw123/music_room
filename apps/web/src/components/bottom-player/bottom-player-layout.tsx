"use client";

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
  setSeekDraft: (value: number | null) => void;
  commitSeek: () => void;
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
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  isImmersiveOpen: boolean;
  onToggleImmersive: () => void;
  isMiniOpen: boolean;
  onToggleMini: () => void;
  isLyricsOpen?: boolean;
  onToggleLyrics?: () => void;
  artworkAccent: string;
  artworkAccentSoft: string;
  artworkUrl: string | null;
};

export function VinylBadge({
  isPlaying,
  compact = false,
  accentColor = "rgb(0 112 243)",
  accentSoft = "rgba(0, 112, 243, 0.16)",
  artworkUrl = null
}: {
  isPlaying: boolean;
  compact?: boolean;
  accentColor?: string;
  accentSoft?: string;
  artworkUrl?: string | null;
}) {
  const shellSize = compact ? "h-10 w-10" : "h-12 w-12";
  const centerSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div className={`relative flex ${shellSize} shrink-0 items-center justify-center`}>
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-transform duration-700 will-change-transform animate-spin-slow"
        style={{ animationPlayState: isPlaying ? "running" : "paused" }}
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
        {artworkUrl ? (
          <div
            aria-hidden="true"
            className="absolute z-10 aspect-square w-[55%] overflow-hidden rounded-full border border-white/10 bg-cover bg-center shadow-[0_0_12px_rgba(0,0,0,0.4)]"
            style={{ backgroundImage: `url("${artworkUrl}")` }}
          />
        ) : null}
        <div
          className={`absolute z-20 flex ${centerSize} items-center justify-center rounded-full border shadow-inner`}
          style={{ borderColor: accentSoft, backgroundColor: accentSoft, color: accentColor }}
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
  disabled = false,
  accentColor = "rgb(0 148 255)"
}: {
  mode: PlaybackMode;
  onCycle: () => void;
  disabled?: boolean;
  accentColor?: string;
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
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-200 transition-colors hover:bg-white/10 active:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: accentColor }}
    >
      <PlaybackModeIcon mode={mode} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

export function LyricsToggleButton({
  isOpen,
  onToggle,
  disabled = false,
  accentColor,
  accentSoft
}: {
  isOpen: boolean;
  onToggle: () => void;
  disabled?: boolean;
  accentColor?: string;
  accentSoft?: string;
}) {
  return (
    <button
      type="button"
      data-testid="player-lyrics-toggle"
      aria-pressed={isOpen}
      aria-label={isOpen ? "关闭歌词" : "打开歌词"}
      title={isOpen ? "关闭歌词" : "打开歌词"}
      onClick={onToggle}
      disabled={disabled}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: accentColor, ...(isOpen ? { backgroundColor: accentSoft } : {}) }}
    >
      词
    </button>
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
  setSeekDraft,
  commitSeek,
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
  onRemoveQueueItem,
  onReorderQueue,
  isImmersiveOpen,
  onToggleImmersive,
  isMiniOpen,
  onToggleMini,
  isLyricsOpen = false,
  onToggleLyrics,
  artworkAccent,
  artworkAccentSoft,
  artworkUrl
}: LayoutProps) {
  return (
    <div className="mx-auto w-full max-w-[1400px] lg:hidden">
      <div className="grid min-h-[4.25rem] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 sm:gap-x-3 sm:gap-y-1.5">
        <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={onToggleImmersive} title="打开沉浸式播放" aria-label="打开沉浸式播放" type="button">
          <VinylBadge
            accentColor={artworkAccent}
            accentSoft={artworkAccentSoft}
            artworkUrl={artworkUrl}
            isPlaying={isPlaying}
            compact
          />
        </button>

        <div className="min-w-0">
          <div className="mb-1 flex min-h-[1.1rem] items-center">
            <span
              className="inline-flex w-[5.4rem] shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em]"
              style={{ borderColor: artworkAccentSoft, backgroundColor: artworkAccentSoft, color: artworkAccent }}
            >
              {isPlaying ? "正在播放" : "已暂停"}
            </span>
          </div>
          <div className="min-h-[2.1rem]">
            <h3 className="truncate text-sm font-semibold leading-5 text-foreground">{title}</h3>
            <p className="truncate text-[11px] leading-4 text-foreground-muted">{artist}</p>
          </div>
        </div>

        <div className="col-span-2 flex items-center gap-1.5 sm:gap-2">
          <PlayerQueueDrawer
            queue={queue}
            tracks={tracks}
            currentQueueItemId={currentQueueItemId}
            accentColor={artworkAccent}
            accentSoft={artworkAccentSoft}
            canControlPlayback={canControlPlayback}
            canReorderQueue={canReorderQueue}
            canRemoveQueue={canRemoveQueue}
            onPlayQueueItem={onPlayQueueItem}
            onRemoveQueueItem={onRemoveQueueItem}
            onReorderQueue={onReorderQueue}
          />
          <span className="w-[38px] shrink-0 text-right text-[10px] tabular-nums text-foreground-muted sm:w-[44px] sm:text-[11px]">
            {formatDuration(boundedProgressMs)}
          </span>
          <div className="flex-1">
            <Slider
              data-testid="player-seek-slider"
              value={boundedProgressMs}
              max={currentTrackDuration || 1}
              accentColor={artworkAccent}
              disabled={!currentTrackDuration || !canSeekPlayback}
              onChange={(event) => setSeekDraft(Number(event.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
            />
          </div>
          <span className="w-[38px] shrink-0 text-[10px] tabular-nums text-foreground-muted sm:w-[44px] sm:text-[11px]">
            {formatDuration(currentTrackDuration)}
          </span>
        </div>

        <div className="col-span-2 grid min-h-[2.25rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 sm:min-h-[2.5rem] sm:gap-3">
          <div className="flex shrink-0 justify-start">
            {onToggleLyrics ? <LyricsToggleButton accentColor={artworkAccent} accentSoft={artworkAccentSoft} disabled={!playbackTrackId} isOpen={isLyricsOpen} onToggle={onToggleLyrics} /> : null}
            <PlaybackModeButton
              mode={playbackMode}
              onCycle={onCyclePlaybackMode}
              disabled={!canControlPlayback}
              accentColor={artworkAccent}
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
              style={{ color: artworkAccent }}
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
              style={canControlPlayback ? { backgroundColor: artworkAccent, color: "#fff", boxShadow: `0 0 18px ${artworkAccentSoft}` } : undefined}
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
              style={{ color: artworkAccent }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" />
              </svg>
            </Button>
          </div>

          <div className="flex shrink-0 items-center">
            <ImmersiveToggleButton accentColor={artworkAccent} accentSoft={artworkAccentSoft} isOpen={isImmersiveOpen} onToggle={onToggleImmersive} />
            <MiniPlayerToggleButton accentColor={artworkAccent} accentSoft={artworkAccentSoft} isOpen={isMiniOpen} onToggle={onToggleMini} />
          </div>
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
  setSeekDraft,
  commitSeek,
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
  onRemoveQueueItem,
  onReorderQueue,
  isImmersiveOpen,
  onToggleImmersive,
  isMiniOpen,
  onToggleMini,
  isLyricsOpen = false,
  onToggleLyrics,
  artworkAccent,
  artworkAccentSoft,
  artworkUrl
}: LayoutProps) {
  return (
    <div className="mx-auto hidden w-full max-w-[1400px] lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={onToggleImmersive} title="打开沉浸式播放" aria-label="打开沉浸式播放" type="button">
        <VinylBadge
          accentColor={artworkAccent}
          accentSoft={artworkAccentSoft}
          artworkUrl={artworkUrl}
          isPlaying={isPlaying}
        />
        </button>

        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.22em]" style={{ color: artworkAccent }}>
            {isPlaying ? "正在播放" : "已暂停"}
          </p>
          <div className="min-h-[2rem]">
            <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
            <p className="truncate text-xs text-foreground-muted">{artist}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3">
        {onToggleLyrics ? <LyricsToggleButton accentColor={artworkAccent} accentSoft={artworkAccentSoft} disabled={!playbackTrackId} isOpen={isLyricsOpen} onToggle={onToggleLyrics} /> : null}
        <PlaybackModeButton
          mode={playbackMode}
          onCycle={onCyclePlaybackMode}
          disabled={!canControlPlayback}
          accentColor={artworkAccent}
        />
        <Button
          data-testid="player-prev-button"
          variant="ghost"
          size="icon"
          disabled={!canControlPlayback || !playbackTrackId}
          onClick={onPrev}
          title="上一首"
          style={{ color: artworkAccent }}
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
          style={canControlPlayback ? { backgroundColor: artworkAccent, color: "#fff", boxShadow: `0 0 18px ${artworkAccentSoft}` } : undefined}
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
          style={{ color: artworkAccent }}
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
            accentColor={artworkAccent}
            accentSoft={artworkAccentSoft}
            canControlPlayback={canControlPlayback}
            canReorderQueue={canReorderQueue}
            canRemoveQueue={canRemoveQueue}
            onPlayQueueItem={onPlayQueueItem}
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
              accentColor={artworkAccent}
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

        <ImmersiveToggleButton accentColor={artworkAccent} accentSoft={artworkAccentSoft} isOpen={isImmersiveOpen} onToggle={onToggleImmersive} />
        <MiniPlayerToggleButton accentColor={artworkAccent} accentSoft={artworkAccentSoft} isOpen={isMiniOpen} onToggle={onToggleMini} />
      </div>
    </div>
  );
}

function ImmersiveToggleButton({ isOpen, onToggle, accentColor, accentSoft }: { isOpen: boolean; onToggle: () => void; accentColor?: string; accentSoft?: string }) {
  return (
    <button
      type="button"
      aria-label={isOpen ? "退出沉浸式播放" : "打开沉浸式播放"}
      title={isOpen ? "退出沉浸式播放" : "打开沉浸式播放"}
      onClick={onToggle}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-10 sm:w-10"
      style={accentColor ? { color: accentColor, ...(isOpen ? { backgroundColor: accentSoft } : {}) } : undefined}
    >
      {isOpen ? (
        <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M9 15H4v5" /><path d="m4 20 6-6" /><path d="M15 9h5V4" /><path d="m20 4-6 6" /></svg>
      ) : (
        <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M4 9V4h5" /><path d="m4 4 6 6" /><path d="M20 15v5h-5" /><path d="m20 20-6-6" /></svg>
      )}
    </button>
  );
}

function MiniPlayerToggleButton({ isOpen, onToggle, accentColor, accentSoft }: { isOpen: boolean; onToggle: () => void; accentColor?: string; accentSoft?: string }) {
  return (
    <button
      type="button"
      aria-label={isOpen ? "关闭迷你播放器" : "打开迷你播放器"}
      title={isOpen ? "关闭迷你播放器" : "打开迷你播放器"}
      onClick={onToggle}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-10 sm:w-10"
      style={accentColor ? { color: accentColor, ...(isOpen ? { backgroundColor: accentSoft } : {}) } : undefined}
    >
      <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        <rect x="3.5" y="4" width="17" height="16" rx="2" />
        <rect x="11" y="12" width="7" height="5" rx="0.8" />
      </svg>
    </button>
  );
}
