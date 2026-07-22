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
  upsertCachedLibraryTrack
} from "@/lib/indexeddb";
import {
  musicRoomApi,
  resolveDownloadedAudioMimeType
} from "@/lib/music-room-api";
import { saveCachedAudioFileToLocalDirectory } from "@/features/upload/local-audio-storage";
import {
  buildCachedLibraryTrackUpsertRecord,
  notifyCacheLibraryChanged
} from "@/features/upload/cache-library";
import {
  playbackEncoderVersion,
  playbackProfileId
} from "@/features/upload/audio-asset-builder";

export type OfflineProviderSource = {
  provider: "netease" | "qqmusic";
  trackId: string;
  label: string;
};

type OfflineFallbackResult = {
  playbackAsset: PlaybackAssetManifest | null;
  fileHash: string;
  file: File | null;
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

  const importKey = `${input.roomSnapshot.room.id}:${input.track.id}:${input.source.provider}:${input.source.trackId}`;
  const existing = inFlightFallbackImports.get(importKey);
  if (existing) {
    return existing;
  }

  const operation = importOfflineProviderTrack({
    ...input,
    fallbackPlaybackAsset: localPlaybackAsset
  });
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
  fallbackPlaybackAsset: PlaybackAssetManifest | null;
  onStatus?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<OfflineFallbackResult> {
  const {
    roomSnapshot,
    track,
    source,
    fallbackPlaybackAsset,
    onStatus,
    signal
  } = input;

  try {
    onStatus?.(`成员不在线，正在从${source.label}下载并保存《${track.title}》…`);
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

    const lyrics = track.lyrics?.trim() || await resolveProviderLyrics(source);
    // The room track already owns its content hash. Avoid decoding or creating
    // playback segments here: the downloaded provider file is the local source.
    await upsertCachedLibraryTrack(
      buildCachedLibraryTrackUpsertRecord({
        roomId: roomSnapshot.room.id,
        file,
        track: {
          ...track,
          fileHash: track.fileHash,
          sizeBytes: file.size,
          mimeType,
          lyrics: lyrics || null
        }
      })
    );

    // Keep the browser cache when no local repository is set. If one exists,
    // this moves the source file into the configured local folder.
    // Do not make playback wait for repository metadata, artwork, or a slow
    // File System Access write. The IndexedDB copy is already durable, and
    // the returned File can start at the room clock position immediately.
    void saveCachedAudioFileToLocalDirectory({
      file,
      fileHash: track.fileHash,
      title: track.title,
      mimeType,
      provider: source.provider,
      playbackAsset: fallbackPlaybackAsset ?? undefined,
      // A provider fallback is a fresh source for the room track. Reusing an
      // older cache entry here could leave the local path pointing at a
      // truncated or stale download while the returned File plays correctly.
      reuseExisting: false
    }).catch(() => undefined);
    notifyCacheLibraryChanged();

    onStatus?.(`成员不在线，已从${source.label}保存《${track.title}》，正在使用本地原音频播放。`);
    return {
      playbackAsset: fallbackPlaybackAsset,
      fileHash: track.fileHash,
      file
    };
  } catch (error) {
    if (signal?.aborted || !fallbackPlaybackAsset) {
      throw error;
    }

    onStatus?.(`成员不在线，${source.label}下载失败，使用已有播放资产继续播放。`);
    return {
      playbackAsset: fallbackPlaybackAsset,
      fileHash: fallbackPlaybackAsset.sourceFileHash,
      file: null
    };
  }
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
      record.manifest.sourceFileHash !== track.fileHash ||
      record.manifest.unitCount <= 0
    ) {
      continue;
    }
    const firstUnit = await getAssetUnit(assetId, 0).catch(() => null);
    if (!isUsablePlaybackUnit(firstUnit, 0)) {
      continue;
    }
    // A complete manifest is expected to contain every unit. Check the tail
    // as well so a truncated local repository cannot be selected as fallback.
    const lastUnitIndex = record.manifest.unitCount - 1;
    const lastUnit = lastUnitIndex === 0
      ? firstUnit
      : await getAssetUnit(assetId, lastUnitIndex).catch(() => null);
    if (isUsablePlaybackUnit(lastUnit, lastUnitIndex)) {
      return record.manifest;
    }
  }

  return null;
}

function isUsablePlaybackUnit(
  unit: Awaited<ReturnType<typeof getAssetUnit>>,
  unitIndex: number
) {
  return !!unit &&
    unit.unitIndex === unitIndex &&
    unit.payloadBytes > 0 &&
    unit.payload.byteLength === unit.payloadBytes;
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
