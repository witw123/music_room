"use client";

import { memo, useEffect } from "react";
import type { AuthSession, RoomSnapshot, TrackMeta } from "@music-room/shared";
import { BottomPlayer } from "@/components/BottomPlayer";
import { usePlayerAudioVisualizer } from "@/features/playback/use-player-audio-visualizer";
import { useRoomPlayback } from "@/features/playback/use-room-playback";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";

type BottomPlayerControllerProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  roomSnapshot: RoomSnapshot | null;
  activeSession: AuthSession | null;
  currentTrack: TrackMeta | null;
  activePlaybackSource: ProgressivePlaybackSource;
  resetEpoch: number;
  onPlaybackPositionChange: (positionMs: number) => void;
  onPlaybackBucketChange: (bucketMs: number) => void;
  onVolumeChange: (volume: number) => void;
  getLocalPlaybackPositionMs?: () => number | null;
  onPlay: () => void;
  onPause: (positionMs?: number) => void | Promise<void>;
  onSeek: (positionMs: number) => void | Promise<void>;
  onPrev: () => void;
  onNext: () => void;
  onEnded: () => void;
  onLocalPlaybackReady: () => void;
};

function BottomPlayerControllerBase({
  audioRef,
  roomSnapshot,
  activeSession,
  currentTrack,
  activePlaybackSource,
  resetEpoch,
  onPlaybackPositionChange,
  onPlaybackBucketChange,
  onVolumeChange,
  getLocalPlaybackPositionMs,
  onPlay,
  onPause,
  onSeek,
  onPrev,
  onNext,
  onEnded,
  onLocalPlaybackReady
}: BottomPlayerControllerProps) {
  const playback = roomSnapshot?.room.playback ?? null;
  const canControlPlayback = !!activeSession && !!roomSnapshot;
  const {
    progressTrack,
    progressMs,
    setProgressMs,
    seekDraft,
    setSeekDraft,
    audioDurationMs,
    setAudioDurationMs,
    volume,
    setVolume,
    syncProgressFromAudio,
    syncDurationFromAudio
  } = useRoomPlayback({
    audioRef,
    playback,
    tracks: roomSnapshot?.tracks ?? [],
    shouldUseLocalAudio: true,
    activePlaybackSource,
    getLocalPlaybackPositionMs
  });
  const visualizer = usePlayerAudioVisualizer({
    audioRef,
    activePlaybackSource,
    playbackStatus: playback?.status,
    currentTrackId: playback?.currentTrackId,
    mediaEpoch: playback?.mediaEpoch ?? null,
    sourcePeerId: playback?.sourcePeerId ?? null,
    sourceSessionId: playback?.sourceSessionId ?? null
  });

  useEffect(() => {
    onPlaybackPositionChange(progressMs);
    onPlaybackBucketChange(Math.floor(progressMs / 4_000) * 4_000);
  }, [progressMs, onPlaybackPositionChange, onPlaybackBucketChange]);

  useEffect(() => {
    onVolumeChange(volume);
  }, [volume, onVolumeChange]);

  useEffect(() => {
    setProgressMs(0);
    setAudioDurationMs(0);
    setSeekDraft(null);
    onPlaybackPositionChange(0);
    onPlaybackBucketChange(0);
  }, [
    resetEpoch,
    setProgressMs,
    setAudioDurationMs,
    setSeekDraft,
    onPlaybackPositionChange,
    onPlaybackBucketChange
  ]);

  return (
    <BottomPlayer
      audioRef={audioRef}
      playback={playback}
      canControlPlayback={canControlPlayback}
      progressMs={progressMs}
      seekDraft={seekDraft}
      setSeekDraft={setSeekDraft}
      audioDurationMs={audioDurationMs || progressTrack?.durationMs || currentTrack?.durationMs || 0}
      volume={volume}
      setVolume={setVolume}
      syncProgressFromAudio={syncProgressFromAudio}
      syncDurationFromAudio={syncDurationFromAudio}
      currentTrack={progressTrack ?? currentTrack}
      visualizerSamples={visualizer.samples}
      visualizerReducedMotion={visualizer.reducedMotion}
      visualizerMaxDevicePixelRatio={visualizer.maxDevicePixelRatio}
      onPlay={onPlay}
      onPause={onPause}
      onSeek={onSeek}
      onPrev={onPrev}
      onNext={onNext}
      onEnded={onEnded}
      onLocalPlaybackReady={onLocalPlaybackReady}
    />
  );
}

export const BottomPlayerController = memo(BottomPlayerControllerBase);
