"use client";

import { useEffect, useState } from "react";
import type { TrackMeta } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";
import { VinylAuraVisualizer } from "@/components/room/VinylAuraVisualizer";

type ImmersivePlayerOverlayProps = {
  isOpen: boolean;
  isPlaying: boolean;
  currentTrack: TrackMeta | null;
  onClose: () => void;
};

export function ImmersivePlayerOverlay({
  isOpen,
  isPlaying,
  currentTrack,
  onClose
}: ImmersivePlayerOverlayProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const sourceProvider = currentTrack?.sourceRef?.provider;
  const sourceTrackId = currentTrack?.sourceRef?.trackId;

  return (
    <div
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-[50] min-h-screen overflow-y-auto bg-[#05080d] text-foreground transition-[opacity,transform,visibility] duration-500 ease-out motion-reduce:transition-none ${isOpen ? "visible translate-y-0 opacity-100" : "pointer-events-none invisible translate-y-3 opacity-0"}`}
      role="dialog"
      aria-modal="true"
      aria-label="沉浸式播放"
    >
      <button
        type="button"
        aria-label="退出沉浸式播放"
        title="退出沉浸式播放"
        onClick={onClose}
        className="absolute left-5 top-5 z-30 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 shadow-lg backdrop-blur-md transition-[background-color,border-color,color,transform] duration-200 hover:border-accent/30 hover:bg-accent/10 hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:left-8 sm:top-8"
      >
        <svg aria-hidden="true" fill="none" height="19" viewBox="0 0 24 24" width="19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
          <path d="M9 15H4v5" />
          <path d="m4 20 6-6" />
          <path d="M15 9h5V4" />
          <path d="m20 4-6 6" />
        </svg>
      </button>

      <main className="relative mx-auto grid min-h-screen w-full max-w-[1500px] items-center gap-10 px-5 pb-[9rem] pt-24 sm:px-10 sm:pb-[8rem] sm:pt-28 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)] lg:gap-16 lg:px-16 lg:pb-28 lg:pt-10 xl:gap-24">
        <section className="flex min-h-0 items-center justify-center" aria-label="唱片">
          <ImmersiveVinyl artworkUrl={currentTrack?.artworkUrl ?? null} isPlaying={isPlaying} />
        </section>

        <section className="flex min-h-0 w-full flex-col justify-center lg:max-h-[min(70vh,42rem)]" aria-label="歌曲信息与歌词">
          <div className="min-w-0">
            <h1 className="max-w-[22ch] truncate text-2xl font-semibold leading-tight text-foreground sm:text-3xl lg:text-4xl">
              {currentTrack?.title ?? "等待选择歌曲"}
            </h1>
            <p className="mt-3 truncate text-base text-foreground-muted sm:text-lg">
              {currentTrack?.artist ?? "从歌单中选择一首歌曲"}
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-foreground-muted/70 sm:text-sm">
              <span>专辑：{currentTrack?.album ?? "未知专辑"}</span>
              {currentTrack?.sourceType ? <span>来源：{getSourceLabel(currentTrack.sourceType)}</span> : null}
            </div>
          </div>

          <ImmersiveLyrics
            isOpen={isOpen}
            sourceProvider={sourceProvider}
            sourceTrackId={sourceTrackId}
          />
        </section>
      </main>
    </div>
  );
}

function ImmersiveVinyl({ artworkUrl, isPlaying }: { artworkUrl: string | null; isPlaying: boolean }) {
  return (
    <div className="relative flex aspect-square w-[min(78vw,32rem)] items-center justify-center sm:w-[min(64vw,36rem)] lg:w-[min(42vw,38rem)]">
      <VinylAuraVisualizer isPlaying={isPlaying} />
      <div
        className={`relative flex aspect-square w-[82%] items-center justify-center overflow-visible rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-[0_26px_90px_rgba(0,0,0,0.55)] transition-[box-shadow,transform] duration-700 ease-out ${isPlaying ? "animate-spin-slow" : ""}`}
      >
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.1),transparent_40%)]" />
        <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,rgba(0,112,243,0.1)_0deg,rgba(0,0,0,0)_90deg,rgba(0,112,243,0.1)_180deg,rgba(0,0,0,0)_270deg,rgba(0,112,243,0.1)_360deg)]" />
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="absolute rounded-full border border-white/[0.025]"
            style={{ width: `${100 - index * 12}%`, height: `${100 - index * 12}%` }}
          />
        ))}
        {artworkUrl ? (
          <div
            className="relative z-10 aspect-square w-[47%] overflow-hidden rounded-full border border-white/10 bg-cover bg-center shadow-[0_0_24px_rgba(0,0,0,0.35)]"
            style={{ backgroundImage: `url("${artworkUrl}")` }}
          />
        ) : null}
        <div className="absolute z-20 flex aspect-square w-[12%] items-center justify-center rounded-full border border-accent/30 bg-gradient-to-br from-accent/30 to-blue-500/20 shadow-inner">
          <div className="aspect-square w-[30%] rounded-full border border-white/10 bg-black shadow-inner" />
        </div>
      </div>

      <div
        className={`absolute z-20 flex flex-col items-center transition-transform duration-500 ease-out ${isPlaying ? "rotate-[20deg]" : "-rotate-[15deg]"}`}
        style={{
          right: "calc(7% - 1rem)",
          top: "12%",
          width: "10%",
          height: "58%",
          transformOrigin: "8% 8%"
        }}
      >
        <div className="absolute top-0 z-10 flex aspect-square w-[18%] items-center justify-center rounded-full border-2 border-[#111] bg-gradient-to-br from-neutral-300 to-neutral-600 shadow-xl">
          <div className="aspect-square w-[42%] rounded-full bg-[#111] shadow-inner" />
        </div>
        <div className="h-[78%] w-[28%] bg-gradient-to-r from-neutral-400 via-neutral-200 to-neutral-500 pt-[12%] shadow-lg" />
        <div className="relative ml-[-35%] h-[24%] w-[105%] skew-x-[15deg] rounded-b-md border-b-2 border-accent bg-[#222] shadow-2xl">
          <div className="absolute right-0 top-2 h-2 w-2 rounded-full bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
        </div>
      </div>
    </div>
  );
}

function ImmersiveLyrics({
  isOpen,
  sourceProvider,
  sourceTrackId
}: {
  isOpen: boolean;
  sourceProvider: "netease" | "qqmusic" | undefined;
  sourceTrackId: string | undefined;
}) {
  const [plainLyric, setPlainLyric] = useState<string | null>(null);
  const [translatedLyric, setTranslatedLyric] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !sourceProvider || !sourceTrackId) {
      setPlainLyric(null);
      setTranslatedLyric(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    const request = sourceProvider === "netease"
      ? musicRoomApi.getNeteaseLyrics(sourceTrackId)
      : musicRoomApi.getQqMusicLyrics(sourceTrackId);
    void request
      .then((lyrics) => {
        if (cancelled) return;
        setPlainLyric(lyrics.plainLyric);
        setTranslatedLyric(lyrics.translatedLyric);
      })
      .catch(() => {
        if (!cancelled) {
          setPlainLyric(null);
          setTranslatedLyric(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, sourceProvider, sourceTrackId]);

  const lines = plainLyric?.split(/\r?\n/).filter(Boolean) ?? [];
  const translatedLines = translatedLyric?.split(/\r?\n/).filter(Boolean) ?? [];

  return (
    <div className="mt-10 min-h-0 flex-1 overflow-hidden border-t border-white/[0.08] pt-6 sm:mt-12 sm:pt-7">
      <div className="max-h-[min(42vh,28rem)] space-y-5 overflow-y-auto pr-3 text-base leading-7 text-foreground-muted sm:text-lg sm:leading-8">
        {lines.length ? lines.map((line, index) => (
          <p key={`${index}:${line}`}>
            <span className="block">{line}</span>
            {translatedLines[index] ? <span className="block text-sm text-foreground-muted/55 sm:text-base">{translatedLines[index]}</span> : null}
          </p>
        )) : (
          <p className="text-sm text-foreground-muted/60">{isLoading ? "正在读取歌词..." : "暂无可用歌词"}</p>
        )}
      </div>
    </div>
  );
}

function getSourceLabel(sourceType: TrackMeta["sourceType"]) {
  if (sourceType === "netease") return "网易云音乐";
  if (sourceType === "qqmusic") return "QQ音乐";
  return "本地音频";
}
