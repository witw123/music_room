import Dexie, { type Table } from "dexie";

type TrackAssetRecord = {
  trackId: string;
  fileHash: string;
  title: string;
  mimeType: string;
  file: Blob;
  cachedAt: string;
};

type TrackPieceRecord = {
  pieceId: string;
  trackId: string;
  peerId: string;
  chunkIndex: number;
  chunkSize: number;
  hash: string;
  createdAt: string;
  payload: ArrayBuffer;
};

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

export type TrackPieceManifestRecord = {
  trackId: string;
  fileHash: string;
  mimeType: string;
  codec: string | null;
  sizeBytes: number | null;
  durationMs: number;
  totalChunks: number;
  chunkSize: number;
  updatedAt: string;
};

export class MusicRoomDatabase extends Dexie {
  trackAssets!: Table<TrackAssetRecord, string>;
  trackPieces!: Table<TrackPieceRecord, string>;
  trackPieceManifests!: Table<TrackPieceManifestRecord, string>;
  cachedTrackLibrary!: Table<CachedLibraryTrackRecord, string>;

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
  }
}

export const musicRoomDatabase = new MusicRoomDatabase();
const queuedManifestUpserts = new Map<string, Omit<TrackPieceManifestRecord, "updatedAt">>();
const queuedManifestTimers = new Map<string, number>();
const manifestUpsertQueueDelayMs = 250;

export async function upsertCachedLibraryTrack(input: Omit<CachedLibraryTrackRecord, "cachedAt"> & {
  cachedAt?: string;
}) {
  const existing = await musicRoomDatabase.cachedTrackLibrary.get(input.fileHash);
  const mergedTrackIds = new Set([...(existing?.sourceTrackIds ?? []), ...input.sourceTrackIds]);
  const mergedRoomIds = new Set([...(existing?.sourceRoomIds ?? []), ...input.sourceRoomIds]);

  await musicRoomDatabase.cachedTrackLibrary.put({
    ...existing,
    ...input,
    cachedAt: input.cachedAt ?? existing?.cachedAt ?? new Date().toISOString(),
    sourceTrackIds: [...mergedTrackIds],
    sourceRoomIds: [...mergedRoomIds]
  });
}

export async function listCachedLibraryTracks() {
  return musicRoomDatabase.cachedTrackLibrary.orderBy("cachedAt").reverse().toArray();
}

export async function getCachedLibraryTrack(fileHash: string) {
  return musicRoomDatabase.cachedTrackLibrary.get(fileHash);
}

export async function getCachedLibraryTrackCount() {
  return musicRoomDatabase.cachedTrackLibrary.count();
}

export async function deleteCachedLibraryTrack(fileHash: string) {
  const record = await musicRoomDatabase.cachedTrackLibrary.get(fileHash);
  if (!record) {
    return null;
  }

  await musicRoomDatabase.cachedTrackLibrary.delete(fileHash);
  return record;
}

export async function upsertTrackPieceManifest(
  input: Omit<TrackPieceManifestRecord, "updatedAt">
) {
  await musicRoomDatabase.trackPieceManifests.put({
    ...input,
    updatedAt: new Date().toISOString()
  });
}

async function flushQueuedTrackPieceManifest(trackId: string) {
  const queued = queuedManifestUpserts.get(trackId);
  queuedManifestUpserts.delete(trackId);
  clearQueuedTrackPieceManifestTimer(trackId);

  if (!queued) {
    return;
  }

  await upsertTrackPieceManifest(queued);
}

export function queueTrackPieceManifestUpsert(
  input: Omit<TrackPieceManifestRecord, "updatedAt">
) {
  if (typeof window === "undefined") {
    return upsertTrackPieceManifest(input);
  }

  queuedManifestUpserts.set(input.trackId, input);

  if (queuedManifestTimers.has(input.trackId)) {
    return Promise.resolve();
  }

  const timerId = window.setTimeout(() => {
    void flushQueuedTrackPieceManifest(input.trackId);
  }, manifestUpsertQueueDelayMs);
  queuedManifestTimers.set(input.trackId, timerId);

  return Promise.resolve();
}

export async function flushQueuedTrackPieceManifestUpserts(trackId?: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (trackId) {
    await flushQueuedTrackPieceManifest(trackId);
    return;
  }

  await Promise.all(
    [...queuedManifestUpserts.keys()].map((queuedTrackId) =>
      flushQueuedTrackPieceManifest(queuedTrackId)
    )
  );
}

export async function getTrackPieceManifest(trackId: string) {
  return musicRoomDatabase.trackPieceManifests.get(trackId);
}

export async function getTrackPieceManifests(trackIds: string[]) {
  if (trackIds.length === 0) {
    return [];
  }

  return musicRoomDatabase.trackPieceManifests.where("trackId").anyOf(trackIds).toArray();
}

export async function deleteTrackPieceManifest(trackId: string) {
  queuedManifestUpserts.delete(trackId);
  clearQueuedTrackPieceManifestTimer(trackId);
  await musicRoomDatabase.trackPieceManifests.delete(trackId);
}

export async function deleteTrackPieceManifests(trackIds: string[]) {
  if (trackIds.length === 0) {
    return;
  }

  for (const trackId of trackIds) {
    queuedManifestUpserts.delete(trackId);
    clearQueuedTrackPieceManifestTimer(trackId);
  }

  await musicRoomDatabase.trackPieceManifests.bulkDelete(trackIds);
}

export async function cacheTrackPieces(
  pieces: Array<{
    pieceId: string;
    trackId: string;
    peerId: string;
    chunkIndex: number;
    chunkSize: number;
    hash: string;
    payload: ArrayBuffer;
  }>
) {
  if (pieces.length === 0) {
    return;
  }

  await musicRoomDatabase.trackPieces.bulkPut(
    pieces.map((piece) => ({
      ...piece,
      createdAt: new Date().toISOString()
    }))
  );
}

export async function getCachedPieceIndexes(trackId: string, peerId: string) {
  const pieces = await musicRoomDatabase.trackPieces
    .where("[trackId+peerId]")
    .equals([trackId, peerId])
    .toArray();

  return pieces
    .map((piece) => piece.chunkIndex)
    .sort((left, right) => left - right);
}

export async function getCachedPiece(
  trackId: string,
  peerId: string,
  chunkIndex: number
) {
  return (
    (await musicRoomDatabase.trackPieces
      .where("[trackId+peerId+chunkIndex]")
      .equals([trackId, peerId, chunkIndex])
      .first()) ?? null
  );
}

export async function getCachedPiecesForTrack(trackId: string, peerId: string) {
  const pieces = await musicRoomDatabase.trackPieces
    .where("[trackId+peerId]")
    .equals([trackId, peerId])
    .toArray();

  return pieces.sort((left, right) => left.chunkIndex - right.chunkIndex);
}

export async function deleteCachedPiecesForTrack(trackId: string, peerId?: string) {
  const pieces = peerId
    ? await musicRoomDatabase.trackPieces.where("[trackId+peerId]").equals([trackId, peerId]).toArray()
    : await musicRoomDatabase.trackPieces.where("trackId").equals(trackId).toArray();

  if (pieces.length === 0) {
    if (!peerId) {
      await deleteTrackPieceManifest(trackId);
    }
    return 0;
  }

  if (!peerId) {
    queuedManifestUpserts.delete(trackId);
    clearQueuedTrackPieceManifestTimer(trackId);
  }

  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.trackPieces,
    musicRoomDatabase.trackPieceManifests,
    async () => {
      await musicRoomDatabase.trackPieces.bulkDelete(pieces.map((piece) => piece.pieceId));
      if (!peerId) {
        await musicRoomDatabase.trackPieceManifests.delete(trackId);
      }
    }
  );
  return pieces.length;
}

export async function deleteCachedPiecesForTracks(trackIds: string[]) {
  const uniqueTrackIds = [...new Set(trackIds.filter(Boolean))];
  if (uniqueTrackIds.length === 0) {
    return 0;
  }

  const pieces = await musicRoomDatabase.trackPieces.where("trackId").anyOf(uniqueTrackIds).toArray();
  for (const trackId of uniqueTrackIds) {
    queuedManifestUpserts.delete(trackId);
    clearQueuedTrackPieceManifestTimer(trackId);
  }

  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.trackAssets,
    musicRoomDatabase.trackPieces,
    musicRoomDatabase.trackPieceManifests,
    async () => {
      await musicRoomDatabase.trackAssets.bulkDelete(uniqueTrackIds);
      await musicRoomDatabase.trackPieceManifests.bulkDelete(uniqueTrackIds);
      if (pieces.length > 0) {
        await musicRoomDatabase.trackPieces.bulkDelete(pieces.map((piece) => piece.pieceId));
      }
    }
  );

  return pieces.length;
}

export async function clearAllCachedTracks() {
  for (const timerId of queuedManifestTimers.values()) {
    if (typeof window !== "undefined") {
      window.clearTimeout(timerId);
    }
  }
  queuedManifestTimers.clear();
  queuedManifestUpserts.clear();

  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.trackAssets,
    musicRoomDatabase.trackPieces,
    musicRoomDatabase.trackPieceManifests,
    musicRoomDatabase.cachedTrackLibrary,
    async () => {
      await musicRoomDatabase.trackAssets.clear();
      await musicRoomDatabase.trackPieces.clear();
      await musicRoomDatabase.trackPieceManifests.clear();
      await musicRoomDatabase.cachedTrackLibrary.clear();
    }
  );
}

export async function clearTransientTrackCacheData() {
  for (const timerId of queuedManifestTimers.values()) {
    if (typeof window !== "undefined") {
      window.clearTimeout(timerId);
    }
  }
  queuedManifestTimers.clear();
  queuedManifestUpserts.clear();

  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.trackAssets,
    musicRoomDatabase.trackPieces,
    musicRoomDatabase.trackPieceManifests,
    async () => {
      await musicRoomDatabase.trackAssets.clear();
      await musicRoomDatabase.trackPieces.clear();
      await musicRoomDatabase.trackPieceManifests.clear();
    }
  );
}

function clearQueuedTrackPieceManifestTimer(trackId: string) {
  const timerId = queuedManifestTimers.get(trackId);
  if (timerId === undefined) {
    return;
  }

  if (typeof window !== "undefined") {
    window.clearTimeout(timerId);
  }
  queuedManifestTimers.delete(trackId);
}
