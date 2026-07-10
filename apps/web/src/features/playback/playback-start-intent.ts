import type { PlaybackSnapshot } from "@music-room/shared";
import { hasActivePlaybackIntent, type ProgressivePlaybackSource } from "./progressive-playback";

export type PlaybackStartIntentReason =
  | "resume-current"
  | "track"
  | "queue-item"
  | "prev"
  | "next";

export type PlaybackStartIntent = {
  id: string;
  reason: PlaybackStartIntentReason;
  trackId: string | null;
  queueItemId: string | null;
  previousTrackId: string | null;
  targetPlaybackRevision: number | null;
  previousQueueVersion: number | null;
  previousMediaEpoch: number | null;
  armedAt: number;
  expiresAt: number;
  consumedAt: number | null;
  matchedSource: ProgressivePlaybackSource | null;
  lastFailure: string | null;
};

type CreatePlaybackStartIntentInput = {
  reason: PlaybackStartIntentReason;
  trackId?: string | null;
  queueItemId?: string | null;
  previousTrackId?: string | null;
  targetPlaybackRevision?: number | null;
  previousQueueVersion?: number | null;
  previousMediaEpoch?: number | null;
  now?: number;
  ttlMs?: number;
};

const defaultPlaybackStartIntentTtlMs = 7_000;

function createPlaybackStartIntentId(now: number) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `intent_${now}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createPlaybackStartIntent(
  input: CreatePlaybackStartIntentInput
): PlaybackStartIntent {
  const armedAt = input.now ?? Date.now();
  return {
    id: createPlaybackStartIntentId(armedAt),
    reason: input.reason,
    trackId: input.trackId ?? null,
    queueItemId: input.queueItemId ?? null,
    previousTrackId: input.previousTrackId ?? null,
    targetPlaybackRevision: input.targetPlaybackRevision ?? null,
    previousQueueVersion: input.previousQueueVersion ?? null,
    previousMediaEpoch: input.previousMediaEpoch ?? null,
    armedAt,
    expiresAt: armedAt + (input.ttlMs ?? defaultPlaybackStartIntentTtlMs),
    consumedAt: null,
    matchedSource: null,
    lastFailure: null
  };
}

export function isPlaybackStartIntentPending(
  intent: PlaybackStartIntent | null | undefined,
  now = Date.now()
) {
  return !!intent && intent.consumedAt === null && intent.expiresAt > now;
}

export function doesPlaybackMatchStartIntent(
  intent: PlaybackStartIntent | null | undefined,
  playback: PlaybackSnapshot | null | undefined,
  now = Date.now()
) {
  if (!isPlaybackStartIntentPending(intent, now) || !playback?.currentTrackId) {
    return false;
  }

  const activeIntent = intent as PlaybackStartIntent;

  if (!hasActivePlaybackIntent(playback)) {
    return false;
  }

  if (
    activeIntent.targetPlaybackRevision !== null &&
    (playback.playbackRevision ?? playback.queueVersion) < activeIntent.targetPlaybackRevision
  ) {
    return false;
  }

  if (
    activeIntent.previousQueueVersion !== null &&
    playback.queueVersion <= activeIntent.previousQueueVersion
  ) {
    return false;
  }

  if (
    activeIntent.previousMediaEpoch !== null &&
    activeIntent.trackId !== null &&
    playback.currentTrackId === activeIntent.trackId &&
    playback.mediaEpoch < activeIntent.previousMediaEpoch
  ) {
    return false;
  }

  if (activeIntent.queueItemId) {
    return playback.currentQueueItemId === activeIntent.queueItemId;
  }

  if (activeIntent.trackId) {
    return playback.currentTrackId === activeIntent.trackId;
  }

  if (activeIntent.previousTrackId) {
    return playback.currentTrackId !== activeIntent.previousTrackId;
  }

  return true;
}

export function doesAudiblePlaybackSatisfyStartIntent(
  intent: PlaybackStartIntent | null | undefined,
  playback: PlaybackSnapshot | null | undefined,
  now = Date.now()
) {
  if (
    !isPlaybackStartIntentPending(intent, now) ||
    !playback?.currentTrackId ||
    !hasActivePlaybackIntent(playback)
  ) {
    return false;
  }

  const activeIntent = intent as PlaybackStartIntent;
  if (activeIntent.queueItemId) {
    return playback.currentQueueItemId === activeIntent.queueItemId;
  }
  if (activeIntent.trackId) {
    return playback.currentTrackId === activeIntent.trackId;
  }
  if (activeIntent.previousTrackId) {
    return playback.currentTrackId !== activeIntent.previousTrackId;
  }
  return true;
}

export function consumePlaybackStartIntent(
  intent: PlaybackStartIntent,
  matchedSource: ProgressivePlaybackSource,
  now = Date.now()
): PlaybackStartIntent {
  return {
    ...intent,
    matchedSource,
    consumedAt: now,
    lastFailure: null
  };
}

export function failPlaybackStartIntent(
  intent: PlaybackStartIntent,
  failure: string
): PlaybackStartIntent {
  return {
    ...intent,
    lastFailure: failure
  };
}

export function getPlaybackStartIntentLabel(intent: PlaybackStartIntent | null | undefined) {
  if (!intent) {
    return null;
  }

  if (intent.queueItemId) {
    return `队列点播 ${intent.queueItemId}`;
  }

  if (intent.trackId) {
    return `曲库点播 ${intent.trackId}`;
  }

  if (intent.reason === "prev") {
    return "上一首";
  }

  if (intent.reason === "next") {
    return "下一首";
  }

  return "恢复播放";
}
