import type { TrackMeta } from "@music-room/shared";
import type {
  CachedLibraryTrackRecord,
  CachedLibraryTrackSummaryRecord
} from "@/lib/indexeddb";
import type {
  CachedLibraryTrack,
  CachedLibraryTrackFile
} from "./audio-utils";
import { isCachedLibraryTrackUsableForRoomTrack } from "./cached-library-track-policy";
import {
  createInFlightCachedLibraryTrackFileLoader,
  toCachedLibraryFileFromBlob,
  toCachedLibraryTrack,
  toCachedLibraryTrackFile
} from "./cache-library-files";

export {
  buildCachedLibraryFileName,
  createInFlightCachedLibraryTrackFileLoader,
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
  > & Partial<Pick<TrackMeta, "album" | "artworkUrl" | "sourceType" | "sourceRef">> & {
    lyrics?: string | null;
  };
  roomId: string;
  file: File | Blob;
};

export type CacheLibraryTrackUpsertRecord = {
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
  file: File;
  sourceTrackIds: string[];
  sourceRoomIds: string[];
  lastSourceTrackId: string;
  lastSourceRoomId: string;
  lastOwnerNickname: string | null;
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
}) {
  const records = await input.listCachedLibraryTrackSummaries();
  const tracks = records.map(toCachedLibraryTrack);

  return {
    tracks,
    tracksByHash: new Map(tracks.map((track) => [track.fileHash, track] as const))
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
    ...(input.track.album !== undefined ? { album: input.track.album } : {}),
    ...(input.track.artworkUrl !== undefined ? { artworkUrl: input.track.artworkUrl } : {}),
    ...(input.track.sourceType ? { provider: input.track.sourceType } : {}),
    ...(input.track.sourceRef?.trackId ? { providerTrackId: input.track.sourceRef.trackId } : {}),
    ...(input.track.lyrics !== undefined ? { lyrics: input.track.lyrics } : {}),
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

export function buildCachedLibraryFileForReload(record: CachedLibraryTrackRecord) {
  return toCachedLibraryTrackFile(record);
}

export function createCachedLibraryTrackFileLoader(
  loadCachedTrackFile: (fileHash: string) => Promise<CachedLibraryTrackFile | null>
) {
  return createInFlightCachedLibraryTrackFileLoader(loadCachedTrackFile);
}
