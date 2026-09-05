"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  getActiveRoomLyricIndex,
  alignRoomLyricLines,
  getRoomLyricDisplayWords,
  getRoomLyricWordProgress,
  parseRoomLyrics
} from "@/features/playback/lyrics";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { appSettingsChangeEvent, getAppSettings } from "@/features/settings/settings-store";

export type DesktopLyricsBarLyrics = {
  plainLyric: string | null;
  translatedLyric?: string | null;
  romanizedLyric?: string | null;
};

export type DesktopLyricsBarProps = {
  title: string;
  artist?: string | null;
  artworkUrl: string | null;
  durationMs?: number | null;
  plainLyric: string | null;
  translatedLyric?: string | null;
  romanizedLyric?: string | null;
  showTranslation?: boolean;
  showRomanized?: boolean;
  onToggleTranslation?: () => void;
  onToggleRomanized?: () => void;
  /** Latest playback position reported by the host; interpolated with rAF. */
  progressMs: number;
  /** Host wall-clock time (Date.now()) when progressMs was sampled. */
  anchorAt: number;
  isPlaying: boolean;
  status: "idle" | "loading" | "ready" | "error";
  canControl: boolean;
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onClose: () => void;
  /** Optional host drag hook (Tauri native window dragging). */
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onScaleChange?: (scale: number) => void;
};

/**
 * Pure floating desktop lyrics bar (Apple Music / Spotify style).
 * - No background box or borders.
 * - Cover art, track meta (title, artist, duration) and controls appear only when clicked.
 * - Automatically scrolls long lines smoothly so words are never truncated.
 * - Word-by-word karaoke styling matches the main player lyrics without sudden dimming.
 */
export function DesktopLyricsBar({
  title,
  artist,
  artworkUrl,
  durationMs,
  plainLyric,
  translatedLyric = null,
  romanizedLyric = null,
  showTranslation = true,
  showRomanized = false,
  onToggleTranslation,
  onToggleRomanized,
  progressMs,
  anchorAt,
  isPlaying,
  status,
  canControl,
  onPrev,
  onTogglePlay,
  onNext,
  onClose,
  onPointerDown
}: DesktopLyricsBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textContentRef = useRef<HTMLDivElement | null>(null);
  const [surfaceHeight, setSurfaceHeight] = useState(76);
  const [isExpanded, setIsExpanded] = useState(false);
  const [overflowPx, setOverflowPx] = useState(0);
  const [lyricScale, setLyricScale] = useState(
    () => getAppSettings().playback.desktopLyricScale
  );
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const autoCollapseTimerRef = useRef<number | null>(null);

  const resetAutoCollapseTimer = useCallback(() => {
    if (autoCollapseTimerRef.current) {
      window.clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = null;
    }
    autoCollapseTimerRef.current = window.setTimeout(() => {
      setIsExpanded(false);
    }, 5000);
  }, []);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      if (next) {
        resetAutoCollapseTimer();
      } else if (autoCollapseTimerRef.current) {
        window.clearTimeout(autoCollapseTimerRef.current);
        autoCollapseTimerRef.current = null;
      }
      return next;
    });
  }, [resetAutoCollapseTimer]);

  useEffect(() => {
    return () => {
      if (autoCollapseTimerRef.current) {
        window.clearTimeout(autoCollapseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const syncScale = () => setLyricScale(getAppSettings().playback.desktopLyricScale);
    syncScale();
    window.addEventListener(appSettingsChangeEvent, syncScale);
    window.addEventListener("storage", syncScale);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, syncScale);
      window.removeEventListener("storage", syncScale);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height && height > 0) setSurfaceHeight(height);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Parse lyrics
  const lines = useMemo(() => parseRoomLyrics(plainLyric), [plainLyric]);
  const translatedLines = useMemo(() => parseRoomLyrics(translatedLyric), [translatedLyric]);
  const romanizedLines = useMemo(() => parseRoomLyrics(romanizedLyric), [romanizedLyric]);

  // Interpolate progress smoothly with rAF for 60/120fps word fill animation
  const [smoothPositionMs, setSmoothPositionMs] = useState(progressMs);
  const anchorRef = useRef({
    baseMs: progressMs,
    receivedAtMs: typeof performance !== "undefined" ? performance.now() : Date.now()
  });

  useEffect(() => {
    anchorRef.current = {
      baseMs: progressMs,
      receivedAtMs: typeof performance !== "undefined" ? performance.now() : Date.now()
    };
    setSmoothPositionMs(progressMs);
  }, [progressMs, anchorAt]);

  useEffect(() => {
    if (!isPlaying) {
      setSmoothPositionMs(anchorRef.current.baseMs);
      return;
    }
    let animationFrameId = 0;
    let lastUpdateAt = 0;
    const tick = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastUpdateAt >= 32) {
        lastUpdateAt = now;
        setSmoothPositionMs(anchorRef.current.baseMs + Math.max(0, now - anchorRef.current.receivedAtMs));
      }
      animationFrameId = window.requestAnimationFrame(tick);
    };
    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [isPlaying]);

  const activeIndex = lines.length > 0 ? Math.max(0, getActiveRoomLyricIndex(lines, smoothPositionMs)) : -1;
  const displayWords = useMemo(
    () => (activeIndex >= 0 ? getRoomLyricDisplayWords(lines, activeIndex) : []),
    [lines, activeIndex]
  );
  const lineText =
    displayWords.length > 0
      ? displayWords.map((word) => word.text).join("")
      : lines[activeIndex >= 0 ? activeIndex : 0]?.text ?? null;
  const hasLyrics = lines.length > 0;

  // Sub-line: translation or romanization
  const alignedTranslatedLine = useMemo(() => {
    if (!showTranslation || translatedLines.length === 0 || activeIndex < 0) return null;
    return alignRoomLyricLines(lines, translatedLines)[activeIndex]?.text ?? null;
  }, [activeIndex, lines, showTranslation, translatedLines]);

  const alignedRomanizedLine = useMemo(() => {
    if (!showRomanized || romanizedLines.length === 0 || activeIndex < 0) return null;
    return alignRoomLyricLines(lines, romanizedLines)[activeIndex]?.text ?? null;
  }, [activeIndex, lines, romanizedLines, showRomanized]);

  const subLineText = alignedTranslatedLine || alignedRomanizedLine || null;
  const hasSubLine = Boolean(subLineText);

  // Dynamic font sizing based on scale setting
  const baseFontSize = hasSubLine
    ? Math.round(Math.min(90, Math.max(16, surfaceHeight * 0.30 * lyricScale)))
    : Math.round(Math.min(110, Math.max(18, surfaceHeight * 0.40 * lyricScale)));
  const subFontSize = Math.round(Math.max(12, baseFontSize * 0.56));

  // Check text overflow for horizontal auto-scrolling
  useEffect(() => {
    const container = containerRef.current;
    const text = textContentRef.current;
    if (!container || !text) {
      setOverflowPx(0);
      return;
    }
    const diff = text.scrollWidth - container.clientWidth;
    setOverflowPx(diff > 4 ? diff : 0);
  }, [activeIndex, lineText, baseFontSize, subLineText, isExpanded]);

  // Calculate auto-scroll translation offset as current line progresses
  const scrollOffset = useMemo(() => {
    if (overflowPx <= 0) return 0;
    if (displayWords.length === 0) return 0;
    const startMs = displayWords[0]?.timeMs ?? 0;
    const lastWord = displayWords[displayWords.length - 1];
    const endMs = (lastWord?.timeMs ?? 0) + (lastWord?.durationMs ?? 1000);
    const duration = Math.max(800, endMs - startMs);
    const progress = Math.min(1, Math.max(0, (smoothPositionMs - startMs) / duration));
    return -Math.min(overflowPx, Math.round(progress * (overflowPx + 24)));
  }, [overflowPx, displayWords, smoothPositionMs]);

  const message = status === "loading" && !hasLyrics
    ? "正在获取歌词…"
    : hasLyrics
      ? lineText ?? "暂无歌词"
      : status === "error"
        ? "歌词暂时不可用"
        : "等待选择歌曲";

  const handlePointerDownInternal = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartPosRef.current = { x: event.clientX, y: event.clientY };
    onPointerDown?.(event);
  };

  const handlePointerUpInternal = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }
    if (dragStartPosRef.current) {
      const dx = Math.abs(event.clientX - dragStartPosRef.current.x);
      const dy = Math.abs(event.clientY - dragStartPosRef.current.y);
      if (dx < 6 && dy < 6) {
        toggleExpanded();
      }
    }
    dragStartPosRef.current = null;
  };

  return (
    <div
      ref={rootRef}
      aria-label={`桌面歌词：${title}${artist ? ` - ${artist}` : ""}`}
      className="group relative flex h-full w-full min-w-0 items-center justify-between gap-2 bg-transparent px-2 md:px-4 py-1 text-white select-none cursor-grab active:cursor-grabbing transition-all duration-300"
      data-testid="desktop-lyrics-bar"
      onPointerDown={handlePointerDownInternal}
      onPointerUp={handlePointerUpInternal}
      onPointerMove={() => {
        if (isExpanded) resetAutoCollapseTimer();
      }}
    >
      {/* Left: Album Cover Thumbnail + Song Name, Artist, and Duration Time (Only visible when clicked) */}
      <div
        className={`flex shrink-0 items-center overflow-hidden transition-all duration-300 ${
          isExpanded ? "opacity-100 max-w-[20rem] mr-2" : "opacity-0 max-w-0 mr-0 pointer-events-none"
        }`}
      >
        <div
          aria-hidden="true"
          className={`relative h-10 w-10 md:h-11 md:w-11 shrink-0 overflow-hidden rounded-xl border border-white/20 bg-black/40 bg-cover bg-center shadow-[0_4px_16px_rgba(0,0,0,0.6)] transition-transform duration-300 ${
            isPlaying ? "scale-100" : "scale-95 opacity-80"
          }`}
          style={{
            backgroundImage: artworkUrl ? `url("${getArtworkSourceUrl(artworkUrl)}")` : undefined
          }}
          title={artist ? `${title} - ${artist}` : title}
        >
          {!artworkUrl ? (
            <div className="grid h-full w-full place-items-center text-white/50">
              <MusicNoteIcon />
            </div>
          ) : null}
        </div>

        {/* Track Title, Artist, and Playback Time */}
        <div className="ml-2.5 flex min-w-0 flex-col justify-center text-left leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]">
          <span className="truncate text-xs md:text-sm font-bold text-white max-w-[8.5rem] md:max-w-[11rem]">
            {title || "等待选择歌曲"}
          </span>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] md:text-[11px] text-white/75 truncate max-w-[8.5rem] md:max-w-[11rem]">
            {artist ? <span className="truncate">{artist}</span> : null}
            <span className="shrink-0 tabular-nums text-white/50 font-medium">
              {formatDuration(smoothPositionMs)}{durationMs ? ` / ${formatDuration(durationMs)}` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Center: Pure Karaoke Lyric Line with Smooth Horizontal Auto-Scrolling */}
      <div
        ref={containerRef}
        className="relative flex h-full min-w-0 flex-1 flex-col justify-center items-center overflow-hidden px-1 text-center select-none"
        data-testid="desktop-lyrics-line"
      >
        {/* Main Lyric Line Wrapper (auto-scrolls horizontally if text is longer than viewport) */}
        <div
          ref={textContentRef}
          className={`whitespace-nowrap transition-transform drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] ${
            overflowPx > 0 ? "duration-200 ease-linear self-start text-left" : "self-center text-center"
          } font-bold tracking-tight text-white leading-tight`}
          style={{
            fontSize: `${baseFontSize}px`,
            transform: overflowPx > 0 ? `translateX(${scrollOffset}px)` : "none"
          }}
        >
          {hasLyrics && displayWords.length > 0 ? (
            displayWords.map((word, wordIndex) => {
              const progress = getRoomLyricWordProgress(word, smoothPositionMs);
              if (progress >= 1) {
                return (
                  <span
                    className="inline text-white font-bold"
                    key={wordIndex}
                  >
                    {word.text}
                  </span>
                );
              }
              if (progress <= 0) {
                return (
                  <span
                    className="inline text-white/65 font-bold transition-colors duration-150"
                    key={wordIndex}
                  >
                    {word.text}
                  </span>
                );
              }
              const filled = (progress * 100).toFixed(1);
              return (
                <span
                  className="inline text-transparent font-bold will-change-[background-image]"
                  key={wordIndex}
                  style={{
                    backgroundImage: `linear-gradient(to right, rgb(255 255 255) 0%, rgb(255 255 255) ${filled}%, rgb(255 255 255 / 0.65) ${filled}%, rgb(255 255 255 / 0.65) 100%)`,
                    backgroundClip: "text",
                    WebkitBackgroundClip: "text"
                  }}
                >
                  {word.text}
                </span>
              );
            })
          ) : (
            <span
              className={`block truncate ${
                status === "loading" ? "animate-pulse text-white/70" : "text-white/85"
              }`}
            >
              {message}
            </span>
          )}
        </div>

        {/* Translation / Romanization Sub-line */}
        {hasSubLine ? (
          <div
            className="mt-1 max-w-full truncate text-white/75 font-medium tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.85)] transition-opacity duration-200"
            style={{ fontSize: `${subFontSize}px` }}
          >
            {subLineText}
          </div>
        ) : null}
      </div>

      {/* Right: Floating Controls (Only visible when clicked, NO dark pill background) */}
      <div
        className={`flex shrink-0 items-center gap-1.5 cursor-default transition-all duration-200 ${
          isExpanded ? "opacity-100 translate-x-0" : "opacity-0 pointer-events-none translate-x-2"
        }`}
      >
        <div className="flex items-center gap-1.5 drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
          {/* Playback Transport: Prev, Play/Pause, Next */}
          <TransportButton disabled={!canControl} label="上一首" onClick={onPrev}>
            <PrevIcon />
          </TransportButton>
          <TransportButton
            disabled={!canControl}
            label={isPlaying ? "暂停" : "播放"}
            onClick={onTogglePlay}
            primary
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </TransportButton>
          <TransportButton disabled={!canControl} label="下一首" onClick={onNext}>
            <NextIcon />
          </TransportButton>

          {/* Translation toggle (译) */}
          {translatedLines.length > 0 && onToggleTranslation ? (
            <button
              aria-label="切换翻译"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold border transition cursor-pointer ${
                showTranslation
                  ? "border-blue-400/80 bg-blue-500/35 text-blue-200 shadow-[0_0_12px_rgba(0,122,255,0.5)]"
                  : "border-white/10 bg-black/20 text-white/70 hover:bg-white/15 hover:text-white"
              }`}
              onClick={onToggleTranslation}
              title={showTranslation ? "隐藏歌词翻译" : "显示歌词翻译"}
              type="button"
            >
              译
            </button>
          ) : null}

          {/* Romanization toggle (音) */}
          {romanizedLines.length > 0 && onToggleRomanized ? (
            <button
              aria-label="切换罗马音"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold border transition cursor-pointer ${
                showRomanized
                  ? "border-purple-400/80 bg-purple-500/35 text-purple-200 shadow-[0_0_12px_rgba(168,85,247,0.5)]"
                  : "border-white/10 bg-black/20 text-white/70 hover:bg-white/15 hover:text-white"
              }`}
              onClick={onToggleRomanized}
              title={showRomanized ? "隐藏罗马音" : "显示罗马音"}
              type="button"
            >
              音
            </button>
          ) : null}

          {/* Close Button */}
          <button
            aria-label="关闭桌面歌词"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-black/20 text-white/70 transition hover:border-red-400/50 hover:bg-red-500/30 hover:text-red-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={onClose}
            title="关闭桌面歌词"
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function TransportButton({
  children,
  disabled,
  label,
  onClick,
  primary = false
}: {
  children: React.ReactNode;
  disabled: boolean;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer ${
        disabled
          ? "cursor-not-allowed opacity-30 text-white/30"
          : primary
            ? "bg-white text-zinc-950 shadow-lg hover:bg-white/90 hover:scale-105 active:scale-95"
            : "border border-white/10 bg-black/20 text-white/80 hover:bg-white/20 hover:text-white active:scale-95"
      }`}
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "当前没有播放控制权限" : label}
      type="button"
    >
      {children}
    </button>
  );
}

function MusicNoteIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 24 24" width="12">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 24 24" width="12">
      <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 24 24" width="12">
      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 24 24" width="12">
      <path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}
