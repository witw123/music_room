"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DesktopLyricsBar } from "@/components/desktop-lyrics/DesktopLyricsBar";
import { isCapacitorRuntime, isTauriRuntime } from "@/lib/desktop/tauri";
import { useDesktopLyrics, getDesktopLyricsPositionStorageKey } from "@/features/playback/desktop-lyrics-context";

type Position = { left: number; top: number };

/**
 * In-app floating desktop lyrics bar (web + Capacitor mobile). The Tauri
 * desktop shell renders the same bar inside its own always-on-top native
 * window instead, so this overlay stays out of the way there.
 */
export function DesktopLyricsOverlay() {
  const {
    isOpen,
    close,
    activePlayer,
    lyrics,
    showTranslation,
    showRomanized
  } = useDesktopLyrics();
  const [position, setPosition] = useState<Position | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const positionRef = useRef<Position | null>(null);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

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

  // The Tauri desktop shell hosts lyrics in a native always-on-top window and
  // the Capacitor mobile shell in a system overlay — both replace this in-page
  // bar (see /desktop-lyrics and DesktopLyricsPlugin.kt).
  if (isTauriRuntime() || isCapacitorRuntime()) return null;
  if (!isOpen || !activePlayer) return null;

  const canControl = activePlayer.canControlPlayback && Boolean(activePlayer.playbackTrackId);
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
    const moved = dragRef.current?.moved ?? false;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (moved && positionRef.current) {
      window.localStorage.setItem(getDesktopLyricsPositionStorageKey(), JSON.stringify(positionRef.current));
    }
  };

  return (
    <div
      ref={panelRef}
      aria-label="桌面歌词"
      className={`fixed z-[120] select-none ${position ? "" : "inset-x-3 bottom-[calc(11.5rem+env(safe-area-inset-bottom))] md:inset-x-auto md:left-1/2 md:right-auto md:bottom-[5.75rem] md:w-[min(92vw,44rem)] md:-translate-x-1/2"}`}
      data-testid="desktop-lyrics-overlay"
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={panelPositionStyle}
    >
      <DesktopLyricsBar
        artist={activePlayer.currentTrack?.artist ?? "暂无艺人信息"}
        artworkUrl={activePlayer.artworkUrl ?? (activePlayer.currentTrack?.artworkUrl ?? null)}
        canControl={canControl}
        isPlaying={activePlayer.isPlaying}
        lyrics={{
          plainLyric: lyrics.plainLyric,
          translatedLyric: lyrics.translatedLyric,
          romanizedLyric: lyrics.romanizedLyric
        }}
        anchorAt={Date.now()}
        onClose={close}
        onNext={activePlayer.onNext}
        onPrev={activePlayer.onPrev}
        onTogglePlay={activePlayer.onTogglePlay}
        progressMs={activePlayer.progressMs}
        showRomanized={showRomanized}
        showTranslation={showTranslation}
        status={lyrics.status}
        title={activePlayer.currentTrack?.title ?? "等待选择歌曲"}
      />
    </div>
  );
}

function clampPosition(position: Position, panel: HTMLDivElement | null): Position {
  const width = panel?.offsetWidth ?? 320;
  const height = panel?.offsetHeight ?? 64;
  const horizontalInset = Math.min(0.5, (width / 2 + 12) / Math.max(window.innerWidth, 1));
  const verticalInset = Math.min(0.5, (height / 2 + 12) / Math.max(window.innerHeight, 1));
  return {
    left: Math.min(1 - horizontalInset, Math.max(horizontalInset, position.left)),
    top: Math.min(1 - verticalInset, Math.max(verticalInset, position.top))
  };
}
