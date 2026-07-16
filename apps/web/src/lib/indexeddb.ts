import Dexie, { type Table } from "dexie";
import {
  assetUnitDescriptorSchema,
  playbackProfileId,
  verifyAssetUnit,
  type AssetKind,
  type AssetUnitDescriptor,
  type AudioAssetManifest
} from "@music-room/shared";

export type CachedLibraryTrackRecord = {
  fileHash: string;
  title: string;
  artist: string;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  file: Blob;
  cachedAt: string;
  sourceTrackIds: string[];
  sourceRoomIds: string[];
  lastSourceTrackId: string | null;
  lastSourceRoomId: string | null;
  lastOwnerNickname: string | null;
};

export type CachedLibraryTrackSummaryRecord = Omit<CachedLibraryTrackRecord, "file">;

export function removeCachedLibrarySourceReferences(
  record: Pick<
    CachedLibraryTrackRecord,
    "sourceTrackIds" | "lastSourceTrackId" | "lastSourceRoomId" | "lastOwnerNickname"
  >,
  removedTrackIds: readonly string[]
) {
  const removed = new Set(removedTrackIds);
  const sourceTrackIds = record.sourceTrackIds.filter((trackId) => !removed.has(trackId));
  const lastSourceTrackId = record.lastSourceTrackId && sourceTrackIds.includes(record.lastSourceTrackId)
    ? record.lastSourceTrackId
    : sourceTrackIds[sourceTrackIds.length - 1] ?? null;
  const lastSourceWasRemoved = lastSourceTrackId !== record.lastSourceTrackId;

  return {
    sourceTrackIds,
    lastSourceTrackId,
    lastSourceRoomId: lastSourceWasRemoved ? null : record.lastSourceRoomId,
    lastOwnerNickname: lastSourceWasRemoved ? null : record.lastOwnerNickname,
    isUnreferenced: sourceTrackIds.length === 0
  };
}

export type AudioAssetManifestRecord = {
  assetId: string;
  kind: AssetKind;
  sourceFileHash: string;
  manifest: AudioAssetManifest;
  complete: boolean;
  createdAt: string;
  lastAccessedAt: string;
};

export type AudioAssetUnitRecord = AssetUnitDescriptor & {
  unitId: string;
  payload: ArrayBuffer;
  lastAccessedAt: string;
  protectedUntil: string | null;
};

export type TrackAssetLinkRecord = {
  trackId: string;
  originalAssetId: string;
  playbackAssetId: string;
  linkedAt: string;
};

export type TranscodeJobRecord = {
  sourceFileHash: string;
  kind: "original-reindex" | "playback-transcode";
  profileId: typeof playbackProfileId;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  errorMessage: string | null;
  updatedAt: string;
};

export type LocalAudioDirectoryRecord = {
  id: "default";
  handle: FileSystemDirectoryHandle;
  name: string;
  updatedAt: string;
};

export type LocalAudioFileRecord = {
  fileHash: string;
  fileName: string;
  savedAt: string;
};

export class MusicRoomDatabase extends Dexie {
  cachedTrackLibrary!: Table<CachedLibraryTrackRecord, string>;
  cachedTrackLibraryMetadata!: Table<CachedLibraryTrackSummaryRecord, string>;
  assetManifests!: Table<AudioAssetManifestRecord, string>;
  assetUnits!: Table<AudioAssetUnitRecord, string>;
  trackAssetLinks!: Table<TrackAssetLinkRecord, string>;
  transcodeJobs!: Table<TranscodeJobRecord, string>;
  localAudioDirectory!: Table<LocalAudioDirectoryRecord, string>;
  localAudioFiles!: Table<LocalAudioFileRecord, string>;

  constructor() {
    super("music-room");
    this.version(2).stores({
      trackAssets: "&trackId, fileHash, cachedAt",
      trackPieces: "&pieceId, trackId, peerId, [trackId+peerId], createdAt"
    });
    this.version(3).stores({
      trackAssets: "&trackId, fileHash, cachedAt",
      trackPieces:
        "&pieceId, trackId, peerId, chunkIndex, [trackId+peerId], [trackId+peerId+chunkIndex], createdAt"
    });
    this.version(4).stores({
      trackAssets: "&trackId, fileHash, cachedAt",
      trackPieces:
        "&pieceId, trackId, peerId, chunkIndex, [trackId+peerId], [trackId+peerId+chunkIndex], createdAt",
      trackPieceManifests: "&trackId, fileHash, updatedAt"
    });
    this.version(5).stores({
      trackAssets: "&trackId, fileHash, cachedAt",
      trackPieces:
        "&pieceId, trackId, peerId, chunkIndex, [trackId+peerId], [trackId+peerId+chunkIndex], createdAt",
      trackPieceManifests: "&trackId, fileHash, updatedAt",
      cachedTrackLibrary: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds"
    });
    this.version(6)
      .stores({
        trackAssets: "&trackId, fileHash, cachedAt",
        trackPieces:
          "&pieceId, trackId, fileHash, peerId, ownerKey, chunkIndex, [trackId+peerId], [trackId+peerId+chunkIndex], [trackId+ownerKey], [trackId+ownerKey+chunkIndex], [fileHash+ownerKey], [fileHash+ownerKey+chunkIndex], createdAt",
        trackPieceManifests: "&trackId, fileHash, updatedAt",
        cachedTrackLibrary: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
        manualCacheTasks: "&taskKey, roomId, trackId, fileHash, status, updatedAt, [roomId+trackId]"
      })
      .upgrade(async (transaction) => {
        const pieces = transaction.table("trackPieces");
        await pieces.toCollection().modify((piece: Record<string, unknown>) => {
          piece.ownerKey ??= piece.peerId || "__local__";
          piece.fileHash ??= "";
        });
      });
    this.version(7)
      .stores({
        trackAssets: "&trackId, fileHash, cachedAt",
        trackPieces:
          "&pieceId, trackId, fileHash, peerId, ownerKey, chunkIndex, [trackId+peerId], [trackId+peerId+chunkIndex], [trackId+ownerKey], [trackId+ownerKey+chunkIndex], [fileHash+ownerKey], [fileHash+ownerKey+chunkIndex], createdAt",
        trackPieceManifests: "&trackId, fileHash, updatedAt",
        cachedTrackLibrary: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
        cachedTrackLibraryMetadata: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
        manualCacheTasks: "&taskKey, roomId, trackId, fileHash, status, updatedAt, [roomId+trackId]"
      })
      .upgrade(async (transaction) => {
        const library = transaction.table<CachedLibraryTrackRecord, string>("cachedTrackLibrary");
        const metadata = transaction.table<CachedLibraryTrackSummaryRecord, string>(
          "cachedTrackLibraryMetadata"
        );
        const summaries: CachedLibraryTrackSummaryRecord[] = [];
        await library.each((record) => {
          summaries.push(toCachedLibraryTrackSummaryRecord(record));
        });
        if (summaries.length > 0) {
          await metadata.bulkPut(summaries);
        }
      });
    this.version(8).stores({
      trackAssets: "&trackId, fileHash, cachedAt",
      trackPieces:
        "&pieceId, trackId, fileHash, peerId, ownerKey, chunkIndex, [trackId+peerId], [trackId+peerId+chunkIndex], [trackId+ownerKey], [trackId+ownerKey+chunkIndex], [fileHash+ownerKey], [fileHash+ownerKey+chunkIndex], createdAt",
      trackPieceManifests: "&trackId, fileHash, updatedAt",
      cachedTrackLibrary: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
      cachedTrackLibraryMetadata: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
      manualCacheTasks: "&taskKey, roomId, trackId, fileHash, status, updatedAt, [roomId+trackId]",
      cachedLibraryDeleteLeases: "&fileHash, leaseTrackId, requestedAt"
    });
    this.version(9)
      .stores({
        trackAssets: "&trackId, fileHash, cachedAt",
        trackPieces:
          "&pieceId, trackId, fileHash, peerId, ownerKey, chunkIndex, [trackId+peerId], [trackId+peerId+chunkIndex], [trackId+ownerKey], [trackId+ownerKey+chunkIndex], [fileHash+ownerKey], [fileHash+ownerKey+chunkIndex], createdAt",
        trackPieceManifests: "&trackId, fileHash, updatedAt",
        cachedTrackLibrary: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
        cachedTrackLibraryMetadata: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
        manualCacheTasks: "&taskKey, roomId, trackId, fileHash, status, updatedAt, [roomId+trackId]",
        cachedLibraryDeleteLeases: "&fileHash, leaseTrackId, requestedAt",
        assetManifests: "&assetId, kind, sourceFileHash, complete, lastAccessedAt",
        assetUnits: "&unitId, assetId, kind, unitIndex, [assetId+unitIndex], lastAccessedAt, protectedUntil",
        trackAssetLinks: "&trackId, originalAssetId, playbackAssetId, linkedAt",
        transcodeJobs: "&sourceFileHash, kind, status, updatedAt"
      })
      .upgrade(async (transaction) => {
        await Promise.all([
          transaction.table("trackAssets").clear(),
          transaction.table("trackPieces").clear(),
          transaction.table("trackPieceManifests").clear(),
          transaction.table("manualCacheTasks").clear(),
          transaction.table("cachedLibraryDeleteLeases").clear()
        ]);

        const library = transaction.table<CachedLibraryTrackRecord, string>("cachedTrackLibrary");
        const jobs = transaction.table<TranscodeJobRecord, string>("transcodeJobs");
        const now = new Date().toISOString();
        const queuedJobs: TranscodeJobRecord[] = [];
        await library.each((record) => {
          queuedJobs.push({
            sourceFileHash: record.fileHash,
            kind: "original-reindex",
            profileId: playbackProfileId,
            status: "queued",
            progress: 0,
            errorMessage: null,
            updatedAt: now
          });
        });
        if (queuedJobs.length > 0) {
          await jobs.bulkPut(queuedJobs);
        }
      });
    this.version(10).upgrade(async (transaction) => {
      const manifests = transaction.table<AudioAssetManifestRecord, string>("assetManifests");
      const units = transaction.table<AudioAssetUnitRecord, string>("assetUnits");
      const links = transaction.table<TrackAssetLinkRecord, string>("trackAssetLinks");
      const jobs = transaction.table<TranscodeJobRecord, string>("transcodeJobs");

      // IndexedDB has no runtime types, so old v1 records can still be present
      // while this migration runs even though the current model is v2-only.
      const obsoletePlaybackAssets = await manifests.filter((record) => {
        const manifest = record.manifest as { kind?: unknown; profileId?: unknown };
        return manifest.kind === "playback" && manifest.profileId !== playbackProfileId;
      }).toArray();
      const obsoleteAssetIds = obsoletePlaybackAssets.map((record) => record.assetId);

      if (obsoleteAssetIds.length > 0) {
        await Promise.all([
          units.where("assetId").anyOf(obsoleteAssetIds).delete(),
          links.where("playbackAssetId").anyOf(obsoleteAssetIds).delete(),
          manifests.bulkDelete(obsoleteAssetIds)
        ]);
      }
      await jobs.filter((job) =>
        (job as { profileId?: unknown }).profileId !== playbackProfileId
      ).delete();
    });
    this.version(11)
      .stores({
        cachedTrackLibrary: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
        cachedTrackLibraryMetadata: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
        assetManifests: "&assetId, kind, sourceFileHash, complete, lastAccessedAt",
        assetUnits: "&unitId, assetId, kind, unitIndex, [assetId+unitIndex], lastAccessedAt, protectedUntil",
        trackAssetLinks: "&trackId, originalAssetId, playbackAssetId, linkedAt",
        transcodeJobs: "&sourceFileHash, kind, status, updatedAt"
      })
      .upgrade(async (transaction) => {
        // Remove every pre-v11 room-transfer cache. Only upload-owned library
        // files and locally built audio assets survive this migration.
        await Promise.all([
          transaction.table("trackAssets").clear(),
          transaction.table("trackPieces").clear(),
          transaction.table("trackPieceManifests").clear(),
          transaction.table("manualCacheTasks").clear(),
          transaction.table("cachedLibraryDeleteLeases").clear()
        ]);
      });
    this.version(12).stores({
      // Remove the old room-transfer stores instead of leaving empty tables
      // behind in existing browser databases.
      trackAssets: null,
      trackPieces: null,
      trackPieceManifests: null,
      manualCacheTasks: null,
      cachedLibraryDeleteLeases: null,
      cachedTrackLibrary: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
      cachedTrackLibraryMetadata: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
      assetManifests: "&assetId, kind, sourceFileHash, complete, lastAccessedAt",
      assetUnits: "&unitId, assetId, kind, unitIndex, [assetId+unitIndex], lastAccessedAt, protectedUntil",
      trackAssetLinks: "&trackId, originalAssetId, playbackAssetId, linkedAt",
      transcodeJobs: "&sourceFileHash, kind, status, updatedAt"
    });
    this.version(13).stores({
      cachedTrackLibrary: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
      cachedTrackLibraryMetadata: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
      assetManifests: "&assetId, kind, sourceFileHash, complete, lastAccessedAt",
      assetUnits: "&unitId, assetId, kind, unitIndex, [assetId+unitIndex], lastAccessedAt, protectedUntil",
      trackAssetLinks: "&trackId, originalAssetId, playbackAssetId, linkedAt",
      transcodeJobs: "&sourceFileHash, kind, status, updatedAt",
      localAudioDirectory: "&id",
      localAudioFiles: "&fileHash, savedAt"
    });
  }
}
export const musicRoomDatabase = new MusicRoomDatabase();

export function assetUnitId(assetId: string, unitIndex: number) {
  if (!assetId || !Number.isInteger(unitIndex) || unitIndex < 0) {
    throw new TypeError("A valid asset id and non-negative unit index are required.");
  }
  return `${assetId}:${unitIndex}`;
}

export async function putAssetManifest(
  manifest: AudioAssetManifest,
  options?: { complete?: boolean }
) {
  const now = new Date().toISOString();
  const existing = await musicRoomDatabase.assetManifests.get(manifest.assetId);
  await musicRoomDatabase.assetManifests.put({
    assetId: manifest.assetId,
    kind: manifest.kind,
    sourceFileHash:
      manifest.kind === "original" ? manifest.fileHash : manifest.sourceFileHash,
    manifest,
    complete: options?.complete ?? existing?.complete ?? false,
    createdAt: existing?.createdAt ?? now,
    lastAccessedAt: now
  });
}

export async function getAssetManifest(assetId: string) {
  const record = await musicRoomDatabase.assetManifests.get(assetId);
  if (record) {
    await musicRoomDatabase.assetManifests.update(assetId, {
      lastAccessedAt: new Date().toISOString()
    });
  }
  return record ?? null;
}

export async function deleteAudioAsset(assetId: string) {
  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.assetManifests,
    musicRoomDatabase.assetUnits,
    async () => {
      await musicRoomDatabase.assetUnits.where("assetId").equals(assetId).delete();
      await musicRoomDatabase.assetManifests.delete(assetId);
    }
  );
}

export async function putVerifiedAssetUnit(input: {
  descriptor: AssetUnitDescriptor;
  payload: ArrayBuffer;
  protectedUntil?: string | null;
}) {
  const descriptor = assetUnitDescriptorSchema.parse(input.descriptor);
  const manifestRecord = await musicRoomDatabase.assetManifests.get(descriptor.assetId);
  if (!manifestRecord || manifestRecord.kind !== descriptor.kind) {
    throw new Error("Asset manifest is missing or does not match the unit kind.");
  }
  if (descriptor.unitIndex >= manifestRecord.manifest.unitCount) {
    throw new Error("Asset unit index exceeds the manifest unit count.");
  }
  if (input.payload.byteLength !== descriptor.payloadBytes) {
    throw new Error("Asset unit payload length does not match its descriptor.");
  }
  if (descriptor.unitIndex >= manifestRecord.manifest.unitCount) {
    throw new RangeError("Asset unit index exceeds the manifest unit count.");
  }
  const valid = await verifyAssetUnit({
    unitIndex: descriptor.unitIndex,
    payload: input.payload,
    contentHash: descriptor.contentHash,
    proof: descriptor.proof,
    merkleRoot: manifestRecord.manifest.merkleRoot
  });
  if (!valid) {
    throw new Error("Asset unit failed Merkle verification.");
  }

  const now = new Date().toISOString();
  await musicRoomDatabase.assetUnits.put({
    ...descriptor,
    unitId: assetUnitId(descriptor.assetId, descriptor.unitIndex),
    payload: input.payload,
    lastAccessedAt: now,
    protectedUntil: input.protectedUntil ?? null
  });
  const unitCount = await musicRoomDatabase.assetUnits.where("assetId").equals(descriptor.assetId).count();
  if (unitCount >= manifestRecord.manifest.unitCount) {
    await musicRoomDatabase.assetManifests.update(descriptor.assetId, {
      complete: true,
      lastAccessedAt: now
    });
  }
}

export async function putLocallyGeneratedAssetUnits(input: {
  assetId: string;
  units: Array<{ descriptor: AssetUnitDescriptor; payload: ArrayBuffer }>;
  complete?: boolean;
}) {
  if (input.units.length === 0) return;
  const manifestRecord = await musicRoomDatabase.assetManifests.get(input.assetId);
  if (!manifestRecord) {
    throw new Error("Asset manifest is missing for locally generated units.");
  }
  const now = new Date().toISOString();
  const records = input.units.map(({ descriptor: rawDescriptor, payload }) => {
    const descriptor = assetUnitDescriptorSchema.parse(rawDescriptor);
    if (
      descriptor.assetId !== input.assetId ||
      descriptor.kind !== manifestRecord.kind ||
      descriptor.unitIndex >= manifestRecord.manifest.unitCount ||
      payload.byteLength !== descriptor.payloadBytes
    ) {
      throw new Error("Locally generated asset unit does not match its manifest.");
    }
    return {
      ...descriptor,
      unitId: assetUnitId(descriptor.assetId, descriptor.unitIndex),
      payload,
      lastAccessedAt: now,
      protectedUntil: null
    } satisfies AudioAssetUnitRecord;
  });
  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.assetManifests,
    musicRoomDatabase.assetUnits,
    async () => {
      await musicRoomDatabase.assetUnits.bulkPut(records);
      if (input.complete) {
        const unitCount = await musicRoomDatabase.assetUnits
          .where("assetId")
          .equals(input.assetId)
          .count();
        if (unitCount !== manifestRecord.manifest.unitCount) {
          throw new Error("Locally generated asset is incomplete after persistence.");
        }
        await musicRoomDatabase.assetManifests.update(input.assetId, {
          complete: true,
          lastAccessedAt: now
        });
      }
    }
  );
}

export async function getAssetUnit(assetId: string, unitIndex: number) {
  const unitId = assetUnitId(assetId, unitIndex);
  const record = await musicRoomDatabase.assetUnits.get(unitId);
  if (record) {
    await musicRoomDatabase.assetUnits.update(unitId, {
      lastAccessedAt: new Date().toISOString()
    });
  }
  return record ?? null;
}

export async function getAssetUnits(assetId: string, unitIndexes: readonly number[]) {
  const uniqueIndexes = [...new Set(unitIndexes.filter((index) => Number.isInteger(index) && index >= 0))];
  if (uniqueIndexes.length === 0) {
    return [];
  }
  const records = await musicRoomDatabase.assetUnits.bulkGet(
    uniqueIndexes.map((index) => assetUnitId(assetId, index))
  );
  return records.filter((record): record is AudioAssetUnitRecord => !!record);
}

export async function getAssetUnitIndexes(assetId: string) {
  const keys = await musicRoomDatabase.assetUnits.where("assetId").equals(assetId).primaryKeys();
  return keys.flatMap((key) => {
    if (typeof key !== "string") {
      return [];
    }
    const index = Number(key.slice(key.lastIndexOf(":") + 1));
    return Number.isInteger(index) && index >= 0 ? [index] : [];
  }).sort((left, right) => left - right);
}

export async function linkTrackAssets(input: Omit<TrackAssetLinkRecord, "linkedAt">) {
  await musicRoomDatabase.trackAssetLinks.put({
    ...input,
    linkedAt: new Date().toISOString()
  });
}

export async function getTrackAssetLink(trackId: string) {
  return (await musicRoomDatabase.trackAssetLinks.get(trackId)) ?? null;
}

export async function deleteOriginalAssetForTrack(trackId: string) {
  const link = await getTrackAssetLink(trackId);
  if (link?.originalAssetId) {
    await deleteAudioAsset(link.originalAssetId);
  }
}

export async function upsertTranscodeJob(
  input: Omit<TranscodeJobRecord, "updatedAt">
) {
  await musicRoomDatabase.transcodeJobs.put({
    ...input,
    updatedAt: new Date().toISOString()
  });
}

export async function listQueuedTranscodeJobs() {
  return musicRoomDatabase.transcodeJobs.where("status").equals("queued").toArray();
}

export async function upsertCachedLibraryTrack(input: Omit<CachedLibraryTrackRecord, "cachedAt"> & {
  cachedAt?: string;
}) {
  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.cachedTrackLibrary,
    musicRoomDatabase.cachedTrackLibraryMetadata,
    async () => {
      const existing = await musicRoomDatabase.cachedTrackLibrary.get(input.fileHash);
      const existingSummary =
        existing ?? (await musicRoomDatabase.cachedTrackLibraryMetadata.get(input.fileHash));
      const mergedTrackIds = new Set([
        ...(existingSummary?.sourceTrackIds ?? []),
        ...input.sourceTrackIds
      ]);
      const mergedRoomIds = new Set([
        ...(existingSummary?.sourceRoomIds ?? []),
        ...input.sourceRoomIds
      ]);
      const record = {
        ...existing,
        ...input,
        cachedAt: input.cachedAt ?? existingSummary?.cachedAt ?? new Date().toISOString(),
        sourceTrackIds: [...mergedTrackIds],
        sourceRoomIds: [...mergedRoomIds]
      };

      await musicRoomDatabase.cachedTrackLibrary.put(record);
      await musicRoomDatabase.cachedTrackLibraryMetadata.put(
        toCachedLibraryTrackSummaryRecord(record)
      );
    }
  );
}

export async function listCachedLibraryTracks() {
  return musicRoomDatabase.cachedTrackLibrary.orderBy("cachedAt").reverse().toArray();
}

export async function listCachedLibraryTrackSummaries() {
  await backfillCachedLibraryTrackMetadataIfNeeded();
  return musicRoomDatabase.cachedTrackLibraryMetadata.orderBy("cachedAt").reverse().toArray();
}

export async function getCachedLibraryTrack(fileHash: string) {
  return musicRoomDatabase.cachedTrackLibrary.get(fileHash);
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

export async function getLocalAudioDirectory() {
  return (await musicRoomDatabase.localAudioDirectory.get("default")) ?? null;
}

export async function saveLocalAudioDirectory(input: {
  handle: FileSystemDirectoryHandle;
  name: string;
}) {
  await musicRoomDatabase.localAudioDirectory.put({
    id: "default",
    handle: input.handle,
    name: input.name,
    updatedAt: new Date().toISOString()
  });
}

export async function listLocalAudioFiles() {
  return musicRoomDatabase.localAudioFiles.orderBy("savedAt").reverse().toArray();
}

export async function getLocalAudioFileRecord(fileHash: string) {
  return (await musicRoomDatabase.localAudioFiles.get(fileHash)) ?? null;
}

export async function saveLocalAudioFileRecord(input: Omit<LocalAudioFileRecord, "savedAt"> & {
  savedAt?: string;
}) {
  await musicRoomDatabase.localAudioFiles.put({
    ...input,
    savedAt: input.savedAt ?? new Date().toISOString()
  });
}

export async function deleteLocalTrackDataForTracks(trackIds: readonly string[]) {
  const uniqueTrackIds = [...new Set(trackIds.filter(Boolean))];
  if (uniqueTrackIds.length === 0) {
    return;
  }

  await musicRoomDatabase.transaction(
    "rw",
    [
      musicRoomDatabase.cachedTrackLibrary,
      musicRoomDatabase.cachedTrackLibraryMetadata,
      musicRoomDatabase.trackAssetLinks,
      musicRoomDatabase.assetManifests,
      musicRoomDatabase.assetUnits,
      musicRoomDatabase.transcodeJobs
    ],
    async () => {
      const cachedSummaryKeys = await musicRoomDatabase.cachedTrackLibraryMetadata
        .where("sourceTrackIds")
        .anyOf(uniqueTrackIds)
        .primaryKeys();
      const cachedRecordKeys = await musicRoomDatabase.cachedTrackLibrary
        .where("sourceTrackIds")
        .anyOf(uniqueTrackIds)
        .primaryKeys();
      const fileHashes = [
        ...new Set(
          [...cachedSummaryKeys, ...cachedRecordKeys].filter(
            (key): key is string => typeof key === "string"
          )
        )
      ];
      const deletedCacheHashes = new Set<string>();

      for (const fileHash of fileHashes) {
        const record = await musicRoomDatabase.cachedTrackLibrary.get(fileHash);
        const summary = await musicRoomDatabase.cachedTrackLibraryMetadata.get(fileHash);
        const source = record ?? summary;
        if (!source) {
          continue;
        }

        const nextReferences = removeCachedLibrarySourceReferences(source, uniqueTrackIds);
        if (nextReferences.isUnreferenced) {
          await musicRoomDatabase.cachedTrackLibrary.delete(fileHash);
          await musicRoomDatabase.cachedTrackLibraryMetadata.delete(fileHash);
          deletedCacheHashes.add(fileHash);
          continue;
        }

        if (record) {
          await musicRoomDatabase.cachedTrackLibrary.put({ ...record, ...nextReferences });
        }
        const nextSummary = summary ?? (record ? toCachedLibraryTrackSummaryRecord(record) : null);
        if (nextSummary) {
          await musicRoomDatabase.cachedTrackLibraryMetadata.put({
            ...nextSummary,
            ...nextReferences
          });
        }
      }

      const removedLinks = await musicRoomDatabase.trackAssetLinks
        .where("trackId")
        .anyOf(uniqueTrackIds)
        .toArray();
      const remainingLinks = await musicRoomDatabase.trackAssetLinks
        .filter((link) => !uniqueTrackIds.includes(link.trackId))
        .toArray();
      const remainingAssetIds = new Set(
        remainingLinks.flatMap((link) => [link.originalAssetId, link.playbackAssetId])
      );
      const removableAssetIds = [
        ...new Set(
          removedLinks.flatMap((link) => [link.originalAssetId, link.playbackAssetId])
        )
      ].filter((assetId) => !remainingAssetIds.has(assetId));
      const removableManifests = await musicRoomDatabase.assetManifests.bulkGet(removableAssetIds);
      const removableSourceFileHashes = new Set(
        removableManifests
          .filter((manifest): manifest is AudioAssetManifestRecord => !!manifest)
          .map((manifest) => manifest.sourceFileHash)
      );

      await musicRoomDatabase.trackAssetLinks.bulkDelete(uniqueTrackIds);
      if (removableAssetIds.length > 0) {
        await musicRoomDatabase.assetUnits.where("assetId").anyOf(removableAssetIds).delete();
        await musicRoomDatabase.assetManifests.bulkDelete(removableAssetIds);
      }

      if (deletedCacheHashes.size > 0 || removableSourceFileHashes.size > 0) {
        const remainingCachedHashes = new Set(
          (await musicRoomDatabase.cachedTrackLibraryMetadata.toCollection().primaryKeys())
            .filter((key): key is string => typeof key === "string")
        );
        const remainingAssetSourceFileHashes = new Set(
          (await musicRoomDatabase.assetManifests.toArray()).map((manifest) => manifest.sourceFileHash)
        );
        const sourceFileHashesToDelete = [
          ...new Set([...deletedCacheHashes, ...removableSourceFileHashes])
        ].filter(
          (fileHash) =>
            !remainingCachedHashes.has(fileHash) && !remainingAssetSourceFileHashes.has(fileHash)
        );
        if (sourceFileHashesToDelete.length > 0) {
          await musicRoomDatabase.transcodeJobs.bulkDelete(sourceFileHashesToDelete);
        }
      }
    }
  );
}

export async function cleanupOrphanedLocalAudioStorage(input: {
  preserveTrackIds: readonly string[];
  preserveAssetIds?: readonly string[];
}) {
  await backfillCachedLibraryTrackMetadataIfNeeded();

  const preservedTrackIds = new Set(input.preserveTrackIds.filter(Boolean));
  const preservedAssetIds = new Set(input.preserveAssetIds?.filter(Boolean) ?? []);

  return musicRoomDatabase.transaction(
    "rw",
    [
      musicRoomDatabase.cachedTrackLibrary,
      musicRoomDatabase.cachedTrackLibraryMetadata,
      musicRoomDatabase.trackAssetLinks,
      musicRoomDatabase.assetManifests,
      musicRoomDatabase.assetUnits,
      musicRoomDatabase.transcodeJobs
    ],
    async () => {
      const summaries = await musicRoomDatabase.cachedTrackLibraryMetadata.toArray();
      let deletedCacheCount = 0;
      const deletedCacheHashes = new Set<string>();

      for (const summary of summaries) {
        if (summary.sourceTrackIds.length === 0) {
          await musicRoomDatabase.cachedTrackLibrary.delete(summary.fileHash);
          await musicRoomDatabase.cachedTrackLibraryMetadata.delete(summary.fileHash);
          deletedCacheCount += 1;
          deletedCacheHashes.add(summary.fileHash);
          continue;
        }
        const staleTrackIds = summary.sourceTrackIds.filter(
          (trackId) => !preservedTrackIds.has(trackId)
        );
        if (staleTrackIds.length === 0) {
          continue;
        }

        const record = await musicRoomDatabase.cachedTrackLibrary.get(summary.fileHash);
        const nextReferences = removeCachedLibrarySourceReferences(summary, staleTrackIds);
        if (nextReferences.isUnreferenced) {
          await musicRoomDatabase.cachedTrackLibrary.delete(summary.fileHash);
          await musicRoomDatabase.cachedTrackLibraryMetadata.delete(summary.fileHash);
          deletedCacheCount += 1;
          deletedCacheHashes.add(summary.fileHash);
          continue;
        }

        if (record) {
          await musicRoomDatabase.cachedTrackLibrary.put({ ...record, ...nextReferences });
        }
        await musicRoomDatabase.cachedTrackLibraryMetadata.put({
          ...summary,
          ...nextReferences
        });
      }

      const links = await musicRoomDatabase.trackAssetLinks.toArray();
      const staleLinks = links.filter((link) => !preservedTrackIds.has(link.trackId));
      const remainingLinks = links.filter((link) => preservedTrackIds.has(link.trackId));
      const referencedAssetIds = new Set([
        ...preservedAssetIds,
        ...remainingLinks.flatMap((link) => [link.originalAssetId, link.playbackAssetId])
      ]);
      const manifests = await musicRoomDatabase.assetManifests.toArray();
      const orphanedManifests = manifests.filter(
        (manifest) => !referencedAssetIds.has(manifest.assetId)
      );
      const orphanedAssetIds = orphanedManifests.map((manifest) => manifest.assetId);

      if (staleLinks.length > 0) {
        await musicRoomDatabase.trackAssetLinks.bulkDelete(
          staleLinks.map((link) => link.trackId)
        );
      }
      if (orphanedAssetIds.length > 0) {
        await musicRoomDatabase.assetUnits.where("assetId").anyOf(orphanedAssetIds).delete();
        await musicRoomDatabase.assetManifests.bulkDelete(orphanedAssetIds);
      }

      const remainingCacheHashes = new Set(
        (await musicRoomDatabase.cachedTrackLibraryMetadata.toCollection().primaryKeys())
          .filter((key): key is string => typeof key === "string")
      );
      const remainingAssetSourceFileHashes = new Set(
        manifests
          .filter((manifest) => !orphanedAssetIds.includes(manifest.assetId))
          .map((manifest) => manifest.sourceFileHash)
      );
      const sourceFileHashesToDelete = [
        ...new Set([
          ...deletedCacheHashes,
          ...orphanedManifests.map((manifest) => manifest.sourceFileHash)
        ])
      ].filter(
        (fileHash) =>
          !remainingCacheHashes.has(fileHash) && !remainingAssetSourceFileHashes.has(fileHash)
      );
      if (sourceFileHashesToDelete.length > 0) {
        await musicRoomDatabase.transcodeJobs.bulkDelete(sourceFileHashesToDelete);
      }

      return {
        deletedCacheCount,
        deletedAssetCount: orphanedAssetIds.length,
        deletedLinkCount: staleLinks.length
      };
    }
  );
}

export function toCachedLibraryTrackSummaryRecord(
  record: CachedLibraryTrackRecord
): CachedLibraryTrackSummaryRecord {
  const {
    file: _file,
    ...summary
  } = record;
  return summary;
}

async function backfillCachedLibraryTrackMetadataIfNeeded() {
  const metadataCount = await musicRoomDatabase.cachedTrackLibraryMetadata.count();
  if (metadataCount > 0) {
    return;
  }

  const libraryCount = await musicRoomDatabase.cachedTrackLibrary.count();
  if (libraryCount === 0) {
    return;
  }

  const summaries: CachedLibraryTrackSummaryRecord[] = [];
  await musicRoomDatabase.cachedTrackLibrary.each((record) => {
    summaries.push(toCachedLibraryTrackSummaryRecord(record));
  });
  if (summaries.length > 0) {
    await musicRoomDatabase.cachedTrackLibraryMetadata.bulkPut(summaries);
  }
}
