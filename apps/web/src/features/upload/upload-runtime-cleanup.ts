type TrackIdRuntimeStore = {
  keys: () => IterableIterator<string>;
  delete: (trackId: string) => boolean;
};

type StateSetter<TState> = (updater: (current: TState) => TState) => void;
type RuntimeRef<TValue> = {
  current: TValue;
};

export function syncUploadedTrackObjectUrls(input: {
  currentUrls: Map<string, string>;
  uploadedTracks: Record<string, { objectUrl: string }>;
  revokeObjectUrl: (objectUrl: string) => void;
}) {
  const nextUrls = new Map(
    Object.entries(input.uploadedTracks).map(([trackId, upload]) => [trackId, upload.objectUrl])
  );

  for (const [trackId, objectUrl] of input.currentUrls.entries()) {
    if (nextUrls.get(trackId) !== objectUrl) {
      input.revokeObjectUrl(objectUrl);
    }
  }

  return nextUrls;
}

export function cleanupUploadRuntimeRefs(input: {
  uploadedTrackUrlsRef: RuntimeRef<Map<string, string>>;
  cacheLibraryTracksRef: RuntimeRef<{ clear: () => void }>;
  revokeObjectUrl: (objectUrl: string) => void;
}) {
  for (const objectUrl of input.uploadedTrackUrlsRef.current.values()) {
    input.revokeObjectUrl(objectUrl);
  }
  input.uploadedTrackUrlsRef.current.clear();
  input.cacheLibraryTracksRef.current.clear();
}

export function pruneUploadRuntimeStateForActiveTracks<TUpload>(input: {
  activeTrackIds: Set<string>;
  uploadedTracks: Record<string, TUpload>;
  chunkIndexesByTrack: TrackIdRuntimeStore;
  assemblingTrackIdsByTrack: TrackIdRuntimeStore;
}) {
  for (const trackId of input.chunkIndexesByTrack.keys()) {
    if (!input.activeTrackIds.has(trackId)) {
      input.chunkIndexesByTrack.delete(trackId);
    }
  }

  for (const trackId of input.assemblingTrackIdsByTrack.keys()) {
    if (!input.activeTrackIds.has(trackId)) {
      input.assemblingTrackIdsByTrack.delete(trackId);
    }
  }

  const nextUploadedTracks = { ...input.uploadedTracks };
  for (const trackId of Object.keys(input.uploadedTracks)) {
    if (!input.activeTrackIds.has(trackId)) {
      delete nextUploadedTracks[trackId];
    }
  }
  return nextUploadedTracks;
}

export function applyUploadRuntimePruneForActiveTracks<TUpload>(input: {
  activeTrackIds: Set<string>;
  setUploadedTracks: StateSetter<Record<string, TUpload>>;
  chunkIndexesByTrack: TrackIdRuntimeStore;
  assemblingTrackIdsByTrack: TrackIdRuntimeStore;
}) {
  input.setUploadedTracks((current) =>
    pruneUploadRuntimeStateForActiveTracks({
      activeTrackIds: input.activeTrackIds,
      uploadedTracks: current,
      chunkIndexesByTrack: input.chunkIndexesByTrack,
      assemblingTrackIdsByTrack: input.assemblingTrackIdsByTrack
    })
  );
}

export function removeUploadRuntimeTrackIds<TUpload, TTask>(input: {
  trackIds: string[];
  uploadedTracks: Record<string, TUpload>;
  manualCacheTasks?: Record<string, TTask>;
  chunkIndexesByTrack: TrackIdRuntimeStore;
  assemblingTrackIdsByTrack: TrackIdRuntimeStore;
}) {
  if (input.trackIds.length === 0) {
    return {
      uploadedTracks: input.uploadedTracks,
      manualCacheTasks: input.manualCacheTasks
    };
  }

  for (const trackId of input.trackIds) {
    input.chunkIndexesByTrack.delete(trackId);
    input.assemblingTrackIdsByTrack.delete(trackId);
  }

  const nextUploadedTracks = { ...input.uploadedTracks };
  for (const trackId of input.trackIds) {
    delete nextUploadedTracks[trackId];
  }

  if (!input.manualCacheTasks) {
    return {
      uploadedTracks: nextUploadedTracks,
      manualCacheTasks: input.manualCacheTasks
    };
  }

  const nextManualCacheTasks = { ...input.manualCacheTasks };
  for (const trackId of input.trackIds) {
    delete nextManualCacheTasks[trackId];
  }

  return {
    uploadedTracks: nextUploadedTracks,
    manualCacheTasks: nextManualCacheTasks
  };
}

export function applyUploadRuntimeTrackRemoval<TUpload, TTask>(input: {
  trackIds: string[];
  setUploadedTracks: StateSetter<Record<string, TUpload>>;
  setManualCacheTasks?: StateSetter<Record<string, TTask>>;
  chunkIndexesByTrack: TrackIdRuntimeStore;
  assemblingTrackIdsByTrack: TrackIdRuntimeStore;
}) {
  input.setUploadedTracks(
    (current) =>
      removeUploadRuntimeTrackIds({
        trackIds: input.trackIds,
        uploadedTracks: current,
        chunkIndexesByTrack: input.chunkIndexesByTrack,
        assemblingTrackIdsByTrack: input.assemblingTrackIdsByTrack
      }).uploadedTracks
  );

  input.setManualCacheTasks?.(
    (current) =>
      removeUploadRuntimeTrackIds({
        trackIds: input.trackIds,
        uploadedTracks: {},
        manualCacheTasks: current,
        chunkIndexesByTrack: input.chunkIndexesByTrack,
        assemblingTrackIdsByTrack: input.assemblingTrackIdsByTrack
      }).manualCacheTasks ?? current
  );
}
