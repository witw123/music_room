"use client";

import {
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from "react";

type LocalAudioPlaybackStateInput = {
  audioRef: RefObject<HTMLAudioElement | null>;
  playbackCurrentTrackId: string | null;
};

export function useLocalAudioPlaybackState({
  audioRef,
  playbackCurrentTrackId
}: LocalAudioPlaybackStateInput): {
  setAudioPaused: Dispatch<SetStateAction<boolean | null>>;
} {
  const [, setAudioPaused] = useState<boolean | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      setAudioPaused(null);
      return;
    }

    const handlePlay = () => setAudioPaused(false);
    const handlePause = () => setAudioPaused(true);
    setAudioPaused(audio.paused);

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [audioRef, playbackCurrentTrackId]);

  return { setAudioPaused };
}
