"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  alignRoomLyricLines,
  getActiveRoomLyricIndex,
  getRoomLyricDisplayWords,
  getRoomLyricWordProgress,
  parseRoomLyrics
} from "@/features/playback/lyrics";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";

export type DesktopLyricsBarLyrics = {
  plainLyric: string | null;
  translatedLyric: string | null;
  romanizedLyric: string | null;
};

type DesktopLyricsBarProps = {
  title: string;
  artist: string;
  artworkUrl: string | null;
  lyrics: DesktopLyricsBarLyrics;
  /** Latest playback position reported by the host; interpolated with rAF. */
  progressMs: number;
  /** Host wall-clock time (Date.now()) when progressMs was sampled. */
  anchorAt: number;
  isPlaying: boolean;
  status: "idle" | "loading" | "ready" | "error";
  canControl: boolean;
  showTranslation: boolean;
  showRomanized: boolean;
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onClose: () => void;
  /** Optional host drag hook (Tauri native window dragging). */
  onDragStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

/**
 * The combined desktop-lyrics bar: player card (artwork, track info, transport)
 * and word-by-word karaoke lyrics in one surface. Hosted inside the Tauri
 * always-on-top window on the desktop shell, and as the in-app floating bar on
 * web/mobile.
 */
export function DesktopLyricsBar({
  title,
  artist,
  artworkUrl,
  lyrics,
  progressMs,
  anchorAt,
  isPlaying,
  status,
  canControl,
  showTranslation,
  showRomanized,
  onPrev,
  onTogglePlay,
  onNext,
  onClose,
  onDragStart
}: DesktopLyricsBarProps) {
  const lines = useMemo(() => parseRoomLyrics(lyrics.plainLyric), [lyrics.plainLyric]);
  const translatedLines = useMemo(() => parseRoomLyrics(lyrics.translatedLyric), [lyrics.translatedLyric]);
  const romanizedLines = useMemo(() => parseRoomLyrics(lyrics.romanizedLyric), [lyrics.romanizedLyric]);
  const translatedByPrimary = useMemo(
    () => alignRoomLyricLines(lines, translatedLines),
    [lines, translatedLines]
  );
  const romanizedByPrimary = useMemo(
    () => alignRoomLyricLines(lines, romanizedLines),
    [lines, romanizedLines]
  );

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
  const activeLine = activeIndex >= 0 ? lines[activeIndex] : undefined;
  const nextLine = activeIndex >= 0 ? lines[activeIndex + 1]?.text ?? null : null;
  const displayWords = useMemo(
    () => (activeIndex >= 0 ? getRoomLyricDisplayWords(lines, activeIndex) : []),
    [lines, activeIndex]
  );
  const translatedLine = translatedByPrimary[activeIndex]?.text ?? null;
  const romanizedLine = romanizedByPrimary[activeIndex]?.text ?? null;
  const hasLyrics = lines.length > 0;

  return (
    <div
      className="flex w-full items-center gap-3 rounded-[1.4rem] border border-white/10 bg-[#101116]/92 px-4 py-3 shadow-[0_18px_54px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
      data-testid="desktop-lyrics-bar"
      onPointerDown={onDragStart}
    >
      <div
        aria-hidden="true"
        className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] bg-cover bg-center"
        style={artworkUrl ? { backgroundImage: `url("${getArtworkSourceUrl(artworkUrl)}")` } : undefined}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-white">{title}</p>
        <div className="mt-0.5 min-h-[1.6rem]" data-testid="desktop-lyrics-line">
          {status === "loading" && !hasLyrics ? (
            <span className="block truncate text-[0.95rem] font-bold text-white/60">正在获取歌词…</span>
          ) : displayWords.length > 0 ? (
            <span className="block truncate text-[0.95rem] font-bold leading-[1.6rem]">
              {displayWords.map((word, wordIndex) => {
                const progress = getRoomLyricWordProgress(word, smoothPositionMs);
                if (progress >= 1) {
                  return <span key={wordIndex} className="text-white">{word.text}</span>;
                }
                if (progress <= 0) {
                  return <span key={wordIndex} className="text-white/40">{word.text}</span>;
                }
                const filled = (progress * 100).toFixed(1);
                return (
                  <span
                    className="inline text-transparent will-change-[background-image]"
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
              })}
            </span>
          ) : (
            <span className="block truncate text-[0.95rem] font-bold text-white/60">
              {status === "error" ? "歌词暂时不可用" : hasLyrics ? activeLine?.text ?? "暂无歌词" : "暂无歌词"}
            </span>
          )}
          {nextLine && displayWords.length > 0 ? (
            <span className="mt-0.5 block truncate text-[11px] text-white/40">{nextLine}</span>
          ) : null}
          {showTranslation && translatedLine ? (
            <span className="mt-0.5 block truncate text-[11px] text-white/55">{translatedLine}</span>
          ) : null}
          {showRomanized && romanizedLine ? (
            <span className="mt-0.5 block truncate text-[10px] text-white/35">{romanizedLine}</span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-white/50">{artist}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
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
      <button
        aria-label="关闭桌面歌词"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        disabled ? "cursor-not-allowed text-white/20" : primary ? "bg-white text-black hover:bg-white/90" : "text-white/70 hover:bg-white/10 hover:text-white"
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
function PauseIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M6 19h4V5H6zm3.5 6l8.5 6V6z" /></svg>; }
function PrevIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>; }
function NextIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" /></svg>; }
function CloseIcon() { return <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>; }
