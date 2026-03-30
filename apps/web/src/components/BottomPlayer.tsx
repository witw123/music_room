"use client";

import { useTransition } from "react";
import type {
  AuthSession,
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

type BottomPlayerProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
  progressMs: number;
  seekDraft: number | null;
  setSeekDraft: (v: number | null) => void;
  audioDurationMs: number;
  volume: number;
  setVolume: (v: number) => void;
  syncProgressFromAudio: () => void;
  syncDurationFromAudio: () => void;
  roomSnapshot: RoomSnapshot | null;
  activeSession: AuthSession | null;
  uploadedTracks: Record<string, { objectUrl: string }>;
  currentTrack: TrackMeta | null;
  currentTrackAvailability: {
    localChunkCount: number;
    totalChunks: number;
  } | null;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  onPlay: () => void;
  onPause: (positionMs: number) => void;
  onSeek: (positionMs: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onEnded: () => void;
  onLocalPlaybackReady: () => void;
  onRemotePlaying: () => void;
  onRemoteWaiting: () => void;
  onRemotePause: () => void;
  onRemoteError: () => void;
};

function getMediaStatusLabel(state: RoomMediaConnectionState) {
  switch (state) {
    case "connecting":
      return "正在连接...";
    case "buffering":
      return "正在缓冲...";
    case "live":
      return "房间音频已接入";
    case "reconnecting":
      return "重新连接中...";
    case "failed":
      return "连接失败";
    default:
      return "等待播放";
  }
}

export function BottomPlayer({
  audioRef,
  remoteAudioRef,
  progressMs,
  seekDraft,
  setSeekDraft,
  audioDurationMs,
  volume,
  setVolume,
  syncProgressFromAudio,
  syncDurationFromAudio,
  roomSnapshot,
  activeSession,
  uploadedTracks,
  currentTrack,
  currentTrackAvailability,
  mediaConnectionState,
  mediaConnectedPeersCount,
  onPlay,
  onPause,
  onSeek,
  onPrev,
  onNext,
  onEnded,
  onLocalPlaybackReady,
  onRemotePlaying,
  onRemoteWaiting,
  onRemotePause,
  onRemoteError
}: BottomPlayerProps) {
  const [isPending, startTransition] = useTransition();
  const playback = roomSnapshot?.room.playback;
  const canControlPlayback = !!activeSession && !!roomSnapshot;
  const isPlaying = playback?.status === "playing";
  const effectiveProgressMs = seekDraft ?? progressMs;
  const currentTrackDuration = audioDurationMs;
  const progressRatio =
    currentTrackDuration > 0 ? Math.min(effectiveProgressMs / currentTrackDuration, 1) : 0;
  const localTrackAvailable = !!uploadedTracks[currentTrack?.id ?? ""];
  const mediaStatusLabel = getMediaStatusLabel(mediaConnectionState);

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 flex flex-col lg:grid lg:grid-cols-[1.5fr_auto_2fr_1.5fr] items-center gap-6 p-4 lg:px-8 bg-background-secondary/85 backdrop-blur-2xl border-t border-surface-border shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-all">
      {/* Top Progress Rail (Full bleeding progress bar for visual flair) */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/5" aria-hidden="true">
        <div 
          className="h-full bg-gradient-to-r from-accent to-blue-400 transition-all duration-300 ease-linear shadow-[0_0_10px_rgba(0,112,243,0.6)]" 
          style={{ width: `${progressRatio * 100}%` }} 
        />
      </div>

      {/* Track Info */}
      <div className="flex items-center gap-4 w-full min-w-0">
        <div
          className={`relative w-14 h-14 rounded-2xl overflow-hidden bg-surface border border-surface-border flex-shrink-0 shadow-lg ${
            isPlaying ? "animate-spin-slow rounded-full border-accent/30 shadow-accent/20" : "transition-all duration-700"
          }`}
        >
          {currentTrack?.artworkUrl ? (
            <img src={currentTrack.artworkUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-surface to-surface-hover flex items-center justify-center">
              <div className="w-3 h-3 rounded-full border-2 border-accent/20" />
            </div>
          )}
          {isPlaying && (
            <div className="absolute inset-0 rounded-full border border-white/10" />
          )}
        </div>
        <div className="min-w-0 truncate">
          <p className="text-[10px] uppercase font-bold tracking-widest text-accent text-glow mb-1">
            {isPlaying ? "正在播放" : "已暂停"}
          </p>
          <h3 className="text-sm font-semibold text-foreground truncate">{currentTrack?.title ?? "等待选择歌曲"}</h3>
          <p className="text-xs text-foreground-muted truncate mt-0.5">{currentTrack?.artist ?? "从曲库或共享队列中选择一首歌"}</p>
        </div>
      </div>

      {/* Play Controls */}
      <div className="flex items-center gap-4 justify-center">
        <Button
          variant="ghost"
          size="icon"
          disabled={!canControlPlayback || !playback?.currentTrackId}
          onClick={() => startTransition(() => void onPrev())}
          title="上一首"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </Button>
        <button
          className={`inline-grid place-items-center w-12 h-12 rounded-full transition-all group outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            canControlPlayback 
              ? "bg-foreground text-background hover:scale-105 active:scale-95 shadow-xl" 
              : "bg-surface text-foreground-muted opacity-50 cursor-not-allowed"
          }`}
          disabled={!canControlPlayback}
          onClick={() =>
            startTransition(() =>
              void (
                isPlaying
                  ? onPause(Math.round((audioRef.current?.currentTime ?? 0) * 1000))
                  : onPlay()
              )
            )
          }
          title={isPlaying ? "暂停" : "播放"}
          type="button"
        >
          {isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6zm8-14v14h4V5z" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <Button
          variant="ghost"
          size="icon"
          disabled={!canControlPlayback || !playback?.currentTrackId}
          onClick={() => startTransition(() => void onNext())}
          title="下一首"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" />
          </svg>
        </Button>
      </div>

      {/* Center Progress Slider Area */}
      <div className="hidden lg:flex items-center w-full gap-4 px-4">
        <span className="text-xs tabular-nums text-foreground-muted min-w-[40px] text-right">{formatDuration(effectiveProgressMs)}</span>
        <div className="flex-1 flex items-center h-8">
          <Slider 
           value={effectiveProgressMs}
           max={currentTrackDuration || 1}
           disabled={!currentTrackDuration || !canControlPlayback}
           onChange={(event) => setSeekDraft(Number(event.target.value))}
           onMouseUp={() => {
             if (seekDraft !== null && canControlPlayback) {
               startTransition(() => void onSeek(seekDraft));
               setSeekDraft(null);
             }
           }}
           onTouchEnd={() => {
             if (seekDraft !== null && canControlPlayback) {
               startTransition(() => void onSeek(seekDraft));
               setSeekDraft(null);
             }
           }}
          />
        </div>
        <span className="text-xs tabular-nums text-foreground-muted min-w-[40px]">{formatDuration(currentTrackDuration)}</span>
      </div>

      {/* Right Status & Volume */}
      <div className="flex items-center justify-end gap-5 w-full">
        <div className="hidden sm:flex flex-col items-end gap-1">
          {roomSnapshot?.room.playback.sourceSessionId === activeSession?.id ? (
            <span className="text-xs text-accent font-medium text-glow truncate">正在分发给 {mediaConnectedPeersCount} 人</span>
          ) : (
            <span className="text-xs text-foreground-muted truncate">{mediaStatusLabel}</span>
          )}
          {!localTrackAvailable && currentTrackAvailability ? (
            <span className="text-[10px] text-foreground-muted">缓存 {currentTrackAvailability.localChunkCount}/{currentTrackAvailability.totalChunks || 0}</span>
          ) : null}
          {!canControlPlayback && currentTrack ? (
            <span className="text-[10px] text-foreground-muted">当前为成员旁听模式</span>
          ) : null}
        </div>
        
        <div className="flex items-center justify-center gap-3 min-w-[120px]">
          <span className="text-foreground-muted">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.14v7.72A4.49 4.49 0 0016.5 12zM14 3.23v2.06a6.51 6.51 0 010 13.42v2.06A8.51 8.51 0 0014 3.23z" />
            </svg>
          </span>
          <Slider 
           className="w-20"
           value={volume}
           max={1}
           step={0.01}
           onChange={(event) => setVolume(Number(event.target.value))}
          />
        </div>
      </div>

      <audio
        ref={audioRef}
        className="hidden"
        onEnded={() => void onEnded()}
        onTimeUpdate={syncProgressFromAudio}
        onLoadedMetadata={() => {
          syncDurationFromAudio();
          syncProgressFromAudio();
          onLocalPlaybackReady();
        }}
        onDurationChange={syncDurationFromAudio}
        onPlay={() => {
          syncProgressFromAudio();
          onLocalPlaybackReady();
        }}
        onPause={syncProgressFromAudio}
        onSeeked={syncProgressFromAudio}
      />

      <audio
        ref={remoteAudioRef}
        className="hidden"
        autoPlay
        playsInline
        onPlaying={onRemotePlaying}
        onWaiting={onRemoteWaiting}
        onPause={onRemotePause}
        onError={onRemoteError}
      />

      {isPending ? (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-surface backdrop-blur-md border border-surface-border text-foreground-muted text-xs px-3 py-1 rounded-full shadow-lg flex items-center gap-2 animate-fade-in">
          <div className="w-2 h-2 rounded-full bg-accent animate-ping" />
          同步中...
        </div>
      ) : null}
    </footer>
  );
}
