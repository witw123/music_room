import {
  backfillCachedLibraryTrackMetadataIfNeeded,
  musicRoomDatabase,
  toCachedLibraryTrackSummaryRecord,
  type AssetUnitDescriptor,
  type CachedLibraryTrackRecord,
  type CachedLibraryTrackSummaryRecord
} from "./database";

export { backfillCachedLibraryTrackMetadataIfNeeded, toCachedLibraryTrackSummaryRecord };

export function removeCachedLibrarySourceReferences(
  record: Pick<
    CachedLibraryTrackRecord,
    "sourceTrackIds" | "sourceRoomIds" | "lastSourceTrackId" | "lastSourceRoomId" | "lastOwnerNickname"
  >,
  removedTrackIds: readonly string[],
  removedRoomId?: string
) {
  const removed = new Set(removedTrackIds);
  const shouldRemoveReference = (trackId: string | undefined, index: number) =>
    !!trackId &&
    removed.has(trackId) &&
    (!removedRoomId || record.sourceRoomIds[index] === removedRoomId || record.sourceRoomIds[index] === undefined);
  const sourceTrackIds = record.sourceTrackIds.filter(
    (trackId, index) => !shouldRemoveReference(trackId, index)
  );
  const sourceRoomIds = record.sourceRoomIds.filter(
    (_, index) => !shouldRemoveReference(record.sourceTrackIds[index], index)
  );
  const lastSourceTrackId = record.lastSourceTrackId && sourceTrackIds.includes(record.lastSourceTrackId)
    ? record.lastSourceTrackId
    : sourceTrackIds[sourceTrackIds.length - 1] ?? null;
  const lastSourceWasRemoved = lastSourceTrackId !== record.lastSourceTrackId;

  return {
    sourceTrackIds,
    sourceRoomIds,
    lastSourceTrackId,
    lastSourceRoomId: lastSourceWasRemoved ? null : record.lastSourceRoomId,
    lastOwnerNickname: lastSourceWasRemoved ? null : record.lastOwnerNickname,
    isUnreferenced: sourceTrackIds.length === 0
  };
}


export async function upsertCachedLibraryTrack(input: Omit<CachedLibraryTrackRecord, "cachedAt"> & {
  cachedAt?: string;
}) {
  const existing = await musicRoomDatabase.cachedTrackLibraryMetadata.get(input.fileHash);
  const cachedAt = input.cachedAt ?? existing?.cachedAt ?? new Date().toISOString();
  const record: CachedLibraryTrackRecord = {
    ...input,
    ...(input.loudness ?? existing?.loudness
      ? { loudness: input.loudness ?? existing?.loudness }
      : {}),
    cachedAt,
    sourceTrackIds: [...new Set([...(existing?.sourceTrackIds ?? []), ...input.sourceTrackIds])],
    sourceRoomIds: [...new Set([...(existing?.sourceRoomIds ?? []), ...input.sourceRoomIds])]
  };
  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.cachedTrackLibrary,
    musicRoomDatabase.cachedTrackLibraryMetadata,
    async () => {
      await musicRoomDatabase.cachedTrackLibrary.put(record);
      await musicRoomDatabase.cachedTrackLibraryMetadata.put(
        toCachedLibraryTrackSummaryRecord(record)
      );
    }
  );
}

export async function putPlaybackAssetDraftUnit(input: {
  draftId: string;
  unitIndex: number;
  descriptor: Omit<AssetUnitDescriptor, "assetId" | "contentHash" | "proof">;
  contentHash: string;
  payload: ArrayBuffer;
}) {
  await putPlaybackAssetDraftUnits({
    draftId: input.draftId,
    units: [input]
  });
}

export async function putPlaybackAssetDraftUnits(input: {
  draftId: string;
  units: Array<{
    unitIndex: number;
    descriptor: Omit<AssetUnitDescriptor, "assetId" | "contentHash" | "proof">;
    contentHash: string;
    payload: ArrayBuffer;
  }>;
}) {
  if (input.units.length === 0) return;
  const createdAt = new Date().toISOString();
  await musicRoomDatabase.playbackAssetDraftUnits.bulkPut(
    input.units.map((unit) => ({
      draftUnitId: `${input.draftId}:${unit.unitIndex}`,
      draftId: input.draftId,
      unitIndex: unit.unitIndex,
      descriptor: unit.descriptor,
      contentHash: unit.contentHash,
      payload: unit.payload,
      createdAt
    }))
  );
}

export async function getPlaybackAssetDraftUnitBatch(
  draftId: string,
  offset: number,
  limit: number
) {
  return musicRoomDatabase.playbackAssetDraftUnits
    .where("[draftId+unitIndex]")
    .between(
      [draftId, Math.max(0, offset)],
      [draftId, Number.MAX_SAFE_INTEGER],
      true,
      false
    )
    .limit(Math.max(1, limit))
    .toArray();
}

export async function deletePlaybackAssetDraft(draftId: string) {
  await musicRoomDatabase.playbackAssetDraftUnits.where("draftId").equals(draftId).delete();
}

export async function releaseAssetUnitsToLocalRepository(assetId: string) {
  await musicRoomDatabase.assetUnits.where("assetId").equals(assetId).delete();
}

export async function listCachedLibraryTracks() {
  return musicRoomDatabase.cachedTrackLibrary.orderBy("cachedAt").reverse().toArray();
}

export async function listCachedLibraryTrackSummaries() {
  await backfillCachedLibraryTrackMetadataIfNeeded();
  return musicRoomDatabase.cachedTrackLibraryMetadata.orderBy("cachedAt").reverse().toArray();
}

export async function listCachedLibraryTrackHashes() {
  const keys = await musicRoomDatabase.cachedTrackLibrary.toCollection().primaryKeys();
  return keys.filter((key): key is string => typeof key === "string");
}

export async function getCachedLibraryTrack(fileHash: string) {
  return musicRoomDatabase.cachedTrackLibrary.get(fileHash);
}

export async function getCachedLibraryTrackByProviderTrack(
  provider: "netease" | "qqmusic",
  providerTrackId: string
) {
  return musicRoomDatabase.cachedTrackLibrary
    .filter((record) =>
      record.provider === provider && record.providerTrackId === providerTrackId
    )
    .first();
}

export async function deleteCachedLibraryTrackFile(fileHash: string) {
  await musicRoomDatabase.cachedTrackLibrary.delete(fileHash);
}

export async function getCachedLibraryTrackSummary(fileHash: string) {
  const summary = await musicRoomDatabase.cachedTrackLibraryMetadata.get(fileHash);
  if (summary) {
    return summary;
  }

  const record = await musicRoomDatabase.cachedTrackLibrary.get(fileHash);
  if (!record) {
    return null;
  }

  const backfilledSummary = toCachedLibraryTrackSummaryRecord(record);
  await musicRoomDatabase.cachedTrackLibraryMetadata.put(backfilledSummary);
  return backfilledSummary;
}

export async function getCachedLibraryTrackCount() {
  await backfillCachedLibraryTrackMetadataIfNeeded();
  return musicRoomDatabase.cachedTrackLibraryMetadata.count();
}

export async function deleteCachedLibraryTrack(fileHash: string) {
  const record = await musicRoomDatabase.cachedTrackLibrary.get(fileHash);
  if (!record) {
    await musicRoomDatabase.cachedTrackLibraryMetadata.delete(fileHash);
    return null;
  }

  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.cachedTrackLibrary,
    musicRoomDatabase.cachedTrackLibraryMetadata,
    async () => {
      await musicRoomDatabase.cachedTrackLibrary.delete(fileHash);
      await musicRoomDatabase.cachedTrackLibraryMetadata.delete(fileHash);
    }
  );
  return record;
}

export async function upsertCachedLibraryTrackSummary(
  input: CachedLibraryTrackSummaryRecord
) {
  const existing = await musicRoomDatabase.cachedTrackLibraryMetadata.get(input.fileHash);
  await musicRoomDatabase.cachedTrackLibraryMetadata.put({
    ...existing,
    ...input,
    sourceTrackIds: [...new Set([...(existing?.sourceTrackIds ?? []), ...input.sourceTrackIds])],
    sourceRoomIds: [...new Set([...(existing?.sourceRoomIds ?? []), ...input.sourceRoomIds])]
  });
}

