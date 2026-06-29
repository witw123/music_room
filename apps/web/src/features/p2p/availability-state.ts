import {
  mergeTrackAvailabilityAnnouncement,
  type TrackAvailabilityAnnouncement
} from "@music-room/shared";

export type AvailabilityState = Record<string, Record<string, TrackAvailabilityAnnouncement>>;

export function buildLocalPieceAvailabilityAnnouncement(input: {
  existing?: TrackAvailabilityAnnouncement | null;
  roomId: string;
  trackId: string;
  ownerPeerId: string;
  nickname: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
}) {
  const existing = input.existing ?? null;
  const availableChunkSet = new Set(existing?.availableChunks ?? []);
  const previousChunkCount = availableChunkSet.size;
  availableChunkSet.add(input.chunkIndex);

  const nextTotalChunks = Math.max(input.totalChunks, existing?.totalChunks ?? 0);
  const nextChunkSize = existing?.chunkSize ?? input.chunkSize;

  if (
    existing &&
    availableChunkSet.size === previousChunkCount &&
    existing.totalChunks === nextTotalChunks &&
    existing.chunkSize === nextChunkSize
  ) {
    return existing;
  }

  return {
    roomId: input.roomId,
    trackId: input.trackId,
    ownerPeerId: input.ownerPeerId,
    nickname: input.nickname,
    assetKind: existing?.assetKind ?? "relay",
    assetHash: existing?.assetHash ?? input.trackId,
    totalChunks: nextTotalChunks,
    chunkSize: nextChunkSize,
    availableChunks: [...availableChunkSet].sort((left, right) => left - right),
    source: existing?.source ?? ("local_cache" as const),
    announcedAt: new Date().toISOString()
  } satisfies TrackAvailabilityAnnouncement;
}

export function upsertAvailabilityAnnouncement(
  current: AvailabilityState,
  announcement: TrackAvailabilityAnnouncement
) {
  const trackAvailability = current[announcement.trackId] ?? {};
  const existing = trackAvailability[announcement.ownerPeerId];
  const nextAnnouncement = mergeTrackAvailabilityAnnouncement(existing, announcement);

  if (
    existing === nextAnnouncement
  ) {
    return current;
  }

  return {
    ...current,
    [announcement.trackId]: {
      ...trackAvailability,
      [announcement.ownerPeerId]: nextAnnouncement
    }
  };
}

export function removeAvailabilityAnnouncementsByPeer(
  current: AvailabilityState,
  ownerPeerId: string
) {
  let changed = false;
  const nextEntries = Object.entries(current)
    .map(([trackId, trackAvailability]) => {
      const nextTrackAvailability = Object.fromEntries(
        Object.entries(trackAvailability).filter(([peerId]) => peerId !== ownerPeerId)
      );

      if (Object.keys(nextTrackAvailability).length !== Object.keys(trackAvailability).length) {
        changed = true;
      }

      return [trackId, nextTrackAvailability] as const;
    })
    .filter(([, trackAvailability]) => Object.keys(trackAvailability).length > 0);

  if (!changed) {
    return current;
  }

  return Object.fromEntries(nextEntries);
}
