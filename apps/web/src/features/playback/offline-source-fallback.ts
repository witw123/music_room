"use client";

import type {
  RoomSnapshot,
  TrackLoudness,
  TrackMeta
} from "@music-room/shared";
import {
  upsertCachedLibraryTrack
} from "@/features/library/indexeddb";
import {
  musicRoomApi,
  resolveDownloadedAudioMimeType
} from "@/lib/network/music-room-api";
import { saveCachedAudioFileToLocalDirectory } from "@/features/library/local-audio-storage";
import {
  buildCachedLibraryTrackUpsertRecord,
  notifyCacheLibraryChanged
} from "@/features/library/cache-library";
import { resolveProviderTrackSource } from "@/features/library/provider-track-identity";
import { analyzeAudioBlobLoudness } from "./loudness";

export type OfflineProviderSource = {
  provider: "netease" | "qqmusic";
  trackId: string;
  label: string;
};

type OfflineFallbackResult = {
  fileHash: string;
  file: File | null;
  loudness?: TrackLoudness;
};

const inFlightFallbackImports = new Map<
  string,
  Promise<OfflineFallbackResult>
>();

export function resolveOfflineProviderSource(input: {
  roomSnapshot: RoomSnapshot | null | undefined;
  track: TrackMeta | null | undefined;
  forceProviderCache?: boolean;
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

  if (!input.forceProviderCache) {
    const sourceSessionId = playback.sourceSessionId ?? track.ownerSessionId;
    const sourceMember = roomSnapshot.room.members.find(
      (member) => member.id === sourceSessionId
    );
    if (sourceMember && sourceMember.presenceState !== "offline") {
      return null;
    }
  }

  const providerSource = resolveProviderTrackSource(track);
  if (!providerSource) {
    return null;
  }

  return {
    provider: providerSource.provider,
    trackId: providerSource.trackId,
    label: providerSource.provider === "netease" ? "网易云音乐" : "QQ 音乐"
  } satisfies OfflineProviderSource;
}

export async function ensureOfflineProviderPlaybackAsset(input: {
  roomSnapshot: RoomSnapshot;
  track: TrackMeta;
  source: OfflineProviderSource;
  forceDownload?: boolean;
  onStatus?: (message: string) => void;
  signal?: AbortSignal;
}) {
  const importKey = `${input.roomSnapshot.room.id}:${input.track.id}:${input.source.provider}:${input.source.trackId}`;
  const existing = inFlightFallbackImports.get(importKey);
  if (existing) {
    return existing;
  }

  // This operation is shared across render/effect lifetimes. A room snapshot
  // refresh can dispose the caller that started it, but that must not abort a
  // download which is still useful cache for the next render or next room
  // visit. The caller's cancelled flag still prevents stale state updates.
  const operation = importOfflineProviderTrack({
    ...input,
    onStatus: undefined,
    signal: undefined
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
  forceDownload?: boolean;
  onStatus?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<OfflineFallbackResult> {
  const {
    roomSnapshot,
    track,
    source,
    onStatus,
    signal
  } = input;

  try {
    onStatus?.(input.forceDownload
      ? `正在从${source.label}下载并缓存《${track.title}》…`
      : `成员不在线，正在从${source.label}下载并缓存《${track.title}》…`);
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

    const providerLyrics = await resolveProviderLyrics(source);
    const lyrics = providerLyrics?.wordSyncedLyric || providerLyrics?.plainLyric || track.lyrics?.trim() || null;
    const loudness = track.loudness ?? await analyzeAudioBlobLoudness(file);
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
          lyrics: lyrics || null,
          translatedLyrics: providerLyrics?.translatedLyric ?? null,
          romanizedLyrics: providerLyrics?.romanizedLyric ?? null,
          ...(loudness ? { loudness } : {})
        }
      })
    );

    // Keep the browser cache when no local repository is set. If one exists,
    // this moves the source file into its cache/provider directory. This is
    // still disposable cache storage, never the formal local library.
    // Do not make playback wait for repository metadata, artwork, or a slow
    // File System Access write. The IndexedDB copy is already durable, and
    // the returned File can start at the room clock position immediately.
    void saveCachedAudioFileToLocalDirectory({
      file,
      fileHash: track.fileHash,
      title: track.title,
      mimeType,
      provider: source.provider,
      // A provider fallback is a fresh source for the room track. Reusing an
      // older cache entry here could leave the local path pointing at a
      // truncated or stale download while the returned File plays correctly.
      reuseExisting: false
    }).catch(() => undefined);
    notifyCacheLibraryChanged();

    onStatus?.(input.forceDownload
      ? `已从${source.label}缓存《${track.title}》，正在使用缓存音频播放。`
      : `成员不在线，已从${source.label}缓存《${track.title}》，正在使用缓存音频播放。`);
    return {
      fileHash: track.fileHash,
      file,
      ...(loudness ? { loudness } : {})
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    onStatus?.(`成员不在线，${source.label}下载失败，已回退到流式播放。`);
    return {
      fileHash: track.fileHash,
      file: null,
      ...(track.loudness ? { loudness: track.loudness } : {})
    };
  }
}

async function resolveProviderLyrics(source: OfflineProviderSource) {
  try {
    const response = source.provider === "netease"
      ? await musicRoomApi.getNeteaseLyrics(source.trackId)
      : await musicRoomApi.getQqMusicLyrics(source.trackId);
    return response;
  } catch {
    return null;
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, " ").trim();
}
