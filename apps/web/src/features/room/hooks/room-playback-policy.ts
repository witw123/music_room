"use client";

export function shouldMaintainCachedPlaybackSurface(input: {
  currentTrackId: string | null | undefined;
  hasLocalSource: boolean;
}) {
  return !!input.currentTrackId && input.hasLocalSource;
}
