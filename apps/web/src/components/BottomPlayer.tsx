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
  onPause: (positionMs?: number) => void;
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
      return "正在连接";
    case "buffering":
      return "正在缓冲";
    case "live":
      return "房间音频已接入";
    case "reconnecting":
      return "重新连接中";
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
  const sourceOwnedByMe = roomSnapshot?.room.playback.sourceSessionId === activeSession?.id;

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 border-t border-surface-border bg-background-secondary/88 px-4 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] pt-4 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all lg:grid lg:grid-cols-[1.5fr_auto_2fr_1.5fr] lg:items-center lg:gap-6 lg:px-8">
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-white/5" aria-hidden="true">
        <div
          className="h-full bg-gradient-to-r from-accent to-blue-400 shadow-[0_0_10px_rgba(0,112,243,0.6)] transition-all duration-300 ease-linear"
          style={{ width: `${progressRatio * 100}%` }}
        />
      </div>

      <div className="flex items-center gap-3 lg:min-w-0">
        <div
          className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-lg sm:h-14 sm:w-14 ${
            isPlaying ? "animate-spin-slow rounded-full border-accent/30 shadow-accent/20" : "transition-all duration-700"
          }`}
        >
          {currentTrack?.artworkUrl ? (
            <img src={currentTrack.artworkUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface to-surface-hover">
              <div className="h-3 w-3 rounded-full border-2 border-accent/20" />
            </div>
          )}
          {isPlaying ? <div className="absolute inset-0 rounded-full border border-white/10" /> : null}
        </div>

        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
            {isPlaying ? "正在播放" : "已暂停"}
          </p>
          <h3 className="truncate text-sm font-semibold text-foreground sm:text-base">
            {currentTrack?.title ?? "等待选择歌曲"}
          </h3>
          <p className="truncate text-xs text-foreground-muted sm:text-sm">
            {currentTrack?.artist ?? "从曲库或共享队列中选择一首歌"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4 lg:mt-0">
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
          className={`inline-grid h-12 w-12 place-items-center rounded-full outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-14 sm:w-14 ${
            canControlPlayback
              ? "bg-foreground text-background shadow-xl hover:scale-105 active:scale-95"
              : "cursor-not-allowed bg-surface text-foreground-muted opacity-50"
          }`}
          disabled={!canControlPlayback}
          onClick={() =>
            startTransition(() =>
              void (
                isPlaying
                  ? onPause()
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

      <div className="mt-4 flex items-center gap-3 lg:hidden">
        <span className="min-w-[42px] text-right text-xs tabular-nums text-foreground-muted">
          {formatDuration(effectiveProgressMs)}
        </span>
        <div className="flex-1">
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
        <span className="min-w-[42px] text-xs tabular-nums text-foreground-muted">
          {formatDuration(currentTrackDuration)}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-3 lg:mt-0 lg:w-full">
        <div className="flex items-center justify-between gap-3 text-xs lg:hidden">
          <span className={`truncate ${sourceOwnedByMe ? "text-accent" : "text-foreground-muted"}`}>
            {sourceOwnedByMe ? `正在分发给 ${mediaConnectedPeersCount} 人` : mediaStatusLabel}
          </span>
          {!localTrackAvailable && currentTrackAvailability ? (
            <span className="shrink-0 text-foreground-muted">
              缓存 {currentTrackAvailability.localChunkCount}/{currentTrackAvailability.totalChunks || 0}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3 lg:justify-end">
          <div className="hidden w-full items-center gap-4 px-4 lg:flex">
            <span className="min-w-[40px] text-right text-xs tabular-nums text-foreground-muted">
              {formatDuration(effectiveProgressMs)}
            </span>
            <div className="flex h-8 flex-1 items-center">
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
            <span className="min-w-[40px] text-xs tabular-nums text-foreground-muted">
              {formatDuration(currentTrackDuration)}
            </span>
          </div>

          <div className="hidden flex-col items-end gap-1 lg:flex">
            {sourceOwnedByMe ? (
              <span className="truncate text-xs font-medium text-accent">
                正在分发给 {mediaConnectedPeersCount} 人
              </span>
            ) : (
              <span className="truncate text-xs text-foreground-muted">{mediaStatusLabel}</span>
            )}
            {!localTrackAvailable && currentTrackAvailability ? (
              <span className="text-[10px] text-foreground-muted">
                缓存 {currentTrackAvailability.localChunkCount}/{currentTrackAvailability.totalChunks || 0}
              </span>
            ) : null}
            {!canControlPlayback && currentTrack ? (
              <span className="text-[10px] text-foreground-muted">当前为成员旁听模式</span>
            ) : null}
          </div>

          <div className="flex min-w-[132px] items-center justify-center gap-3 sm:min-w-[160px]">
            <span className="text-foreground-muted">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.14v7.72A4.49 4.49 0 0016.5 12zM14 3.23v2.06a6.51 6.51 0 010 13.42v2.06A8.51 8.51 0 0014 3.23z" />
              </svg>
            </span>
            <Slider
              className="w-full max-w-[110px] sm:max-w-[140px]"
              value={volume}
              max={1}
              step={0.01}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </div>
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
        onTimeUpdate={syncProgressFromAudio}
        onLoadedMetadata={syncDurationFromAudio}
        onDurationChange={syncDurationFromAudio}
        onPlaying={onRemotePlaying}
        onWaiting={onRemoteWaiting}
        onPause={onRemotePause}
        onSeeked={syncProgressFromAudio}
        onError={onRemoteError}
      />

      {isPending ? (
        <div className="animate-fade-in absolute -top-8 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-surface-border bg-surface px-3 py-1 text-xs text-foreground-muted shadow-lg backdrop-blur-md">
          <div className="h-2 w-2 rounded-full bg-accent animate-ping" />
          同步中...
        </div>
      ) : null}
    </footer>
  );
}
