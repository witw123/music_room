import type { PlaybackSnapshot, TrackMeta } from "@music-room/shared";
import { isFlacTrack } from "@/features/audio-codecs/audio-format";
import { getRoomPlaybackClockNowMs } from "./room-playback-clock";
import {
  getChunkIndexForPositionMs,
  getDecodableAheadBufferedMs
} from "./asset-buffer-calculus";
import { getRequiredDecodablePrefixChunkCount } from "./asset-window-scheduler";

export { isFlacTrack, isWavTrack } from "@/features/audio-codecs/audio-format";
export {
  getContiguousChunkCount,
  chunkIndexToPositionMs,
  getChunkIndexForPositionMs,
  getContiguousBufferedMs,
  getAheadBufferedMs,
  getDecodableAheadBufferedMs
} from "./asset-buffer-calculus";

export type AssetTransferPolicy =
  | "startup"
  | "steady"
  | "catchup"
  | "outrun-recovery"
  | "pause-fill"
  | "background";

export type AssetTransferManifest = {
  trackId: string;
  fileHash: string;
  mimeType: string;
  codec: string | null;
  sizeBytes: number | null;
  durationMs: number;
  totalChunks: number;
  chunkSize: number;
};

type AssetManifestGeometryHint = {
  totalChunks: number;
  chunkSize: number;
  [key: string]: unknown;
} | null | undefined;

export function hasActivePlayback(playback: PlaybackSnapshot | null | undefined) {
  return playback?.status === "playing" || playback?.status === "buffering";
}

export function getStartupWindowMs(_input: { mimeType?: string | null; codec?: string | null }) {
  return 8_000;
}

export function getTakeoverWindowMs(input: { mimeType?: string | null; codec?: string | null }) {
  return isFlacTrack(input) ? 3_000 : 2_000;
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
  return isFlacTrack(input) ? 18_000 : 10_000;
}

export function buildAssetTransferManifest(
  track: TrackMeta | null | undefined,
  availability: AssetManifestGeometryHint,
  manifestHint?: AssetManifestGeometryHint
): AssetTransferManifest | null {
  if (!track) return null;

  const relayManifest = track.relayManifest ?? null;
  const preferredManifest = relayManifest ?? track.pieceManifest ?? null;
  const availabilityMatchesSnapshot =
    !relayManifest ||
    (availability?.totalChunks === relayManifest.totalChunks &&
      availability.chunkSize === relayManifest.chunkSize);
  const usableAvailability = availabilityMatchesSnapshot ? availability : null;
  const totalChunks =
    relayManifest?.totalChunks ??
    usableAvailability?.totalChunks ??
    manifestHint?.totalChunks ??
    preferredManifest?.totalChunks ??
    0;
  const chunkSize =
    relayManifest?.chunkSize ??
    usableAvailability?.chunkSize ??
    manifestHint?.chunkSize ??
    preferredManifest?.chunkSize ??
    0;
  if (totalChunks <= 0 || chunkSize <= 0) return null;

  return {
    trackId: track.id,
    fileHash: track.fileHash,
    mimeType: preferredManifest?.pieceMimeType ?? track.mimeType ?? "audio/mpeg",
    codec: track.codec ?? null,
    sizeBytes: track.sizeBytes ?? null,
    durationMs: track.durationMs,
    totalChunks,
    chunkSize
  };
}

export function getAssetTransferManifestKey(
  track: TrackMeta | null | undefined,
  availability: AssetManifestGeometryHint,
  manifestHint?: AssetManifestGeometryHint
) {
  const manifest = buildAssetTransferManifest(track, availability, manifestHint);
  if (!manifest) return "none";
  return [
    manifest.trackId,
    manifest.fileHash,
    manifest.mimeType,
    manifest.codec ?? "",
    manifest.sizeBytes ?? "",
    manifest.durationMs,
    manifest.totalChunks,
    manifest.chunkSize
  ].join("|");
}

export function getEffectivePlaybackPositionMs(
  playback: PlaybackSnapshot | null | undefined,
  durationMs: number,
  now = getRoomPlaybackClockNowMs()
) {
  if (!playback) return 0;
  if (playback.status !== "playing" || !playback.startedAt) {
    return durationMs > 0 ? Math.min(playback.positionMs, durationMs) : playback.positionMs;
  }
  const startedAt = new Date(playback.startedAt).getTime();
  if (Number.isNaN(startedAt)) return playback.positionMs;
  const nextPositionMs = playback.positionMs + Math.max(0, now - startedAt);
  return durationMs > 0 ? Math.min(nextPositionMs, durationMs) : nextPositionMs;
}

export function isStartupReady(input: {
  manifest: AssetTransferManifest | null;
  availableChunks: number[];
  playbackPositionMs: number;
}) {
  if (!input.manifest) return false;
  return getDecodableAheadBufferedMs(input) >= Math.min(
    input.manifest.durationMs,
    getStartupWindowMs(input.manifest)
  );
}

export function getPriorityChunkIndexes(input: {
  manifest: AssetTransferManifest;
  availableChunks: number[];
  playbackPositionMs: number;
  policy: AssetTransferPolicy;
  lookBehindMs?: number;
  lookAheadMs?: number;
}) {
  const { manifest, playbackPositionMs, policy } = input;
  const owned = new Set(input.availableChunks);
  const wantedChunks: number[] = [];
  const seen = new Set<number>();
  const lookBehindMs = input.lookBehindMs ?? (policy === "steady" || policy === "background" ? 8_000 : 0);
  const lookAheadMs = input.lookAheadMs ?? (
    policy === "pause-fill"
      ? manifest.durationMs
      : policy === "outrun-recovery"
        ? Math.max(getRemoteFirstComfortBufferMs(manifest), getTargetSteadyBufferMs(manifest) * 2)
        : policy === "steady" || policy === "background"
          ? getTargetSteadyBufferMs(manifest)
          : getStartupWindowMs(manifest)
  );
  const currentChunkIndex = getChunkIndexForPositionMs(manifest, playbackPositionMs);
  const startChunkIndex = getChunkIndexForPositionMs(
    manifest,
    Math.max(0, playbackPositionMs - lookBehindMs)
  );
  const endChunkIndex = Math.max(
    currentChunkIndex,
    getChunkIndexForPositionMs(manifest, Math.min(manifest.durationMs, playbackPositionMs + lookAheadMs))
  );
  const requiredLeadingChunkCount = getRequiredDecodablePrefixChunkCount({
    manifest,
    playbackPositionMs,
    lookAheadMs: Math.max(lookAheadMs, getStartupWindowMs(manifest))
  });
  const contiguousOwnedPrefixEnd = (() => {
    let end = 0;
    while (end < manifest.totalChunks && owned.has(end)) end += 1;
    return end;
  })();
  const append = (from: number, to: number, step: 1 | -1) => {
    for (let index = from; step === 1 ? index <= to : index >= to; index += step) {
      if (index >= 0 && index < manifest.totalChunks && !owned.has(index) && !seen.has(index)) {
        seen.add(index);
        wantedChunks.push(index);
      }
    }
  };

  append(0, requiredLeadingChunkCount - 1, 1);
  const mustFillPrefix =
    policy === "startup" ||
    policy === "catchup" ||
    policy === "outrun-recovery" ||
    contiguousOwnedPrefixEnd < requiredLeadingChunkCount;
  if (mustFillPrefix && contiguousOwnedPrefixEnd < requiredLeadingChunkCount) {
    append(
      contiguousOwnedPrefixEnd,
      Math.min(manifest.totalChunks - 1, Math.max(requiredLeadingChunkCount - 1, contiguousOwnedPrefixEnd + 24)),
      1
    );
    return wantedChunks;
  }
  append(currentChunkIndex, endChunkIndex, 1);
  append(currentChunkIndex - 1, startChunkIndex, -1);
  if (policy === "outrun-recovery" || policy === "pause-fill") {
    append(endChunkIndex + 1, manifest.totalChunks - 1, 1);
  }
  if (policy === "pause-fill") append(startChunkIndex - 1, 0, -1);
  return wantedChunks;
}

export function getAssetTransferFillTimeMs(input: {
  manifest: AssetTransferManifest | null;
  availableChunks: number[];
  downloadRateKbps: number | null;
  playbackPositionMs?: number | null;
  lookBehindMs?: number;
  lookAheadMs?: number;
}) {
  if (!input.manifest) return null;
  const owned = new Set(input.availableChunks);
  const missing = typeof input.playbackPositionMs === "number" && typeof input.lookAheadMs === "number"
    ? getPriorityChunkIndexes({
        manifest: input.manifest,
        availableChunks: input.availableChunks,
        playbackPositionMs: input.playbackPositionMs,
        policy: "startup",
        lookBehindMs: input.lookBehindMs,
        lookAheadMs: input.lookAheadMs
      })
    : [...Array(input.manifest.totalChunks).keys()].filter((index) => !owned.has(index));
  if (missing.length === 0) return 0;
  if (input.downloadRateKbps === null || !Number.isFinite(input.downloadRateKbps) || input.downloadRateKbps <= 0) {
    return null;
  }
  return Math.ceil(missing.length * input.manifest.chunkSize * 8 / (input.downloadRateKbps * 1000) * 1000);
}
