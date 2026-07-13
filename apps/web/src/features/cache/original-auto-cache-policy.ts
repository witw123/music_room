export type OriginalAutoCacheInputs = {
  playbackBufferedMs: number;
  completePlaybackProviderCount: number;
  throughputKbps: number | null;
  rttP95Ms: number | null;
  playbackChannelBufferedBytes: number;
  deadlineMissesLast30s: number;
  availableStorageBytes: number | null;
  originalSizeBytes: number;
};

export function shouldStartOriginalAutoCache(input: OriginalAutoCacheInputs) {
  const requiredStorage = Math.max(Math.ceil(input.originalSizeBytes * 1.2), 500 * 1024 * 1024);
  return (
    input.playbackBufferedMs >= 30_000 &&
    input.completePlaybackProviderCount >= 2 &&
    (input.throughputKbps ?? 0) >= 768 &&
    (input.rttP95Ms ?? Number.POSITIVE_INFINITY) < 500 &&
    input.playbackChannelBufferedBytes < 512 * 1024 &&
    input.deadlineMissesLast30s === 0 &&
    (input.availableStorageBytes ?? 0) >= requiredStorage
  );
}

export function shouldPauseOriginalAutoCache(input: Pick<
  OriginalAutoCacheInputs,
  "playbackBufferedMs" | "throughputKbps" | "playbackChannelBufferedBytes" | "deadlineMissesLast30s"
>) {
  return (
    input.playbackBufferedMs < 20_000 ||
    (input.throughputKbps ?? 0) < 384 ||
    input.playbackChannelBufferedBytes >= 512 * 1024 ||
    input.deadlineMissesLast30s > 0
  );
}
