"use client";

import { memo, useEffect } from "react";
import type { AuthSession, RoomSnapshot, TrackMeta } from "@music-room/shared";
import { BottomPlayer } from "@/components/BottomPlayer";
import { usePlayerAudioVisualizer } from "@/features/playback/use-player-audio-visualizer";
import { useRoomPlayback } from "@/features/playback/use-room-playback";
import { roomAudioOutput } from "@/features/playback/room-audio-output";

type BottomPlayerControllerProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isSourceOwner: boolean;
  roomSnapshot: RoomSnapshot | null;
  activeSession: AuthSession | null;
  currentTrack: TrackMeta | null;
  canSeekPlayback: boolean;
  resetEpoch: number;
  onPlaybackPositionChange: (positionMs: number) => void;
  onVolumeChange: (volume: number) => void;
  onPlay: () => void;
  onPause: (positionMs?: number) => void | Promise<void>;
  onSeek: (positionMs: number) => void | Promise<void>;
  onPrev: () => void;
  onNext: () => void;
};

function BottomPlayerControllerBase({
  audioRef,
  isSourceOwner,
  roomSnapshot,
  activeSession,
  currentTrack,
  canSeekPlayback,
  resetEpoch,
  onPlaybackPositionChange,
  onVolumeChange,
  onPlay,
  onPause,
  onSeek,
  onPrev,
  onNext
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
    getLocalPlaybackPositionMs: undefined
  });
  const visualizer = usePlayerAudioVisualizer({
    audioRef,
    outputStream: isSourceOwner ? roomAudioOutput.getBroadcastStream() : null,
    playbackStatus: playback?.status,
    currentTrackId: playback?.currentTrackId,
    mediaEpoch: playback?.mediaEpoch ?? null,
    sourcePeerId: playback?.sourcePeerId ?? null,
    sourceSessionId: playback?.sourceSessionId ?? null
  });

  useEffect(() => {
    onPlaybackPositionChange(progressMs);
  }, [progressMs, onPlaybackPositionChange]);

  useEffect(() => {
    onVolumeChange(volume);
  }, [volume, onVolumeChange]);

  useEffect(() => {
    setProgressMs(0);
    setAudioDurationMs(0);
    setSeekDraft(null);
    onPlaybackPositionChange(0);
  }, [
    resetEpoch,
    setProgressMs,
    setAudioDurationMs,
    setSeekDraft,
    onPlaybackPositionChange
  ]);

  return (
    <BottomPlayer
      audioRef={audioRef}
      playback={playback}
      canControlPlayback={canControlPlayback}
      canSeekPlayback={canSeekPlayback}
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
    />
  );
}

export const BottomPlayerController = memo(BottomPlayerControllerBase);
