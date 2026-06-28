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
  fileHash?: string;
  peerId: string;
  ownerKey?: string;
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
  pieceHashes?: string[];
  updatedAt: string;
};

export type ManualCacheTaskStatusRecord =
  | "idle"
  | "queued"
  | "downloading"
  | "paused"
  | "blocked"
  | "assembling"
  | "ready"
  | "failed"
  | "failed-integrity";

export type ManualCacheTaskRecord = {
  taskKey: string;
  roomId: string;
  trackId: string;
  fileHash: string;
  status: ManualCacheTaskStatusRecord;
  mode: "manual" | "playback-demand" | "auto-played";
  errorMessage: string | null;
  completedChunks: number;
  totalChunks: number;
  mimeType: string | null;
  manifestSource: string | null;
  blockedReason: string | null;
  integrityMode: "strong" | "weak" | null;
  providerPeerIds: string[];
  connectedProviderPeerIds: string[];
  selectedProviderPeerId: string | null;
  requestableChunkCount: number;
  pendingChunkCount: number;
  lastRequestedChunks: number[];
  lastPieceReceivedAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

export const localCacheOwnerKey = "__local__";
const transientCacheRetentionMs = 30 * 24 * 60 * 60 * 1000;

export class MusicRoomDatabase extends Dexie {
  trackAssets!: Table<TrackAssetRecord, string>;
  trackPieces!: Table<TrackPieceRecord, string>;
  trackPieceManifests!: Table<TrackPieceManifestRecord, string>;
  cachedTrackLibrary!: Table<CachedLibraryTrackRecord, string>;
  manualCacheTasks!: Table<ManualCacheTaskRecord, string>;

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
        const pieces = transaction.table<TrackPieceRecord, string>("trackPieces");
        await pieces.toCollection().modify((piece) => {
          piece.ownerKey ??= piece.peerId || localCacheOwnerKey;
          piece.fileHash ??= "";
        });
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

export async function getTrackPieceManifestByFileHash(fileHash: string) {
  if (!fileHash) {
    return null;
  }

  return (
    (await musicRoomDatabase.trackPieceManifests.where("fileHash").equals(fileHash).first()) ?? null
  );
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
    fileHash?: string;
    peerId: string;
    ownerKey?: string;
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
      ownerKey: piece.ownerKey ?? piece.peerId ?? localCacheOwnerKey,
      fileHash: piece.fileHash ?? "",
      createdAt: new Date().toISOString()
    }))
  );
}

export function filterCachedPiecesByGeometry<T extends { pieceId: string }>(
  pieces: T[],
  options?: { fileHash?: string | null; chunkSize?: number | null }
) {
  return pieces.filter((piece) => cachedPieceMatchesGeometry(piece, options));
}

function cachedPieceMatchesGeometry(
  piece: { pieceId: string },
  options?: { fileHash?: string | null; chunkSize?: number | null }
) {
  const chunkSize = options?.chunkSize;
  if (!chunkSize || chunkSize <= 0) {
    return true;
  }

  const [identity, chunkSizeText] = piece.pieceId.split(":");
  if (options?.fileHash && identity !== options.fileHash) {
    return false;
  }

  return Number(chunkSizeText) === chunkSize;
}

export async function getCachedPieceIndexes(
  trackId: string,
  peerId: string,
  options?: { fileHash?: string | null; ownerKey?: string | null; chunkSize?: number | null }
) {
  const ownerKey = options?.ownerKey ?? peerId;
  if (options?.fileHash) {
    const pieces = await musicRoomDatabase.trackPieces
      .where("[fileHash+ownerKey]")
      .equals([options.fileHash, ownerKey])
      .toArray();

    return uniqueSortedChunkIndexes(filterCachedPiecesByGeometry(pieces, options));
  }

  const pieces = await musicRoomDatabase.trackPieces
    .where("[trackId+ownerKey]")
    .equals([trackId, ownerKey])
    .toArray();

  return uniqueSortedChunkIndexes(filterCachedPiecesByGeometry(pieces, options));
}

export async function getCachedPiece(
  trackId: string,
  peerId: string,
  chunkIndex: number,
  options?: { fileHash?: string | null; ownerKey?: string | null; chunkSize?: number | null }
): Promise<TrackPieceRecord | null> {
  const ownerKey = options?.ownerKey ?? peerId;
  if (options?.fileHash) {
    const pieces = await musicRoomDatabase.trackPieces
      .where("[fileHash+ownerKey+chunkIndex]")
      .equals([options.fileHash, ownerKey, chunkIndex])
      .toArray();

    return filterCachedPiecesByGeometry(pieces, options)[0] ?? null;
  }

  const pieces = await musicRoomDatabase.trackPieces
    .where("[trackId+ownerKey+chunkIndex]")
    .equals([trackId, ownerKey, chunkIndex])
    .toArray();

  return filterCachedPiecesByGeometry(pieces, options)[0] ?? null;
}

export async function getCachedPiecesForTrack(
  trackId: string,
  peerId: string,
  options?: { fileHash?: string | null; ownerKey?: string | null; chunkSize?: number | null }
) {
  const ownerKey = options?.ownerKey ?? peerId;
  const pieces = options?.fileHash
    ? await musicRoomDatabase.trackPieces
        .where("[fileHash+ownerKey]")
        .equals([options.fileHash, ownerKey])
        .toArray()
    : await musicRoomDatabase.trackPieces
        .where("[trackId+ownerKey]")
        .equals([trackId, ownerKey])
        .toArray();

  return filterCachedPiecesByGeometry(pieces, options).sort(
    (left, right) => left.chunkIndex - right.chunkIndex
  );
}

export async function deleteCachedPiecesForTrack(trackId: string, peerId?: string) {
  const pieces = peerId
    ? await musicRoomDatabase.trackPieces.where("[trackId+ownerKey]").equals([trackId, peerId]).toArray()
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

  const cutoff = new Date(Date.now() - transientCacheRetentionMs).toISOString();
  const expiredTasks = await musicRoomDatabase.manualCacheTasks
    .where("updatedAt")
    .below(cutoff)
    .toArray();
  const expiredTrackIds = expiredTasks.map((task) => task.trackId);
  const expiredTaskKeys = expiredTasks.map((task) => task.taskKey);
  const expiredPieces =
    expiredTrackIds.length > 0
      ? await musicRoomDatabase.trackPieces.where("trackId").anyOf(expiredTrackIds).toArray()
      : [];

  await musicRoomDatabase.transaction(
    "rw",
    musicRoomDatabase.trackAssets,
    musicRoomDatabase.trackPieces,
    musicRoomDatabase.trackPieceManifests,
    musicRoomDatabase.manualCacheTasks,
    async () => {
      if (expiredTrackIds.length > 0) {
        await musicRoomDatabase.trackAssets.bulkDelete(expiredTrackIds);
        await musicRoomDatabase.trackPieceManifests.bulkDelete(expiredTrackIds);
      }
      if (expiredPieces.length > 0) {
        await musicRoomDatabase.trackPieces.bulkDelete(expiredPieces.map((piece) => piece.pieceId));
      }
      if (expiredTaskKeys.length > 0) {
        await musicRoomDatabase.manualCacheTasks.bulkDelete(expiredTaskKeys);
      }
    }
  );
}

export async function upsertManualCacheTask(
  input: Omit<ManualCacheTaskRecord, "taskKey" | "updatedAt"> & {
    taskKey?: string;
    updatedAt?: string;
  }
) {
  const taskKey = input.taskKey ?? buildManualCacheTaskKey(input.roomId, input.trackId);
  await musicRoomDatabase.manualCacheTasks.put({
    ...input,
    taskKey,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  });
}

export async function getManualCacheTask(roomId: string, trackId: string) {
  return (
    (await musicRoomDatabase.manualCacheTasks
      .where("[roomId+trackId]")
      .equals([roomId, trackId])
      .first()) ?? null
  );
}

export async function listManualCacheTasksForRoom(roomId: string) {
  return musicRoomDatabase.manualCacheTasks.where("roomId").equals(roomId).toArray();
}

export async function deleteManualCacheTask(roomId: string, trackId: string) {
  await musicRoomDatabase.manualCacheTasks.delete(buildManualCacheTaskKey(roomId, trackId));
}

export async function deleteManualCacheTasksForTracks(roomId: string, trackIds: string[]) {
  const keys = [...new Set(trackIds.filter(Boolean))].map((trackId) =>
    buildManualCacheTaskKey(roomId, trackId)
  );
  if (keys.length === 0) {
    return;
  }
  await musicRoomDatabase.manualCacheTasks.bulkDelete(keys);
}

export function buildManualCacheTaskKey(roomId: string, trackId: string) {
  return `${roomId}:${trackId}`;
}

function uniqueSortedChunkIndexes(pieces: Array<{ chunkIndex: number }>) {
  return [...new Set(pieces.map((piece) => piece.chunkIndex))].sort((left, right) => left - right);
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
