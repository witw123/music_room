"use client";

import {
  putAssetManifest,
  putVerifiedAssetUnit,
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
  let restoredPlaybackAssetCount = 0;

  for (const record of records) {
    await restoreTrackSummary(record);
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

    restoredTrackCount += 1;
  }

  for (const manifest of await repository.listPlaybackAssets()) {
    if (await restorePlaybackAsset(repository, manifest)) {
      restoredPlaybackAssetCount += 1;
    }
  }

  for (const providerTrack of await repository.listProviderTracks<Parameters<typeof upsertLocalPlaylistTrack>[0]>()) {
    await upsertLocalPlaylistTrack(providerTrack);
  }

  return { restoredTrackCount, restoredPlaybackAssetCount };
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
    sourceTrackIds: [],
    sourceRoomIds: [],
    lastSourceTrackId: null,
    lastSourceRoomId: null,
    lastOwnerNickname: null
  };
  await upsertCachedLibraryTrackSummary(summary);
}

async function restorePlaybackAsset(
  repository: LocalRepository,
  manifest: Awaited<ReturnType<LocalRepository["listPlaybackAssets"]>>[number]
) {
  if (!manifest || manifest.manifest.kind !== "playback") return false;

  try {
    await putAssetManifest(manifest.manifest);
    for (const unit of manifest.units) {
      const file = await repository.readPlaybackUnit(unit);
      if (!file) return false;
      await putVerifiedAssetUnit({
        descriptor: unit.descriptor,
        payload: await file.arrayBuffer()
      });
    }
    return true;
  } catch {
    return false;
  }
}
