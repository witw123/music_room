import type { PlaybackSnapshot } from "@music-room/shared";

export function isCurrentPlaybackSourceDevice(input: {
  playback: PlaybackSnapshot | null | undefined;
  peerId: string | null | undefined;
  activeSessionId: string | null | undefined;
  sourcePeerId?: string | null;
}) {
  const playback = input.playback;
  if (!playback?.currentTrackId) {
    return false;
  }

  const sourcePeerId = input.sourcePeerId ?? playback.sourcePeerId;
  if (input.peerId && sourcePeerId) {
    return sourcePeerId === input.peerId;
  }

  return Boolean(input.activeSessionId && playback.sourceSessionId === input.activeSessionId);
}
