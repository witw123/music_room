import type { PlaybackSnapshot } from "@music-room/shared";

export function isCurrentPlaybackSourceDevice(input: {
  playback: PlaybackSnapshot | null | undefined;
  peerId: string | null | undefined;
  activeSessionId: string | null | undefined;
}) {
  const playback = input.playback;
  if (!playback?.currentTrackId) {
    return false;
  }

  if (input.peerId && playback.sourcePeerId) {
    return playback.sourcePeerId === input.peerId;
  }

  return Boolean(input.activeSessionId && playback.sourceSessionId === input.activeSessionId);
}
