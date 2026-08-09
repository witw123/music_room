"use client";

import { memo, useEffect } from "react";
import type { AuthSession, PlaybackSnapshot, RoomSnapshot, TrackMeta } from "@music-room/shared";
import { BottomPlayer } from "@/components/BottomPlayer";
import { usePlayerAudioVisualizer } from "@/features/playback/use-player-audio-visualizer";
import { useRoomPlayback } from "@/features/playback/use-room-playback";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import type { RoomPlaybackBarrierClock } from "@/features/playback/room-playback-clock";
import { hasRoomPermission } from "@/features/room/room-permissions";

type BottomPlayerControllerProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isSourceOwner: boolean;
  roomSnapshot: RoomSnapshot | null;
  playbackBarrier?: RoomPlaybackBarrierClock | null;
  activeSession: AuthSession | null;
  currentTrack: TrackMeta | null;
  canSeekPlayback: boolean;
  resetEpoch: number;
  onPlaybackPositionChange: (positionMs: number) => void;
  onVolumeChange: (volume: number) => void;
  onPlay: () => void;
  onPause: (positionMs?: number) => void | Promise<void>;
  onSeek: (positionMs: number) => Promise<PlaybackSnapshot | null>;
  onPrev: () => void;
  onNext: () => void;
  onCyclePlaybackMode: () => void | Promise<void>;
  canReorderQueue: boolean;
  canRemoveQueue: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onPlayNextQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  isLyricsOpen: boolean;
  onToggleLyrics: () => void;
  mobileVariant?: "compact" | "full";
};

function BottomPlayerControllerBase({
  audioRef,
  isSourceOwner,
  roomSnapshot,
  playbackBarrier,
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
  onNext,
  onCyclePlaybackMode,
  canReorderQueue,
  canRemoveQueue,
  onPlayQueueItem,
  onPlayNextQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  isLyricsOpen,
  onToggleLyrics,
  mobileVariant = "full"
}: BottomPlayerControllerProps) {
  const playback = roomSnapshot?.room.playback ?? null;
  const canControlPlayback = hasRoomPermission(
    roomSnapshot,
    activeSession?.userId,
    "player"
  );
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
    getLocalPlaybackPositionMs: undefined,
    playbackBarrier
  });
  const isPlaybackBarrierBlocked = playbackBarrier?.blocked === true;
  const visualizer = usePlayerAudioVisualizer({
    audioRef,
    outputStream: isSourceOwner ? roomAudioOutput.getBroadcastStream() : null,
    playbackStatus: isPlaybackBarrierBlocked && playback?.status === "playing"
      ? "paused"
      : playback?.status,
    currentTrackId: playback?.currentTrackId,
    mediaEpoch: playback?.mediaEpoch ?? null,
    sourcePeerId: playback?.sourcePeerId ?? null,
    sourceSessionId: playback?.sourceSessionId ?? null
  });

  useEffect(() => {
    const barrierPositionMs = playbackBarrier?.holdPositionMs;
    onPlaybackPositionChange(
      isPlaybackBarrierBlocked && typeof barrierPositionMs === "number"
        ? barrierPositionMs
        : progressMs
    );
  }, [isPlaybackBarrierBlocked, playbackBarrier?.holdPositionMs, progressMs, onPlaybackPositionChange]);

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
      mobileVariant={mobileVariant}
      audioRef={audioRef}
      playback={playback}
      playbackBarrier={playbackBarrier}
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
      onCyclePlaybackMode={onCyclePlaybackMode}
      queue={roomSnapshot?.queue ?? []}
      tracks={roomSnapshot?.tracks ?? []}
      currentQueueItemId={playback?.currentQueueItemId ?? null}
      nextQueueItemId={playback?.nextQueueItemId ?? null}
      canReorderQueue={canReorderQueue}
      canRemoveQueue={canRemoveQueue}
      onPlayQueueItem={onPlayQueueItem}
      onPlayNextQueueItem={onPlayNextQueueItem}
      onRemoveQueueItem={onRemoveQueueItem}
      onReorderQueue={onReorderQueue}
      isLyricsOpen={isLyricsOpen}
      onToggleLyrics={onToggleLyrics}
    />
  );
}

export const BottomPlayerController = memo(BottomPlayerControllerBase);
