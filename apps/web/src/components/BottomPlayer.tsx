"use client";

import { memo, useCallback, useTransition } from "react";
import type { PlaybackSnapshot, TrackMeta } from "@music-room/shared";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { getPlaybackEffectivePositionMs } from "@/features/playback/use-room-playback";
import {
  DesktopBottomPlayerLayout,
  MobileBottomPlayerLayout
} from "@/components/bottom-player/bottom-player-layout";

type BottomPlayerProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
  playback: PlaybackSnapshot | null;
  canControlPlayback: boolean;
  progressMs: number;
  seekDraft: number | null;
  setSeekDraft: (v: number | null) => void;
  audioDurationMs: number;
  volume: number;
  setVolume: (v: number) => void;
  syncProgressFromAudio: () => void;
  syncDurationFromAudio: () => void;
  currentTrack: TrackMeta | null;
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

function BottomPlayerBase({
  audioRef,
  remoteAudioRef,
  playback,
  canControlPlayback,
  progressMs,
  seekDraft,
  setSeekDraft,
  audioDurationMs,
  volume,
  setVolume,
  syncProgressFromAudio,
  syncDurationFromAudio,
  currentTrack,
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
  const isPlaying = playback?.status === "playing";
  const currentTrackDuration = audioDurationMs;
  const snapshotProgressMs =
    playback?.currentTrackId && seekDraft === null
      ? getPlaybackEffectivePositionMs(playback, currentTrackDuration)
      : null;
  const effectiveProgressMs = Math.max(0, seekDraft ?? snapshotProgressMs ?? progressMs);
  const boundedProgressMs =
    currentTrackDuration > 0
      ? Math.min(effectiveProgressMs, currentTrackDuration)
      : effectiveProgressMs;
  const progressRatio =
    currentTrackDuration > 0 ? Math.min(boundedProgressMs / currentTrackDuration, 1) : 0;
  const title = currentTrack?.title ?? "等待选择歌曲";
  const artist = currentTrack?.artist ?? "从曲库或共享队列中选择一首歌";

  const commitSeek = useCallback(() => {
    if (seekDraft !== null && canControlPlayback) {
      startTransition(() => void onSeek(seekDraft));
      setSeekDraft(null);
    }
  }, [canControlPlayback, onSeek, seekDraft, setSeekDraft, startTransition]);

  const applyVolume = useCallback(
    (nextVolume: number) => {
      setVolume(nextVolume);
      roomAudioOutput.applyVolume({
        localAudio: audioRef.current,
        remoteAudio: remoteAudioRef.current,
        volume: nextVolume
      });
    },
    [audioRef, remoteAudioRef, setVolume]
  );

  const togglePlayback = useCallback(() => {
    startTransition(() => void (isPlaying ? onPause() : onPlay()));
  }, [isPlaying, onPause, onPlay, startTransition]);

  const playPrev = useCallback(() => {
    startTransition(() => void onPrev());
  }, [onPrev, startTransition]);

  const playNext = useCallback(() => {
    startTransition(() => void onNext());
  }, [onNext, startTransition]);

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

export const BottomPlayer = memo(BottomPlayerBase);
