export const cachePolicy = {
  manualTrackCaching: true,
  automaticLocalPlaybackTakeover: true,
  cacheOnlyPlayback: true
} as const;

export const enableManualTrackCaching = cachePolicy.manualTrackCaching;
export const enableTrackCaching = cachePolicy.automaticLocalPlaybackTakeover;
export const enableCacheOnlyPlayback = cachePolicy.cacheOnlyPlayback;
