import type { ProgressivePlaybackSource } from "./progressive-playback";

export function hasHostMediaStreamTrack(stream: MediaStream | null | undefined) {
  return !!stream && stream.getAudioTracks().length > 0;
}

export function buildHostCaptureRefreshKey(input: {
  currentTrackId: string | null | undefined;
  mediaEpoch: number;
  activePlaybackSource: ProgressivePlaybackSource;
}) {
  if (!input.currentTrackId) {
    return null;
  }

  return `${input.currentTrackId}|${input.mediaEpoch}|${input.activePlaybackSource}`;
}

export function resolveHostCaptureRefresh(input: {
  currentTrackId: string | null | undefined;
  mediaEpoch: number;
  activePlaybackSource: ProgressivePlaybackSource;
  lastCaptureRefreshKey: string | null | undefined;
}) {
  const captureRefreshKey = buildHostCaptureRefreshKey(input);
  return {
    captureRefreshKey,
    forceRefresh:
      captureRefreshKey !== null && captureRefreshKey !== (input.lastCaptureRefreshKey ?? null)
  };
}

export function shouldDeferHostMediaStreamSync(input: {
  stream: MediaStream | null | undefined;
  listenerPeerCount: number;
  playbackStatus: "playing" | "paused" | "idle";
}) {
  return (
    input.playbackStatus === "playing" &&
    input.listenerPeerCount > 0 &&
    !hasHostMediaStreamTrack(input.stream)
  );
}
