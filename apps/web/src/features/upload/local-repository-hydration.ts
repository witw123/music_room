"use client";

import {
  deleteCachedLibraryTrackFile,
  linkTrackAssets,
  putAssetManifest,
  releaseAssetUnitsToLocalRepository,
  saveLocalAudioCacheFileRecord,
  saveLocalAudioFileRecord,
  upsertTranscodeJob,
  upsertLocalPlaylistTrack,
  upsertCachedLibraryTrackSummary,
  type CachedLibraryTrackSummaryRecord,
  type TranscodeJobRecord
} from "@/lib/indexeddb";
import { LocalRepository, type LocalRepositoryTrackRecord } from "./local-repository";

export async function hydrateLocalRepository(repository: LocalRepository) {
  const records = await repository.listTracks();
  let restoredTrackCount = 0;
  let restoredOriginalAssetCount = 0;
  let restoredPlaybackAssetCount = 0;

  for (const record of records) {
    if (
      record.retention === "library" ||
      record.source.kind === "managed" ||
      (record.roomRefs?.length ?? 0) > 0
    ) {
      await restoreTrackSummary(repository, record);
      restoredTrackCount += 1;
    }
    if (record.source.kind === "managed") {
      await deleteCachedLibraryTrackFile(record.fileHash);
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

    if (record.originalAsset) {
      const original = await repository.readOriginalManifest(record.originalAsset.assetId);
      if (original?.manifest.kind === "original") {
        await putAssetManifest(original.manifest, { complete: true });
        await releaseAssetUnitsToLocalRepository(original.manifest.assetId);
        restoredOriginalAssetCount += 1;
      }
    }
    if (record.playbackAsset) {
      const playback = await repository.readPlaybackAsset(
        record.playbackAsset.assetId,
        record.playbackAsset.profileId
      );
      if (playback?.manifest.kind === "playback") {
        await putAssetManifest(playback.manifest, { complete: true });
        await releaseAssetUnitsToLocalRepository(playback.manifest.assetId);
        restoredPlaybackAssetCount += 1;
      }
    }

    for (const roomRef of record.roomRefs ?? []) {
      if (record.originalAsset && record.playbackAsset) {
        await linkTrackAssets({
          trackId: roomRef.trackId,
          originalAssetId: record.originalAsset.assetId,
          playbackAssetId: record.playbackAsset.assetId
        });
      }
    }
  }

  for (const providerTrack of await repository.listProviderTracks<Parameters<typeof upsertLocalPlaylistTrack>[0]>()) {
    await upsertLocalPlaylistTrack(providerTrack);
  }

  for (const job of await repository.listTranscodeJobs()) {
    await upsertTranscodeJob({
      sourceFileHash: job.sourceFileHash,
      kind: job.kind,
      profileId: job.profileId as TranscodeJobRecord["profileId"],
      status: job.status,
      progress: job.progress,
      errorMessage: job.errorMessage
    });
  }

  return { restoredTrackCount, restoredOriginalAssetCount, restoredPlaybackAssetCount };
}

async function restoreTrackSummary(
  repository: LocalRepository,
  record: LocalRepositoryTrackRecord
) {
  const lyrics = record.lyricsPath
    ? await repository.readPath(record.lyricsPath).then((file) => file?.text() ?? null).catch(() => null)
    : null;
  const summary: CachedLibraryTrackSummaryRecord = {
    fileHash: record.fileHash,
    title: record.title,
    artist: record.artist,
    ...(record.album !== undefined ? { album: record.album } : {}),
    ...(record.artworkUrl !== undefined ? { artworkUrl: record.artworkUrl } : {}),
    ...(record.lyrics !== undefined || lyrics !== null
      ? { lyrics: lyrics ?? record.lyrics ?? null }
      : {}),
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
