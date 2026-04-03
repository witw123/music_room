import type { TrackAvailabilityAnnouncement } from "@music-room/shared";

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

  if (
    existing &&
    existing.totalChunks === announcement.totalChunks &&
    existing.chunkSize === announcement.chunkSize &&
    existing.source === announcement.source &&
    existing.availableChunks.length === announcement.availableChunks.length &&
    existing.availableChunks.every((chunk, index) => chunk === announcement.availableChunks[index])
  ) {
    return current;
  }

  return {
    ...current,
    [announcement.trackId]: {
      ...trackAvailability,
      [announcement.ownerPeerId]: announcement
    }
  };
}
