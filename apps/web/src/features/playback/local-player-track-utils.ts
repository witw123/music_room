import type { TrackMeta } from "@music-room/shared";
import type { LocalPlaylistTrackRecord } from "@/features/library/indexeddb";

export const localQueueOwnerId = "local-playlist";

export function buildLocalQueueItemId(trackId: string) {
  return `local-queue:${trackId}`;
}

export function firstMetadataText(...values: Array<string | null | undefined>) {
  return values.find((value) => Boolean(value?.trim()))?.trim() ?? null;
}

export function isBrowserLocalArtwork(value: string | null | undefined) {
  return Boolean(value && /^(?:data|blob):/i.test(value));
}

export function mergeLocalTrackRecord(
  track: LocalPlaylistTrackRecord,
  libraryRecords: readonly LocalPlaylistTrackRecord[]
): LocalPlaylistTrackRecord {
  const libraryTrack = libraryRecords.find(
    (candidate) =>
      candidate.id === track.id ||
      (!!track.fileHash && candidate.fileHash === track.fileHash) ||
      (!!track.providerTrackId &&
        candidate.provider === track.provider &&
        candidate.providerTrackId === track.providerTrackId)
  );
  if (!libraryTrack) {
    return {
      ...track,
      title: firstMetadataText(track.title) ?? "未命名歌曲",
      artist: firstMetadataText(track.artist) ?? "本地歌曲",
      album: track.album ?? null
    };
  }

  return {
    ...libraryTrack,
    ...track,
    title: firstMetadataText(track.title) ?? firstMetadataText(libraryTrack.title) ?? "未命名歌曲",
    artist: firstMetadataText(track.artist) ?? firstMetadataText(libraryTrack.artist) ?? "本地歌曲",
    album: track.album ?? libraryTrack.album,
    durationMs: track.durationMs || libraryTrack.durationMs,
    mimeType: track.mimeType || libraryTrack.mimeType,
    sizeBytes: track.sizeBytes || libraryTrack.sizeBytes,
    artworkUrl: isBrowserLocalArtwork(libraryTrack.artworkUrl)
      ? libraryTrack.artworkUrl
      : track.artworkUrl ?? libraryTrack.artworkUrl,
    lyrics: track.lyrics ?? libraryTrack.lyrics,
    translatedLyrics: track.translatedLyrics ?? libraryTrack.translatedLyrics,
    romanizedLyrics: track.romanizedLyrics ?? libraryTrack.romanizedLyrics,
    loudness: track.loudness ?? libraryTrack.loudness,
    fileHash: track.fileHash ?? libraryTrack.fileHash,
    fileName: track.fileName ?? libraryTrack.fileName,
    sourceDirectoryId: track.sourceDirectoryId ?? libraryTrack.sourceDirectoryId,
    availableOffline: track.availableOffline || libraryTrack.availableOffline
  };
}

export function toTrackMeta(track: LocalPlaylistTrackRecord): TrackMeta {
  const sourceRef =
    track.provider === "local_upload"
      ? undefined
      : { provider: track.provider, trackId: track.providerTrackId ?? track.id };

  return {
    id: track.id,
    title: firstMetadataText(track.title) ?? "未命名歌曲",
    artist: firstMetadataText(track.artist) ?? "本地歌曲",
    album: track.album ?? null,
    durationMs: Number.isFinite(track.durationMs) ? track.durationMs : 0,
    bitrate: null,
    sizeBytes: track.sizeBytes,
    codec: null,
    mimeType: track.mimeType,
    lyrics: track.lyrics,
    translatedLyrics: track.translatedLyrics ?? null,
    romanizedLyrics: track.romanizedLyrics ?? null,
    fileHash: track.fileHash ?? track.id,
    artworkUrl: track.artworkUrl,
    ownerSessionId: localQueueOwnerId,
    ownerNickname: "本地歌单",
    sourceType: track.provider,
    sourceRef,
    ...(track.loudness ? { loudness: track.loudness } : {})
  };
}
