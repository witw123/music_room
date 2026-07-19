"use client";

import { useEffect, useState } from "react";
import type { TrackMeta } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";
import { VinylAuraVisualizer } from "@/components/room/VinylAuraVisualizer";
import { VinylTonearm } from "@/components/room/VinylTonearm";
import { RoomLyricsPanel } from "@/components/room/RoomLyricsPanel";
import { useArtworkPalette, type ArtworkPalette } from "@/components/bottom-player/artwork-colors";

type ImmersivePlayerOverlayProps = {
  isOpen: boolean;
  isPlaying: boolean;
  positionMs: number;
  currentTrack: TrackMeta | null;
  onClose: () => void;
};

export function ImmersivePlayerOverlay({
  isOpen,
  isPlaying,
  positionMs,
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

  useEffect(() => {
    if (!isOpen) return;
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [isOpen]);

  const sourceProvider = currentTrack?.sourceRef?.provider;
  const sourceTrackId = currentTrack?.sourceRef?.trackId;
  const artworkPalette = useArtworkPalette(currentTrack?.artworkUrl);

  return (
    <div
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-[50] h-[100dvh] max-h-[100dvh] w-full overflow-hidden text-foreground transition-[opacity,transform,visibility,background-color] duration-500 ease-out motion-reduce:transition-none ${isOpen ? "visible translate-y-0 opacity-100" : "pointer-events-none invisible translate-y-3 opacity-0"}`}
      style={{ backgroundColor: artworkPalette.background }}
      role="dialog"
      aria-modal="true"
      aria-label="沉浸式播放"
      >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-40 transition-opacity duration-700"
        style={{
          background: `linear-gradient(120deg, ${artworkPalette.accentSoft}, transparent 42%, ${artworkPalette.border})`
        }}
      />
      <button
        type="button"
        aria-label="退出沉浸式播放"
        title="退出沉浸式播放"
        onClick={onClose}
        className="absolute left-4 top-4 z-[60] inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 shadow-lg backdrop-blur-md transition-[background-color,border-color,color,transform] duration-200 hover:border-accent/30 hover:bg-accent/10 hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:left-8 sm:top-8"
        style={{ borderColor: artworkPalette.border }}
      >
        <svg aria-hidden="true" fill="none" height="19" viewBox="0 0 24 24" width="19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
          <path d="M9 15H4v5" />
          <path d="m4 20 6-6" />
          <path d="M15 9h5V4" />
          <path d="m20 4-6 6" />
        </svg>
      </button>

      <main className="relative z-10 mx-auto grid h-[100dvh] min-h-0 max-h-[100dvh] w-full max-w-[1500px] -translate-y-4 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 overflow-hidden px-4 pb-4 pt-16 sm:-translate-y-5 sm:gap-6 sm:px-8 sm:pb-6 sm:pt-20 lg:-translate-y-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)] lg:grid-rows-1 lg:gap-12 lg:px-14 lg:pb-8 lg:pt-8 xl:gap-20">
        <section className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden" aria-label="唱片">
          <ImmersiveVinyl artworkUrl={currentTrack?.artworkUrl ?? null} isPlaying={isPlaying} palette={artworkPalette} />
        </section>

        <section className="flex min-h-0 w-full min-w-0 flex-col justify-center overflow-hidden" aria-label="歌曲信息与歌词">
          <div className="min-w-0">
            <h1 className="max-w-[22ch] break-words text-xl font-semibold leading-[1.08] text-foreground sm:text-3xl lg:text-4xl">
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
            isPlaying={isPlaying}
            positionMs={positionMs}
            sourceProvider={sourceProvider}
            sourceTrackId={sourceTrackId}
          />
        </section>
      </main>
    </div>
  );
}

function ImmersiveVinyl({ artworkUrl, isPlaying, palette }: { artworkUrl: string | null; isPlaying: boolean; palette: ArtworkPalette }) {
  return (
    <div className="relative flex aspect-square h-[min(34dvh,14rem)] w-auto max-w-full items-center justify-center sm:h-[min(40dvh,20rem)] lg:h-[min(68dvh,34rem)]">
      <VinylAuraVisualizer isPlaying={isPlaying} />
      <div
        className="relative flex aspect-square w-[86%] items-center justify-center overflow-visible"
      >
        <div
          className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-[0_26px_90px_rgba(0,0,0,0.55)] transition-[box-shadow,transform] duration-700 ease-out ${isPlaying ? "animate-spin-slow" : ""}`}
        >
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.1),transparent_40%)]" />
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(from 0deg at 50% 50%, ${palette.accentSoft} 0deg, transparent 90deg, ${palette.accentSoft} 180deg, transparent 270deg, ${palette.accentSoft} 360deg)`
            }}
          />
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
          <div
            className="absolute z-20 flex aspect-square w-[12%] items-center justify-center rounded-full border shadow-inner"
            style={{ borderColor: palette.border, backgroundColor: palette.accentSoft }}
          >
            <div className="aspect-square w-[30%] rounded-full border border-white/10 bg-black shadow-inner" />
          </div>
        </div>
        <VinylTonearm isPlaying={isPlaying} accentColor={palette.accent} />
      </div>
    </div>
  );
}

function ImmersiveLyrics({
  isOpen,
  isPlaying,
  positionMs,
  sourceProvider,
  sourceTrackId
}: {
  isOpen: boolean;
  isPlaying: boolean;
  positionMs: number;
  sourceProvider: "netease" | "qqmusic" | undefined;
  sourceTrackId: string | undefined;
}) {
  const [plainLyric, setPlainLyric] = useState<string | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!isOpen || !sourceProvider || !sourceTrackId) {
      setPlainLyric(null);
      setLyricsStatus("idle");
      return;
    }

    let cancelled = false;
    setLyricsStatus("loading");
    const request = sourceProvider === "netease"
      ? musicRoomApi.getNeteaseLyrics(sourceTrackId)
      : musicRoomApi.getQqMusicLyrics(sourceTrackId);
    void request
      .then((lyrics) => {
        if (cancelled) return;
        setPlainLyric(lyrics.plainLyric);
        setLyricsStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setPlainLyric(null);
          setLyricsStatus("error");
        }
      })

    return () => {
      cancelled = true;
    };
  }, [isOpen, sourceProvider, sourceTrackId]);

  if (!isOpen) return null;

  return (
    <div className="mt-2 min-h-0 border-t border-white/[0.08] pt-3 sm:mt-4 sm:pt-4">
      <RoomLyricsPanel
        className="h-[min(34svh,15rem)] max-h-[15rem] min-h-[6rem] sm:h-[min(40svh,22rem)] sm:max-h-[22rem] sm:min-h-[9rem]"
        isPlaying={isPlaying}
        lyrics={plainLyric}
        positionMs={positionMs}
        status={lyricsStatus}
      />
    </div>
  );
}

function getSourceLabel(sourceType: TrackMeta["sourceType"]) {
  if (sourceType === "netease") return "网易云音乐";
  if (sourceType === "qqmusic") return "QQ音乐";
  return "本地音频";
}
