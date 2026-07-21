"use client";

import type {
  PlaybackAssetManifest,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import {
  getAssetManifest,
  getAssetUnit,
  getTrackAssetLink,
  linkTrackAssets,
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import {
  musicRoomApi,
  resolveDownloadedAudioMimeType
} from "@/lib/music-room-api";
import { persistRoomSnapshotToLocalRepository } from "@/features/upload/local-room-storage";
import { saveCachedAudioFileToLocalDirectory } from "@/features/upload/local-audio-storage";
import {
  buildCachedLibraryTrackUpsertRecord,
  notifyCacheLibraryChanged
} from "@/features/upload/cache-library";
import {
  playbackEncoderVersion,
  playbackProfileId,
  prepareAudioAssets
} from "@/features/upload/audio-asset-builder";

export type OfflineProviderSource = {
  provider: "netease" | "qqmusic";
  trackId: string;
  label: string;
};

type OfflineFallbackResult = {
  playbackAsset: PlaybackAssetManifest;
  fileHash: string;
};

const inFlightFallbackImports = new Map<
  string,
  Promise<OfflineFallbackResult>
>();

export function resolveOfflineProviderSource(input: {
  roomSnapshot: RoomSnapshot | null | undefined;
  track: TrackMeta | null | undefined;
}) {
  const { roomSnapshot, track } = input;
  const playback = roomSnapshot?.room.playback;
  if (
    !track ||
    !playback ||
    playback.status !== "playing" ||
    playback.currentTrackId !== track.id
  ) {
    return null;
  }

  const sourceSessionId = playback.sourceSessionId ?? track.ownerSessionId;
  const sourceMember = roomSnapshot.room.members.find(
    (member) => member.id === sourceSessionId
  );
  if (sourceMember && sourceMember.presenceState !== "offline") {
    return null;
  }

  if (
    (track.sourceType !== "netease" && track.sourceType !== "qqmusic") ||
    !track.sourceRef ||
    track.sourceRef.provider !== track.sourceType
  ) {
    return null;
  }

  return {
    provider: track.sourceType,
    trackId: track.sourceRef.trackId,
    label: track.sourceType === "netease" ? "网易云音乐" : "QQ 音乐"
  } satisfies OfflineProviderSource;
}

export async function ensureOfflineProviderPlaybackAsset(input: {
  roomSnapshot: RoomSnapshot;
  track: TrackMeta;
  source: OfflineProviderSource;
  onStatus?: (message: string) => void;
  signal?: AbortSignal;
}) {
  const localPlaybackAsset = await findUsableLocalPlaybackAsset(input.track.id, input.track);
  if (localPlaybackAsset) {
    return {
      playbackAsset: localPlaybackAsset,
      fileHash: localPlaybackAsset.sourceFileHash
    } satisfies OfflineFallbackResult;
  }

  const importKey = `${input.roomSnapshot.room.id}:${input.track.id}:${input.source.provider}:${input.source.trackId}`;
  const existing = inFlightFallbackImports.get(importKey);
  if (existing) {
    return existing;
  }

  const operation = importOfflineProviderTrack(input);
  inFlightFallbackImports.set(importKey, operation);
  const sharedOperation = operation.finally(() => {
    if (inFlightFallbackImports.get(importKey) === sharedOperation) {
      inFlightFallbackImports.delete(importKey);
    }
  });
  inFlightFallbackImports.set(importKey, sharedOperation);
  return sharedOperation;
}

async function importOfflineProviderTrack(input: {
  roomSnapshot: RoomSnapshot;
  track: TrackMeta;
  source: OfflineProviderSource;
  onStatus?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<OfflineFallbackResult> {
  const { roomSnapshot, track, source, onStatus, signal } = input;
  onStatus?.(`成员不在线，正在从${source.label}获取《${track.title}》并导入曲库…`);

  const downloaded = source.provider === "netease"
    ? await musicRoomApi.downloadNeteaseTrack(source.trackId, "exhigh", signal)
    : await musicRoomApi.downloadQqMusicTrack(source.trackId, "exhigh", signal);
  const mimeType = await resolveDownloadedAudioMimeType(
    downloaded.blob,
    downloaded.contentType
  );
  const extension = mimeType === "audio/flac" ? "flac" : "mp3";
  const file = new File(
    [downloaded.blob],
    `${sanitizeFileName(track.title) || source.provider}-fallback.${extension}`,
    { type: mimeType }
  );

  const prepared = await prepareAudioAssets({
    file,
    signal,
    onProgress: ({ stage, completed, total }) => {
      if (stage !== "encoding" && stage !== "persisting-playback") return;
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
      onStatus?.(`成员不在线，正在从${source.label}导入曲库《${track.title}》 ${percent}%`);
    }
  });

  await linkTrackAssets({
    trackId: track.id,
    originalAssetId: prepared.originalAsset.assetId,
    playbackAssetId: prepared.playbackAsset.assetId
  });

  const lyrics = track.lyrics?.trim() || await resolveProviderLyrics(source);
  await upsertCachedLibraryTrack(
    buildCachedLibraryTrackUpsertRecord({
      roomId: roomSnapshot.room.id,
      file,
      track: {
        ...track,
        fileHash: prepared.fileHash,
        sizeBytes: file.size,
        durationMs: prepared.playbackAsset.durationMs,
        mimeType,
        lyrics: lyrics || null
      }
    })
  );

  // Keep the browser cache as the fallback when no local repository is set.
  // When one exists, move the source file into it immediately instead.
  await saveCachedAudioFileToLocalDirectory({
    file,
    fileHash: prepared.fileHash,
    title: track.title,
    mimeType,
    provider: source.provider,
    originalAsset: prepared.originalAsset,
    playbackAsset: prepared.playbackAsset
  }).catch(() => undefined);
  await persistRoomSnapshotToLocalRepository(roomSnapshot).catch(() => undefined);
  notifyCacheLibraryChanged();

  onStatus?.(`成员不在线，已从${source.label}导入《${track.title}》，正在播放。`);
  return {
    playbackAsset: prepared.playbackAsset,
    fileHash: prepared.fileHash
  };
}

async function findUsableLocalPlaybackAsset(
  trackId: string,
  track: TrackMeta
) {
  const link = await getTrackAssetLink(trackId).catch(() => null);
  const assetIds = [
    link?.playbackAssetId,
    track.playbackAsset?.assetId
  ].filter((assetId): assetId is string => !!assetId);

  for (const assetId of [...new Set(assetIds)]) {
    const record = await getAssetManifest(assetId).catch(() => null);
    if (!record || !record.complete || record.manifest.kind !== "playback") continue;
    if (
      record.manifest.profileId !== playbackProfileId ||
      record.manifest.encoder.version !== playbackEncoderVersion ||
      record.manifest.unitCount <= 0
    ) {
      continue;
    }
    if (await getAssetUnit(assetId, 0).catch(() => null)) {
      return record.manifest;
    }
  }

  return null;
}

async function resolveProviderLyrics(source: OfflineProviderSource) {
  try {
    const response = source.provider === "netease"
      ? await musicRoomApi.getNeteaseLyrics(source.trackId)
      : await musicRoomApi.getQqMusicLyrics(source.trackId);
    return response.plainLyric?.trim()?.slice(0, 100_000) ?? null;
  } catch {
    return null;
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, " ").trim();
}
