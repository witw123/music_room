import type {
  CachedLibraryTrackRecord,
  CachedLibraryTrackSummaryRecord
} from "@/lib/indexeddb";
import type { TrackMeta } from "@music-room/shared";
import type {
  CachedLibraryTrack,
  UploadedTrack
} from "@/features/upload/audio-utils";
import { isCachedLibraryTrackUsableForRoomTrack } from "@/features/upload/cached-library-track-policy";
import { toCachedLibraryFile } from "./cache-library";

type MissingOwnedRoomTrack = Pick<
  TrackMeta,
  "id" | "fileHash"
> &
  Partial<Pick<TrackMeta, "durationMs" | "sizeBytes">>;

export async function rehydrateOwnedUploadedTracksFromCache(input: {
  missingOwnedTracks: MissingOwnedRoomTrack[];
  cachedLibraryTracksByHash: Map<string, CachedLibraryTrack>;
  getCachedLibraryTrackSummary: (
    fileHash: string
  ) => Promise<CachedLibraryTrackSummaryRecord | null | undefined>;
  getCachedLibraryTrack: (
    fileHash: string
  ) => Promise<CachedLibraryTrackRecord | null | undefined>;
  createObjectUrl: (file: File) => string;
}): Promise<{
  uploads: Record<string, UploadedTrack>;
  createdObjectUrls: string[];
}> {
  const uploads: Record<string, UploadedTrack> = {};
  const createdObjectUrls: string[] = [];

  for (const track of input.missingOwnedTracks) {
    const cachedSummary =
      input.cachedLibraryTracksByHash.get(track.fileHash) ??
      (await input.getCachedLibraryTrackSummary(track.fileHash));
    if (
      !isCachedLibraryTrackUsableForRoomTrack({
        cachedTrack: cachedSummary,
        roomTrack: track
      })
    ) {
      continue;
    }

    const cachedRecord = await input.getCachedLibraryTrack(track.fileHash);
    const usableCachedRecord = isCachedLibraryTrackUsableForRoomTrack({
      cachedTrack: cachedRecord,
      roomTrack: track
    })
      ? cachedRecord
      : null;
    if (!usableCachedRecord) {
      continue;
    }

    const cachedFile = toCachedLibraryFile({
      file: usableCachedRecord.file,
      title: usableCachedRecord.title,
      mimeType: usableCachedRecord.mimeType,
      fileHash: usableCachedRecord.fileHash
    });
    const objectUrl = input.createObjectUrl(cachedFile);
    createdObjectUrls.push(objectUrl);
    uploads[track.id] = {
      file: cachedFile,
      objectUrl,
      origin: "live-upload"
    };
  }

  return {
    uploads,
    createdObjectUrls
  };
}
