"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useDesktopLyrics, getDesktopLyricsPositionStorageKey } from "@/features/playback/desktop-lyrics-context";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";

type Position = { left: number; top: number };

export function DesktopLyricsOverlay() {
  const {
    isOpen,
    close,
    activePlayer,
    lyrics,
    showTranslation,
    showRomanized
  } = useDesktopLyrics();
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const positionRef = useRef<Position | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    if (!isOpen) {
      setExpanded(false);
    }
  }, [isOpen]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(getDesktopLyricsPositionStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Position>;
      if (typeof parsed.left === "number" && typeof parsed.top === "number") {
        const nextPosition = clampPosition({ left: parsed.left, top: parsed.top }, null);
        positionRef.current = nextPosition;
        setPosition(nextPosition);
      }
    } catch {
      // Ignore malformed local UI state and use the default bottom-center position.
    }
  }, []);

  useEffect(() => {
    const handleResize = () => setPosition((current) => current ? clampPosition(current, panelRef.current) : current);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (!isOpen || !activePlayer) return null;

  const canControl = activePlayer.canControlPlayback && Boolean(activePlayer.playbackTrackId);
  const hasLyrics = Boolean(lyrics.currentLine || lyrics.plainLyric);
  const panelPositionStyle = position
    ? {
        left: `${position.left * 100}%`,
        top: `${position.top * 100}%`,
        transform: "translate(-50%, -50%)"
      }
    : undefined;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel) return;
    const rect = panel.getBoundingClientRect();
    if (Math.abs(event.clientX - (rect.left + drag.offsetX)) > 5 || Math.abs(event.clientY - (rect.top + drag.offsetY)) > 5) {
      drag.moved = true;
    }
    if (!drag.moved) return;
    const left = event.clientX - drag.offsetX + rect.width / 2;
    const top = event.clientY - drag.offsetY + rect.height / 2;
    const next = clampPosition({ left: left / window.innerWidth, top: top / window.innerHeight }, panel);
    positionRef.current = next;
    setPosition(next);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag?.moved && positionRef.current) {
      suppressClickRef.current = true;
      window.localStorage.setItem(getDesktopLyricsPositionStorageKey(), JSON.stringify(positionRef.current));
    }
  };

  const handleToggleExpanded = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setExpanded((current) => !current);
  };

  return (
    <div
      ref={panelRef}
      aria-label="桌面歌词"
      className={`fixed z-[120] select-none ${position ? "" : "bottom-[calc(12rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 md:bottom-[5.75rem]"}`}
      data-testid="desktop-lyrics-overlay"
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={panelPositionStyle}
    >
      {expanded ? (
        <div className="flex w-[min(92vw,24rem)] items-center gap-2 rounded-2xl border border-white/10 bg-[#111113]/90 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.52)] backdrop-blur-2xl">
          <div
            aria-hidden="true"
            className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] bg-cover bg-center"
            style={activePlayer.artworkUrl ? { backgroundImage: `url("${getArtworkSourceUrl(activePlayer.artworkUrl)}")` } : undefined}
          >
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{activePlayer.currentTrack?.title ?? "等待选择歌曲"}</p>
            <p className="truncate text-[11px] text-white/50">{activePlayer.currentTrack?.artist ?? "暂无艺人信息"}</p>
          </div>
          <TransportButton disabled={!canControl} label="上一首" onClick={activePlayer.onPrev}>
            <PrevIcon />
          </TransportButton>
          <TransportButton disabled={!canControl} label={activePlayer.isPlaying ? "暂停" : "播放"} onClick={activePlayer.onTogglePlay} primary>
            {activePlayer.isPlaying ? <PauseIcon /> : <PlayIcon />}
          </TransportButton>
          <TransportButton disabled={!canControl} label="下一首" onClick={activePlayer.onNext}>
            <NextIcon />
          </TransportButton>
          <button aria-label="关闭桌面歌词" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={close} title="关闭桌面歌词" type="button">
            <CloseIcon />
          </button>
        </div>
      ) : (
        <button
          aria-label="展开桌面歌词播放器"
          className="max-w-[min(88vw,42rem)] cursor-grab rounded-full border border-white/10 bg-[#111113]/82 px-5 py-2.5 text-center shadow-[0_12px_42px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-[background-color,box-shadow,transform] duration-200 hover:bg-[#17171a] hover:shadow-[0_16px_50px_rgba(0,0,0,0.5)] active:cursor-grabbing active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={handleToggleExpanded}
          title="展开桌面歌词播放器"
          type="button"
        >
          <span className={`block truncate text-sm font-semibold ${hasLyrics ? "text-white" : "text-white/60"}`}>
            {lyrics.currentLine ?? (lyrics.status === "loading" ? "正在获取歌词…" : "暂无歌词")}
          </span>
          {!lyrics.currentLine ? <span className="mt-0.5 block max-w-[min(78vw,32rem)] truncate text-[11px] text-white/45">{activePlayer.currentTrack?.title ?? "等待选择歌曲"} · {activePlayer.currentTrack?.artist ?? "暂无艺人信息"}</span> : null}
          {showTranslation && lyrics.translatedLine ? <span className="mt-0.5 block truncate text-[11px] text-white/55">{lyrics.translatedLine}</span> : null}
          {showRomanized && lyrics.romanizedLine ? <span className="mt-0.5 block truncate text-[10px] text-white/35">{lyrics.romanizedLine}</span> : null}
        </button>
      )}
    </div>
  );
}

function TransportButton({ children, disabled, label, onClick, primary = false }: { children: React.ReactNode; disabled: boolean; label: string; onClick: () => void; primary?: boolean }) {
  return <button aria-label={label} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${disabled ? "cursor-not-allowed text-white/20" : primary ? "bg-white text-black hover:bg-white/90" : "text-white/70 hover:bg-white/10 hover:text-white"}`} disabled={disabled} onClick={onClick} title={disabled ? "当前没有播放控制权限" : label} type="button">{children}</button>;
}

function PlayIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M8 5v14l11-7z" /></svg>; }
function PauseIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg>; }
function PrevIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>; }
function NextIcon() { return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" /></svg>; }
function CloseIcon() { return <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>; }

function clampPosition(position: Position, panel: HTMLDivElement | null): Position {
  const width = panel?.offsetWidth ?? 280;
  const height = panel?.offsetHeight ?? 48;
  const horizontalInset = Math.min(0.5, (width / 2 + 12) / Math.max(window.innerWidth, 1));
  const verticalInset = Math.min(0.5, (height / 2 + 12) / Math.max(window.innerHeight, 1));
  return {
    left: Math.min(1 - horizontalInset, Math.max(horizontalInset, position.left)),
    top: Math.min(1 - verticalInset, Math.max(verticalInset, position.top))
  };
}
