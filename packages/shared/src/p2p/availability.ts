import type { TrackAvailabilityAnnouncement } from "./models";

export function mergeTrackAvailabilityAnnouncement(
  existing: TrackAvailabilityAnnouncement | null | undefined,
  announcement: TrackAvailabilityAnnouncement
) {
  if (!existing) {
    return announcement;
  }

  if (!canMergeTrackAvailabilityAnnouncements(existing, announcement)) {
    return announcement;
  }

  const mergedChunks = uniqueSortedValidChunks(
    [...existing.availableChunks, ...announcement.availableChunks],
    announcement.totalChunks
  );
  const existingChunks = uniqueSortedValidChunks(existing.availableChunks, existing.totalChunks);
  const hasNewChunks =
    mergedChunks.length !== existingChunks.length ||
    mergedChunks.some((chunk, index) => chunk !== existingChunks[index]);
  const hasNewPieceHashes = !existing.pieceHashes?.length && !!announcement.pieceHashes?.length;

  if (!hasNewChunks && !hasNewPieceHashes) {
    return existing;
  }

  return {
    ...existing,
    ...announcement,
    assetKind: announcement.assetKind ?? existing.assetKind,
    assetHash: announcement.assetHash ?? existing.assetHash,
    availableChunks: mergedChunks,
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
