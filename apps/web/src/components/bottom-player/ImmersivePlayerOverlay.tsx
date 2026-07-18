"use client";

import type { TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

type ImmersivePlayerOverlayProps = {
  isOpen: boolean;
  isPlaying: boolean;
  canControlPlayback: boolean;
  currentTrack: TrackMeta | null;
  progressMs: number;
  durationMs: number;
  setSeekDraft: (value: number | null) => void;
  commitSeek: () => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
};

export function ImmersivePlayerOverlay({
  isOpen,
  isPlaying,
  canControlPlayback,
  currentTrack,
  progressMs,
  durationMs,
  setSeekDraft,
  commitSeek,
  onClose,
  onPrev,
  onNext,
  onTogglePlay
}: ImmersivePlayerOverlayProps) {
  if (!isOpen) return null;

  const title = currentTrack?.title ?? "等待选择歌曲";
  const artist = currentTrack?.artist ?? "从曲库或共享队列中选择一首歌";
  const artworkUrl = currentTrack?.artworkUrl ?? null;

  return (
    <div className="fixed inset-0 z-[70] flex min-h-screen flex-col overflow-y-auto bg-[#07101b] text-foreground" role="dialog" aria-modal="true" aria-label="沉浸式播放">
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-4 sm:px-8">
        <Button variant="ghost" size="icon" className="h-9 w-9 text-foreground-muted hover:text-foreground" onClick={onClose} aria-label="退出沉浸式播放" title="退出沉浸式播放">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </Button>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-foreground-muted">沉浸式播放</span>
        <span className="w-9" aria-hidden="true" />
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-8 sm:px-10 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)] lg:gap-20 lg:py-14">
        <section className="flex justify-center" aria-label="唱片">
          <div className={`relative flex aspect-square w-[min(70vw,26rem)] items-center justify-center rounded-full border border-white/[0.1] bg-[#02060b] p-[7%] shadow-[0_24px_90px_rgba(0,0,0,0.45)] ${isPlaying ? "animate-spin-slow" : ""}`}>
            <div className="absolute inset-[4%] rounded-full border border-white/[0.06]" />
            <div className="absolute inset-[9%] rounded-full border border-white/[0.05]" />
            <div
              className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/[0.12] bg-[#111d2b] bg-cover bg-center"
              style={artworkUrl ? { backgroundImage: `url(${JSON.stringify(artworkUrl)})` } : undefined}
            >
              {!artworkUrl ? <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground-muted">No artwork</span> : null}
              <span className="absolute h-[14%] w-[14%] rounded-full border border-white/20 bg-[#07101b] shadow-inner" />
            </div>
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-7">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-accent">Now playing</p>
            <h1 className="mt-3 truncate text-2xl font-semibold text-foreground sm:text-4xl">{title}</h1>
            <p className="mt-2 truncate text-sm text-foreground-muted sm:text-base">{artist}</p>
            {currentTrack?.album ? <p className="mt-2 truncate text-xs text-foreground-muted/70">专辑 · {currentTrack.album}</p> : null}
          </div>

          <section className="min-h-[210px] border-y border-white/[0.08] py-5" aria-label="歌词占位">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">歌词</h2>
              <span className="font-mono text-[10px] text-foreground-muted">即将支持</span>
            </div>
            <p className="mt-8 text-sm leading-7 text-foreground-muted/60">歌词内容将在接入歌词数据后显示。</p>
          </section>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between font-mono text-[10px] text-foreground-muted">
              <span>{formatDuration(progressMs)}</span>
              <span>{formatDuration(durationMs)}</span>
            </div>
            <Slider
              data-testid="immersive-player-seek-slider"
              value={progressMs}
              max={durationMs || 1}
              disabled={!durationMs || !canControlPlayback}
              onChange={(event) => setSeekDraft(Number(event.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
            />
          </div>

          <div className="flex items-center justify-center gap-4">
            <Button variant="ghost" size="icon" className="h-10 w-10 text-foreground-muted hover:text-foreground" disabled={!canControlPlayback} onClick={onPrev} title="上一首" aria-label="上一首">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
            </Button>
            <button className="grid h-14 w-14 place-items-center rounded-full bg-accent text-white shadow-lg shadow-accent/20 transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canControlPlayback} onClick={onTogglePlay} title={isPlaying ? "暂停" : "播放"} aria-label={isPlaying ? "暂停" : "播放"} type="button">
              {isPlaying ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg> : <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <Button variant="ghost" size="icon" className="h-10 w-10 text-foreground-muted hover:text-foreground" disabled={!canControlPlayback} onClick={onNext} title="下一首" aria-label="下一首">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" /></svg>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
