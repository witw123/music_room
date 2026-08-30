"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DesktopLyricsBar } from "@/components/desktop-lyrics/DesktopLyricsBar";
import { isCapacitorRuntime, isTauriRuntime } from "@/lib/desktop/tauri";
import { useDesktopLyrics, getDesktopLyricsPositionStorageKey } from "@/features/playback/desktop-lyrics-context";

type Position = { x: number; y: number };

/**
 * In-app floating desktop lyrics bar (web + Capacitor mobile).
 * Supports pixel-perfect free dragging across screen with boundary clamping and position memory.
 */
export function DesktopLyricsOverlay() {
  const {
    isOpen,
    close,
    activePlayer,
    lyrics,
    showTranslation,
    showRomanized,
    toggleTranslation,
    toggleRomanized
  } = useDesktopLyrics();
  const [position, setPosition] = useState<Position | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    moved: boolean;
  } | null>(null);
  const positionRef = useRef<Position | null>(null);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // Load saved position from localStorage
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(getDesktopLyricsPositionStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Position>;
      if (typeof parsed.x === "number" && typeof parsed.y === "number" && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        const clamped = clampPixelPosition({ x: parsed.x, y: parsed.y }, panelRef.current);
        positionRef.current = clamped;
        setPosition(clamped);
      }
    } catch {
      // Ignore malformed storage and use default bottom-center position.
    }
  }, []);

  // Adjust position if viewport resizes
  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => (current ? clampPixelPosition(current, panelRef.current) : current));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (isTauriRuntime() || isCapacitorRuntime()) return null;
  if (!isOpen || !activePlayer) return null;

  const canControl = activePlayer.canControlPlayback && Boolean(activePlayer.playbackTrackId);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true;
    }
    if (!drag.moved) return;

    const nextX = drag.startLeft + dx;
    const nextY = drag.startTop + dy;
    const clamped = clampPixelPosition({ x: nextX, y: nextY }, panel);
    positionRef.current = clamped;
    setPosition(clamped);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const moved = dragRef.current?.moved ?? false;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (moved && positionRef.current) {
      try {
        window.localStorage.setItem(getDesktopLyricsPositionStorageKey(), JSON.stringify(positionRef.current));
      } catch {
        // Storage write may fail in sandboxes
      }
    }
  };

  const panelPositionStyle = position
    ? {
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: "none",
        bottom: "auto",
        right: "auto"
      }
    : undefined;

  return (
    <div
      ref={panelRef}
      aria-label="桌面歌词"
      className={`fixed z-[120] select-none touch-none ${
        position
          ? "w-[min(92vw,48rem)]"
          : "inset-x-3 bottom-[calc(11.5rem+env(safe-area-inset-bottom))] md:inset-x-auto md:left-1/2 md:right-auto md:bottom-[5.75rem] md:w-[min(92vw,48rem)] md:-translate-x-1/2"
      }`}
      data-testid="desktop-lyrics-overlay"
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={panelPositionStyle}
    >
      <div className="h-16 md:h-20 w-full">
        <DesktopLyricsBar
          title={activePlayer.currentTrack?.title ?? "等待选择歌曲"}
          artist={activePlayer.currentTrack?.artist}
          artworkUrl={activePlayer.artworkUrl ?? (activePlayer.currentTrack?.artworkUrl ?? null)}
          canControl={canControl}
          isPlaying={activePlayer.isPlaying}
          plainLyric={lyrics.plainLyric}
          translatedLyric={lyrics.translatedLyric}
          romanizedLyric={lyrics.romanizedLyric}
          showTranslation={showTranslation}
          showRomanized={showRomanized}
          onToggleTranslation={toggleTranslation}
          onToggleRomanized={toggleRomanized}
          anchorAt={Date.now()}
          onClose={close}
          onNext={activePlayer.onNext}
          onPrev={activePlayer.onPrev}
          onTogglePlay={activePlayer.onTogglePlay}
          progressMs={activePlayer.progressMs}
          status={lyrics.status}
        />
      </div>
    </div>
  );
}

function clampPixelPosition(pos: Position, panel: HTMLDivElement | null): Position {
  if (typeof window === "undefined") return pos;
  const width = panel?.offsetWidth ?? 380;
  const height = panel?.offsetHeight ?? 68;
  const maxX = Math.max(10, window.innerWidth - width - 10);
  const maxY = Math.max(10, window.innerHeight - height - 10);
  return {
    x: Math.max(10, Math.min(maxX, pos.x)),
    y: Math.max(10, Math.min(maxY, pos.y))
  };
}
