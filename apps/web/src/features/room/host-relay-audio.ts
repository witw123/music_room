"use client";

import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";

export function resolveHostRelayAudioElement(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  localAudio: HTMLAudioElement | null;
  remoteAudio: HTMLAudioElement | null;
}) {
  if (input.activePlaybackSource === "remote-stream") {
    return input.remoteAudio ?? input.localAudio;
  }

  return input.localAudio ?? input.remoteAudio;
}
