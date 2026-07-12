import type { TrackAvailabilityAnnouncement } from "./models";

import type { PieceAvailabilityRange } from "./models";

export function chunkIndexesToAvailabilityRanges(
  chunkIndexes: readonly number[],
  totalChunks = Number.MAX_SAFE_INTEGER
): PieceAvailabilityRange[] {
  const sorted = [...new Set(chunkIndexes)]
    .filter((chunkIndex) => Number.isInteger(chunkIndex) && chunkIndex >= 0 && chunkIndex < totalChunks)
    .sort((left, right) => left - right);
  const ranges: PieceAvailabilityRange[] = [];

  for (const chunkIndex of sorted) {
    const previous = ranges[ranges.length - 1];
    if (previous && chunkIndex === previous.end + 1) {
      previous.end = chunkIndex;
    } else {
      ranges.push({ start: chunkIndex, end: chunkIndex });
    }
  }

  return ranges;
}

export function availabilityRangesToChunkIndexes(
  ranges: readonly PieceAvailabilityRange[],
  totalChunks = Number.MAX_SAFE_INTEGER
) {
  const indexes: number[] = [];
  for (const range of ranges) {
    const start = Math.max(0, Math.min(totalChunks - 1, Math.floor(range.start)));
    const end = Math.max(start, Math.min(totalChunks - 1, Math.floor(range.end)));
    for (let chunkIndex = start; chunkIndex <= end; chunkIndex += 1) {
      indexes.push(chunkIndex);
    }
  }
  return [...new Set(indexes)].sort((left, right) => left - right);
}

export function resolveAnnouncementChunkIndexes(announcement: Pick<TrackAvailabilityAnnouncement, "availableChunks" | "availableRanges" | "totalChunks">) {
  return announcement.availableRanges?.length
    ? availabilityRangesToChunkIndexes(announcement.availableRanges, announcement.totalChunks)
    : uniqueSortedValidChunks(announcement.availableChunks, announcement.totalChunks);
}

export function compactTrackAvailabilityAnnouncement(
  announcement: TrackAvailabilityAnnouncement
) {
  const chunkIndexes = resolveAnnouncementChunkIndexes(announcement);
  return {
    ...announcement,
    availableChunks: [],
    availableRanges: chunkIndexesToAvailabilityRanges(chunkIndexes, announcement.totalChunks)
  } satisfies TrackAvailabilityAnnouncement;
}

export function mergeTrackAvailabilityAnnouncement(
  existing: TrackAvailabilityAnnouncement | null | undefined,
  announcement: TrackAvailabilityAnnouncement
) {
  if (!existing) {
    return normalizeAvailabilityAnnouncement(announcement);
  }

  if (!canMergeTrackAvailabilityAnnouncements(existing, announcement)) {
    return announcement;
  }

  const mergedChunks = uniqueSortedValidChunks(
    [...existing.availableChunks, ...announcement.availableChunks],
    announcement.totalChunks
  );
  const mergedRanges = chunkIndexesToAvailabilityRanges(
    [...resolveAnnouncementChunkIndexes(existing), ...resolveAnnouncementChunkIndexes(announcement)],
    announcement.totalChunks
  );
  const existingChunks = uniqueSortedValidChunks(existing.availableChunks, existing.totalChunks);
  const hasNewChunks =
    mergedChunks.length !== existingChunks.length ||
    mergedChunks.some((chunk, index) => chunk !== existingChunks[index]);
  const hasNewPieceHashes = !existing.pieceHashes?.length && !!announcement.pieceHashes?.length;
  const hasNewRanges =
    !!announcement.availableRanges?.length &&
    JSON.stringify(existing.availableRanges ?? []) !== JSON.stringify(mergedRanges);

  if (!hasNewChunks && !hasNewPieceHashes && !hasNewRanges) {
    return existing;
  }

  return {
    ...existing,
    ...announcement,
    assetKind: announcement.assetKind ?? existing.assetKind,
    assetHash: announcement.assetHash ?? existing.assetHash,
    availableChunks: mergedChunks,
    availableRanges: mergedRanges,
    pieceHashes: announcement.pieceHashes ?? existing.pieceHashes
  } satisfies TrackAvailabilityAnnouncement;
}

export function canMergeTrackAvailabilityAnnouncements(
  existing: TrackAvailabilityAnnouncement,
  announcement: TrackAvailabilityAnnouncement
) {
  return (
    existing.roomId === announcement.roomId &&
    existing.trackId === announcement.trackId &&
    existing.ownerPeerId === announcement.ownerPeerId &&
    existing.totalChunks === announcement.totalChunks &&
    existing.chunkSize === announcement.chunkSize &&
    existing.source === announcement.source &&
    (existing.assetKind ?? "relay") === (announcement.assetKind ?? "relay") &&
    (!existing.assetHash ||
      !announcement.assetHash ||
      existing.assetHash === announcement.assetHash)
  );
}

function uniqueSortedValidChunks(chunks: number[], totalChunks: number) {
  return [...new Set(chunks.filter((chunk) => chunk >= 0 && chunk < totalChunks))].sort(
    (left, right) => left - right
  );
}

function normalizeAvailabilityAnnouncement(announcement: TrackAvailabilityAnnouncement) {
  if (announcement.availableChunks.length > 0 || !announcement.availableRanges?.length) {
    return announcement;
  }

  return {
    ...announcement,
    availableChunks: availabilityRangesToChunkIndexes(
      announcement.availableRanges,
      announcement.totalChunks
    )
  } satisfies TrackAvailabilityAnnouncement;
}
