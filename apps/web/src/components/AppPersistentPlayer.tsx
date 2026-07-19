"use client";

import { BottomPlayer } from "@/components/BottomPlayer";
import { useLocalPlayer } from "@/features/playback/local-player-context";

export function AppPersistentPlayer() {
  const player = useLocalPlayer();

  return (
    <BottomPlayer
      audioRef={player.audioRef}
      playback={player.playback}
      canControlPlayback={player.canControlPlayback}
      canSeekPlayback={player.canSeekPlayback}
      progressMs={player.progressMs}
      seekDraft={player.seekDraft}
      setSeekDraft={player.setSeekDraft}
      audioDurationMs={player.audioDurationMs}
      volume={player.volume}
      setVolume={player.setVolume}
      syncProgressFromAudio={player.syncProgressFromAudio}
      syncDurationFromAudio={player.syncDurationFromAudio}
      currentTrack={player.currentTrack}
      visualizerSamples={[]}
      visualizerReducedMotion={true}
      onPlay={player.onPlay}
      onPause={player.onPause}
      onSeek={player.onSeek}
      onPrev={player.onPrev}
      onNext={player.onNext}
      onCyclePlaybackMode={player.onCyclePlaybackMode}
      queue={player.queue}
      tracks={player.tracks}
      currentQueueItemId={player.currentQueueItemId}
      canReorderQueue={true}
      onPlayQueueItem={player.onPlayQueueItem}
      onRemoveQueueItem={player.onRemoveQueueItem}
      onReorderQueue={player.onReorderQueue}
    />
  );
}
