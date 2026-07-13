import type { AssetAvailabilityAnnouncement, AssetUnitRange } from "./asset-models";

export function unitIndexesToRanges(
  unitIndexes: readonly number[],
  totalUnits = Number.MAX_SAFE_INTEGER
): AssetUnitRange[] {
  const indexes = [...new Set(unitIndexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < totalUnits)
    .sort((left, right) => left - right);
  const ranges: AssetUnitRange[] = [];
  for (const index of indexes) {
    const previous = ranges[ranges.length - 1];
    if (previous && previous.end + 1 === index) {
      previous.end = index;
    } else {
      ranges.push({ start: index, end: index });
    }
  }
  return ranges;
}

export function rangesToUnitIndexes(
  ranges: readonly AssetUnitRange[],
  totalUnits = Number.MAX_SAFE_INTEGER
) {
  const indexes: number[] = [];
  for (const range of ranges) {
    const start = Math.max(0, Math.min(totalUnits - 1, range.start));
    const end = Math.max(start, Math.min(totalUnits - 1, range.end));
    for (let index = start; index <= end; index += 1) {
      indexes.push(index);
    }
  }
  return [...new Set(indexes)].sort((left, right) => left - right);
}

export function mergeAssetAvailability(
  existing: AssetAvailabilityAnnouncement | null | undefined,
  incoming: AssetAvailabilityAnnouncement
) {
  if (
    !existing ||
    existing.assetId !== incoming.assetId ||
    existing.ownerPeerId !== incoming.ownerPeerId ||
    existing.totalUnits !== incoming.totalUnits
  ) {
    return incoming;
  }
  if (Date.parse(incoming.announcedAt) < Date.parse(existing.announcedAt)) {
    return existing;
  }
  const ranges = unitIndexesToRanges(
    [
      ...rangesToUnitIndexes(existing.availableRanges, existing.totalUnits),
      ...rangesToUnitIndexes(incoming.availableRanges, incoming.totalUnits)
    ],
    incoming.totalUnits
  );
  return {
    ...incoming,
    availableRanges: ranges,
    complete: ranges.length === 1 && ranges[0]?.start === 0 && ranges[0]?.end === incoming.totalUnits - 1
  } satisfies AssetAvailabilityAnnouncement;
}

export function assetAvailabilityKey(
  announcement: Pick<AssetAvailabilityAnnouncement, "assetId" | "ownerPeerId">
) {
  return `${announcement.assetId}:${announcement.ownerPeerId}`;
}
