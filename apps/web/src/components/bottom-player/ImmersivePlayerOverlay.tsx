"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { QueueItem, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { VinylTonearm } from "@/components/room/VinylTonearm";
import { RoomLyricsPanel } from "@/components/room/RoomLyricsPanel";
import { PlayerQueueDrawer } from "@/components/PlayerQueueDrawer";
import { Slider } from "@/components/ui/slider";
import { useArtworkPalette, type ArtworkPalette } from "@/components/bottom-player/artwork-colors";
import { type PlaybackMode } from "@/components/bottom-player/playback-mode";
import { SquareAlbumCover } from "@/components/PlayerArtwork";
import { appSettingsChangeEvent, getAppSettings, getDefaultAppSettings } from "@/features/settings/settings-store";
import { usePlayerStyle } from "@/features/settings/use-player-style";

type ImmersivePlayerOverlayProps = {
  isOpen: boolean;
  isPlaying: boolean;
  positionMs: number;
  currentTrack: TrackMeta | null;
  canControlPlayback: boolean;
  canSeekPlayback: boolean;
  playbackTrackId: string | null | undefined;
  durationMs: number;
  volume: number;
  setSeekDraft: (value: number | null) => void;
  commitSeek: () => void;
  applyVolume: (value: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  playbackMode: PlaybackMode;
  onCyclePlaybackMode: () => void | Promise<void>;
  queue: QueueItem[];
  tracks: TrackMeta[];
  currentQueueItemId: string | null;
  canReorderQueue: boolean;
  canRemoveQueue: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  onClose: () => void;
};

export function ImmersivePlayerOverlay({
  isOpen,
  isPlaying,
  positionMs,
  currentTrack,
  canControlPlayback,
  canSeekPlayback,
  playbackTrackId,
  durationMs,
  volume,
  setSeekDraft,
  commitSeek,
  applyVolume,
  onPrev,
  onNext,
  onTogglePlay,
  playbackMode,
  onCyclePlaybackMode,
  queue,
  tracks,
  currentQueueItemId,
  canReorderQueue,
  canRemoveQueue,
  onPlayQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  onClose
}: ImmersivePlayerOverlayProps) {
  const [mobileView, setMobileView] = useState<"artwork" | "lyrics">("artwork");

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setMobileView("artwork");
    }
  }, [isOpen]);

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
  const playerStyle = usePlayerStyle();

  return (
    <div
      aria-hidden={!isOpen}
      aria-label="沉浸式播放"
      aria-modal="true"
      className={`fixed inset-0 z-[80] h-[100dvh] max-h-[100dvh] w-full overflow-hidden text-foreground transition-[opacity,transform,visibility,background-color] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${isOpen ? "visible translate-y-0 scale-100 opacity-100" : "pointer-events-none invisible translate-y-[3%] scale-[0.985] opacity-0"}`}
      role="dialog"
      style={{ backgroundColor: artworkPalette.background }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-45 transition-opacity duration-500 motion-reduce:transition-none"
        style={{ background: `linear-gradient(145deg, ${artworkPalette.accentSoft}, transparent 45%, ${artworkPalette.border})` }}
      />

      <MobileImmersivePlayer
        artworkPalette={artworkPalette}
        artworkUrl={currentTrack?.artworkUrl ?? null}
        canControlPlayback={canControlPlayback}
        canRemoveQueue={canRemoveQueue}
        canReorderQueue={canReorderQueue}
        canSeekPlayback={canSeekPlayback}
        currentQueueItemId={currentQueueItemId}
        currentTrack={currentTrack}
        durationMs={durationMs}
        isOpen={isOpen}
        isPlaying={isPlaying}
        mobileView={mobileView}
        onClose={onClose}
        onCyclePlaybackMode={onCyclePlaybackMode}
        onNext={onNext}
        onPlayQueueItem={onPlayQueueItem}
        onPrev={onPrev}
        onRemoveQueueItem={onRemoveQueueItem}
        onReorderQueue={onReorderQueue}
        onSetMobileView={setMobileView}
        onTogglePlay={onTogglePlay}
        playbackMode={playbackMode}
        playbackTrackId={playbackTrackId}
        playerStyle={playerStyle}
        positionMs={positionMs}
        queue={queue}
        setSeekDraft={setSeekDraft}
        sourceProvider={sourceProvider}
        sourceTrackId={sourceTrackId}
        tracks={tracks}
        volume={volume}
        applyVolume={applyVolume}
        commitSeek={commitSeek}
      />

      <button
        type="button"
        aria-label="退出沉浸式播放"
        title="退出沉浸式播放"
        onClick={onClose}
        className="light-overlay-control absolute left-[calc(env(safe-area-inset-left)+1rem)] top-[calc(env(safe-area-inset-top)+1rem)] z-[60] hidden h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 shadow-lg backdrop-blur-md transition-[background-color,border-color,color,transform] duration-200 hover:border-accent/30 hover:bg-accent/10 hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:inline-flex"
        style={{ borderColor: artworkPalette.border }}
      >
        <svg aria-hidden="true" fill="none" height="19" viewBox="0 0 24 24" width="19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M9 15H4v5" /><path d="m4 20 6-6" /><path d="M15 9h5V4" /><path d="m20 4-6 6" /></svg>
      </button>

      <main className="relative z-10 mx-auto hidden h-[100dvh] min-h-0 w-full max-w-[1500px] grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)] items-center gap-12 overflow-hidden px-14 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 md:grid xl:gap-20">
        <section className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden" aria-label={playerStyle === "square-cover" ? "专辑封面" : "唱片"}>
          <ImmersiveVinyl artworkUrl={currentTrack?.artworkUrl ?? null} isPlaying={isPlaying} palette={artworkPalette} playerStyle={playerStyle} />
        </section>
        <section className="flex min-h-0 w-full min-w-0 flex-col justify-center overflow-hidden" aria-label="歌曲信息与歌词">
          <TrackDetails currentTrack={currentTrack} />
          <ImmersiveLyrics isOpen={isOpen} isPlaying={isPlaying} positionMs={positionMs} roomLyrics={currentTrack?.lyrics ?? null} sourceProvider={sourceProvider} sourceTrackId={sourceTrackId} />
        </section>
      </main>
    </div>
  );
}

type MobileImmersivePlayerProps = ImmersivePlayerOverlayProps & {
  artworkPalette: ArtworkPalette;
  artworkUrl: string | null;
  mobileView: "artwork" | "lyrics";
  onSetMobileView: (view: "artwork" | "lyrics") => void;
  playerStyle: "vinyl" | "square-cover";
  sourceProvider: "netease" | "qqmusic" | undefined;
  sourceTrackId: string | undefined;
};

function MobileImmersivePlayer({
  artworkPalette,
  artworkUrl,
  canControlPlayback,
  canRemoveQueue,
  canReorderQueue,
  canSeekPlayback,
  commitSeek,
  currentQueueItemId,
  currentTrack,
  durationMs,
  isOpen,
  isPlaying,
  mobileView,
  onClose,
  onCyclePlaybackMode,
  onNext,
  onPlayQueueItem,
  onPrev,
  onRemoveQueueItem,
  onReorderQueue,
  onSetMobileView,
  onTogglePlay,
  playbackMode,
  playbackTrackId,
  playerStyle,
  positionMs,
  queue,
  setSeekDraft,
  sourceProvider,
  sourceTrackId,
  tracks,
  volume,
  applyVolume
}: MobileImmersivePlayerProps) {
  const controlsDisabled = !canControlPlayback || !playbackTrackId;

  return (
    <section className="relative z-10 flex h-full min-h-0 flex-col px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] md:hidden">
      <header className="flex h-12 shrink-0 items-center justify-between">
        <button aria-label="退出沉浸式播放" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/85 transition-[background-color,transform] duration-200 hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80" onClick={onClose} title="退出沉浸式播放" type="button">
          <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <span className="h-1.5 w-10 rounded-full bg-white/35" aria-hidden="true" />
        <span className="h-11 w-11" aria-hidden="true" />
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden py-3">
        {mobileView === "artwork" ? (
          <div className="mobile-player-panel flex min-h-0 flex-col items-center justify-center" key="artwork">
            <button aria-label="显示歌词" className="rounded-[1.35rem] outline-none transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-white" onClick={() => onSetMobileView("lyrics")} title="显示歌词" type="button">
              <ImmersiveVinyl artworkUrl={artworkUrl} isPlaying={isPlaying} mobile palette={artworkPalette} playerStyle={playerStyle} />
            </button>
            <div className="mt-7 w-full">
              <TrackDetails currentTrack={currentTrack} mobile />
            </div>
          </div>
        ) : (
          <div className="mobile-player-panel flex min-h-0 flex-1 flex-col" key="lyrics">
            <button aria-label="显示专辑封面" className="mb-3 flex min-w-0 items-center gap-3 rounded-lg py-2 text-left outline-none transition-[background-color,transform] duration-200 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-white" onClick={() => onSetMobileView("artwork")} title="显示专辑封面" type="button">
              <SquareAlbumCover artworkUrl={artworkUrl} className="h-11 w-11 shrink-0 rounded-md" />
              <span className="min-w-0"><span className="block truncate text-sm font-semibold text-white">{currentTrack?.title ?? "等待选择歌曲"}</span><span className="mt-0.5 block truncate text-xs text-white/55">{currentTrack?.artist ?? "从歌单中选择一首歌曲"}</span></span>
            </button>
            <div className="flex min-h-0 flex-1 items-center">
              <ImmersiveLyrics isOpen={isOpen} isPlaying={isPlaying} mobile positionMs={positionMs} roomLyrics={currentTrack?.lyrics ?? null} sourceProvider={sourceProvider} sourceTrackId={sourceTrackId} />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 pt-2">
        <div className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-white/58">{formatDuration(positionMs)}</span>
          <Slider
            accentColor={artworkPalette.accent}
            className="[&>div]:h-1.5"
            disabled={!durationMs || !canSeekPlayback}
            max={durationMs || 1}
            onChange={(event) => setSeekDraft(Number(event.target.value))}
            onKeyUp={commitSeek}
            onPointerUp={commitSeek}
            value={positionMs}
          />
          <span className="w-10 shrink-0 text-xs tabular-nums text-white/58">{formatDuration(durationMs)}</span>
        </div>

        <div className="mt-5 grid grid-cols-[2.75rem_1fr_2.75rem] items-center">
          <button aria-label="切换播放模式" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/70 transition-[background-color,transform] duration-200 hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-35" disabled={!canControlPlayback} onClick={() => void onCyclePlaybackMode()} title="切换播放模式" type="button">
            <PlaybackModeGlyph mode={playbackMode} />
          </button>
          <div className="flex items-center justify-center gap-3">
            <TransportButton ariaLabel="上一首" disabled={controlsDisabled} onClick={onPrev}><svg aria-hidden="true" fill="currentColor" height="22" viewBox="0 0 24 24" width="22"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg></TransportButton>
            <button aria-label={isPlaying ? "暂停" : "播放"} className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-[0_10px_30px_rgba(0,0,0,0.22)] transition-transform duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:bg-white/35" disabled={controlsDisabled} onClick={onTogglePlay} title={isPlaying ? "暂停" : "播放"} type="button">
              {isPlaying ? <svg aria-hidden="true" fill="currentColor" height="25" viewBox="0 0 24 24" width="25"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg> : <svg aria-hidden="true" fill="currentColor" height="25" viewBox="0 0 24 24" width="25"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <TransportButton ariaLabel="下一首" disabled={controlsDisabled} onClick={onNext}><svg aria-hidden="true" fill="currentColor" height="22" viewBox="0 0 24 24" width="22"><path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" /></svg></TransportButton>
          </div>
          <PlayerQueueDrawer
            accentColor={artworkPalette.accent}
            accentSoft={artworkPalette.accentSoft}
            canControlPlayback={canControlPlayback}
            canRemoveQueue={canRemoveQueue}
            canReorderQueue={canReorderQueue}
            compactMobile
            currentQueueItemId={currentQueueItemId}
            onPlayQueueItem={onPlayQueueItem}
            onRemoveQueueItem={onRemoveQueueItem}
            onReorderQueue={onReorderQueue}
            queue={queue}
            tracks={tracks}
          />
        </div>

        <div className="mt-5 flex items-center gap-3 px-2 text-white/62">
          <SpeakerGlyph volume={volume} />
          <Slider accentColor={artworkPalette.accent} className="[&>div]:h-1" max={1} onChange={(event) => applyVolume(Number(event.target.value))} onInput={(event) => applyVolume(Number((event.target as HTMLInputElement).value))} step={0.01} value={volume} />
        </div>
      </div>
    </section>
  );
}

function TrackDetails({ currentTrack, mobile = false }: { currentTrack: TrackMeta | null; mobile?: boolean }) {
  return (
    <div className="min-w-0 text-center md:text-left">
      <h1 className={`${mobile ? "text-[1.35rem] leading-7" : "text-3xl leading-[1.08] lg:text-4xl"} mx-auto max-w-[24ch] break-words font-semibold text-foreground md:mx-0`}>
        {currentTrack?.title ?? "等待选择歌曲"}
      </h1>
      <p className={`${mobile ? "mt-1 text-sm" : "mt-3 text-lg"} truncate text-foreground-muted`}>{currentTrack?.artist ?? "从歌单中选择一首歌曲"}</p>
      {!mobile ? <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground-muted/70"><span>专辑：{currentTrack?.album ?? "未知专辑"}</span>{currentTrack?.sourceType ? <span>来源：{getSourceLabel(currentTrack.sourceType)}</span> : null}</div> : null}
    </div>
  );
}

function TransportButton({ ariaLabel, children, disabled, onClick }: { ariaLabel: string; children: ReactNode; disabled: boolean; onClick: () => void }) {
  return <button aria-label={ariaLabel} className="inline-flex h-12 w-12 items-center justify-center rounded-full text-white transition-[background-color,transform] duration-200 hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-35" disabled={disabled} onClick={onClick} title={ariaLabel} type="button">{children}</button>;
}

function PlaybackModeGlyph({ mode }: { mode: PlaybackMode }) {
  if (mode === "shuffle") return <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M4 7h3.5c3.5 0 4.5 10 9 10H20" /><path d="m17 14 3 3-3 3" /><path d="M4 17h3c1.4 0 2.4-1.1 3.1-2.4" /><path d="M14 9.4C14.8 8 15.8 7 17.2 7H20" /><path d="m17 4 3 3-3 3" /></svg>;
  if (mode === "single") return <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="m7 22-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /><path d="M12 10v4" /></svg>;
  return <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M4 7h12" /><path d="m13 4 3 3-3 3" /><path d="M20 17H8" /><path d="m11 14-3 3 3 3" /></svg>;
}

function SpeakerGlyph({ volume }: { volume: number }) {
  return <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="M11 5 6 9H3v6h3l5 4V5Z" />{volume <= 0.01 ? <path d="m19 9-5 6m0-6 5 6" /> : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>}</svg>;
}

function ImmersiveVinyl({ artworkUrl, isPlaying, mobile = false, palette, playerStyle }: { artworkUrl: string | null; isPlaying: boolean; mobile?: boolean; palette: ArtworkPalette; playerStyle: "vinyl" | "square-cover" }) {
  return (
    <div className={`relative flex aspect-square w-auto max-w-full items-center justify-center ${mobile ? "h-[min(42dvh,22rem)]" : "h-[min(68dvh,34rem)]"}`}>
      <div className="relative flex aspect-square w-[86%] items-center justify-center overflow-visible">
        {playerStyle === "square-cover" ? <SquareAlbumCover artworkUrl={artworkUrl} className="h-full w-full rounded-[1.25rem] shadow-[0_26px_90px_rgba(0,0,0,0.35)]" /> : (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-[0_26px_90px_rgba(0,0,0,0.55)] animate-spin-slow" style={{ animationPlayState: isPlaying ? "running" : "paused" }}>
            <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.1),transparent_40%)]" />
            <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(from 0deg at 50% 50%, ${palette.accentSoft} 0deg, transparent 90deg, ${palette.accentSoft} 180deg, transparent 270deg, ${palette.accentSoft} 360deg)` }} />
            {Array.from({ length: 7 }).map((_, index) => <div key={index} className="absolute rounded-full border border-white/[0.025]" style={{ width: `${100 - index * 12}%`, height: `${100 - index * 12}%` }} />)}
            {artworkUrl ? <div className="absolute z-10 aspect-square w-[47%] overflow-hidden rounded-full border border-white/10 bg-cover bg-center shadow-[0_0_24px_rgba(0,0,0,0.35)]" style={{ backgroundImage: `url("${artworkUrl}")` }} /> : null}
            <div className="absolute z-20 flex aspect-square w-[12%] items-center justify-center rounded-full border shadow-inner" style={{ borderColor: palette.border, backgroundColor: palette.accentSoft }}><div className="aspect-square w-[30%] rounded-full border border-white/10 bg-black shadow-inner" /></div>
          </div>
        )}
        {playerStyle === "vinyl" ? <VinylTonearm isPlaying={isPlaying} accentColor={palette.accent} /> : null}
      </div>
    </div>
  );
}

function ImmersiveLyrics({ isOpen, isPlaying, mobile = false, positionMs, roomLyrics, sourceProvider, sourceTrackId }: { isOpen: boolean; isPlaying: boolean; mobile?: boolean; positionMs: number; roomLyrics: string | null; sourceProvider: "netease" | "qqmusic" | undefined; sourceTrackId: string | undefined }) {
  const [plainLyric, setPlainLyric] = useState<string | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lyricPreferences, setLyricPreferences] = useState(() => getDefaultAppSettings().playback);

  useEffect(() => {
    const syncPreferences = () => setLyricPreferences(getAppSettings().playback);
    syncPreferences();
    window.addEventListener(appSettingsChangeEvent, syncPreferences);
    window.addEventListener("storage", syncPreferences);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, syncPreferences);
      window.removeEventListener("storage", syncPreferences);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setPlainLyric(null);
      setLyricsStatus("idle");
      return;
    }
    if (roomLyrics?.trim()) {
      setPlainLyric(roomLyrics.trim());
      setLyricsStatus("ready");
      return;
    }
    if (!sourceProvider || !sourceTrackId) {
      setPlainLyric(null);
      setLyricsStatus("ready");
      return;
    }
    let cancelled = false;
    setLyricsStatus("loading");
    const request = sourceProvider === "netease" ? musicRoomApi.getNeteaseLyrics(sourceTrackId) : musicRoomApi.getQqMusicLyrics(sourceTrackId);
    void request.then((lyrics) => {
      if (!cancelled) {
        setPlainLyric(lyrics.plainLyric);
        setLyricsStatus("ready");
      }
    }).catch(() => {
      if (!cancelled) {
        setPlainLyric(null);
        setLyricsStatus("error");
      }
    });
    return () => { cancelled = true; };
  }, [isOpen, roomLyrics, sourceProvider, sourceTrackId]);

  if (!isOpen) return null;
  return <div className={mobile ? "min-h-0 w-full" : "mt-4 min-h-0 border-t border-white/[0.08] pt-4"}><RoomLyricsPanel visibleLines={mobile ? 7 : lyricPreferences.lyricLines} fontScale={lyricPreferences.lyricFontScale} isPlaying={isPlaying} lyrics={plainLyric} positionMs={positionMs} status={lyricsStatus} /></div>;
}

function getSourceLabel(sourceType: TrackMeta["sourceType"]) {
  if (sourceType === "netease") return "网易云音乐";
  if (sourceType === "qqmusic") return "QQ音乐";
  return "本地音频";
}
