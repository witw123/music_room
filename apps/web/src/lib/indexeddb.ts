import Dexie, { type Table } from "dexie";
import {
  assetUnitDescriptorSchema,
  playbackEncoderVersion,
  playbackProfileId,
  verifyAssetUnit,
  type AssetKind,
  type AssetUnitDescriptor,
  type AudioAssetManifest
} from "@music-room/shared";
import { LocalRepository } from "@/features/upload/local-repository";

export type CachedLibraryTrackRecord = {
  fileHash: string;
  title: string;
  artist: string;
  album?: string | null;
  artworkUrl?: string | null;
  lyrics?: string | null;
  provider?: "netease" | "qqmusic" | "local_upload";
  providerTrackId?: string | null;
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

export type PlaybackAssetDraftUnitRecord = {
  draftUnitId: string;
  draftId: string;
  unitIndex: number;
  descriptor: Omit<AssetUnitDescriptor, "assetId" | "contentHash" | "proof">;
  contentHash: string;
  payload: ArrayBuffer;
  createdAt: string;
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
  repositoryId?: string;
  schemaVersion?: number;
  updatedAt: string;
};

export type LocalPlaylistDirectoryRecord = {
  id: string;
  handle: FileSystemDirectoryHandle;
  name: string;
  updatedAt: string;
};

export type LocalAudioStorageKind = "cache" | "saved";

export type LocalAudioFileRecord = {
  fileHash: string;
  fileName: string;
  relativePath?: string;
  storageKind?: LocalAudioStorageKind;
  source?: "directory-scan";
  sourceDirectoryId?: string;
  savedAt: string;
};

export type LocalAudioCacheFileRecord = {
  fileHash: string;
  fileName: string;
  relativePath?: string;
  cachedAt: string;
};

export type LocalPlaylistTrackRecord = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  mimeType: string;
  sizeBytes: number;
  artworkUrl: string | null;
  lyrics: string | null;
  provider: "netease" | "qqmusic" | "local_upload";
  providerTrackId: string | null;
  fileHash: string | null;
  fileName: string | null;
  sourceDirectoryId?: string | null;
  availableOffline: boolean;
  source?: "directory-scan";
  createdAt: string;
  updatedAt: string;
};

export type FavoriteProviderAlbumRecord = {
  id: string;
  userId: string;
  provider: "netease" | "qqmusic";
  providerAlbumId: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  description: string | null;
  releaseTime: string | null;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
};

export class MusicRoomDatabase extends Dexie {
  cachedTrackLibrary!: Table<CachedLibraryTrackRecord, string>;
  cachedTrackLibraryMetadata!: Table<CachedLibraryTrackSummaryRecord, string>;
  assetManifests!: Table<AudioAssetManifestRecord, string>;
  assetUnits!: Table<AudioAssetUnitRecord, string>;
  playbackAssetDraftUnits!: Table<PlaybackAssetDraftUnitRecord, string>;
  trackAssetLinks!: Table<TrackAssetLinkRecord, string>;
  transcodeJobs!: Table<TranscodeJobRecord, string>;
  localAudioDirectory!: Table<LocalAudioDirectoryRecord, string>;
  localPlaylistDirectories!: Table<LocalPlaylistDirectoryRecord, string>;
  localAudioFiles!: Table<LocalAudioFileRecord, string>;
  localAudioCacheFiles!: Table<LocalAudioCacheFileRecord, string>;
  localPlaylistTracks!: Table<LocalPlaylistTrackRecord, string>;
  favoriteProviderAlbums!: Table<FavoriteProviderAlbumRecord, string>;

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
    this.version(14).stores({
      cachedTrackLibrary: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
      cachedTrackLibraryMetadata: "&fileHash, cachedAt, *sourceTrackIds, *sourceRoomIds",
      assetManifests: "&assetId, kind, sourceFileHash, complete, lastAccessedAt",
      assetUnits: "&unitId, assetId, kind, unitIndex, [assetId+unitIndex], lastAccessedAt, protectedUntil",
      trackAssetLinks: "&trackId, originalAssetId, playbackAssetId, linkedAt",
      transcodeJobs: "&sourceFileHash, kind, status, updatedAt",
      localAudioDirectory: "&id",
      localAudioFiles: "&fileHash, savedAt",
      localAudioCacheFiles: "&fileHash, cachedAt"
    });
    this.version(15).stores({
      localPlaylistTracks: "&id, provider, providerTrackId, fileHash, updatedAt"
    });
    this.version(16).stores({
      localPlaylistDirectories: "&id, name, updatedAt"
    });
    this.version(17).stores({
      favoriteProviderAlbums: "&id, userId, provider, providerAlbumId, updatedAt"
    });
    this.version(18).upgrade(async (transaction) => {
      const manifests = transaction.table<AudioAssetManifestRecord, string>("assetManifests");
      const units = transaction.table<AudioAssetUnitRecord, string>("assetUnits");
      const links = transaction.table<TrackAssetLinkRecord, string>("trackAssetLinks");
      const jobs = transaction.table<TranscodeJobRecord, string>("transcodeJobs");
      const obsoletePlaybackAssets = await manifests.filter((record) => {
        const manifest = record.manifest as {
          kind?: unknown;
          profileId?: unknown;
          encoder?: { version?: unknown };
        };
        return manifest.kind === "playback" && (
          manifest.profileId !== playbackProfileId ||
          manifest.encoder?.version !== playbackEncoderVersion
        );
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
    this.version(19).stores({
      playbackAssetDraftUnits: "&draftUnitId, draftId, unitIndex, [draftId+unitIndex]"
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

export async function getAssetManifest(
  assetId: string,
  options?: { includeLocalRepository?: boolean }
) {
  const record = await musicRoomDatabase.assetManifests.get(assetId);
  if (record?.complete || options?.includeLocalRepository === false) {
    if (record) {
      await musicRoomDatabase.assetManifests.update(assetId, {
        lastAccessedAt: new Date().toISOString()
      });
    }
    return record ?? null;
  }

  if (!record) {
    const repository = await getLocalRepositoryForAssetRead();
    if (!repository) return null;

    const original = await repository.readOriginalManifest(assetId);
    if (original?.manifest.kind === "original") {
      return createLocalAssetManifestRecord(repository, original.manifest);
    }

    const playback = await repository.readPlaybackAsset(assetId, playbackProfileId);
    return playback?.manifest.kind === "playback"
      ? createLocalAssetManifestRecord(repository, playback.manifest)
      : null;
  }

  const repository = await getLocalRepositoryForAssetRead();
  if (repository) {
    const original = await repository.readOriginalManifest(assetId);
    if (original?.manifest.kind === "original") {
      return createLocalAssetManifestRecord(repository, original.manifest);
    }

    const playback = await repository.readPlaybackAsset(assetId, playbackProfileId);
    if (playback?.manifest.kind === "playback") {
      return createLocalAssetManifestRecord(repository, playback.manifest);
    }
  }

  if (record) {
    await musicRoomDatabase.assetManifests.update(assetId, {
      lastAccessedAt: new Date().toISOString()
    });
    return record;
  }
  return null;
}

export async function getCompleteAssetPairForSourceFileHash(fileHash: string) {
  const records = await musicRoomDatabase.assetManifests
    .where("sourceFileHash")
    .equals(fileHash)
    .toArray();
  const original = records.find(
    (record) => record.complete && record.manifest.kind === "original"
  );
  const playback = records.find(
    (record) =>
      record.complete &&
      record.manifest.kind === "playback" &&
      record.manifest.profileId === playbackProfileId
  );
  if (original && playback) return { original, playback };

  const repository = await getLocalRepositoryForAssetRead();
  if (!repository) return null;
  const [localOriginal, localPlayback] = await Promise.all([
    repository.listOriginalAssets(),
    repository.listPlaybackAssets()
  ]);
  const originalManifest = localOriginal.find(
    (record) => record.manifest.kind === "original" && record.manifest.fileHash === fileHash
  )?.manifest;
  const playbackManifest = localPlayback.find(
    (record) =>
      record.manifest.kind === "playback" &&
      record.manifest.profileId === playbackProfileId &&
      record.manifest.sourceFileHash === fileHash
  )?.manifest;
  return originalManifest && playbackManifest
    ? {
        original: createLocalAssetManifestRecord(repository, originalManifest),
        playback: createLocalAssetManifestRecord(repository, playbackManifest)
      }
    : null;
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
    return record;
  }

  return getLocalPlaybackUnit(assetId, unitIndex);
}

export async function getAssetUnits(assetId: string, unitIndexes: readonly number[]) {
  const uniqueIndexes = [...new Set(unitIndexes.filter((index) => Number.isInteger(index) && index >= 0))];
  if (uniqueIndexes.length === 0) {
    return [];
  }
  const records = await musicRoomDatabase.assetUnits.bulkGet(
    uniqueIndexes.map((index) => assetUnitId(assetId, index))
  );
  const byIndex = new Map(
    records
      .filter((record): record is AudioAssetUnitRecord => !!record)
      .map((record) => [record.unitIndex, record] as const)
  );
  if (byIndex.size < uniqueIndexes.length) {
    const repository = await getLocalRepositoryForAssetRead();
    if (repository) {
      for (const unitIndex of uniqueIndexes) {
        if (byIndex.has(unitIndex)) continue;
        const localUnit = await getLocalPlaybackUnitFromRepository(
          repository,
          assetId,
          unitIndex
        );
        if (localUnit) byIndex.set(unitIndex, localUnit);
      }
    }
  }
  return uniqueIndexes.flatMap((unitIndex) => {
    const record = byIndex.get(unitIndex);
    return record ? [record] : [];
  });
}

export async function getAssetUnitIndexes(assetId: string) {
  const keys = await musicRoomDatabase.assetUnits.where("assetId").equals(assetId).primaryKeys();
  const indexes = keys.flatMap((key) => {
    if (typeof key !== "string") {
      return [];
    }
    const index = Number(key.slice(key.lastIndexOf(":") + 1));
    return Number.isInteger(index) && index >= 0 ? [index] : [];
  });
  if (indexes.length > 0) return indexes.sort((left, right) => left - right);

  const repository = await getLocalRepositoryForAssetRead();
  if (!repository) return [];
  const playback = await repository.readPlaybackAsset(assetId, playbackProfileId);
  return playback?.units
    .map((unit) => unit.descriptor.unitIndex)
    .sort((left, right) => left - right) ?? [];
}

async function getLocalRepositoryForAssetRead() {
  const directory = await musicRoomDatabase.localAudioDirectory.get("default");
  if (!directory) return null;
  return LocalRepository.open(directory.handle, { recover: false }).catch(() => null);
}

function createLocalAssetManifestRecord(
  repository: LocalRepository,
  manifest: AudioAssetManifest
): AudioAssetManifestRecord {
  return {
    assetId: manifest.assetId,
    kind: manifest.kind,
    sourceFileHash: manifest.kind === "original" ? manifest.fileHash : manifest.sourceFileHash,
    manifest,
    complete: true,
    createdAt: repository.manifest.createdAt,
    lastAccessedAt: new Date().toISOString()
  };
}

async function getLocalPlaybackUnit(assetId: string, unitIndex: number) {
  const repository = await getLocalRepositoryForAssetRead();
  return repository
    ? getLocalPlaybackUnitFromRepository(repository, assetId, unitIndex)
    : null;
}

async function getLocalPlaybackUnitFromRepository(
  repository: LocalRepository,
  assetId: string,
  unitIndex: number
) {
  const playback = await repository.readPlaybackAsset(assetId, playbackProfileId);
  const unit = playback?.units.find((candidate) => candidate.descriptor.unitIndex === unitIndex);
  if (!unit) return null;
  const file = await repository.readPlaybackUnit(unit);
  if (!file) return null;
  return {
    ...unit.descriptor,
    unitId: assetUnitId(assetId, unitIndex),
    payload: await file.arrayBuffer(),
    lastAccessedAt: new Date().toISOString(),
    protectedUntil: null
  } satisfies AudioAssetUnitRecord;
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
  const record = {
    ...input,
    updatedAt: new Date().toISOString()
  } satisfies TranscodeJobRecord;
  await musicRoomDatabase.transcodeJobs.put(record);

  const directory = await musicRoomDatabase.localAudioDirectory.get("default");
  if (directory) {
    await LocalRepository.open(directory.handle, { recover: false })
      .then((repository) => repository.writeTranscodeJob(record))
      .catch(() => undefined);
  }
}

export async function listQueuedTranscodeJobs() {
  return musicRoomDatabase.transcodeJobs.where("status").equals("queued").toArray();
}

export async function upsertCachedLibraryTrack(input: Omit<CachedLibraryTrackRecord, "cachedAt"> & {
  cachedAt?: string;
}) {
  const existing = await musicRoomDatabase.cachedTrackLibraryMetadata.get(input.fileHash);
  const cachedAt = input.cachedAt ?? existing?.cachedAt ?? new Date().toISOString();
  const record: CachedLibraryTrackRecord = {
    ...input,
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

export async function getLocalAudioDirectory() {
  return (await musicRoomDatabase.localAudioDirectory.get("default")) ?? null;
}

export async function saveLocalAudioDirectory(input: {
  handle: FileSystemDirectoryHandle;
  name: string;
  repositoryId?: string;
  schemaVersion?: number;
}) {
  await musicRoomDatabase.localAudioDirectory.put({
    id: "default",
    handle: input.handle,
    name: input.name,
    repositoryId: input.repositoryId,
    schemaVersion: input.schemaVersion,
    updatedAt: new Date().toISOString()
  });
}

export async function getLocalPlaylistDirectory(id: string) {
  return (await musicRoomDatabase.localPlaylistDirectories.get(id)) ?? null;
}

export async function saveLocalPlaylistDirectory(input: Omit<LocalPlaylistDirectoryRecord, "updatedAt"> & {
  updatedAt?: string;
}) {
  await musicRoomDatabase.localPlaylistDirectories.put({
    ...input,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  });
}

export async function deleteLocalPlaylistDirectory(id: string) {
  await musicRoomDatabase.localPlaylistDirectories.delete(id);
}

export async function listLocalAudioFiles(storageKind: LocalAudioStorageKind = "saved") {
  const records = await musicRoomDatabase.localAudioFiles.orderBy("savedAt").reverse().toArray();
  return records.filter((record) => (record.storageKind ?? "saved") === storageKind);
}

export async function listLocalAudioCacheFiles() {
  return musicRoomDatabase.localAudioCacheFiles.orderBy("cachedAt").reverse().toArray();
}

export async function getLocalAudioFileRecord(
  fileHash: string,
  storageKind: LocalAudioStorageKind = "saved"
) {
  const record = await musicRoomDatabase.localAudioFiles.get(fileHash);
  return record && (record.storageKind ?? "saved") === storageKind ? record : null;
}

export async function deleteLocalAudioFileRecord(
  fileHash: string,
  storageKind: LocalAudioStorageKind = "saved"
) {
  const record = await getLocalAudioFileRecord(fileHash, storageKind);
  if (record) {
    await musicRoomDatabase.localAudioFiles.delete(fileHash);
  }
}

export async function getLocalAudioCacheFileRecord(fileHash: string) {
  return (await musicRoomDatabase.localAudioCacheFiles.get(fileHash)) ?? null;
}

export async function saveLocalAudioCacheFileRecord(input: Omit<LocalAudioCacheFileRecord, "cachedAt"> & {
  cachedAt?: string;
}) {
  await musicRoomDatabase.localAudioCacheFiles.put({
    ...input,
    cachedAt: input.cachedAt ?? new Date().toISOString()
  });
}

export async function deleteLocalAudioCacheFileRecord(fileHash: string) {
  await musicRoomDatabase.localAudioCacheFiles.delete(fileHash);
}

export async function upsertLocalPlaylistTrack(
  input: Omit<LocalPlaylistTrackRecord, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  }
) {
  const existing = await musicRoomDatabase.localPlaylistTracks.get(input.id);
  const now = new Date().toISOString();
  await musicRoomDatabase.localPlaylistTracks.put({
    ...input,
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  });
  const directory = await musicRoomDatabase.localAudioDirectory.get("default");
  if (directory) {
    await LocalRepository.open(directory.handle, { recover: false })
      .then((repository) => repository.writeProviderTrack(input.id, {
        ...input,
        createdAt: input.createdAt ?? existing?.createdAt ?? now,
        updatedAt: input.updatedAt ?? now
      }))
      .catch(() => undefined);
  }
}

export async function listLocalPlaylistTracks() {
  return musicRoomDatabase.localPlaylistTracks.orderBy("updatedAt").reverse().toArray();
}

export async function deleteLocalPlaylistTrack(id: string) {
  await musicRoomDatabase.localPlaylistTracks.delete(id);
}

export function favoriteProviderAlbumId(
  userId: string,
  provider: FavoriteProviderAlbumRecord["provider"],
  providerAlbumId: string
) {
  return `${userId}:${provider}:${providerAlbumId}`;
}

export async function upsertFavoriteProviderAlbum(
  input: Omit<FavoriteProviderAlbumRecord, "id" | "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  }
) {
  const id = favoriteProviderAlbumId(input.userId, input.provider, input.providerAlbumId);
  const existing = await musicRoomDatabase.favoriteProviderAlbums.get(id);
  const now = new Date().toISOString();
  await musicRoomDatabase.favoriteProviderAlbums.put({
    ...input,
    id,
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  });
}

export async function deleteFavoriteProviderAlbum(
  userId: string,
  provider: FavoriteProviderAlbumRecord["provider"],
  providerAlbumId: string
) {
  await musicRoomDatabase.favoriteProviderAlbums.delete(
    favoriteProviderAlbumId(userId, provider, providerAlbumId)
  );
}

export async function listFavoriteProviderAlbums(userId: string) {
  const records = await musicRoomDatabase.favoriteProviderAlbums
    .where("userId")
    .equals(userId)
    .toArray();
  return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getFavoriteProviderAlbum(
  userId: string,
  provider: FavoriteProviderAlbumRecord["provider"],
  providerAlbumId: string
) {
  return musicRoomDatabase.favoriteProviderAlbums.get(
    favoriteProviderAlbumId(userId, provider, providerAlbumId)
  );
}

export async function saveLocalAudioFileRecord(input: Omit<LocalAudioFileRecord, "savedAt"> & {
  savedAt?: string;
}) {
  await musicRoomDatabase.localAudioFiles.put({
    ...input,
    storageKind: input.storageKind ?? "saved",
    savedAt: input.savedAt ?? new Date().toISOString()
  });
}

export async function deleteLocalTrackDataForTracks(
  trackIds: readonly string[],
  options?: { roomId?: string }
) {
  const uniqueTrackIds = [...new Set(trackIds.filter(Boolean))];
  if (uniqueTrackIds.length === 0) {
    return;
  }

  const deletedLocalFileHashes = new Set<string>();
  const deletedLocalAssetManifests = new Map<string, AudioAssetManifestRecord>();

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

        const nextReferences = removeCachedLibrarySourceReferences(
          source,
          uniqueTrackIds,
          options?.roomId
        );
        if (nextReferences.isUnreferenced) {
          await musicRoomDatabase.cachedTrackLibrary.delete(fileHash);
          await musicRoomDatabase.cachedTrackLibraryMetadata.delete(fileHash);
          deletedCacheHashes.add(fileHash);
          deletedLocalFileHashes.add(fileHash);
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
      for (const manifest of removableManifests) {
        if (manifest) deletedLocalAssetManifests.set(manifest.assetId, manifest);
      }
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

  await cleanupDeletedLocalRepositoryData(deletedLocalFileHashes, deletedLocalAssetManifests);
  if (options?.roomId) {
    const directory = await musicRoomDatabase.localAudioDirectory.get("default");
    const repository = directory
      ? await LocalRepository.open(directory.handle, { recover: false }).catch(() => null)
      : null;
    if (repository) {
      await repository.removeRoomTrackReferences(options.roomId, uniqueTrackIds);
    }
  }
}

async function cleanupDeletedLocalRepositoryData(
  fileHashes: ReadonlySet<string>,
  manifests: ReadonlyMap<string, AudioAssetManifestRecord>
) {
  if (fileHashes.size === 0 && manifests.size === 0) return;
  const directory = await musicRoomDatabase.localAudioDirectory.get("default");
  const repository = directory
    ? await LocalRepository.open(directory.handle, { recover: false }).catch(() => null)
    : null;
  if (!repository) return;

  const localAssetRefs = new Map<string, { kind: "original" | "playback"; profileId?: string }>();
  const protectedLocalAssetIds = new Set<string>();
  for (const fileHash of fileHashes) {
    const record = await repository.readTrack(fileHash);
    const localFile = await musicRoomDatabase.localAudioFiles.get(fileHash);
    const isSavedLocally =
      localFile && (localFile.storageKind ?? "saved") === "saved";
    if (isSavedLocally || record?.retention === "library") {
      if (record?.originalAsset) {
        protectedLocalAssetIds.add(record.originalAsset.assetId);
      }
      if (record?.playbackAsset) {
        protectedLocalAssetIds.add(record.playbackAsset.assetId);
      }
      continue;
    }
    if (record?.source.kind !== "managed") continue;
    if (record.originalAsset) {
      localAssetRefs.set(record.originalAsset.assetId, { kind: "original" });
    }
    if (record.playbackAsset) {
      localAssetRefs.set(record.playbackAsset.assetId, {
        kind: "playback",
        profileId: record.playbackAsset.profileId
      });
    }
    await repository.removePath(record.source.relativePath);
    await repository.deleteTrack(fileHash);
    await musicRoomDatabase.localAudioFiles.delete(fileHash);
    await musicRoomDatabase.localAudioCacheFiles.delete(fileHash);
  }

  for (const record of manifests.values()) {
    if (protectedLocalAssetIds.has(record.assetId)) continue;
    if (record.manifest.kind === "original") {
      await repository.deleteOriginalAsset(record.assetId);
    } else {
      await repository.deletePlaybackAsset(record.assetId, record.manifest.profileId);
    }
  }
  for (const [assetId, asset] of localAssetRefs) {
    if (protectedLocalAssetIds.has(assetId)) continue;
    if (asset.kind === "original") {
      await repository.deleteOriginalAsset(assetId);
    } else if (asset.profileId) {
      await repository.deletePlaybackAsset(assetId, asset.profileId);
    }
  }
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
      const remainingCachedHashes = new Set(
        (await musicRoomDatabase.cachedTrackLibraryMetadata.toCollection().primaryKeys())
          .filter((key): key is string => typeof key === "string")
      );
      const manifests = await musicRoomDatabase.assetManifests.toArray();
      const referencedAssetIds = new Set([
        ...preservedAssetIds,
        ...remainingLinks.flatMap((link) => [link.originalAssetId, link.playbackAssetId]),
        ...manifests
          .filter((manifest) => remainingCachedHashes.has(manifest.sourceFileHash))
          .map((manifest) => manifest.assetId)
      ]);
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
          !remainingCachedHashes.has(fileHash) && !remainingAssetSourceFileHashes.has(fileHash)
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
