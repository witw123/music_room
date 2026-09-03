import type { RemoteTrackSourceRef, TrackMeta, TrackSourceType } from "@music-room/shared";
import { MusicRoomApiError, musicRoomApi, resolveDownloadedAudioMimeType } from "@/lib/network/music-room-api";
import { getAssetManifest, getAssetUnit } from "@/features/library/indexeddb";
import { playbackProfileId } from "@/features/library/audio-asset-builder";

export function buildProviderSourceRef(
  sourceType: Exclude<TrackSourceType, "local_upload">,
  trackId: string
): RemoteTrackSourceRef {
  return { provider: sourceType, trackId } as RemoteTrackSourceRef;
}

export function sourceTypeLabel(sourceType: Exclude<TrackSourceType, "local_upload">) {
  return {
    netease: "网易云",
    qqmusic: "QQ 音乐"
  }[sourceType];
}

export async function hasUsableLocalPlaybackAsset(track: TrackMeta) {
  const playbackAsset = track.playbackAsset;
  if (
    !playbackAsset ||
    playbackAsset.profileId !== playbackProfileId ||
    playbackAsset.unitCount <= 0
  ) {
    return false;
  }

  const manifest = await getAssetManifest(playbackAsset.assetId).catch(() => null);
  if (!manifest?.complete) {
    return false;
  }

  return !!(await getAssetUnit(playbackAsset.assetId, 0).catch(() => null));
}

export async function resolveCachedAudioMimeType(file: File) {
  return resolveDownloadedAudioMimeType(file, file.type);
}

export function extensionForImportedMimeType(mimeType: string) {
  if (mimeType === "audio/flac") return "flac";
  if (mimeType === "audio/wav") return "wav";
  return "mp3";
}

export function sanitizeFileName(value: string, sourceType: TrackSourceType) {
  return value.replace(/[\\/:*?"<>|]+/g, " ").trim() || `${sourceType}-track`;
}

export async function resolveImportedLyrics(input: {
  title: string;
  artist: string;
  sourceType: TrackSourceType;
  sourceTrackId?: string;
}) {
  const preferredProviders =
    input.sourceType === "local_upload"
      ? (["netease", "qqmusic"] as const)
      : ([input.sourceType] as const);

  if (input.sourceTrackId && input.sourceType !== "local_upload") {
    const direct = await requestProviderLyrics(input.sourceType, input.sourceTrackId);
    if (direct) return direct;
  }

  const keyword = `${input.title} ${input.artist}`.trim();
  const searchResults = await Promise.all(
    preferredProviders.map(async (provider) => {
      try {
        const response =
          provider === "netease"
            ? await musicRoomApi.searchNeteaseTracks(keyword, { limit: 10 })
            : await musicRoomApi.searchQqMusicTracks(keyword, { limit: 10 });
        return {
          provider,
          track: findMatchingProviderTrack(response.items, input)
        };
      } catch {
        return { provider, track: null };
      }
    })
  );

  const matches = searchResults
    .filter(
      (result): result is typeof result & { track: NonNullable<typeof result.track> } =>
        !!result.track
    )
    .sort((left, right) => right.track.score - left.track.score);
  const lyricResults = await Promise.all(
    matches.map(async ({ provider, track }) => ({
      lyrics: await requestProviderLyrics(provider, track.providerTrackId),
      score: track.score
    }))
  );
  return (
    lyricResults
      .sort((left, right) => right.score - left.score)
      .find((result) => result.lyrics)?.lyrics ?? null
  );
}

export async function requestProviderLyrics(
  provider: "netease" | "qqmusic",
  trackId: string
) {
  try {
    const response =
      provider === "netease"
        ? await musicRoomApi.getNeteaseLyrics(trackId)
        : await musicRoomApi.getQqMusicLyrics(trackId);
    const lyrics = (response.wordSyncedLyric ?? response.plainLyric)?.trim();
    return lyrics ? lyrics.slice(0, 100_000) : null;
  } catch {
    return null;
  }
}

export function findMatchingProviderTrack(
  tracks: Array<{ title: string; artist: string; providerTrackId: string }>,
  input: Pick<Parameters<typeof resolveImportedLyrics>[0], "title" | "artist">
) {
  const normalizedTitle = normalizeLyricsMatchText(input.title);
  const normalizedArtist = normalizeLyricsMatchText(input.artist);
  return (
    tracks
      .map((track) => {
        const titleMatches = normalizeLyricsMatchText(track.title) === normalizedTitle;
        const artistMatches = normalizeLyricsMatchText(track.artist) === normalizedArtist;
        return {
          ...track,
          score: titleMatches ? 10 + (artistMatches ? 5 : 0) : 0
        };
      })
      .filter((track) => track.score > 0)
      .sort((left, right) => right.score - left.score)[0] ?? null
  );
}

export function normalizeLyricsMatchText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function toProviderImportErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "QQMUSIC_TRACK_NOT_FOUND") {
      return "该歌曲没有可用的公开音频，可能受付费、VIP 或版权限制。";
    }
    if (error.code === "QQMUSIC_AUDIO_UNSUPPORTED") {
      return "平台返回了当前播放器不支持的音频格式。";
    }
    if (error.code === "QQMUSIC_IMPORT_TOO_LARGE") {
      return "歌曲文件过大，无法导入。";
    }
    if (error.code === "QQMUSIC_UNAVAILABLE") {
      return "平台接口暂时不可用，请稍后重试或切换平台。";
    }
    if (error.code === "RATE_LIMITED") {
      return "请求过于频繁，请稍后再试。";
    }
  }
  return error instanceof Error ? error.message : "音乐平台导入失败，请稍后重试。";
}
