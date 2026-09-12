"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { Button } from "@/components/ui/button";
import type { ProviderTrackCandidate, QueueItem, TrackMeta } from "@music-room/shared";
import { PlayerQueueDrawer } from "./PlayerQueueDrawer";
import { FavoriteTrackButton } from "@/components/ui/FavoriteTrackButton";
import { getNextPlaybackMode, type PlaybackMode } from "./playback-mode";
import { SquareAlbumCover } from "./PlayerArtwork";
import { getArtworkSourceUrl, withAlpha } from "./artwork-colors";
import {
  getAppSettings,
  updateAppSettings,
  appSettingsChangeEvent,
  type PlayerStyle,
  type AudioQualityPreference
} from "@/features/settings/settings-store";

type LayoutProps = {
  isPlaying: boolean;
  canControlPlayback: boolean;
  canSeekPlayback: boolean;
  playbackTrackId: string | null | undefined;
  title: string;
  artist: string;
  album: string;
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
  nextQueueItemId: string | null;
  canReorderQueue: boolean;
  canRemoveQueue: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onPlayNextQueueItem: (queueItemId: string) => Promise<void>;
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
  playerStyle: PlayerStyle;
  mobileVariant?: "compact" | "full";
  favoriteTrack?: ProviderTrackCandidate | null;
  favoriteTrackIsFavorite?: boolean;
  favoriteTrackIsPending?: boolean;
  onToggleFavoriteTrack?: () => void;
};

export function VinylBadge({
  isPlaying,
  compact = false,
  accentColor = "rgb(161 161 170)",
  accentSoft = "rgba(161, 161, 170, 0.16)",
  artworkUrl = null,
  playerStyle = "vinyl"
}: {
  isPlaying: boolean;
  compact?: boolean;
  accentColor?: string;
  accentSoft?: string;
  artworkUrl?: string | null;
  playerStyle?: PlayerStyle;
}) {
  const shellSize = compact ? "h-10 w-10" : "h-12 w-12";
  const centerSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  if (playerStyle === "square-cover") {
    return <SquareAlbumCover artworkUrl={artworkUrl} className={`${shellSize} shrink-0 rounded-xl`} />;
  }

  return (
    <div className={`relative flex ${shellSize} shrink-0 items-center justify-center`}>
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-transform duration-700 will-change-transform animate-spin-slow"
        style={{ animationPlayState: isPlaying ? "running" : "paused" }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.1),transparent_40%)]" />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 0deg at 50% 50%, ${withAlpha(accentColor, 0.1)} 0deg, transparent 90deg, ${withAlpha(accentColor, 0.1)} 180deg, transparent 270deg, ${withAlpha(accentColor, 0.1)} 360deg)`
          }}
        />
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
            style={{ backgroundImage: `url("${getArtworkSourceUrl(artworkUrl)}")` }}
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
  sequence: "列表循环",
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
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition-colors hover:bg-white/10 active:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
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
  accentColor
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
      aria-label={isOpen ? "关闭桌面歌词" : "打开桌面歌词"}
      title={isOpen ? "关闭桌面歌词" : "打开桌面歌词"}
      onClick={onToggle}
      disabled={disabled}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold transition-colors hover:bg-white/10 active:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 ${
        isOpen ? "text-white bg-white/10" : "text-foreground-muted hover:text-white"
      }`}
      style={isOpen && accentColor ? { color: accentColor } : undefined}
    >
      <span className="text-[13px] font-bold font-sans">词</span>
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

function VolumeControl({
  volume,
  onChange,
  accentColor = "rgb(0 148 255)",
  accentSoft = "rgba(0, 148, 255, 0.16)"
}: {
  volume: number;
  onChange: (value: number) => void;
  accentColor?: string;
  accentSoft?: string;
}) {
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
        <div className="absolute bottom-full right-1/2 z-[60] mb-2 flex translate-x-1/2 flex-col items-center">
          <div className="light-popover-surface flex h-[9.25rem] w-14 flex-col items-center rounded-2xl border border-surface-border bg-background-secondary/95 px-2.5 py-2.5 shadow-[0_14px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="relative h-24 w-5 shrink-0">
              <div className="absolute left-1/2 top-0 h-full w-1.5 -translate-x-1/2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="absolute inset-x-0 bottom-0 rounded-full transition-[height,background-color] duration-150"
                  style={{
                    height: `${percentage}%`,
                    backgroundColor: accentColor,
                    boxShadow: `0 0 10px ${accentColor}`
                  }}
                />
              </div>
              <div
                aria-hidden="true"
                className="absolute left-1/2 h-5 w-5 -translate-x-1/2 translate-y-1/2 rounded-full border border-white/20 bg-foreground shadow-[0_3px_9px_rgba(0,0,0,0.35)] transition-[bottom] duration-150"
                style={{ bottom: `${percentage}%` }}
              />
              <input
                aria-label="音量"
                data-testid="player-volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => onChange(Number(event.target.value))}
                className="absolute left-1/2 top-1/2 h-8 w-24 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer opacity-0 focus-visible:opacity-100 focus-visible:outline-none"
              />
            </div>
            <span className="mt-2 text-xs tabular-nums text-foreground-muted">{percentage}%</span>
          </div>
          <div className="h-0 w-0 border-x-[7px] border-t-[7px] border-x-transparent border-t-background-secondary" aria-hidden="true" />
        </div>
      ) : null}
      <button
        type="button"
        data-testid="player-volume-button"
        aria-expanded={isOpen}
        aria-label={`音量 ${percentage}%，点击${isOpen ? "收起" : "调整"}`}
        title={`音量 ${percentage}%`}
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-10 sm:w-10"
        style={{ color: accentColor, ...(isOpen ? { backgroundColor: accentSoft } : {}) }}
      >
        <VolumeIcon volume={volume} />
      </button>
    </div>
  );
}

export function MobileBottomPlayerLayout({
  isPlaying,
  canControlPlayback,
  playbackTrackId,
  title,
  artist,
  onTogglePlay,
  queue,
  tracks,
  currentQueueItemId,
  nextQueueItemId,
  canReorderQueue,
  canRemoveQueue,
  onPlayQueueItem,
  onPlayNextQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  onToggleImmersive,
  artworkAccent,
  artworkAccentSoft,
  artworkUrl
}: LayoutProps) {
  const pointerStartY = useRef<number | null>(null);
  const pointerStartX = useRef<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    pointerStartY.current = e.clientY;
    pointerStartX.current = e.clientX;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (pointerStartY.current === null || pointerStartX.current === null) return;
    const deltaY = e.clientY - pointerStartY.current;
    const deltaX = e.clientX - pointerStartX.current;
    pointerStartY.current = null;
    pointerStartX.current = null;

    // Upward swipe gesture (swipe up): upward drag > 25px with vertical dominance
    if (deltaY < -25 && Math.abs(deltaY) > Math.abs(deltaX)) {
      onToggleImmersive();
    }
  };

  return (
    <div
      className="relative mx-auto w-full max-w-[760px] md:hidden select-none"
      data-player-layout="mobile"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {/* Subtle indicator showing swipe up affordance */}
      <div className="absolute -top-1 left-1/2 -translate-x-1/2 h-0.5 w-7 rounded-full bg-white/20 opacity-70 pointer-events-none" />

      <div className="flex h-12 items-center gap-2.5 px-1">
        {/* Click body to open full immersive sheet */}
        <button
          aria-label="打开播放详情"
          className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left outline-none transition-transform duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent"
          onClick={onToggleImmersive}
          title="打开播放详情"
          type="button"
        >
          <SquareAlbumCover
            artworkUrl={artworkUrl}
            className="h-10 w-10 shrink-0 rounded-lg border border-white/[0.08] shadow-sm"
          />

          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-foreground leading-tight">{title}</p>
            <p className="truncate text-[11px] text-foreground-muted mt-0.5 leading-tight">{artist}</p>
          </div>
        </button>

        {/* Action Controls */}
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            aria-label={isPlaying ? "暂停" : "播放"}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              canControlPlayback
                ? "bg-foreground text-background shadow-sm hover:opacity-90"
                : "cursor-not-allowed bg-white/10 text-foreground-muted opacity-40"
            }`}
            disabled={!canControlPlayback || !playbackTrackId}
            onClick={onTogglePlay}
            title={isPlaying ? "暂停" : "播放"}
            type="button"
          >
            {isPlaying ? (
              <svg aria-hidden="true" fill="currentColor" height="15" viewBox="0 0 24 24" width="15">
                <path d="M6 19h4V5H6zm8-14v14h4V5z" />
              </svg>
            ) : (
              <svg aria-hidden="true" fill="currentColor" height="15" viewBox="0 0 24 24" width="15" className="translate-x-[0.5px]">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <PlayerQueueDrawer
            queue={queue}
            tracks={tracks}
            currentQueueItemId={currentQueueItemId}
            nextQueueItemId={nextQueueItemId}
            accentColor={artworkAccent}
            accentSoft={artworkAccentSoft}
            canControlPlayback={canControlPlayback}
            canReorderQueue={canReorderQueue}
            canRemoveQueue={canRemoveQueue}
            onPlayQueueItem={onPlayQueueItem}
            onPlayNextQueueItem={onPlayNextQueueItem}
            onRemoveQueueItem={onRemoveQueueItem}
            onReorderQueue={onReorderQueue}
            compactMobile
          />
        </div>
      </div>
    </div>
  );
}

export function TopEdgeScrubber({
  progressMs,
  durationMs,
  canSeek,
  onSeekDraft,
  onCommitSeek,
  accentColor = "var(--accent)"
}: {
  progressMs: number;
  durationMs: number;
  canSeek: boolean;
  onSeekDraft: (value: number | null) => void;
  onCommitSeek: () => void;
  accentColor?: string;
}) {
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverData, setHoverData] = useState<{ ratio: number; timeMs: number } | null>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);

  const effectiveDuration = durationMs > 0 ? durationMs : 1;
  const currentRatio = Math.max(0, Math.min(1, progressMs / effectiveDuration));
  const displayRatio = isDragging && hoverData ? hoverData.ratio : currentRatio;

  const calculateRatio = (clientX: number) => {
    if (!scrubberRef.current) return 0;
    const rect = scrubberRef.current.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canSeek || durationMs <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    const ratio = calculateRatio(event.clientX);
    const timeMs = Math.round(ratio * durationMs);
    setHoverData({ ratio, timeMs });
    onSeekDraft(timeMs);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (durationMs <= 0) return;
    const ratio = calculateRatio(event.clientX);
    const timeMs = Math.round(ratio * durationMs);
    setHoverData({ ratio, timeMs });
    if (isDragging) {
      onSeekDraft(timeMs);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch (_err) {
        void _err;
      }
      setIsDragging(false);
      onCommitSeek();
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch (_err) {
        void _err;
      }
      setIsDragging(false);
      onSeekDraft(null);
    }
  };

  return (
    <div
      ref={scrubberRef}
      role="slider"
      data-testid="player-seek-slider"
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={progressMs}
      aria-valuetext={`${formatDuration(progressMs)} / ${formatDuration(durationMs)}`}
      tabIndex={canSeek ? 0 : -1}
      className="group/scrubber absolute inset-x-0 -top-1.5 z-30 h-3.5 cursor-pointer select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerEnter={() => setIsHovering(true)}
      onPointerLeave={() => {
        if (!isDragging) {
          setIsHovering(false);
          setHoverData(null);
        }
      }}
    >
      {/* Background track line: 2px normal, 3.5px on hover/drag */}
      <div className="absolute inset-x-0 top-1.5 h-[2px] bg-white/10 transition-[height,top] duration-150 group-hover/scrubber:top-[4.5px] group-hover/scrubber:h-[3.5px]">
        {/* Progress Fill */}
        <div
          className="relative h-full transition-[width] duration-75"
          style={{
            width: `${displayRatio * 100}%`,
            backgroundColor: accentColor
          }}
        >
          {/* Thumb circle on hover / drag */}
          <div
            className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.5)] transition-all duration-150 ${
              isHovering || isDragging
                ? "h-3 w-3 opacity-100 scale-100"
                : "h-2 w-2 opacity-0 scale-75 pointer-events-none"
            }`}
          />
        </div>
      </div>

      {/* Floating time tooltip bubble: 00:53 / 05:00 */}
      {(isHovering || isDragging) && hoverData !== null && durationMs > 0 && (
        <div
          className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-full border border-white/15 bg-white px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-900 shadow-[0_4px_12px_rgba(0,0,0,0.3)] animate-fade-in"
          style={{
            left: `${Math.max(0.04, Math.min(0.96, hoverData.ratio)) * 100}%`
          }}
        >
          {formatDuration(hoverData.timeMs)} / {formatDuration(durationMs)}
        </div>
      )}
    </div>
  );
}

const AUDIO_QUALITY_OPTIONS: Array<{
  value: AudioQualityPreference;
  label: string;
  badge: string;
  bitrate: string;
}> = [
  { value: "hires", label: "Hi-Res", badge: "Hi-Res", bitrate: "高解析" },
  { value: "lossless", label: "无损", badge: "无损", bitrate: "FLAC" },
  { value: "exhigh", label: "极高", badge: "极高", bitrate: "320k" },
  { value: "high", label: "较高", badge: "较高", bitrate: "192k" },
  { value: "standard", label: "标准", badge: "标准", bitrate: "128k" }
];

export function QualityBadge({ quality }: { quality?: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [preferredQuality, setPreferredQuality] = useState<AudioQualityPreference>(() => {
    return getAppSettings().playback.preferredAudioQuality;
  });

  useEffect(() => {
    const handleSettingsChange = () => {
      setPreferredQuality(getAppSettings().playback.preferredAudioQuality);
    };
    window.addEventListener(appSettingsChangeEvent, handleSettingsChange);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, handleSettingsChange);
    };
  }, []);

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

  const activeQuality = (quality as AudioQualityPreference) || preferredQuality;
  const currentOption =
    AUDIO_QUALITY_OPTIONS.find((opt) => opt.value === activeQuality) ??
    AUDIO_QUALITY_OPTIONS.find((opt) => opt.value === "exhigh")!;

  const handleSelect = (val: AudioQualityPreference) => {
    updateAppSettings({
      playback: {
        preferredAudioQuality: val
      }
    });
    setPreferredQuality(val);
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`音频音质设置：当前${currentOption.label}`}
        aria-expanded={isOpen}
        title="点击切换首选音质"
        className="inline-flex items-center gap-1 rounded border border-white/20 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium tracking-tight text-white/80 select-none hover:border-white/40 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <span>{currentOption.badge}</span>
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`opacity-60 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 z-[60] mb-2 w-44 rounded-xl border border-surface-border bg-background-secondary/95 p-1.5 shadow-[0_12px_28px_rgba(0,0,0,0.35)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
          <div className="px-2 py-1 text-[10px] font-semibold text-foreground-muted tracking-wider">
            首选音质偏好
          </div>
          <div className="space-y-0.5">
            {AUDIO_QUALITY_OPTIONS.map((opt) => {
              const isSelected = opt.value === activeQuality;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${
                    isSelected
                      ? "bg-accent/15 text-accent font-medium"
                      : "text-foreground-secondary hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{opt.label}</span>
                    <span className="text-[10px] text-foreground-muted">({opt.bitrate})</span>
                  </div>
                  {isSelected && (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-1 border-t border-surface-border/50 px-2 pt-1 text-[9px] text-foreground-muted leading-tight">
            平台无高规格或无权限时平滑降级
          </div>
        </div>
      )}
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
  nextQueueItemId,
  canReorderQueue,
  canRemoveQueue,
  onPlayQueueItem,
  onPlayNextQueueItem,
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
  artworkUrl,
  playerStyle,
  favoriteTrack,
  favoriteTrackIsFavorite = false,
  favoriteTrackIsPending = false,
  onToggleFavoriteTrack
}: LayoutProps) {
  return (
    <div
      className="relative hidden h-full w-full items-center justify-between px-4 sm:px-6 md:flex"
      data-player-layout="desktop"
    >
      {/* Pinned Top-Edge Scrubber with hover expand, draggable thumb, and floating time bubble */}
      <TopEdgeScrubber
        progressMs={boundedProgressMs}
        durationMs={currentTrackDuration}
        canSeek={canSeekPlayback}
        onSeekDraft={setSeekDraft}
        onCommitSeek={commitSeek}
        accentColor={artworkAccent}
      />

      {/* Left: Album Cover + Track Title/Artist + Favorite Button */}
      <div className="flex min-w-0 items-center gap-3 w-[260px] lg:w-[320px] shrink-0">
        <button
          className="group/cover relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent shrink-0"
          onClick={onToggleImmersive}
          title="打开沉浸式播放"
          aria-label="打开沉浸式播放"
          type="button"
        >
          <VinylBadge
            compact
            accentColor={artworkAccent}
            accentSoft={artworkAccentSoft}
            artworkUrl={artworkUrl}
            isPlaying={isPlaying}
            playerStyle={playerStyle}
          />
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover/cover:opacity-100">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </div>
        </button>

        <div className="min-w-0 flex-1">
          <h3
            className="truncate text-sm font-medium text-foreground hover:text-white transition-colors cursor-pointer"
            onClick={onToggleImmersive}
            title={title}
          >
            {title}
          </h3>
          <p
            className="truncate text-xs text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
            onClick={onToggleImmersive}
            title={artist}
          >
            {artist}
          </p>
        </div>

        {favoriteTrack && onToggleFavoriteTrack ? (
          <FavoriteTrackButton
            accentColor={artworkAccent}
            isFavorite={favoriteTrackIsFavorite}
            onToggle={onToggleFavoriteTrack}
            pending={favoriteTrackIsPending}
            track={favoriteTrack}
          />
        ) : null}
      </div>

      {/* Center: Playback Mode + Prev + Circular Play/Pause + Next + Queue (Viewport Dead-Center) */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center gap-2.5 sm:gap-3.5 pointer-events-auto">
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
          className="h-9 w-9 rounded-full text-foreground-muted hover:text-white hover:bg-white/[0.08]"
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
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-white shadow-md outline-none transition-transform focus-visible:ring-2 focus-visible:ring-accent ${
            canControlPlayback
              ? "hover:scale-105 active:scale-95 cursor-pointer"
              : "cursor-not-allowed opacity-50"
          }`}
          style={{ backgroundColor: artworkAccent }}
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
          className="h-9 w-9 rounded-full text-foreground-muted hover:text-white hover:bg-white/[0.08]"
          disabled={!canControlPlayback || !playbackTrackId}
          onClick={onNext}
          title="下一首"
          style={{ color: artworkAccent }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" />
          </svg>
        </Button>

        <PlayerQueueDrawer
          queue={queue}
          tracks={tracks}
          currentQueueItemId={currentQueueItemId}
          nextQueueItemId={nextQueueItemId}
          accentColor={artworkAccent}
          accentSoft={artworkAccentSoft}
          canControlPlayback={canControlPlayback}
          canReorderQueue={canReorderQueue}
          canRemoveQueue={canRemoveQueue}
          onPlayQueueItem={onPlayQueueItem}
          onPlayNextQueueItem={onPlayNextQueueItem}
          onRemoveQueueItem={onRemoveQueueItem}
          onReorderQueue={onReorderQueue}
        />
      </div>

      {/* Right: Audio Quality Badge + Lyrics Toggle + Volume Control + Immersive + Mini */}
      <div className="flex min-w-0 items-center justify-end gap-1.5 w-[260px] lg:w-[320px] shrink-0 ml-auto">
        <QualityBadge />

        {onToggleLyrics ? (
          <LyricsToggleButton
            accentColor={artworkAccent}
            accentSoft={artworkAccentSoft}
            disabled={!playbackTrackId}
            isOpen={isLyricsOpen}
            onToggle={onToggleLyrics}
          />
        ) : null}

        <VolumeControl
          volume={volume}
          onChange={applyVolume}
          accentColor={artworkAccent}
          accentSoft={artworkAccentSoft}
        />

        <ImmersiveToggleButton
          accentColor={artworkAccent}
          accentSoft={artworkAccentSoft}
          isOpen={isImmersiveOpen}
          onToggle={onToggleImmersive}
        />

        <MiniPlayerToggleButton
          accentColor={artworkAccent}
          accentSoft={artworkAccentSoft}
          isOpen={isMiniOpen}
          onToggle={onToggleMini}
        />
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
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-10 sm:w-10"
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
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-10 sm:w-10"
      style={accentColor ? { color: accentColor, ...(isOpen ? { backgroundColor: accentSoft } : {}) } : undefined}
    >
      <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        <rect x="3.5" y="4" width="17" height="16" rx="2" />
        <rect x="11" y="12" width="7" height="5" rx="0.8" />
      </svg>
    </button>
  );
}
