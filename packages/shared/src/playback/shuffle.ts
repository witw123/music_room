export type ShuffleRandom = () => number;

export function shuffleTrackIds(
  trackIds: readonly string[],
  random: ShuffleRandom = Math.random
) {
  const result = [...new Set(trackIds)];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const value = random();
    const normalized = Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
    const swapIndex = Math.floor(normalized * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }

  return result;
}

/**
 * Keeps unplayed ids in their current order, adds newly queued ids, and starts
 * a fresh cycle only after the previous bag has been consumed.
 */
export function synchronizeShuffleBagTrackIds(
  bag: readonly string[],
  trackIds: readonly string[],
  currentTrackId: string | null,
  random: ShuffleRandom = Math.random
) {
  const uniqueTrackIds = [...new Set(trackIds)];
  const trackIdSet = new Set(uniqueTrackIds);
  const retained = [...new Set(bag)].filter((trackId) =>
    trackIdSet.has(trackId) && trackId !== currentTrackId
  );
  const retainedSet = new Set(retained);
  const additions = uniqueTrackIds.filter((trackId) =>
    trackId !== currentTrackId && !retainedSet.has(trackId)
  );

  if (retained.length > 0 || additions.length > 0) {
    return [...retained, ...shuffleTrackIds(additions, random)];
  }

  return shuffleTrackIds(
    uniqueTrackIds.length === 1
      ? uniqueTrackIds
      : uniqueTrackIds.filter((trackId) => trackId !== currentTrackId),
    random
  );
}

export function takeNextShuffleTrack<T extends { id: string }>(
  tracks: readonly T[],
  bag: readonly string[],
  currentTrackId: string | null,
  isPlayable: (track: T) => boolean,
  random: ShuffleRandom = Math.random
) {
  const trackIds = tracks.map((track) => track.id);
  const nextBag = synchronizeShuffleBagTrackIds(bag, trackIds, currentTrackId, random);
  const trackById = new Map(tracks.map((track) => [track.id, track] as const));
  const nextTrackId = nextBag.find((trackId) => {
    const track = trackById.get(trackId);
    return trackId !== currentTrackId && !!track && isPlayable(track);
  });

  if (nextTrackId) {
    return {
      track: trackById.get(nextTrackId) ?? null,
      bag: nextBag.filter((trackId) => trackId !== nextTrackId)
    };
  }

  const onlyTrackId = [...new Set(trackIds)][0];
  const onlyTrack = onlyTrackId ? trackById.get(onlyTrackId) : undefined;
  if (
    onlyTrackId &&
    onlyTrackId === currentTrackId &&
    onlyTrack &&
    isPlayable(onlyTrack)
  ) {
    return { track: onlyTrack, bag: [] };
  }

  return { track: null, bag: nextBag };
}
