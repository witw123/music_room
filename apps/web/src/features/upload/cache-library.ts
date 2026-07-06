import type { TrackMeta } from "@music-room/shared";
import type {
  CachedLibraryTrackRecord,
  CachedLibraryTrackSummaryRecord
} from "@/lib/indexeddb";
import type {
  CachedLibraryTrack,
  CachedLibraryTrackFile
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
