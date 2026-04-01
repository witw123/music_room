"use client";

import { useTransition } from "react";
import type { AuthSession, RoomMediaConnectionState, RoomSnapshot, TrackMeta } from "@music-room/shared";
import {
  DesktopBottomPlayerLayout,
  MobileBottomPlayerLayout
} from "@/components/bottom-player/bottom-player-layout";

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
  const title = currentTrack?.title ?? "等待选择歌曲";
  const artist = currentTrack?.artist ?? "从曲库或共享队列中选择一首歌";

  const commitSeek = () => {
    if (seekDraft !== null && canControlPlayback) {
      startTransition(() => void onSeek(seekDraft));
      setSeekDraft(null);
    }
  };

  const applyVolume = (nextVolume: number) => {
    setVolume(nextVolume);

    if (audioRef.current) {
      audioRef.current.volume = nextVolume;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = nextVolume;
    }
  };

  const togglePlayback = () => {
    startTransition(() => void (isPlaying ? onPause() : onPlay()));
  };

  const playPrev = () => startTransition(() => void onPrev());
  const playNext = () => startTransition(() => void onNext());

  void uploadedTracks;
  void currentTrackAvailability;
  void mediaConnectionState;
  void mediaConnectedPeersCount;

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 border-t border-surface-border bg-background-secondary/90 px-3 pb-[calc(env(safe-area-inset-bottom)+0.45rem)] pt-2 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:px-4 lg:px-8 lg:pb-[calc(env(safe-area-inset-bottom)+0.55rem)] lg:pt-2.5">
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-white/5" aria-hidden="true">
        <div
          className="h-full bg-gradient-to-r from-accent to-blue-400 shadow-[0_0_10px_rgba(0,112,243,0.6)]"
          style={{ width: `${progressRatio * 100}%` }}
        />
      </div>

      <MobileBottomPlayerLayout
        isPlaying={isPlaying}
        canControlPlayback={canControlPlayback}
        playbackTrackId={playback?.currentTrackId}
        title={title}
        artist={artist}
        boundedProgressMs={boundedProgressMs}
        currentTrackDuration={currentTrackDuration}
        volume={volume}
        setSeekDraft={setSeekDraft}
        commitSeek={commitSeek}
        applyVolume={applyVolume}
        onPrev={playPrev}
        onNext={playNext}
        onTogglePlay={togglePlayback}
      />

      <DesktopBottomPlayerLayout
        isPlaying={isPlaying}
        canControlPlayback={canControlPlayback}
        playbackTrackId={playback?.currentTrackId}
        title={title}
        artist={artist}
        boundedProgressMs={boundedProgressMs}
        currentTrackDuration={currentTrackDuration}
        volume={volume}
        setSeekDraft={setSeekDraft}
        commitSeek={commitSeek}
        applyVolume={applyVolume}
        onPrev={playPrev}
        onNext={playNext}
        onTogglePlay={togglePlayback}
      />

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
