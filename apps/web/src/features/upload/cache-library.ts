import type { TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import type {
  CachedLibraryTrackRecord,
  CachedLibraryTrackSummaryRecord
} from "@/lib/indexeddb";
import type {
  CachedLibraryTrack,
  CachedLibraryTrackFile,
  UploadedTrack
} from "@/features/upload/audio-utils";
import { isCachedLibraryTrackUsableForRoomTrack } from "@/features/upload/cached-library-track-policy";
import { resolveReusableCachedPieceManifest } from "./track-availability";
import type { ManualCacheTask } from "./upload-ui-state";
import {
  toCachedLibraryFileFromBlob,
  toCachedLibraryTrack
} from "./cache-library-files";

export {
  buildCachedLibraryFileName,
  createInFlightCachedLibraryTrackFileLoader,
  exportCachedLibraryTrackFile,
  toCachedLibraryFile,
  toCachedLibraryFileFromBlob,
  toCachedLibraryTrack,
  toCachedLibraryTrackFile
} from "./cache-library-files";

type CacheLibraryTrackUpsertInput = {
  track: Pick<
    TrackMeta,
    | "id"
    | "title"
    | "artist"
    | "mimeType"
    | "durationMs"
    | "sizeBytes"
    | "fileHash"
    | "ownerNickname"
  >;
  roomId: string;
  file: File | Blob;
};

type CacheLibraryTrackUpsertRecord = {
  fileHash: string;
  title: string;
  artist: string;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  file: File;
  sourceTrackIds: string[];
  sourceRoomIds: string[];
  lastSourceTrackId: string;
  lastSourceRoomId: string;
  lastOwnerNickname: string | null;
};

type TrackRegistrationDraft = Omit<TrackMeta, "id"> & { id?: string };
type UploadedTracksState = Record<string, UploadedTrack>;
type UploadedTracksStateSetter = (updater: (current: UploadedTracksState) => UploadedTracksState) => void;

type CachedPieceIndex = {
  chunkIndex: number;
};

type StartCacheDownloadResult = {
  taskPatch: Partial<ManualCacheTask> | null;
  chunkIndexes: Set<number> | null;
  shouldClearChunkIndexes: boolean;
  assembleRequest: { trackId: string; mimeType: string | null; totalChunks: number } | null;
  statusMessage: string | null;
};

export function hasUsableCachedLibraryFileForRoomTrack(input: {
  cachedTrack:
    | (CachedLibraryTrackRecord & { file?: Blob | null })
    | (CachedLibraryTrackSummaryRecord & { file?: Blob | null })
    | CachedLibraryTrack
    | CachedLibraryTrackFile
    | null
    | undefined;
  roomTrack:
    | Pick<TrackMeta, "id" | "fileHash" | "durationMs" | "sizeBytes">
    | null
    | undefined;
}) {
  return !!(
    input.cachedTrack &&
    "file" in input.cachedTrack &&
    input.cachedTrack.file &&
    isCachedLibraryTrackUsableForRoomTrack({
      cachedTrack: input.cachedTrack,
      roomTrack: input.roomTrack
    })
  );
}

export async function loadCacheLibrarySnapshot(input: {
  listCachedLibraryTrackSummaries: () => Promise<CachedLibraryTrackSummaryRecord[]>;
  getCachedLibraryTrackCount: () => Promise<number>;
}) {
  const records = await input.listCachedLibraryTrackSummaries();
  const tracks = records.map(toCachedLibraryTrack);

  return {
    tracks,
    tracksByHash: new Map(tracks.map((track) => [track.fileHash, track] as const)),
    count: await input.getCachedLibraryTrackCount()
  };
}

export function claimRoomEntryCacheAutoImport(input: {
  cacheLibraryHydrated: boolean;
  entryKey: string | null;
  claimedEntryKey: string | null;
}) {
  if (!input.cacheLibraryHydrated || !input.entryKey) {
    return {
      shouldRun: false,
      nextClaimedEntryKey: input.claimedEntryKey
    };
  }

  return {
    shouldRun: input.claimedEntryKey !== input.entryKey,
    nextClaimedEntryKey: input.entryKey
  };
}

export function selectCachedLibraryTracksForRoomAutoImport(input: {
  activeSessionNickname: string | null | undefined;
  activeSessionUserId: string | null | undefined;
  roomId: string | null | undefined;
  roomTracks: Array<Pick<TrackMeta, "fileHash" | "ownerSessionId">>;
  cachedLibraryTracks: CachedLibraryTrack[];
}) {
  if (!input.activeSessionUserId || !input.activeSessionNickname || !input.roomId) {
    return [];
  }

  const existingOwnedFileHashes = new Set(
    input.roomTracks
      .filter((track) => track.ownerSessionId === input.activeSessionUserId)
      .map((track) => track.fileHash)
  );
  const selected = new Set<string>();

  for (const cachedTrack of input.cachedLibraryTracks) {
    const belongsToCurrentRoom =
      cachedTrack.sourceRoomIds.includes(input.roomId) ||
      cachedTrack.lastSourceRoomId === input.roomId;
    const belongsToActiveMember = cachedTrack.lastOwnerNickname === input.activeSessionNickname;
    if (
      belongsToCurrentRoom &&
      belongsToActiveMember &&
      !existingOwnedFileHashes.has(cachedTrack.fileHash)
    ) {
      selected.add(cachedTrack.fileHash);
    }
  }

  return [...selected];
}

export function buildCachedLibraryTrackUpsertRecord(
  input: CacheLibraryTrackUpsertInput
): CacheLibraryTrackUpsertRecord {
  const file =
    input.file instanceof File ? input.file : toCachedLibraryFileFromBlob(input.file, input.track);

  return {
    fileHash: input.track.fileHash,
    title: input.track.title,
    artist: input.track.artist ?? "未知艺术家",
    mimeType: input.track.mimeType || file.type || "audio/mpeg",
    durationMs: input.track.durationMs,
    sizeBytes: input.track.sizeBytes ?? file.size,
    file,
    sourceTrackIds: [input.track.id],
    sourceRoomIds: [input.roomId],
    lastSourceTrackId: input.track.id,
    lastSourceRoomId: input.roomId,
    lastOwnerNickname: input.track.ownerNickname ?? null
  };
}

export async function deleteCachedLibraryTrackEntry(input: {
  fileHash: string;
  deleteCachedLibraryTrackRecord: (
    fileHash: string
  ) => Promise<(CachedLibraryTrackRecord & { sourceTrackIds: string[] }) | null | undefined>;
  deleteCachedPiecesForTracks: (trackIds: string[]) => Promise<unknown>;
}) {
  const record = await input.deleteCachedLibraryTrackRecord(input.fileHash);
  const affectedTrackIds = record?.sourceTrackIds ?? [];
  if (affectedTrackIds.length > 0) {
    await input.deleteCachedPiecesForTracks(affectedTrackIds);
  }

  return { affectedTrackIds };
}

export async function deleteUploadedTrackArtifacts(input: {
  trackId: string;
  roomId: string | null | undefined;
  deleteCachedPiecesForTrack: (trackId: string) => Promise<unknown>;
  deleteManualCacheTask: (roomId: string, trackId: string) => Promise<unknown>;
}) {
  await input.deleteCachedPiecesForTrack(input.trackId);
  if (input.roomId) {
    await input.deleteManualCacheTask(input.roomId, input.trackId);
  }

  return { removedTrackIds: [input.trackId] };
}

export async function deleteRoomTrackArtifacts(input: {
  trackIds: string[];
  roomId: string | null | undefined;
  deleteCachedPiecesForTracks: (trackIds: string[]) => Promise<unknown>;
  deleteManualCacheTasksForTracks: (roomId: string, trackIds: string[]) => Promise<unknown>;
}) {
  const removedTrackIds = [...new Set(input.trackIds.filter(Boolean))];
  if (removedTrackIds.length === 0) {
    return { removedTrackIds };
  }

  await input.deleteCachedPiecesForTracks(removedTrackIds);
  if (input.roomId) {
    await input.deleteManualCacheTasksForTracks(input.roomId, removedTrackIds);
  }

  return { removedTrackIds };
}

export async function importCachedLibraryTrackToRoom(input: {
  fileHash: string;
  activeSession: { userId: string; nickname: string } | null;
  roomId: string | null | undefined;
  roomTracks: TrackMeta[];
  peerId: string;
  shouldAnnounceAvailability: boolean;
  loadCachedLibraryTrackFile: (fileHash: string) => Promise<CachedLibraryTrackFile | null>;
  createObjectUrl: (file: File) => string;
  revokeObjectUrl: (href: string) => void;
  buildTrackMeta: (file: File, objectUrl: string) => Promise<TrackRegistrationDraft>;
  buildRegisterTrackPayload: (track: TrackRegistrationDraft) => unknown;
  registerTrack: (roomId: string, payload: unknown) => Promise<TrackMeta>;
  syncRoomSnapshot: (roomId: string) => Promise<void>;
  buildTrackAvailabilityFromFile: (input: {
    roomId: string;
    trackId: string;
    fileHash: string;
    file: File;
    peerId: string;
    nickname: string;
    source: "live_upload";
    mimeType: string | null;
    codec: string | null;
    sizeBytes: number;
    durationMs: number;
    totalChunks?: number;
    chunkSize?: number;
  }) => Promise<TrackAvailabilityAnnouncement>;
  publishAvailability: (availability: TrackAvailabilityAnnouncement) => void;
}): Promise<{ trackId: string; upload: UploadedTrack } | null> {
  if (!input.activeSession || !input.roomId) {
    return null;
  }

  const cachedTrack = await input.loadCachedLibraryTrackFile(input.fileHash);
  if (!cachedTrack) {
    return null;
  }

  let registeredTrack =
    input.roomTracks.find(
      (track) =>
        track.ownerSessionId === input.activeSession?.userId &&
        track.fileHash === input.fileHash
    ) ?? null;

  if (!registeredTrack) {
    const tempObjectUrl = input.createObjectUrl(cachedTrack.file);
    try {
      const trackMeta = await input.buildTrackMeta(cachedTrack.file, tempObjectUrl);
      registeredTrack = await input.registerTrack(
        input.roomId,
        input.buildRegisterTrackPayload(trackMeta)
      );
    } finally {
      input.revokeObjectUrl(tempObjectUrl);
    }
    await input.syncRoomSnapshot(input.roomId);
  }

  const uploadObjectUrl = input.createObjectUrl(cachedTrack.file);
  if (input.peerId && input.shouldAnnounceAvailability) {
    input.publishAvailability(
      await input.buildTrackAvailabilityFromFile({
        roomId: input.roomId,
        trackId: registeredTrack.id,
        fileHash: registeredTrack.fileHash,
        file: cachedTrack.file,
        peerId: input.peerId,
        nickname: input.activeSession.nickname,
        source: "live_upload",
        mimeType: registeredTrack.mimeType ?? null,
        codec: registeredTrack.codec ?? null,
        sizeBytes: registeredTrack.sizeBytes ?? cachedTrack.file.size,
        durationMs: registeredTrack.durationMs,
        totalChunks: registeredTrack.pieceManifest?.totalChunks,
        chunkSize: registeredTrack.pieceManifest?.chunkSize
      })
    );
  }

  return {
    trackId: registeredTrack.id,
    upload: {
      file: cachedTrack.file,
      objectUrl: uploadObjectUrl,
      origin: "live-upload"
    }
  };
}

export function applyCachedLibraryRoomImportResult(input: {
  result: { trackId: string; upload: UploadedTrack } | null;
  setUploadedTracks: UploadedTracksStateSetter;
}) {
  const result = input.result;
  if (!result) {
    return null;
  }

  input.setUploadedTracks((current) => ({
    ...current,
    [result.trackId]: result.upload
  }));
  return result.trackId;
}

export async function startCacheDownload(input: {
  manualTrackCachingEnabled: boolean;
  trackId: string;
  mode: ManualCacheTask["mode"];
  roomTracks: TrackMeta[];
  peerId: string;
  cachedLibraryTracksByHash: Map<string, CachedLibraryTrack>;
  getCachedLibraryTrackSummary: (
    fileHash: string
  ) => Promise<CachedLibraryTrackSummaryRecord | null | undefined>;
  getCachedLibraryTrack: (
    fileHash: string
  ) => Promise<CachedLibraryTrackRecord | null | undefined>;
  getTrackPieceManifestByFileHash: (
    fileHash: string
  ) => Promise<{
    totalChunks: number;
    chunkSize: number;
    mimeType?: string | null;
    pieceHashes?: string[] | null;
  } | null | undefined>;
  getTrackPieceManifest: (
    trackId: string
  ) => Promise<{
    totalChunks: number;
    chunkSize: number;
    mimeType?: string | null;
    pieceHashes?: string[] | null;
  } | null | undefined>;
  deleteCachedPiecesForTrack: (
    trackId: string,
    peerId?: string,
    options?: { fileHash?: string; ownerKey?: string }
  ) => Promise<unknown>;
  getCachedPiecesForTrack: (
    trackId: string,
    peerId: string,
    options?: { fileHash?: string; ownerKey?: string; chunkSize?: number }
  ) => Promise<CachedPieceIndex[]>;
  localCacheOwnerKey?: string;
}): Promise<StartCacheDownloadResult> {
  const emptyResult: StartCacheDownloadResult = {
    taskPatch: null,
    chunkIndexes: null,
    shouldClearChunkIndexes: false,
    assembleRequest: null,
    statusMessage: null
  };
  if (!input.manualTrackCachingEnabled) {
    return emptyResult;
  }

  const track = input.roomTracks.find((entry) => entry.id === input.trackId);
  if (!track) {
    return emptyResult;
  }

  const cachedLibraryTrack =
    input.cachedLibraryTracksByHash.get(track.fileHash) ??
    (await input.getCachedLibraryTrackSummary(track.fileHash));
  if (
    isCachedLibraryTrackUsableForRoomTrack({
      cachedTrack: cachedLibraryTrack,
      roomTrack: track
    })
  ) {
    const cachedLibraryRecord = await input.getCachedLibraryTrack(track.fileHash);
    if (
      hasUsableCachedLibraryFileForRoomTrack({
        cachedTrack: cachedLibraryRecord,
        roomTrack: track
      })
    ) {
      return {
        ...emptyResult,
        taskPatch: {
          status: "ready",
          mode: input.mode,
          fileHash: track.fileHash,
          errorMessage: null,
          completedChunks: resolveTrackTotalChunks(track),
          totalChunks: resolveTrackTotalChunks(track),
          mimeType: track.mimeType ?? null,
          blockedReason: null,
          lastError: null
        }
      };
    }
  }

  const expectedManifest = track.relayManifest ?? track.pieceManifest ?? null;
  const rawCachedManifest =
    (await input.getTrackPieceManifestByFileHash(track.fileHash)) ??
    (await input.getTrackPieceManifest(input.trackId));
  const cachedManifest = resolveReusableCachedPieceManifest({
    cachedManifest: rawCachedManifest,
    expectedManifest
  });
  const manifestMismatch =
    !!rawCachedManifest &&
    !cachedManifest &&
    !!expectedManifest &&
    (rawCachedManifest.totalChunks !== expectedManifest.totalChunks ||
      rawCachedManifest.chunkSize !== expectedManifest.chunkSize);
  if (manifestMismatch) {
    await input.deleteCachedPiecesForTrack(input.trackId, undefined, {
      fileHash: track.fileHash,
      ownerKey: input.localCacheOwnerKey
    });
  }

  const pieces = await input.getCachedPiecesForTrack(input.trackId, input.peerId, {
    fileHash: track.fileHash,
    ownerKey: input.localCacheOwnerKey,
    chunkSize: cachedManifest?.chunkSize ?? expectedManifest?.chunkSize
  });
  const chunkIndexes = new Set(pieces.map((piece) => piece.chunkIndex));
  const totalChunks =
    cachedManifest?.totalChunks ?? expectedManifest?.totalChunks ?? Math.max(chunkIndexes.size, 0);
  const mimeType = cachedManifest?.mimeType ?? track.mimeType ?? null;
  const completedChunks = chunkIndexes.size;
  const taskPatch: Partial<ManualCacheTask> = {
    status: completedChunks > 0 ? "downloading" : "queued",
    mode: input.mode,
    fileHash: track.fileHash,
    errorMessage: null,
    completedChunks,
    totalChunks,
    mimeType,
    manifestSource: cachedManifest ? "cache" : expectedManifest ? "snapshot" : null,
    blockedReason: null,
    integrityMode: cachedManifest?.pieceHashes?.length === totalChunks ? "strong" : "weak",
    lastError: null
  };

  return {
    taskPatch,
    chunkIndexes,
    shouldClearChunkIndexes: manifestMismatch,
    assembleRequest:
      totalChunks > 0 && completedChunks >= totalChunks
        ? { trackId: input.trackId, mimeType, totalChunks }
        : null,
    statusMessage: input.mode === "manual" ? `已开始缓存《${track.title}》。` : null
  };
}

function resolveTrackTotalChunks(track: Pick<TrackMeta, "relayManifest" | "pieceManifest">) {
  return track.relayManifest?.totalChunks ?? track.pieceManifest?.totalChunks ?? 0;
}
