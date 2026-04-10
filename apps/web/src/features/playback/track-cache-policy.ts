"use client";

import type { UploadedTrack } from "@/features/upload/audio-utils";

export const enablePlaybackCacheTakeover = false;
export const enableManualTrackCaching = true;
export const enableTrackCaching = enablePlaybackCacheTakeover;

export function isCacheBackedUploadedTrack(track: UploadedTrack | null | undefined) {
  return !!track && track.origin !== "live-upload" && track.origin !== "cache-library";
}

export function canUseUploadedTrackForPlayback(track: UploadedTrack | null | undefined) {
  if (!track) {
    return false;
  }

  return (
    track.origin === "live-upload" ||
    track.origin === "cache-library" ||
    enablePlaybackCacheTakeover
  );
}

export function getPlayableUploadedTrack(track: UploadedTrack | null | undefined) {
  return canUseUploadedTrackForPlayback(track) ? track : null;
}
