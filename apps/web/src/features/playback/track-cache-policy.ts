"use client";

import type { UploadedTrack } from "@/features/upload/audio-utils";

export const enableTrackCaching = false;

export function isCacheBackedUploadedTrack(track: UploadedTrack | null | undefined) {
  return !!track && track.origin !== "live-upload";
}

export function canUseUploadedTrackForPlayback(track: UploadedTrack | null | undefined) {
  if (!track) {
    return false;
  }

  return track.origin === "live-upload" || enableTrackCaching;
}

export function getPlayableUploadedTrack(track: UploadedTrack | null | undefined) {
  return canUseUploadedTrackForPlayback(track) ? track : null;
}
