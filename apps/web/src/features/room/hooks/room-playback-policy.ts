"use client";

import type { PlaybackSnapshot } from "@music-room/shared";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";

export function shouldMaintainRemotePlaybackSurface(input: {
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: PlaybackSnapshot["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  sourcePeerId: string | null | undefined;
  localPeerId: string | null | undefined;
  hasRemoteSrcObject?: boolean;
}) {
  if (input.isCurrentSourceOwner) {
    return false;
  }

  if (!input.currentTrackId || !input.sourcePeerId) {
    return (
      !!input.hasRemoteSrcObject &&
      (input.playbackStatus === "playing" ||
        input.playbackStatus === "paused" ||
        input.playbackStatus === "buffering")
    );
  }

  if (input.sourcePeerId === input.localPeerId) {
    return false;
  }

  if (
    input.activePlaybackSource !== "remote-stream" &&
    !input.hasRemoteSrcObject
  ) {
    return false;
  }

  return (
    input.playbackStatus === "playing" ||
    input.playbackStatus === "paused" ||
    input.playbackStatus === "buffering"
  );
}
