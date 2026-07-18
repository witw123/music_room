"use client";

import { useRef, useState } from "react";
import { BottomPlayer } from "@/components/BottomPlayer";

export function AppPersistentPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);

  return (
    <BottomPlayer
      audioRef={audioRef}
      playback={null}
      canControlPlayback={false}
      canSeekPlayback={false}
      progressMs={0}
      seekDraft={seekDraft}
      setSeekDraft={setSeekDraft}
      audioDurationMs={0}
      volume={volume}
      setVolume={setVolume}
      syncProgressFromAudio={() => undefined}
      syncDurationFromAudio={() => undefined}
      currentTrack={null}
      visualizerSamples={[]}
      visualizerReducedMotion={true}
      onPlay={() => undefined}
      onPause={() => undefined}
      onSeek={async () => null}
      onPrev={() => undefined}
      onNext={() => undefined}
      onCyclePlaybackMode={() => undefined}
      queue={[]}
      tracks={[]}
      currentQueueItemId={null}
      canReorderQueue={false}
      onPlayQueueItem={async () => undefined}
      onRemoveQueueItem={async () => undefined}
      onReorderQueue={async () => undefined}
    />
  );
}
