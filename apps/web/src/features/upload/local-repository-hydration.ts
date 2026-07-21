"use client";

import {
  saveLocalAudioCacheFileRecord,
  saveLocalAudioFileRecord,
  upsertLocalPlaylistTrack,
  upsertCachedLibraryTrackSummary,
  type CachedLibraryTrackSummaryRecord
} from "@/lib/indexeddb";
import { LocalRepository, type LocalRepositoryTrackRecord } from "./local-repository";

export async function hydrateLocalRepository(repository: LocalRepository) {
  const records = await repository.listTracks();
  let restoredTrackCount = 0;

  for (const record of records) {
    if (record.retention === "library" || record.source.kind === "managed") {
      await restoreTrackSummary(record);
      restoredTrackCount += 1;
    }
    if (record.source.kind === "managed") {
      const fileName = record.source.relativePath.split("/").pop() ?? record.fileHash;
      if (record.retention === "library") {
        await saveLocalAudioFileRecord({
          fileHash: record.fileHash,
          fileName,
          relativePath: record.source.relativePath,
          storageKind: "saved"
        });
      } else {
        await saveLocalAudioCacheFileRecord({
          fileHash: record.fileHash,
          fileName,
          relativePath: record.source.relativePath
        });
      }
    }
  }

  for (const providerTrack of await repository.listProviderTracks<Parameters<typeof upsertLocalPlaylistTrack>[0]>()) {
    await upsertLocalPlaylistTrack(providerTrack);
  }

  return { restoredTrackCount, restoredOriginalAssetCount: 0, restoredPlaybackAssetCount: 0 };
}

async function restoreTrackSummary(record: LocalRepositoryTrackRecord) {
  const summary: CachedLibraryTrackSummaryRecord = {
    fileHash: record.fileHash,
    title: record.title,
    artist: record.artist,
    ...(record.album !== undefined ? { album: record.album } : {}),
    ...(record.artworkUrl !== undefined ? { artworkUrl: record.artworkUrl } : {}),
    ...(record.lyrics !== undefined ? { lyrics: record.lyrics } : {}),
    ...(record.sourceType !== undefined ? { provider: record.sourceType } : {}),
    ...(record.sourceRef?.trackId ? { providerTrackId: record.sourceRef.trackId } : {}),
    mimeType: record.mimeType,
    durationMs: record.durationMs,
    sizeBytes: record.sizeBytes,
    cachedAt: record.updatedAt,
    sourceTrackIds: record.roomRefs?.map((ref) => ref.trackId) ?? [],
    sourceRoomIds: record.roomRefs?.map((ref) => ref.roomId) ?? [],
    lastSourceTrackId: record.roomRefs?.at(-1)?.trackId ?? null,
    lastSourceRoomId: record.roomRefs?.at(-1)?.roomId ?? null,
    lastOwnerNickname: record.roomRefs?.at(-1)?.ownerNickname ?? null
  };
  await upsertCachedLibraryTrackSummary(summary);
}
