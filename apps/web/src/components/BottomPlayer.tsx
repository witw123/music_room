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
      return "房间音频已接通";
    case "reconnecting":
      return "正在重新连接";
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
  const effectiveProgressMs = Math.max(0, seekDraft ?? progressMs);
  const currentTrackDuration = audioDurationMs;
  const boundedProgressMs =
    currentTrackDuration > 0 ? Math.min(effectiveProgressMs, currentTrackDuration) : effectiveProgressMs;
  const progressRatio =
    currentTrackDuration > 0 ? Math.min(boundedProgressMs / currentTrackDuration, 1) : 0;
  const localTrackAvailable = !!uploadedTracks[currentTrack?.id ?? ""];
  const mediaStatusLabel = getMediaStatusLabel(mediaConnectionState);
  const sourceOwnedByMe = roomSnapshot?.room.playback.sourceSessionId === activeSession?.userId;

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 border-t border-surface-border bg-background-secondary/88 px-4 pb-[calc(env(safe-area-inset-bottom)+0.6rem)] pt-2.5 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.45fr)] lg:items-center lg:gap-4 lg:px-8 lg:pb-[calc(env(safe-area-inset-bottom)+0.55rem)] lg:pt-2.5">
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-white/5" aria-hidden="true">
        <div
          className="h-full bg-gradient-to-r from-accent to-blue-400 shadow-[0_0_10px_rgba(0,112,243,0.6)] transition-all duration-300 ease-linear"
          style={{ width: `${progressRatio * 100}%` }}
        />
      </div>

      <div className="flex items-center gap-3 lg:min-w-0">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center sm:h-12 sm:w-12">
          <div
            className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-all duration-700 ${
              isPlaying ? "animate-spin-slow" : ""
            }`}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.1),transparent_40%)]" />
            <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,rgba(0,112,243,0.1)_0deg,rgba(0,0,0,0)_90deg,rgba(0,112,243,0.1)_180deg,rgba(0,0,0,0)_270deg,rgba(0,112,243,0.1)_360deg)]" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="absolute rounded-full border border-white/[0.03]"
                style={{ width: `${100 - index * 18}%`, height: `${100 - index * 18}%` }}
              />
            ))}
            <div className="relative z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-accent/20 bg-gradient-to-br from-accent/20 to-blue-500/20 shadow-inner sm:h-4 sm:w-4">
              <div className="h-1.5 w-1.5 rounded-full border border-white/5 bg-black shadow-inner" />
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.22em] text-accent">
            {isPlaying ? "正在播放" : "已暂停"}
          </p>
          <div className="min-h-[2.2rem]">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {currentTrack?.title ?? "等待选择歌曲"}
            </h3>
            <p className="truncate text-[11px] text-foreground-muted sm:text-xs">
              {currentTrack?.artist ?? "从曲库或共享队列中选择一首歌"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-center gap-3 lg:mt-0">
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
          className={`inline-grid h-11 w-11 place-items-center rounded-full outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-12 sm:w-12 ${
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

      <div className="mt-2.5 flex items-center gap-3 lg:hidden">
        <span className="min-w-[42px] text-right text-xs tabular-nums text-foreground-muted">
          {formatDuration(boundedProgressMs)}
        </span>
        <div className="flex-1">
          <Slider
            value={boundedProgressMs}
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

      <div className="mt-2 flex flex-col gap-2.5 lg:mt-0 lg:w-full">
        <div className="flex min-h-[1rem] items-center justify-between gap-3 text-xs lg:hidden">
          <span className="truncate text-foreground-muted">
            {!sourceOwnedByMe ? mediaStatusLabel : ""}
          </span>
          {!localTrackAvailable && currentTrackAvailability ? (
            <span className="shrink-0 text-foreground-muted">
              缓存 {currentTrackAvailability.localChunkCount}/{currentTrackAvailability.totalChunks || 0}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2.5 lg:justify-end">
          <div className="hidden w-full items-center gap-4 lg:flex">
            <span className="min-w-[40px] text-right text-xs tabular-nums text-foreground-muted">
              {formatDuration(boundedProgressMs)}
            </span>
            <div className="flex h-8 flex-1 items-center">
              <Slider
                value={boundedProgressMs}
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

          <div className="flex min-w-[118px] items-center justify-center gap-3 sm:min-w-[146px]">
            <span className="text-foreground-muted">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.14v7.72A4.49 4.49 0 0016.5 12zM14 3.23v2.06a6.51 6.51 0 010 13.42v2.06A8.51 8.51 0 0014 3.23z" />
              </svg>
            </span>
            <Slider
              className="w-full max-w-[98px] sm:max-w-[124px]"
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
          <div className="h-2 w-2 animate-ping rounded-full bg-accent" />
          同步中...
        </div>
      ) : null}
    </footer>
  );
}
