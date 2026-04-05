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

export function isHostRelayAudioReadyForCapture(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  relayAudio: Pick<HTMLAudioElement, "currentSrc" | "src">;
  currentTrackObjectUrl: string | null | undefined;
}) {
  if (input.activePlaybackSource !== "full-local" || !input.currentTrackObjectUrl) {
    return true;
  }

  const currentMediaSrc = input.relayAudio.currentSrc || input.relayAudio.src || null;
  return currentMediaSrc === input.currentTrackObjectUrl;
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
