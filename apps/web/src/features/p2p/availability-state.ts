import type { TrackAvailabilityAnnouncement } from "@music-room/shared";

export type AvailabilityState = Record<string, Record<string, TrackAvailabilityAnnouncement>>;

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
