import type { PlaybackSnapshot, TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";

export type ProgressivePlaybackSource =
  | "remote-stream"
  | "progressive-local"
  | "full-local";

export type ProgressiveEngineType = "none" | "mse" | "pcm";

export type ProgressiveSchedulerPolicy =
  | "startup"
  | "steady"
  | "catchup"
  | "pause-fill"
  | "background";

export type ProgressiveTrackManifest = {
  trackId: string;
  fileHash: string;
  mimeType: string;
  codec: string | null;
  sizeBytes: number | null;
  durationMs: number;
  totalChunks: number;
  chunkSize: number;
};

export type ProgressiveHealthSnapshot = {
  activeSource: ProgressivePlaybackSource;
  engineType: ProgressiveEngineType;
  contiguousBufferedMs: number;
  aheadBufferedMs: number;
  schedulerPolicy: ProgressiveSchedulerPolicy;
  startupReady: boolean;
  fallbackReason: string | null;
};

export function isChromeOrEdgeBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent;
  const isChromium = /(Chrome|Chromium|Edg)\//.test(userAgent);
  const isWebKitOnly = /Version\/[\d.]+ .*Safari\//.test(userAgent) && !/Chrome\//.test(userAgent);
  const isFirefox = /Firefox\//.test(userAgent);

  return isChromium && !isWebKitOnly && !isFirefox;
}

export function canUseProgressivePlayback() {
  return typeof window !== "undefined" && isChromeOrEdgeBrowser();
}

export function isLosslessTrack(input: { mimeType?: string | null; codec?: string | null }) {
  const mimeType = input.mimeType?.toLowerCase() ?? "";
  const codec = input.codec?.toLowerCase() ?? "";
  return (
    mimeType.includes("flac") ||
    mimeType.includes("wav") ||
    mimeType.includes("alac") ||
    codec.includes("flac") ||
    codec.includes("wav") ||
    codec.includes("alac")
  );
}

export function isFlacTrack(input: { mimeType?: string | null; codec?: string | null }) {
  const mimeType = input.mimeType?.toLowerCase() ?? "";
  const codec = input.codec?.toLowerCase() ?? "";
  return mimeType.includes("flac") || codec.includes("flac");
}

export function getStartupWindowMs(input: { mimeType?: string | null; codec?: string | null }) {
  return isFlacTrack(input) ? 20_000 : 12_000;
}

export function getTargetSteadyBufferMs(input: { mimeType?: string | null; codec?: string | null }) {
  return isFlacTrack(input) ? 45_000 : 30_000;
}

export function getLowBufferThresholdMs() {
  return 8_000;
}

export function getCriticalBufferThresholdMs() {
  return 3_000;
}

export function buildProgressiveTrackManifest(
  track: TrackMeta | null | undefined,
  availability: TrackAvailabilityAnnouncement | null | undefined
): ProgressiveTrackManifest | null {
  if (!track || !availability || availability.totalChunks <= 0 || availability.chunkSize <= 0) {
    return null;
  }

  return {
    trackId: track.id,
    fileHash: track.fileHash,
    mimeType: track.mimeType || "audio/mpeg",
    codec: track.codec ?? null,
    sizeBytes: track.sizeBytes ?? null,
    durationMs: track.durationMs,
    totalChunks: availability.totalChunks,
    chunkSize: availability.chunkSize
  };
}

export function getContiguousChunkCount(availableChunks: number[]) {
  if (availableChunks.length === 0) {
    return 0;
  }

  const sorted = [...availableChunks].sort((left, right) => left - right);
  let contiguous = 0;
  for (const chunkIndex of sorted) {
    if (chunkIndex !== contiguous) {
      break;
    }
    contiguous += 1;
  }

  return contiguous;
}

export function chunkIndexToPositionMs(
  chunkIndex: number,
  manifest: Pick<ProgressiveTrackManifest, "durationMs" | "totalChunks">
) {
  if (manifest.durationMs <= 0 || manifest.totalChunks <= 0) {
    return 0;
  }

  return Math.floor((chunkIndex / manifest.totalChunks) * manifest.durationMs);
}

export function getContiguousBufferedMs(
  manifest: ProgressiveTrackManifest | null,
  availableChunks: number[]
) {
  if (!manifest || manifest.totalChunks <= 0 || manifest.durationMs <= 0) {
    return 0;
  }

  const contiguousChunkCount = getContiguousChunkCount(availableChunks);
  if (contiguousChunkCount <= 0) {
    return 0;
  }

  return Math.min(
    manifest.durationMs,
    Math.floor((contiguousChunkCount / manifest.totalChunks) * manifest.durationMs)
  );
}

export function getAheadBufferedMs(input: {
  manifest: ProgressiveTrackManifest | null;
  availableChunks: number[];
  playbackPositionMs: number;
}) {
  const contiguousBufferedMs = getContiguousBufferedMs(input.manifest, input.availableChunks);
  if (contiguousBufferedMs <= input.playbackPositionMs) {
    return 0;
  }

  return contiguousBufferedMs - input.playbackPositionMs;
}

export function isStartupReady(input: {
  manifest: ProgressiveTrackManifest | null;
  availableChunks: number[];
  playbackPositionMs: number;
}) {
  const { manifest } = input;
  if (!manifest) {
    return false;
  }

  const contiguousChunkCount = getContiguousChunkCount(input.availableChunks);
  const contiguousBufferedMs = getContiguousBufferedMs(manifest, input.availableChunks);
  const requiredBufferedMs = Math.min(
    manifest.durationMs,
    Math.max(0, input.playbackPositionMs) + getStartupWindowMs(manifest)
  );
  const contiguousBytes = contiguousChunkCount * manifest.chunkSize;

  return contiguousBufferedMs >= requiredBufferedMs && contiguousBytes >= 1.5 * 1024 * 1024;
}

export function getProgressiveEngineType(manifest: ProgressiveTrackManifest | null): ProgressiveEngineType {
  if (!manifest) {
    return "none";
  }

  if (canUseProgressivePcm(manifest)) {
    return "pcm";
  }

  if (canUseProgressiveMse(manifest.mimeType)) {
    return "mse";
  }

  return "none";
}

export function canUseProgressivePcm(
  manifest: Pick<ProgressiveTrackManifest, "mimeType" | "codec"> | null | undefined
) {
  if (!manifest || !isFlacTrack(manifest) || !isChromeOrEdgeBrowser()) {
    return false;
  }

  const audioContextSupported =
    typeof window !== "undefined" &&
    typeof (
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ) !== "undefined";
  const webCodecsSupported =
    typeof globalThis !== "undefined" &&
    typeof (
      globalThis as typeof globalThis & {
        AudioDecoder?: unknown;
        EncodedAudioChunk?: unknown;
      }
    ).AudioDecoder !== "undefined" &&
    typeof (
      globalThis as typeof globalThis & {
        AudioDecoder?: unknown;
        EncodedAudioChunk?: unknown;
      }
    ).EncodedAudioChunk !== "undefined";

  return audioContextSupported && webCodecsSupported;
}

export function canUseProgressiveMse(mimeType: string | null | undefined) {
  if (!mimeType || typeof MediaSource === "undefined") {
    return false;
  }

  const normalizedMimeType = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalizedMimeType !== "audio/mpeg" && normalizedMimeType !== "audio/mp3") {
    return false;
  }

  try {
    return MediaSource.isTypeSupported(mimeType);
  } catch {
    return false;
  }
}

export function getEffectivePlaybackPositionMs(
  playback: PlaybackSnapshot | null | undefined,
  durationMs: number,
  now = Date.now()
) {
  if (!playback) {
    return 0;
  }

  if (playback.status !== "playing" || !playback.startedAt) {
    return durationMs > 0 ? Math.min(playback.positionMs, durationMs) : playback.positionMs;
  }

  const startedAt = new Date(playback.startedAt).getTime();
  if (Number.isNaN(startedAt)) {
    return playback.positionMs;
  }

  const elapsed = Math.max(0, now - startedAt);
  const nextPositionMs = playback.positionMs + elapsed;
  return durationMs > 0 ? Math.min(nextPositionMs, durationMs) : nextPositionMs;
}

export function resolveSchedulerPolicy(input: {
  playback: PlaybackSnapshot | null | undefined;
  activeSource: ProgressivePlaybackSource;
  manifest: ProgressiveTrackManifest | null;
  availableChunks: number[];
  fallbackReason: string | null;
  currentTrackComplete: boolean;
}) {
  const playback = input.playback;
  if (!playback?.currentTrackId || !input.manifest) {
    return "startup" satisfies ProgressiveSchedulerPolicy;
  }

  if (playback.status === "paused" && !input.currentTrackComplete) {
    return "pause-fill" satisfies ProgressiveSchedulerPolicy;
  }

  if (input.fallbackReason) {
    return "catchup" satisfies ProgressiveSchedulerPolicy;
  }

  const positionMs = getEffectivePlaybackPositionMs(playback, input.manifest.durationMs);
  const aheadBufferedMs = getAheadBufferedMs({
    manifest: input.manifest,
    availableChunks: input.availableChunks,
    playbackPositionMs: positionMs
  });

  if (!input.currentTrackComplete) {
    if (!isStartupReady({
      manifest: input.manifest,
      availableChunks: input.availableChunks,
      playbackPositionMs: positionMs
    })) {
      return "startup" satisfies ProgressiveSchedulerPolicy;
    }

    if (input.activeSource === "progressive-local" && aheadBufferedMs < getCriticalBufferThresholdMs()) {
      return "catchup" satisfies ProgressiveSchedulerPolicy;
    }

    return "steady" satisfies ProgressiveSchedulerPolicy;
  }

  return "background" satisfies ProgressiveSchedulerPolicy;
}

export function buildProgressiveHealthSnapshot(input: {
  playback: PlaybackSnapshot | null | undefined;
  activeSource: ProgressivePlaybackSource;
  manifest: ProgressiveTrackManifest | null;
  localAvailability: TrackAvailabilityAnnouncement | null | undefined;
  fallbackReason: string | null;
}) {
  const availableChunks = input.localAvailability?.availableChunks ?? [];
  const playbackPositionMs = getEffectivePlaybackPositionMs(
    input.playback,
    input.manifest?.durationMs ?? 0
  );
  const startupReady = isStartupReady({
    manifest: input.manifest,
    availableChunks,
    playbackPositionMs
  });
  const currentTrackComplete =
    !!input.manifest && availableChunks.length >= input.manifest.totalChunks;

  const schedulerPolicy = resolveSchedulerPolicy({
    playback: input.playback,
    activeSource: input.activeSource,
    manifest: input.manifest,
    availableChunks,
    fallbackReason: input.fallbackReason,
    currentTrackComplete
  });

  return {
    activeSource: input.activeSource,
    engineType: getProgressiveEngineType(input.manifest),
    contiguousBufferedMs: getContiguousBufferedMs(input.manifest, availableChunks),
    aheadBufferedMs: getAheadBufferedMs({
      manifest: input.manifest,
      availableChunks,
      playbackPositionMs
    }),
    schedulerPolicy,
    startupReady,
    fallbackReason: input.fallbackReason
  } satisfies ProgressiveHealthSnapshot;
}

export function getPriorityChunkIndexes(input: {
  manifest: ProgressiveTrackManifest;
  availableChunks: number[];
  playbackPositionMs: number;
  policy: ProgressiveSchedulerPolicy;
}) {
  const { manifest, playbackPositionMs, policy } = input;
  const owned = new Set(input.availableChunks);
  const startupEndPositionMs = Math.min(
    manifest.durationMs,
    Math.max(0, playbackPositionMs) + getStartupWindowMs(manifest)
  );
  const steadyEndPositionMs = Math.min(
    manifest.durationMs,
    Math.max(0, playbackPositionMs) + getTargetSteadyBufferMs(manifest)
  );
  const targetPositionMs =
    policy === "pause-fill"
      ? manifest.durationMs
      : policy === "steady" || policy === "background"
        ? steadyEndPositionMs
        : startupEndPositionMs;
  const targetChunkIndex = Math.min(
    manifest.totalChunks - 1,
    Math.max(0, Math.ceil((targetPositionMs / Math.max(manifest.durationMs, 1)) * manifest.totalChunks) - 1)
  );

  const wantedChunks: number[] = [];
  for (let chunkIndex = 0; chunkIndex <= targetChunkIndex; chunkIndex += 1) {
    if (!owned.has(chunkIndex)) {
      wantedChunks.push(chunkIndex);
    }
  }

  if (policy === "pause-fill") {
    for (let chunkIndex = targetChunkIndex + 1; chunkIndex < manifest.totalChunks; chunkIndex += 1) {
      if (!owned.has(chunkIndex)) {
        wantedChunks.push(chunkIndex);
      }
    }
  }

  return wantedChunks;
}
