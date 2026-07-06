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

export function createInFlightCachedLibraryTrackFileLoader(
  loadCachedTrackFile: (fileHash: string) => Promise<CachedLibraryTrackFile | null>
) {
  const inFlightLoads = new Map<string, Promise<CachedLibraryTrackFile | null>>();

  return (fileHash: string) => {
    const existingLoad = inFlightLoads.get(fileHash);
    if (existingLoad) {
      return existingLoad;
    }

    const nextLoad = loadCachedTrackFile(fileHash).finally(() => {
      if (inFlightLoads.get(fileHash) === nextLoad) {
        inFlightLoads.delete(fileHash);
      }
    });
    inFlightLoads.set(fileHash, nextLoad);
    return nextLoad;
  };
}

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

export function toCachedLibraryFile(input: {
  file: Blob;
  title: string;
  mimeType: string;
  fileHash: string;
}) {
  if (input.file instanceof File) {
    return input.file;
  }

  return new File([input.file], buildCachedLibraryFileName(input), {
    type: input.mimeType || "audio/mpeg"
  });
}

export function toCachedLibraryFileFromBlob(
  file: Blob,
  track: Pick<TrackMeta, "title" | "mimeType" | "fileHash">
) {
  return toCachedLibraryFile({
    file,
    title: track.title,
    mimeType: track.mimeType || file.type || "audio/mpeg",
    fileHash: track.fileHash
  });
}

export function toCachedLibraryTrack(
  record: CachedLibraryTrackSummaryRecord
): CachedLibraryTrack {
  return {
    fileHash: record.fileHash,
    title: record.title,
    artist: record.artist,
    mimeType: record.mimeType,
    durationMs: record.durationMs,
    sizeBytes: record.sizeBytes,
    cachedAt: record.cachedAt,
    sourceTrackIds: record.sourceTrackIds,
    sourceRoomIds: record.sourceRoomIds,
    lastSourceTrackId: record.lastSourceTrackId,
    lastSourceRoomId: record.lastSourceRoomId,
    lastOwnerNickname: record.lastOwnerNickname
  };
}

export function toCachedLibraryTrackFile(
  record: CachedLibraryTrackRecord
): CachedLibraryTrackFile {
  return {
    ...toCachedLibraryTrack(record),
    file: toCachedLibraryFile(record)
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

export async function exportCachedLibraryTrackFile(input: {
  fileHash: string;
  loadCachedLibraryTrackFile: (fileHash: string) => Promise<CachedLibraryTrackFile | null>;
  createObjectUrl: (file: Blob) => string;
  clickDownload: (href: string, filename: string) => void;
  revokeObjectUrl: (href: string) => void;
  defer: (callback: () => void) => void;
}) {
  const cachedTrack = await input.loadCachedLibraryTrackFile(input.fileHash);
  if (!cachedTrack) {
    return false;
  }

  const downloadUrl = input.createObjectUrl(cachedTrack.file);
  input.clickDownload(downloadUrl, buildCachedLibraryFileName(cachedTrack));
  input.defer(() => input.revokeObjectUrl(downloadUrl));
  return true;
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

export function buildCachedLibraryFileName(input: {
  title: string;
  mimeType: string;
  fileHash: string;
}) {
  const baseName = sanitizeFileName(input.title) || input.fileHash;
  const extension = inferFileExtension(input.mimeType);
  return extension ? `${baseName}.${extension}` : baseName;
}

function inferFileExtension(mimeType: string | null | undefined) {
  switch ((mimeType ?? "").toLowerCase()) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/flac":
      return "flac";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mp4":
    case "audio/aac":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    default:
      return "";
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, " ").trim();
}
