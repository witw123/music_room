"use client";

import React, { memo, useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { PlaybackSnapshot, TrackMeta } from "@music-room/shared";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { PlayerTopWaveform } from "@/components/bottom-player/PlayerTopWaveform";
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
  visualizerSamples: number[];
  visualizerReducedMotion: boolean;
  visualizerMaxDevicePixelRatio?: number;
  onPlay: () => void;
  onPause: (positionMs?: number) => void | Promise<void>;
  onSeek: (positionMs: number) => void | Promise<void>;
  onPrev: () => void;
  onNext: () => void;
  onEnded: () => void;
  onLocalPlaybackReady: () => void;
  onRemotePlaying: () => void;
  onRemoteWaiting: () => void;
  onRemotePause: () => void;
  onRemoteError: () => void;
};

function clampProgressMs(progressMs: number, durationMs: number) {
  return durationMs > 0
    ? Math.min(Math.max(0, progressMs), durationMs)
    : Math.max(0, progressMs);
}

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
  visualizerSamples,
  visualizerReducedMotion,
  visualizerMaxDevicePixelRatio,
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
  const [renderedProgressMs, setRenderedProgressMs] = useState(progressMs);
  const progressAnchorRef = useRef({
    progressMs,
    receivedAtMs: Date.now()
  });
  const isPlaying = playback?.status === "playing";
  const currentTrackDuration = audioDurationMs;
  const effectiveProgressMs = Math.max(0, seekDraft ?? renderedProgressMs);
  const boundedProgressMs =
    currentTrackDuration > 0
      ? Math.min(effectiveProgressMs, currentTrackDuration)
      : effectiveProgressMs;
  const progressRatio =
    currentTrackDuration > 0 ? Math.min(boundedProgressMs / currentTrackDuration, 1) : 0;
  const title = currentTrack?.title ?? "等待选择歌曲";
  const artist = currentTrack?.artist ?? "从曲库或共享队列中选择一首歌";

  useEffect(() => {
    progressAnchorRef.current = {
      progressMs,
      receivedAtMs: Date.now()
    };

    if (seekDraft !== null || !isPlaying) {
      setRenderedProgressMs(clampProgressMs(progressMs, currentTrackDuration));
    }
  }, [currentTrackDuration, isPlaying, progressMs, seekDraft]);

  useEffect(() => {
    if (seekDraft !== null || !isPlaying) {
      return;
    }

    let frameId = 0;
    const render = () => {
      const elapsedMs = Math.max(0, Date.now() - progressAnchorRef.current.receivedAtMs);
      const nextProgressMs = clampProgressMs(
        progressAnchorRef.current.progressMs + elapsedMs,
        currentTrackDuration
      );
      setRenderedProgressMs((current) =>
        Math.abs(current - nextProgressMs) >= 16 ? nextProgressMs : current
      );
      frameId = window.requestAnimationFrame(render);
    };

    frameId = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [currentTrackDuration, isPlaying, seekDraft]);

  const commitSeek = useCallback(() => {
    if (seekDraft !== null && canControlPlayback) {
      const targetPositionMs = clampProgressMs(seekDraft, currentTrackDuration);
      setRenderedProgressMs(targetPositionMs);
      progressAnchorRef.current = {
        progressMs: targetPositionMs,
        receivedAtMs: Date.now()
      };
      startTransition(() => {
        void Promise.resolve(onSeek(targetPositionMs)).finally(() => {
          setSeekDraft(null);
        });
      });
    }
  }, [canControlPlayback, currentTrackDuration, onSeek, seekDraft, setSeekDraft, startTransition]);

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
    void (isPlaying ? onPause(boundedProgressMs) : onPlay());
  }, [boundedProgressMs, isPlaying, onPause, onPlay]);

  const playPrev = useCallback(() => {
    void onPrev();
  }, [onPrev]);

  const playNext = useCallback(() => {
    void onNext();
  }, [onNext]);

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 flex flex-col justify-center min-h-[6.5rem] border-t border-surface-border bg-background-secondary/90 px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.3rem)] pt-4 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:px-4 lg:min-h-[4.5rem] lg:px-8 lg:pb-[calc(env(safe-area-inset-bottom)_+_0.2rem)] lg:pt-4">
      <PlayerTopWaveform
        samples={visualizerSamples}
        isPlaying={!!isPlaying}
        progressRatio={progressRatio}
        reducedMotion={visualizerReducedMotion}
        maxDevicePixelRatio={visualizerMaxDevicePixelRatio}
      />

      <div className="absolute left-0 right-0 top-[12px] h-[2px] bg-white/5 lg:top-[14px]" aria-hidden="true">
        <div
          className="h-full bg-gradient-to-r from-accent to-blue-400 shadow-[0_0_10px_rgba(0,112,243,0.6)] transition-[width] duration-150 ease-linear"
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
        autoPlay
        playsInline
        onEnded={() => void onEnded()}
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
        onLoadedMetadata={() => {
          syncDurationFromAudio();
          syncProgressFromAudio();
        }}
        onDurationChange={syncDurationFromAudio}
        onPlaying={() => {
          syncProgressFromAudio();
          onRemotePlaying();
        }}
        onWaiting={onRemoteWaiting}
        onPause={() => {
          syncProgressFromAudio();
          onRemotePause();
        }}
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
