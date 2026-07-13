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
  const requiredStorage = Math.ceil(input.originalSizeBytes * 1.15) + 32 * 1024 * 1024;
  const throughputHealthy = input.throughputKbps === null || input.throughputKbps >= 512;
  const latencyHealthy = input.rttP95Ms === null || input.rttP95Ms < 750;
  return (
    input.playbackBufferedMs >= 12_000 &&
    input.completePlaybackProviderCount >= 1 &&
    throughputHealthy &&
    latencyHealthy &&
    input.playbackChannelBufferedBytes < 1024 * 1024 &&
    input.deadlineMissesLast30s <= 1 &&
    input.availableStorageBytes !== null &&
    input.availableStorageBytes >= requiredStorage
  );
}

export function shouldPauseOriginalAutoCache(input: Pick<
  OriginalAutoCacheInputs,
  "playbackBufferedMs" | "throughputKbps" | "playbackChannelBufferedBytes" | "deadlineMissesLast30s"
>) {
  return (
    input.playbackBufferedMs < 8_000 ||
    (input.throughputKbps !== null && input.throughputKbps < 256) ||
    input.playbackChannelBufferedBytes >= 1024 * 1024 ||
    input.deadlineMissesLast30s > 1
  );
}
