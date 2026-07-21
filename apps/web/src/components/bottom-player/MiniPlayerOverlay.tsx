"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Slider } from "@/components/ui/slider";
import { getArtworkSourceUrl, useArtworkPalette } from "@/components/bottom-player/artwork-colors";

type MiniPlayerOverlayProps = {
  isOpen: boolean;
  isPlaying: boolean;
  canControlPlayback: boolean;
  canSeekPlayback: boolean;
  playbackTrackId: string | null | undefined;
  title: string;
  artist: string;
  positionMs: number;
  durationMs: number;
  volume: number;
  artworkUrl: string | null;
  setSeekDraft: (value: number | null) => void;
  commitSeek: () => void;
  applyVolume: (value: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onOpenImmersive: () => void;
  onClose: () => void;
};

type FloatingPosition = {
  left: number;
  top: number;
};

const floatingInset = 12;

export function MiniPlayerOverlay({
  isOpen,
  isPlaying,
  canControlPlayback,
  canSeekPlayback,
  playbackTrackId,
  title,
  artist,
  positionMs,
  durationMs,
  volume,
  artworkUrl,
  setSeekDraft,
  commitSeek,
  applyVolume,
  onPrev,
  onNext,
  onTogglePlay,
  onOpenImmersive,
  onClose
}: MiniPlayerOverlayProps) {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const palette = useArtworkPalette(artworkUrl);

  useEffect(() => {
    if (!isOpen) {
      dragRef.current = null;
      return;
    }

    const clampPosition = () => {
      const panel = panelRef.current;
      if (!panel) return;
      setPosition((current) => current ? clampFloatingPosition(current, panel) : current);
    };

    window.addEventListener("resize", clampPosition);
    return () => window.removeEventListener("resize", clampPosition);
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !panel) return;
    const nextPosition = {
      left: event.clientX - drag.offsetX,
      top: event.clientY - drag.offsetY
    };
    setPosition(clampFloatingPosition(nextPosition, panel));
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const panelPositionStyle = position ? { left: position.left, top: position.top } : undefined;
  const artworkSource = artworkUrl ? getArtworkSourceUrl(artworkUrl) : null;

  return (
    <section
      ref={panelRef}
      aria-label="迷你播放器"
      className={`fixed z-[70] w-[min(360px,calc(100vw-1rem))] overflow-hidden rounded-2xl border text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl ${position ? "" : "right-3 bottom-[calc(10.5rem+env(safe-area-inset-bottom))] lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"}`}
      data-testid="mini-player-overlay"
      role="dialog"
      style={{
        ...panelPositionStyle,
        backgroundColor: palette.surface,
        borderColor: palette.border
      }}
    >
      <div
        className="flex h-11 cursor-grab touch-none items-center gap-2 border-b border-white/10 px-3 active:cursor-grabbing"
        onPointerCancel={stopDragging}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
      >
        <DragHandleIcon />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white/75">迷你播放器</span>
        <button
          aria-label="打开沉浸式播放"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={onOpenImmersive}
          title="打开沉浸式播放"
          type="button"
        >
          <ExpandIcon />
        </button>
        <button
          aria-label="关闭迷你播放器"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={onClose}
          title="关闭迷你播放器"
          type="button"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="p-2.5 sm:p-3">
        <div
          className="relative aspect-[1.55] overflow-hidden rounded-xl border border-white/10 bg-black/30"
          style={{ backgroundColor: palette.background }}
        >
          {artworkSource ? (
            // External provider artwork is intentionally rendered without Next image optimization.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-75"
              src={artworkSource}
            />
          ) : null}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, ${palette.accentSoft}, transparent 30%, rgba(0,0,0,0.88) 100%)`
            }}
          />
          <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">正在播放</p>
              <h2 className="mt-1 truncate text-base font-bold text-white">{title}</h2>
              <p className="mt-0.5 truncate text-xs text-white/60">{artist}</p>
            </div>
            <MiniPlayButton
              disabled={!canControlPlayback || !playbackTrackId}
              isPlaying={isPlaying}
              onClick={onTogglePlay}
            />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-white/55">{formatTime(positionMs)}</span>
          <Slider
            aria-label="迷你播放器进度"
            data-testid="mini-player-seek-slider"
            value={positionMs}
            max={durationMs || 1}
            accentColor={palette.accent}
            disabled={!durationMs || !canSeekPlayback}
            onChange={(event) => setSeekDraft(Number(event.target.value))}
            onPointerUp={commitSeek}
            onKeyUp={commitSeek}
          />
          <span className="w-9 shrink-0 text-[10px] tabular-nums text-white/55">{formatTime(durationMs)}</span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-1">
          <button
            aria-label={`音量 ${Math.round(volume * 100)}%`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => applyVolume(volume > 0.01 ? 0 : 1)}
            title={volume > 0.01 ? "静音" : "恢复音量"}
            type="button"
          >
            <VolumeIcon volume={volume} />
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
            <MiniTransportButton ariaLabel="上一首" disabled={!canControlPlayback || !playbackTrackId} onClick={onPrev}>
              <PreviousIcon />
            </MiniTransportButton>
            <MiniTransportButton ariaLabel={isPlaying ? "暂停" : "播放"} disabled={!canControlPlayback || !playbackTrackId} onClick={onTogglePlay} prominent>
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </MiniTransportButton>
            <MiniTransportButton ariaLabel="下一首" disabled={!canControlPlayback || !playbackTrackId} onClick={onNext}>
              <NextIcon />
            </MiniTransportButton>
          </div>
          <span className="w-8 shrink-0" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

function clampFloatingPosition(position: FloatingPosition, panel: HTMLElement): FloatingPosition {
  const maxLeft = Math.max(floatingInset, window.innerWidth - panel.offsetWidth - floatingInset);
  const maxTop = Math.max(floatingInset, window.innerHeight - panel.offsetHeight - floatingInset);
  return {
    left: Math.min(Math.max(floatingInset, position.left), maxLeft),
    top: Math.min(Math.max(floatingInset, position.top), maxTop)
  };
}

function formatTime(valueMs: number) {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function MiniTransportButton({
  ariaLabel,
  children,
  disabled,
  onClick,
  prominent = false
}: {
  ariaLabel: string;
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
  prominent?: boolean;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={prominent
        ? "inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        : "inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"}
      disabled={disabled}
      onClick={onClick}
      title={ariaLabel}
      type="button"
    >
      {children}
    </button>
  );
}

function MiniPlayButton({ disabled, isPlaying, onClick }: { disabled: boolean; isPlaying: boolean; onClick: () => void }) {
  return (
    <button
      aria-label={isPlaying ? "暂停" : "播放"}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title={isPlaying ? "暂停" : "播放"}
      type="button"
    >
      {isPlaying ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}

function DragHandleIcon() {
  return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M4 7h7" /><path d="M4 17h7" /><path d="M17 7h3" /><path d="M17 17h3" /><circle cx="15" cy="7" r="1.5" /><circle cx="15" cy="17" r="1.5" /></svg>;
}

function ExpandIcon() {
  return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M9 4H4v5" /><path d="m4 4 6 6" /><path d="M15 20h5v-5" /><path d="m20 20-6-6" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="m6 6 12 12" /><path d="m18 6-12 12" /></svg>;
}

function PreviousIcon() {
  return <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 24 24" width="16"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>;
}

function NextIcon() {
  return <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 24 24" width="16"><path d="m6 18 8.5-6L6 6zm10-12v12h2V6z" /></svg>;
}

function PlayIcon() {
  return <svg aria-hidden="true" fill="currentColor" height="17" viewBox="0 0 24 24" width="17"><path d="M8 5v14l11-7z" /></svg>;
}

function PauseIcon() {
  return <svg aria-hidden="true" fill="currentColor" height="17" viewBox="0 0 24 24" width="17"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg>;
}

function VolumeIcon({ volume }: { volume: number }) {
  if (volume <= 0.01) {
    return <svg aria-hidden="true" fill="none" height="17" viewBox="0 0 24 24" width="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="m19 9-5 6" /><path d="m14 9 5 6" /></svg>;
  }
  return <svg aria-hidden="true" fill="none" height="17" viewBox="0 0 24 24" width="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>;
}
