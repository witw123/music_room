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
  getRoomLyricDisplayWords,
  getRoomLyricWordProgress,
  parseRoomLyrics
} from "@/features/playback/lyrics";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import { appSettingsChangeEvent, getAppSettings } from "@/features/settings/settings-store";

export type DesktopLyricsBarLyrics = {
  plainLyric: string | null;
};

type DesktopLyricsBarProps = {
  title: string;
  artworkUrl: string | null;
  plainLyric: string | null;
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
};

/**
 * The combined desktop-lyrics surface: artwork, transport controls and a
 * single word-by-word karaoke line floating directly over the desktop (no
 * background card). The karaoke font scales with the surface height so the
 * bar adapts when the window is resized.
 */
export function DesktopLyricsBar({
  title,
  artworkUrl,
  plainLyric,
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
  const [surfaceHeight, setSurfaceHeight] = useState(72);
  // Cover + transport stay hidden until the lyrics line is clicked; clicking
  // it again hides them. Clicking never seeks.
  const [controlsVisible, setControlsVisible] = useState(false);
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

  const fontSize = Math.round(Math.min(120, Math.max(12, surfaceHeight * 0.34 * lyricScale)));
  const outlineWidth = `${Math.max(1.5, fontSize * 0.09).toFixed(1)}px`;

  const lines = useMemo(() => parseRoomLyrics(plainLyric), [plainLyric]);

  // Interpolate the coarse host progress clock so per-character karaoke fills
  // advance at display refresh rate instead of the host's render interval.
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

  const message = status === "loading" && !hasLyrics
    ? "正在获取歌词…"
    : hasLyrics
      ? lineText ?? "暂无歌词"
      : status === "error"
        ? "歌词暂时不可用"
        : "暂无歌词";

  return (
    <div
      ref={rootRef}
      aria-label={`桌面歌词：${title}`}
      className="flex h-full w-full min-w-0 items-center gap-3 px-4"
      data-testid="desktop-lyrics-bar"
      onPointerDown={onPointerDown}
    >
      {controlsVisible ? (
        <div
          aria-hidden="true"
          className="aspect-square shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] bg-cover bg-center"
          style={{
            backgroundImage: artworkUrl ? `url("${getArtworkSourceUrl(artworkUrl)}")` : undefined,
            height: `${Math.min(surfaceHeight - 16, 72)}px`,
            width: `${Math.min(surfaceHeight - 16, 72)}px`
          }}
        />
      ) : null}
      <div
        aria-label="切换播放控件"
        className="relative h-full min-w-0 flex-1 cursor-pointer select-none"
        data-testid="desktop-lyrics-line"
        onClick={() => setControlsVisible((current) => !current)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setControlsVisible((current) => !current);
          }
        }}
      >
        {/* Dark outline under-layer keeps the floating text readable over any
            wallpaper now that the card background is gone. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center overflow-hidden"
        >
          <span
            className="block truncate whitespace-nowrap font-bold text-transparent"
            style={{ fontSize, WebkitTextStroke: `${outlineWidth} rgba(0, 0, 0, 0.5)` }}
          >
            {message}
          </span>
        </span>
        <span className="flex h-full items-center overflow-hidden">
          <span className="block truncate whitespace-nowrap font-bold text-white" style={{ fontSize }}>
            {hasLyrics && displayWords.length > 0
              ? displayWords.map((word, wordIndex) => {
                  const progress = getRoomLyricWordProgress(word, smoothPositionMs);
                  if (progress >= 1) {
                    return <span key={wordIndex} className="text-white">{word.text}</span>;
                  }
                  if (progress <= 0) {
                    return <span key={wordIndex} className="text-white/55">{word.text}</span>;
                  }
                  const filled = (progress * 100).toFixed(1);
                  return (
                    <span
                      className="inline text-transparent will-change-[background-image]"
                      key={wordIndex}
                      style={{
                        backgroundImage: `linear-gradient(to right, rgb(255 255 255) 0%, rgb(255 255 255) ${filled}%, rgb(255 255 255 / 0.55) ${filled}%, rgb(255 255 255 / 0.55) 100%)`,
                        backgroundClip: "text",
                        WebkitBackgroundClip: "text"
                      }}
                    >
                      {word.text}
                    </span>
                  );
                })
              : message}
          </span>
        </span>
      </div>
      {controlsVisible ? (
        <div className="flex shrink-0 items-center gap-1 pl-1">
          <TransportButton disabled={!canControl} label="上一首" onClick={onPrev}>
            <PrevIcon />
          </TransportButton>
          <TransportButton disabled={!canControl} label={isPlaying ? "暂停" : "播放"} onClick={onTogglePlay} primary>
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </TransportButton>
          <TransportButton disabled={!canControl} label="下一首" onClick={onNext}>
            <NextIcon />
          </TransportButton>
        </div>
      ) : null}
      <button
        aria-label="关闭桌面歌词"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={onClose}
        title="关闭桌面歌词"
        type="button"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function TransportButton({ children, disabled, label, onClick, primary = false }: { children: React.ReactNode; disabled: boolean; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      aria-label={label}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        disabled ? "cursor-not-allowed text-white/25" : primary ? "bg-white text-black hover:bg-white/90" : "text-white/70 hover:bg-white/10 hover:text-white"
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

function PlayIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M8 5v14l11-7z" /></svg>; }
function PauseIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>; }
function PrevIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>; }
function NextIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" /></svg>; }
function CloseIcon() { return <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>; }
