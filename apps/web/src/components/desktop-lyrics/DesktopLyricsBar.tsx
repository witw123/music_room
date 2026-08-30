"use client";

import {
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
import { appSettingsChangeEvent, getAppSettings, updateAppSettings } from "@/features/settings/settings-store";

export type DesktopLyricsBarLyrics = {
  plainLyric: string | null;
  translatedLyric?: string | null;
  romanizedLyric?: string | null;
};

export type DesktopLyricsBarProps = {
  title: string;
  artist?: string | null;
  artworkUrl: string | null;
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
 * Modern floating desktop lyrics capsule bar (Apple Music / NetEase style).
 * Features rich frosted glassmorphism, word-by-word illuminated karaoke fill,
 * optional synchronized translation/romanization sub-line, and sleek interactive controls.
 */
export function DesktopLyricsBar({
  title,
  artist,
  artworkUrl,
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
  onPointerDown,
  onScaleChange
}: DesktopLyricsBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [surfaceHeight, setSurfaceHeight] = useState(76);
  const [isHovered, setIsHovered] = useState(false);
  const [controlsPinned, setControlsPinned] = useState(false);
  const [lyricScale, setLyricScale] = useState(
    () => getAppSettings().playback.desktopLyricScale
  );

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
    const tick = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      setSmoothPositionMs(anchorRef.current.baseMs + Math.max(0, now - anchorRef.current.receivedAtMs));
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

  // Dynamic font sizing
  const baseFontSize = hasSubLine
    ? Math.round(Math.min(90, Math.max(14, surfaceHeight * 0.28 * lyricScale)))
    : Math.round(Math.min(110, Math.max(15, surfaceHeight * 0.36 * lyricScale)));
  const subFontSize = Math.round(Math.max(11, baseFontSize * 0.58));

  const changeScale = (delta: number) => {
    const next = Math.min(2.5, Math.max(0.6, Math.round((lyricScale + delta) * 10) / 10));
    setLyricScale(next);
    updateAppSettings({ playback: { desktopLyricScale: next } });
    onScaleChange?.(next);
  };

  const message = status === "loading" && !hasLyrics
    ? "正在获取歌词…"
    : hasLyrics
      ? lineText ?? "暂无歌词"
      : status === "error"
        ? "歌词暂时不可用"
        : "等待选择歌曲";

  const showToolbar = isHovered || controlsPinned;

  return (
    <div
      ref={rootRef}
      aria-label={`桌面歌词：${title}${artist ? ` - ${artist}` : ""}`}
      className="group relative flex h-full w-full min-w-0 items-center justify-between gap-2.5 rounded-2xl md:rounded-full border border-white/15 bg-zinc-950/85 px-3.5 md:px-5 py-2 text-white backdrop-blur-2xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] transition-all duration-300 hover:border-white/25 hover:bg-zinc-950/92"
      data-testid="desktop-lyrics-bar"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerDown={onPointerDown}
    >
      {/* Subtle glowing ambient accent in background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-0.5 -z-10 rounded-2xl md:rounded-full bg-gradient-to-r from-blue-600/20 via-cyan-500/15 to-purple-600/20 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100"
      />

      {/* Left: Drag Handle + Cover + Track Info */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Visual Drag Handle */}
        <div
          aria-hidden="true"
          className="grid h-8 w-5 shrink-0 place-items-center cursor-grab text-white/30 transition hover:text-white/70 active:cursor-grabbing"
          title="拖动调整位置"
        >
          <DragGripIcon />
        </div>

        {/* Album Artwork thumbnail */}
        <div
          aria-hidden="true"
          className={`relative h-10 w-10 md:h-11 md:w-11 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] bg-cover bg-center shadow-md transition-transform duration-300 ${
            isPlaying ? "scale-100" : "scale-95 opacity-80"
          }`}
          style={{
            backgroundImage: artworkUrl ? `url("${getArtworkSourceUrl(artworkUrl)}")` : undefined
          }}
          title={artist ? `${title} - ${artist}` : title}
        >
          {!artworkUrl ? (
            <div className="grid h-full w-full place-items-center text-white/40">
              <MusicNoteIcon />
            </div>
          ) : null}
        </div>
      </div>

      {/* Center: Karaoke Lyric Line + Translation Sub-line */}
      <div
        aria-label="点击固定控制栏"
        className="relative flex h-full min-w-0 flex-1 flex-col justify-center items-center overflow-hidden px-2 text-center cursor-pointer select-none"
        data-testid="desktop-lyrics-line"
        onClick={() => setControlsPinned((current) => !current)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setControlsPinned((current) => !current);
          }
        }}
      >
        {/* Main Karaoke Lyric Line */}
        <div
          className="relative max-w-full overflow-hidden truncate font-bold tracking-tight text-white leading-tight"
          style={{ fontSize: `${baseFontSize}px` }}
        >
          {hasLyrics && displayWords.length > 0 ? (
            displayWords.map((word, wordIndex) => {
              const progress = getRoomLyricWordProgress(word, smoothPositionMs);
              if (progress >= 1) {
                return (
                  <span
                    className="inline text-white [text-shadow:0_0_12px_rgba(255,255,255,0.7)]"
                    key={wordIndex}
                  >
                    {word.text}
                  </span>
                );
              }
              if (progress <= 0) {
                return (
                  <span className="inline text-white/40 transition-colors duration-150" key={wordIndex}>
                    {word.text}
                  </span>
                );
              }
              const filled = (progress * 100).toFixed(1);
              return (
                <span
                  className="inline text-transparent will-change-[background-image] [text-shadow:0_0_16px_rgba(0,122,255,0.6)]"
                  key={wordIndex}
                  style={{
                    backgroundImage: `linear-gradient(to right, rgb(255 255 255) 0%, rgb(255 255 255) ${filled}%, rgb(255 255 255 / 0.4) ${filled}%, rgb(255 255 255 / 0.4) 100%)`,
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
                status === "loading" ? "animate-pulse text-white/70" : "text-white/80"
              }`}
            >
              {message}
            </span>
          )}
        </div>

        {/* Translation / Romanization Sub-line */}
        {hasSubLine ? (
          <div
            className="mt-0.5 max-w-full truncate text-white/65 font-medium tracking-wide transition-opacity duration-200"
            style={{ fontSize: `${subFontSize}px` }}
          >
            {subLineText}
          </div>
        ) : null}
      </div>

      {/* Right: Quick Interactive Controls Toolbar */}
      <div
        className={`flex shrink-0 items-center gap-1 transition-all duration-200 ${
          showToolbar ? "opacity-100 translate-x-0" : "opacity-0 md:opacity-40 translate-x-1 hover:opacity-100"
        }`}
      >
        {/* Playback Transport: Prev, Play/Pause, Next */}
        <div className="flex items-center gap-0.5 rounded-full bg-white/[0.07] p-0.5 border border-white/10">
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
        </div>

        {/* Translation toggle (译) */}
        {translatedLines.length > 0 && onToggleTranslation ? (
          <button
            aria-label="切换翻译"
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold border transition ${
              showTranslation
                ? "border-blue-500/50 bg-blue-500/20 text-blue-400 shadow-[0_0_10px_rgba(0,122,255,0.3)]"
                : "border-transparent bg-white/[0.06] text-white/50 hover:bg-white/[0.12] hover:text-white"
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
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold border transition ${
              showRomanized
                ? "border-purple-500/50 bg-purple-500/20 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.3)]"
                : "border-transparent bg-white/[0.06] text-white/50 hover:bg-white/[0.12] hover:text-white"
            }`}
            onClick={onToggleRomanized}
            title={showRomanized ? "隐藏罗马音" : "显示罗马音"}
            type="button"
          >
            音
          </button>
        ) : null}

        {/* Font Scale Adjuster */}
        <div className="hidden sm:flex items-center rounded-full bg-white/[0.06] border border-white/10 p-0.5">
          <button
            aria-label="缩小歌词字体"
            className="grid h-7 w-6 place-items-center rounded-full text-[11px] font-bold text-white/60 transition hover:bg-white/10 hover:text-white"
            onClick={() => changeScale(-0.1)}
            title="缩小字体"
            type="button"
          >
            A-
          </button>
          <span className="px-1 text-[10px] font-semibold text-white/40 select-none">
            {Math.round(lyricScale * 100)}%
          </span>
          <button
            aria-label="放大歌词字体"
            className="grid h-7 w-6 place-items-center rounded-full text-[11px] font-bold text-white/60 transition hover:bg-white/10 hover:text-white"
            onClick={() => changeScale(0.1)}
            title="放大字体"
            type="button"
          >
            A+
          </button>
        </div>

        {/* Close Button */}
        <button
          aria-label="关闭桌面歌词"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/50 transition hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={onClose}
          title="关闭桌面歌词"
          type="button"
        >
          <CloseIcon />
        </button>
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
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        disabled
          ? "cursor-not-allowed opacity-30 text-white/30"
          : primary
            ? "bg-white text-zinc-950 shadow-md hover:bg-white/90 hover:scale-105 active:scale-95"
            : "text-white/70 hover:bg-white/10 hover:text-white active:scale-95"
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

function DragGripIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 24 24" width="16">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
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
