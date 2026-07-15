import type { PlaybackSnapshot } from "@music-room/shared";

export type PlaybackMediaSession = {
  sessionKey: string;
  trackId: string;
  playbackAssetId: string;
  mediaEpoch: number;
  playbackRevision: number;
  startAt: string | null;
  sourcePeerId: string | null;
  outputTrackId: string | null;
  remoteTrackId: string | null;
};

export function createPlaybackMediaSessionKey(input: {
  trackId: string | null | undefined;
  playbackAssetId: string | null | undefined;
  mediaEpoch: number | null | undefined;
  playbackRevision: number | null | undefined;
  startAt: string | null | undefined;
  sourcePeerId: string | null | undefined;
  remoteTrackId?: string | null | undefined;
}) {
  return [
    input.trackId ?? "none",
    input.playbackAssetId ?? "none",
    input.mediaEpoch ?? "none",
    input.playbackRevision ?? "none",
    input.startAt ?? "none",
    input.sourcePeerId ?? "none",
    input.remoteTrackId ?? "none"
  ].join("|");
}

export function createPlaybackMediaSession(input: {
  trackId: string;
  playbackAssetId: string;
  playback: Pick<PlaybackSnapshot, "mediaEpoch" | "playbackRevision" | "startAt">;
  sourcePeerId: string | null;
  outputTrackId?: string | null;
  remoteTrackId?: string | null;
}): PlaybackMediaSession {
  const sessionKey = createPlaybackMediaSessionKey({
    trackId: input.trackId,
    playbackAssetId: input.playbackAssetId,
    mediaEpoch: input.playback.mediaEpoch,
    playbackRevision: input.playback.playbackRevision,
    startAt: input.playback.startAt,
    sourcePeerId: input.sourcePeerId,
    remoteTrackId: input.remoteTrackId
  });
  return {
    sessionKey,
    trackId: input.trackId,
    playbackAssetId: input.playbackAssetId,
    mediaEpoch: input.playback.mediaEpoch,
    playbackRevision: input.playback.playbackRevision,
    startAt: input.playback.startAt ?? null,
    sourcePeerId: input.sourcePeerId,
    outputTrackId: input.outputTrackId ?? null,
    remoteTrackId: input.remoteTrackId ?? null
  };
}
