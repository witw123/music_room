"use client";

import { memo, useEffect } from "react";
import type { AuthSession, RoomSnapshot, TrackMeta } from "@music-room/shared";
import { BottomPlayer } from "@/components/BottomPlayer";
import { useRoomPlayback } from "@/features/playback/use-room-playback";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";

type BottomPlayerControllerProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
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

function BottomPlayerControllerBase({
  audioRef,
  remoteAudioRef,
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
  onLocalPlaybackReady,
  onRemotePlaying,
  onRemoteWaiting,
  onRemotePause,
  onRemoteError
}: BottomPlayerControllerProps) {
  const playback = roomSnapshot?.room.playback ?? null;
  const shouldUseLocalAudio = activePlaybackSource !== "remote-stream";
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
    remoteAudioRef,
    playback,
    tracks: roomSnapshot?.tracks ?? [],
    shouldUseLocalAudio,
    activePlaybackSource,
    getLocalPlaybackPositionMs
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
      remoteAudioRef={remoteAudioRef}
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
      onPlay={onPlay}
      onPause={onPause}
      onSeek={onSeek}
      onPrev={onPrev}
      onNext={onNext}
      onEnded={onEnded}
      onLocalPlaybackReady={onLocalPlaybackReady}
      onRemotePlaying={onRemotePlaying}
      onRemoteWaiting={onRemoteWaiting}
      onRemotePause={onRemotePause}
      onRemoteError={onRemoteError}
    />
  );
}

export const BottomPlayerController = memo(BottomPlayerControllerBase);
