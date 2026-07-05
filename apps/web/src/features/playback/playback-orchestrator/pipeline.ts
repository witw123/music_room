import type { PlaybackSnapshot, RoomSnapshot, TrackMeta } from "@music-room/shared";
import type {
  ProgressiveEngineType,
  ProgressivePlaybackSource
} from "../progressive-playback";

export type PlaybackRecoveryStage =
  | "startup-buffering"
  | "steady"
  | "degraded"
  | "shadow-catchup"
  | "audible-local-fallback";

type TrackFormatInput = Pick<
  TrackMeta,
  "id" | "fileHash" | "durationMs" | "mimeType" | "codec"
> | null | undefined;

export function buildCurrentTrackFormatKey(track: TrackFormatInput) {
  return [
    track?.id ?? "none",
    track?.fileHash ?? "none",
    track?.durationMs ?? "unknown-duration",
    track?.mimeType ?? "unknown-mime",
    track?.codec ?? "unknown-codec"
  ].join("|");
}

type PlaybackPositionInput = Pick<
  PlaybackSnapshot,
  "status" | "currentTrackId" | "positionMs" | "startedAt" | "mediaEpoch"
> | null | undefined;

export function buildPlaybackPositionKey(playback: PlaybackPositionInput) {
  return [
    playback?.currentTrackId ?? "none",
    playback?.status ?? "none",
    playback?.positionMs ?? "unknown-position",
    playback?.startedAt ?? "not-started",
    playback?.mediaEpoch ?? "unknown-epoch"
  ].join("|");
}

export function buildAvailableChunksKey(chunks: readonly number[] | null | undefined) {
  return chunks?.join(",") ?? "none";
}

function isSlidingWindowPlaybackSource(source: ProgressivePlaybackSource) {
  return source === "progressive-local" || source === "lossless-local";
}

export function shouldWarmFullLocalWithSharedAudioElement(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
  canUseFullLocalForPlaybackSession: boolean;
  isCurrentSourceOwner: boolean;
}) {
  return (
    input.canUseFullLocalForPlaybackSession &&
    !input.isCurrentSourceOwner &&
    input.activePlaybackSource !== "full-local" &&
    input.progressiveEngineType === "none"
  );
}

export function hasSufficientBackingForFullLocalWarmup(input: {
  progressiveEngineType: ProgressiveEngineType;
  aheadBufferedMs: number;
  requiredAheadMs: number;
}) {
  if (input.progressiveEngineType === "none") {
    return true;
  }

  return input.aheadBufferedMs >= input.requiredAheadMs;
}

export function shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
  canUseFullLocalForPlaybackSession: boolean;
  fullLocalBlockedReason: string | null | undefined;
  localTakeoverAllowed: boolean;
  aheadBufferedMs: number;
  comfortBufferMs: number;
  warmupReadyAt: number | null;
  now: number;
  switchDelayMs: number;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    input.progressiveEngineType !== "none"
  ) {
    return false;
  }

  if (
    !input.canUseFullLocalForPlaybackSession ||
    input.fullLocalBlockedReason !== null ||
    !input.localTakeoverAllowed ||
    !hasSufficientBackingForFullLocalWarmup({
      progressiveEngineType: input.progressiveEngineType,
      aheadBufferedMs: input.aheadBufferedMs,
      requiredAheadMs: input.comfortBufferMs
    }) ||
    input.warmupReadyAt === null
  ) {
    return false;
  }

  return input.now - input.warmupReadyAt >= input.switchDelayMs;
}

export function buildProgressiveWarmupTimerKey(input: {
  playbackCurrentTrackId: string | null;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null;
  playbackMediaEpoch: number | null;
  currentTrackFormatKey: string;
  progressiveManifestKey: string;
  activePlaybackSource: ProgressivePlaybackSource;
  canUseFullLocalForPlaybackSession: boolean;
  progressiveEngineType: ProgressiveEngineType;
  progressiveStartupReady: boolean;
  startupBufferMs: number;
  progressiveLocalBlockedReason: string | null;
  isCurrentSourceOwner: boolean;
  playbackRecoveryStage: PlaybackRecoveryStage;
  progressiveFallbackReason: string | null;
  stalledEventsLast30s: number;
  waitingEventsLast30s: number;
}) {
  return [
    input.playbackCurrentTrackId ?? "none",
    input.playbackStatus ?? "none",
    input.playbackMediaEpoch ?? "none",
    input.currentTrackFormatKey,
    input.progressiveManifestKey,
    input.activePlaybackSource,
    input.canUseFullLocalForPlaybackSession ? "full-local-ready" : "full-local-missing",
    input.progressiveEngineType,
    input.progressiveStartupReady ? "startup-ready" : "startup-pending",
    input.startupBufferMs,
    input.progressiveLocalBlockedReason ?? "unblocked",
    input.isCurrentSourceOwner ? "source-owner" : "listener",
    input.playbackRecoveryStage,
    input.progressiveFallbackReason ?? "no-fallback",
    input.stalledEventsLast30s,
    input.waitingEventsLast30s
  ].join("|");
}
