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
  }
}

export const musicRoomDatabase = new MusicRoomDatabase();
const queuedManifestUpserts = new Map<string, Omit<TrackPieceManifestRecord, "updatedAt">>();
const queuedManifestTimers = new Map<string, number>();
const manifestUpsertQueueDelayMs = 250;

export async function cacheTrackAsset(input: {
  trackId: string;
  fileHash: string;
  title: string;
  mimeType: string;
  file: Blob;
}) {
  await musicRoomDatabase.trackAssets.put({
    ...input,
    cachedAt: new Date().toISOString()
  });
}

export async function getCachedTrackAsset(trackId: string) {
  return musicRoomDatabase.trackAssets.get(trackId);
}

export async function deleteCachedTrackAsset(trackId: string) {
  await musicRoomDatabase.trackAssets.delete(trackId);
}

export async function getCachedTrackAssets(trackIds: string[]) {
  if (trackIds.length === 0) {
    return [];
  }

  return musicRoomDatabase.trackAssets.where("trackId").anyOf(trackIds).toArray();
}

export async function getCachedTrackAssetCount() {
  return musicRoomDatabase.trackAssets.count();
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
  const timerId = queuedManifestTimers.get(trackId);
  if (timerId !== undefined) {
    window.clearTimeout(timerId);
    queuedManifestTimers.delete(trackId);
  }

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
  const timerId = queuedManifestTimers.get(trackId);
  if (timerId !== undefined) {
    window.clearTimeout(timerId);
    queuedManifestTimers.delete(trackId);
  }
  await musicRoomDatabase.trackPieceManifests.delete(trackId);
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

export async function pruneCachedTracks(maxAssets: number, protectedTrackIds: string[] = []) {
  const protectedIds = new Set(protectedTrackIds);
  const assets = await musicRoomDatabase.trackAssets.orderBy("cachedAt").reverse().toArray();
  const removable = assets.filter((asset) => !protectedIds.has(asset.trackId));
  const overflow = Math.max(0, assets.length - maxAssets);
  const removedTrackIds = removable.slice(Math.max(0, removable.length - overflow)).map((asset) => asset.trackId);

  if (removedTrackIds.length === 0) {
    return [];
  }

  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.trackAssets,
    musicRoomDatabase.trackPieces,
    musicRoomDatabase.trackPieceManifests,
    async () => {
      await musicRoomDatabase.trackAssets.bulkDelete(removedTrackIds);
      await musicRoomDatabase.trackPieceManifests.bulkDelete(removedTrackIds);
      for (const trackId of removedTrackIds) {
        const pieces = await musicRoomDatabase.trackPieces.where("trackId").equals(trackId).toArray();
        if (pieces.length > 0) {
          await musicRoomDatabase.trackPieces.bulkDelete(pieces.map((piece) => piece.pieceId));
        }
      }
    }
  );

  return removedTrackIds;
}

export async function clearAllCachedTracks() {
  for (const timerId of queuedManifestTimers.values()) {
    window.clearTimeout(timerId);
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
