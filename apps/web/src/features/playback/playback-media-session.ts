import type { PlaybackSnapshot, TrackMeta } from "@music-room/shared";

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

export type BrowserMediaSessionActionHandlers = {
  onPlay?: () => void | Promise<unknown>;
  onPause?: () => void | Promise<unknown>;
  onStop?: () => void | Promise<unknown>;
  onPreviousTrack?: () => void | Promise<unknown>;
  onNextTrack?: () => void | Promise<unknown>;
  getPositionMs?: () => number;
  onSeek?: (positionMs: number) => void | Promise<unknown>;
};

type BrowserMediaSession = {
  metadata: MediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler: (
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null
  ) => void;
  setPositionState?: (state: MediaPositionState) => void;
};

const mediaSessionActions: MediaSessionAction[] = [
  "play",
  "pause",
  "stop",
  "previoustrack",
  "nexttrack",
  "seekbackward",
  "seekforward",
  "seekto"
];

function getBrowserMediaSession(): BrowserMediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return null;
  }

  return navigator.mediaSession as BrowserMediaSession;
}

function invokeMediaSessionAction(action: (() => void | Promise<unknown>) | undefined) {
  if (!action) return;
  void Promise.resolve(action()).catch(() => undefined);
}

export function installBrowserMediaSessionActionHandlers(
  input: BrowserMediaSessionActionHandlers
) {
  const mediaSession = getBrowserMediaSession();
  if (!mediaSession || typeof mediaSession.setActionHandler !== "function") {
    return () => undefined;
  }

  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => invokeMediaSessionAction(input.onPlay),
    pause: () => invokeMediaSessionAction(input.onPause),
    stop: () => invokeMediaSessionAction(input.onStop ?? input.onPause),
    previoustrack: () => invokeMediaSessionAction(input.onPreviousTrack),
    nexttrack: () => invokeMediaSessionAction(input.onNextTrack),
    seekbackward: (details) => {
      const offsetMs = Math.max(1, (details.seekOffset ?? 10) * 1000);
      invokeMediaSessionAction(() => input.onSeek?.(
        Math.max(0, getCurrentPositionMs(input.getPositionMs) - offsetMs)
      ));
    },
    seekforward: (details) => {
      const offsetMs = Math.max(1, (details.seekOffset ?? 10) * 1000);
      invokeMediaSessionAction(() => input.onSeek?.(
        getCurrentPositionMs(input.getPositionMs) + offsetMs
      ));
    },
    seekto: (details) => {
      const seekTime = details.seekTime;
      if (typeof seekTime !== "number" || !Number.isFinite(seekTime)) return;
      invokeMediaSessionAction(() => input.onSeek?.(Math.max(0, seekTime * 1000)));
    }
  };

  for (const action of mediaSessionActions) {
    try {
      mediaSession.setActionHandler(action, handlers[action] ?? null);
    } catch {
      // Browsers expose the API before supporting every individual action.
    }
  }

  return () => {
    for (const action of mediaSessionActions) {
      try {
        mediaSession.setActionHandler(action, null);
      } catch {
        // Cleanup is best effort because action support varies by browser.
      }
    }
  };
}

export function syncBrowserMediaSession(input: {
  track: TrackMeta | null | undefined;
  playback: Pick<PlaybackSnapshot, "currentTrackId" | "status" | "positionMs"> | null | undefined;
  positionMs?: number | null;
}) {
  const mediaSession = getBrowserMediaSession();
  if (!mediaSession) return;

  const track = input.track;
  const playback = input.playback;
  if (!track || !playback?.currentTrackId || playback.currentTrackId !== track.id) {
    mediaSession.metadata = null;
    mediaSession.playbackState = "none";
    return;
  }

  if (typeof MediaMetadata !== "undefined") {
    try {
      mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album ?? "音乐房",
        artwork: track.artworkUrl
          ? [{ src: track.artworkUrl, sizes: "512x512", type: "image/*" }]
          : []
      });
    } catch {
      mediaSession.metadata = null;
    }
  }

  mediaSession.playbackState = playback.status === "playing" ? "playing" : "paused";
  const duration = track.durationMs / 1000;
  const position = Math.min(
    duration,
    Math.max(0, (input.positionMs ?? playback.positionMs) / 1000)
  );
  if (
    mediaSession.setPositionState &&
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(position)
  ) {
    try {
      mediaSession.setPositionState({ duration, position, playbackRate: 1 });
    } catch {
      // Position state is optional and rejects invalid or stale timelines.
    }
  }
}

function getCurrentPositionMs(getPositionMs: (() => number) | undefined) {
  const positionMs = getPositionMs?.() ?? 0;
  return Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
}

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
