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
  | "outrun-recovery"
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
  estimatedFillTimeMs: number | null;
  remainingPlaybackMs: number | null;
};

function getPlaybackRiskWindowMs(input: { mimeType?: string | null; codec?: string | null }) {
  return Math.max(getTakeoverWindowMs(input), getRemoteFirstComfortBufferMs(input));
}

const outrunRecoverySafetyFactor = 0.8;

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
  return typeof window !== "undefined";
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

export function getTakeoverWindowMs(input: { mimeType?: string | null; codec?: string | null }) {
  return isFlacTrack(input) ? 4_500 : 3_000;
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

export function getRemoteFirstComfortBufferMs(input: {
  mimeType?: string | null;
  codec?: string | null;
}) {
  return isFlacTrack(input) ? 32_000 : 14_000;
}

export function getOutrunRecoverySafetyFactor() {
  return outrunRecoverySafetyFactor;
}

export function getFullLocalStableWindowMs() {
  return 3_500;
}

export function getLocalTakeoverCooldownMs() {
  return 6_000;
}

export function getMinimumSourceResidenceMs(source: ProgressivePlaybackSource) {
  if (source === "remote-stream") {
    return 0;
  }

  return source === "full-local" ? 3_500 : 6_000;
}

export function buildProgressiveTrackManifest(
  track: TrackMeta | null | undefined,
  availability: TrackAvailabilityAnnouncement | null | undefined,
  manifestHint?: Pick<TrackAvailabilityAnnouncement, "totalChunks" | "chunkSize"> | null
): ProgressiveTrackManifest | null {
  if (!track) {
    return null;
  }

  const preferredManifest = track.relayManifest ?? track.pieceManifest ?? null;
  const totalChunks =
    availability?.totalChunks ?? manifestHint?.totalChunks ?? preferredManifest?.totalChunks ?? 0;
  const chunkSize =
    availability?.chunkSize ?? manifestHint?.chunkSize ?? preferredManifest?.chunkSize ?? 0;
  const mimeType = preferredManifest?.pieceMimeType ?? track.mimeType ?? "audio/mpeg";

  if (totalChunks <= 0 || chunkSize <= 0) {
    return null;
  }

  return {
    trackId: track.id,
    fileHash: track.fileHash,
    mimeType,
    codec: track.codec ?? null,
    sizeBytes: track.sizeBytes ?? null,
    durationMs: track.durationMs,
    totalChunks,
    chunkSize
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

function getChunkIndexForPositionMs(
  manifest: Pick<ProgressiveTrackManifest, "durationMs" | "totalChunks">,
  positionMs: number
) {
  if (manifest.durationMs <= 0 || manifest.totalChunks <= 0) {
    return 0;
  }

  return Math.min(
    manifest.totalChunks - 1,
    Math.max(0, Math.floor((Math.max(0, positionMs) / manifest.durationMs) * manifest.totalChunks))
  );
}

function getPlaybackWindowChunkIndexes(input: {
  manifest: ProgressiveTrackManifest;
  playbackPositionMs: number;
  lookBehindMs: number;
  lookAheadMs: number;
}) {
  const { manifest, playbackPositionMs, lookBehindMs, lookAheadMs } = input;
  const currentChunkIndex = getChunkIndexForPositionMs(manifest, playbackPositionMs);
  const startPositionMs = Math.max(0, playbackPositionMs - Math.max(0, lookBehindMs));
  const endPositionMs = Math.min(
    manifest.durationMs,
    Math.max(0, playbackPositionMs) + Math.max(0, lookAheadMs)
  );
  const startChunkIndex = getChunkIndexForPositionMs(manifest, startPositionMs);
  const endChunkIndex = Math.max(
    currentChunkIndex,
    getChunkIndexForPositionMs(manifest, endPositionMs)
  );

  return {
    currentChunkIndex,
    startChunkIndex,
    endChunkIndex
  };
}

function appendMissingChunks(
  target: number[],
  owned: Set<number>,
  seen: Set<number>,
  from: number,
  to: number,
  step: 1 | -1
) {
  if (step === 1) {
    for (let chunkIndex = from; chunkIndex <= to; chunkIndex += 1) {
      if (!owned.has(chunkIndex) && !seen.has(chunkIndex)) {
        seen.add(chunkIndex);
        target.push(chunkIndex);
      }
    }
    return;
  }

  for (let chunkIndex = from; chunkIndex >= to; chunkIndex -= 1) {
    if (!owned.has(chunkIndex) && !seen.has(chunkIndex)) {
      seen.add(chunkIndex);
      target.push(chunkIndex);
    }
  }
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
  return isProgressiveReady(input, "startup");
}

export function isTakeoverReady(input: {
  manifest: ProgressiveTrackManifest | null;
  availableChunks: number[];
  playbackPositionMs: number;
}) {
  return isProgressiveReady(input, "takeover");
}

function isProgressiveReady(
  input: {
    manifest: ProgressiveTrackManifest | null;
    availableChunks: number[];
    playbackPositionMs: number;
  },
  mode: "startup" | "takeover"
) {
  const { manifest } = input;
  if (!manifest) {
    return false;
  }

  const contiguousChunkCount = getContiguousChunkCount(input.availableChunks);
  const contiguousBufferedMs = getContiguousBufferedMs(manifest, input.availableChunks);
  const requiredBufferedMs = Math.min(
    manifest.durationMs,
    Math.max(0, input.playbackPositionMs) +
      (mode === "takeover" ? getTakeoverWindowMs(manifest) : getStartupWindowMs(manifest))
  );
  const contiguousBytes = contiguousChunkCount * manifest.chunkSize;
  const requiredBytes = mode === "takeover" ? 320 * 1024 : 1.5 * 1024 * 1024;

  return contiguousBufferedMs >= requiredBufferedMs && contiguousBytes >= requiredBytes;
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
  currentPieceDownloadRateKbps?: number | null;
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
  const remainingPlaybackMs = Math.max(0, input.manifest.durationMs - positionMs);
  const estimatedFillTimeMs = estimateTrackFillTimeMs({
    manifest: input.manifest,
    availableChunks: input.availableChunks,
    downloadRateKbps: input.currentPieceDownloadRateKbps ?? null,
    playbackPositionMs: positionMs,
    lookBehindMs: 4_000,
    lookAheadMs: getPlaybackRiskWindowMs(input.manifest)
  });
  const hasOutrunRisk =
    !input.currentTrackComplete &&
    estimatedFillTimeMs !== null &&
    (aheadBufferedMs <= getCriticalBufferThresholdMs() ||
      estimatedFillTimeMs >=
        Math.max(aheadBufferedMs, getCriticalBufferThresholdMs()) * getOutrunRecoverySafetyFactor());

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

    if (hasOutrunRisk) {
      return "outrun-recovery" satisfies ProgressiveSchedulerPolicy;
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
  currentPieceDownloadRateKbps?: number | null;
}) {
  const availableChunks = input.localAvailability?.availableChunks ?? [];
  const playbackPositionMs = getEffectivePlaybackPositionMs(
    input.playback,
    input.manifest?.durationMs ?? 0
  );
  const remainingPlaybackMs =
    input.manifest && input.playback?.currentTrackId
      ? Math.max(0, input.manifest.durationMs - playbackPositionMs)
      : null;
  const estimatedFillTimeMs = estimateTrackFillTimeMs({
    manifest: input.manifest,
    availableChunks,
    downloadRateKbps: input.currentPieceDownloadRateKbps ?? null,
    playbackPositionMs,
    lookBehindMs: 4_000,
    lookAheadMs: input.manifest ? getPlaybackRiskWindowMs(input.manifest) : 0
  });
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
    currentTrackComplete,
    currentPieceDownloadRateKbps: input.currentPieceDownloadRateKbps ?? null
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
    fallbackReason: input.fallbackReason,
    estimatedFillTimeMs,
    remainingPlaybackMs
  } satisfies ProgressiveHealthSnapshot;
}

export function estimateTrackFillTimeMs(input: {
  manifest: ProgressiveTrackManifest | null;
  availableChunks: number[];
  downloadRateKbps: number | null;
  playbackPositionMs?: number | null;
  lookBehindMs?: number;
  lookAheadMs?: number;
}) {
  if (!input.manifest) {
    return null;
  }

  const owned = new Set(input.availableChunks);
  const missingChunkIndexes =
    typeof input.playbackPositionMs === "number" &&
    typeof input.lookAheadMs === "number"
      ? getPriorityChunkIndexes({
          manifest: input.manifest,
          availableChunks: input.availableChunks,
          playbackPositionMs: input.playbackPositionMs,
          policy: "startup",
          lookBehindMs: input.lookBehindMs ?? 0,
          lookAheadMs: input.lookAheadMs
        })
      : [...Array(input.manifest.totalChunks).keys()].filter((chunkIndex) => !owned.has(chunkIndex));
  const missingChunkCount = missingChunkIndexes.length;
  if (missingChunkCount === 0) {
    return 0;
  }

  if (
    input.downloadRateKbps === null ||
    !Number.isFinite(input.downloadRateKbps) ||
    input.downloadRateKbps <= 0
  ) {
    return null;
  }

  const missingBits = missingChunkCount * input.manifest.chunkSize * 8;
  return Math.ceil(missingBits / (input.downloadRateKbps * 1000) * 1000);
}

export function shouldEnableRemoteFirstLock(input: {
  diagnostics: {
    mediaCandidateType: string | null;
    mediaProtocol: string | null;
    currentRoundTripTimeMs: number | null;
    availableOutgoingBitrateKbps: number | null;
    packetLossRate?: number | null;
    packetsLost: number | null;
    jitterMs: number | null;
  } | null;
}) {
  const diagnostics = input.diagnostics;
  if (!diagnostics) {
    return false;
  }

  if (
    typeof diagnostics.currentRoundTripTimeMs === "number" &&
    diagnostics.currentRoundTripTimeMs >= 220
  ) {
    return true;
  }

  if (
    typeof diagnostics.packetLossRate === "number" &&
    diagnostics.packetLossRate >= 8
  ) {
    return true;
  }

  if (
    typeof diagnostics.availableOutgoingBitrateKbps === "number" &&
    diagnostics.availableOutgoingBitrateKbps > 0 &&
    diagnostics.availableOutgoingBitrateKbps <= 72
  ) {
    return true;
  }

  if (
    typeof diagnostics.jitterMs === "number" &&
    diagnostics.jitterMs >= 45
  ) {
    return true;
  }

  return false;
}

export function getPriorityChunkIndexes(input: {
  manifest: ProgressiveTrackManifest;
  availableChunks: number[];
  playbackPositionMs: number;
  policy: ProgressiveSchedulerPolicy;
  lookBehindMs?: number;
  lookAheadMs?: number;
}) {
  const { manifest, playbackPositionMs, policy } = input;
  const owned = new Set(input.availableChunks);
  const wantedChunks: number[] = [];
  const seen = new Set<number>();
  const derivedLookBehindMs =
    input.lookBehindMs ??
    (policy === "steady" || policy === "background" ? 8_000 : 0);
  const derivedLookAheadMs =
    input.lookAheadMs ??
    (policy === "pause-fill"
      ? manifest.durationMs
      : policy === "outrun-recovery"
        ? Math.max(getRemoteFirstComfortBufferMs(manifest), getTargetSteadyBufferMs(manifest) * 2)
        : policy === "steady" || policy === "background"
          ? getTargetSteadyBufferMs(manifest)
          : getStartupWindowMs(manifest));
  const { currentChunkIndex, startChunkIndex, endChunkIndex } = getPlaybackWindowChunkIndexes({
    manifest,
    playbackPositionMs,
    lookBehindMs: derivedLookBehindMs,
    lookAheadMs: derivedLookAheadMs
  });

  appendMissingChunks(wantedChunks, owned, seen, currentChunkIndex, endChunkIndex, 1);
  appendMissingChunks(wantedChunks, owned, seen, currentChunkIndex - 1, startChunkIndex, -1);

  if (policy === "outrun-recovery" || policy === "pause-fill") {
    appendMissingChunks(wantedChunks, owned, seen, endChunkIndex + 1, manifest.totalChunks - 1, 1);
  }

  if (policy === "pause-fill") {
    appendMissingChunks(wantedChunks, owned, seen, startChunkIndex - 1, 0, -1);
  }

  return wantedChunks;
}
