import type { ProgressiveTrackManifest } from "./progressive-playback";

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

export function getChunkIndexForPositionMs(
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

function getContiguousChunkCountFrom(input: {
  availableChunks: number[];
  startChunkIndex: number;
  totalChunks: number;
}) {
  if (input.totalChunks <= 0) {
    return 0;
  }

  const availableChunkSet = new Set(
    input.availableChunks.filter(
      (chunkIndex) => chunkIndex >= 0 && chunkIndex < input.totalChunks
    )
  );
  let contiguousChunkCount = 0;
  for (
    let chunkIndex = Math.max(0, input.startChunkIndex);
    chunkIndex < input.totalChunks;
    chunkIndex += 1
  ) {
    if (!availableChunkSet.has(chunkIndex)) {
      break;
    }
    contiguousChunkCount += 1;
  }
  return contiguousChunkCount;
}

export function getAheadBufferedMs(input: {
  manifest: ProgressiveTrackManifest | null;
  availableChunks: number[];
  playbackPositionMs: number;
}) {
  const { manifest } = input;
  if (!manifest || manifest.totalChunks <= 0 || manifest.durationMs <= 0) {
    return 0;
  }

  const currentChunkIndex = getChunkIndexForPositionMs(
    manifest,
    input.playbackPositionMs
  );
  const contiguousChunkCount = getContiguousChunkCountFrom({
    availableChunks: input.availableChunks,
    startChunkIndex: currentChunkIndex,
    totalChunks: manifest.totalChunks
  });
  if (contiguousChunkCount <= 0) {
    return 0;
  }

  const chunkDurationMs = manifest.durationMs / manifest.totalChunks;
  const bufferedEndMs = Math.min(
    manifest.durationMs,
    (currentChunkIndex + contiguousChunkCount) * chunkDurationMs
  );
  return Math.max(0, Math.floor(bufferedEndMs - Math.max(0, input.playbackPositionMs)));
}

export function getDecodableAheadBufferedMs(input: {
  manifest: ProgressiveTrackManifest | null;
  availableChunks: number[];
  playbackPositionMs: number;
}) {
  if (!input.manifest) {
    return 0;
  }

  const contiguousBufferedMs = getContiguousBufferedMs(input.manifest, input.availableChunks);
  return Math.max(0, Math.floor(contiguousBufferedMs - Math.max(0, input.playbackPositionMs)));
}
