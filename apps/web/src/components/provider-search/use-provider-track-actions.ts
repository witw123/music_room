import { useCallback, type Dispatch, type SetStateAction } from "react";
import { musicRoomApi } from "@/lib/network/music-room-api";
import {
  ensureDefaultLocalPlaylist,
  getDefaultLocalPlaylistTrackIds,
  hashAudioBlob,
  localPlaylistTrackId,
  listMergedLocalPlaylistTracks,
  restoreLocalPlaylistsFromRepository,
  toProviderTrackRecord,
  upsertLocalPlaylistTrack,
  type LocalPlaylistTrackRecord
} from "@/features/playlist/local-playlist";
import {
  ensureLocalAudioDirectoryWriteAccess,
  getLocalAudioStorageState,
  normalizeLocalAudioMimeType,
  saveAudioFileToLocalDirectory
} from "@/features/library/local-audio-storage";
import { cacheProviderTrackForPlayback } from "@/features/playback/provider-track-cache";
import { analyzeAudioBlobLoudness } from "@/features/playback/loudness";
import { toProviderErrorMessage, type Track } from "./search-ui-primitives";
import type { useLocalPlayer } from "@/features/playback/local-player-context";

export async function resolveTrackArtwork(track: Track): Promise<Track> {
  if (track.artworkUrl) return track;
  try {
    return track.provider === "netease"
      ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
      : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
  } catch {
    return track;
  }
}

type ProviderTrackActionsOptions = {
  localTracks: LocalPlaylistTrackRecord[];
  setLocalTracks: Dispatch<SetStateAction<LocalPlaylistTrackRecord[]>>;
  playbackTracks: LocalPlaylistTrackRecord[];
  setPlaybackTracks: Dispatch<SetStateAction<LocalPlaylistTrackRecord[]>>;
  player: ReturnType<typeof useLocalPlayer>;
  pending: string | null;
  setPending: (value: string | null) => void;
  setErrorMessage: (message: string | null) => void;
  setStatusMessage: (message: string | null) => void;
};

export function useProviderTrackActions({
  localTracks,
  setLocalTracks,
  playbackTracks,
  setPlaybackTracks,
  player,
  pending,
  setPending,
  setErrorMessage,
  setStatusMessage
}: ProviderTrackActionsOptions) {
  const cacheTrackForPlayback = useCallback(async (track: Track) => {
    const trackId = localPlaylistTrackId(track);
    const savedTrack = localTracks.find((item) => item.id === trackId);
    if (savedTrack?.fileHash && player.isTrackPlayable(savedTrack)) return savedTrack;
    const cachedTrack = playbackTracks.find((item) => item.id === trackId);
    if (cachedTrack?.fileHash && player.isTrackPlayable(cachedTrack)) return cachedTrack;

    const record = await cacheProviderTrackForPlayback(track);
    setPlaybackTracks((current) => [...current.filter((item) => item.id !== record.id), record]);
    return record;
  }, [localTracks, playbackTracks, player, setPlaybackTracks]);

  const playProviderTrack = useCallback(async (track: Track) => {
    if (pending) return;
    setPending(`play:${track.provider}:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      const record = await cacheTrackForPlayback(track);
      await player.playTrack(record);
      setStatusMessage(`正在播放《${track.title}》，已保留在本机缓存中。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "歌曲播放失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }, [cacheTrackForPlayback, pending, player, setErrorMessage, setPending, setStatusMessage]);

  const queueProviderTrack = useCallback(async (track: Track) => {
    if (pending) return;
    setPending(`queue:${track.provider}:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      const record = await cacheTrackForPlayback(track);
      player.addToQueue(record);
      setStatusMessage(`《${track.title}》已加入播放队列。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加入队列失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }, [cacheTrackForPlayback, pending, player, setErrorMessage, setPending, setStatusMessage]);

  const downloadTrack = useCallback(async (track: Track) => {
    const downloadKey = `download:${track.provider}:${track.providerTrackId}`;
    if (
      pending ||
      localTracks.some(
        (item) =>
          item.provider === track.provider &&
          item.providerTrackId === track.providerTrackId &&
          item.availableOffline
      )
    ) {
      return;
    }

    setPending(downloadKey);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const resolvedTrack = await resolveTrackArtwork(track);
      if (!(await ensureLocalAudioDirectoryWriteAccess())) {
        throw new Error("请先在我的页面选择本地歌曲保存位置。");
      }
      const response =
        resolvedTrack.provider === "netease"
          ? await musicRoomApi.downloadNeteaseTrack(resolvedTrack.providerTrackId)
          : await musicRoomApi.downloadQqMusicTrack(resolvedTrack.providerTrackId);
      const fileHash = await hashAudioBlob(response.blob);
      const mimeType = normalizeLocalAudioMimeType(response.contentType || response.blob.type);
      const loudness = await analyzeAudioBlobLoudness(response.blob);
      const lyricPayload = await (resolvedTrack.provider === "netease"
        ? musicRoomApi.getNeteaseLyrics(resolvedTrack.providerTrackId)
        : musicRoomApi.getQqMusicLyrics(resolvedTrack.providerTrackId)
      ).catch(() => null);
      const lyrics = lyricPayload?.wordSyncedLyric ?? lyricPayload?.plainLyric ?? null;
      const saved = await saveAudioFileToLocalDirectory({
        file: response.blob,
        fileHash,
        title: resolvedTrack.title,
        mimeType,
        track: {
          artist: resolvedTrack.artist,
          album: resolvedTrack.album,
          artworkUrl: resolvedTrack.artworkUrl,
          lyrics,
          translatedLyrics: lyricPayload?.translatedLyric ?? null,
          romanizedLyrics: lyricPayload?.romanizedLyric ?? null,
          provider: resolvedTrack.provider,
          providerTrackId: resolvedTrack.providerTrackId,
          durationMs: resolvedTrack.durationMs,
          sizeBytes: response.blob.size
        }
      });
      const updatedTrack = {
        ...toProviderTrackRecord(
          resolvedTrack,
          localTracks.find((item) => item.id === localPlaylistTrackId(resolvedTrack))
        ),
        artworkUrl: saved.artworkUrl ?? resolvedTrack.artworkUrl,
        fileHash,
        fileName: saved.fileName,
        sizeBytes: response.blob.size,
        mimeType,
        lyrics,
        translatedLyrics: lyricPayload?.translatedLyric ?? null,
        romanizedLyrics: lyricPayload?.romanizedLyric ?? null,
        ...(loudness ? { loudness } : {}),
        availableOffline: true,
        updatedAt: new Date().toISOString()
      };
      await upsertLocalPlaylistTrack(updatedTrack);
      const nextTracks = [...localTracks.filter((item) => item.id !== updatedTrack.id), updatedTrack];
      setLocalTracks(nextTracks);

      const storage = await getLocalAudioStorageState();
      const savedFileHashes = new Set(storage.savedFileHashes);
      const mergedTracks = await listMergedLocalPlaylistTracks();
      await restoreLocalPlaylistsFromRepository();
      ensureDefaultLocalPlaylist({
        trackIds: getDefaultLocalPlaylistTrackIds(mergedTracks, savedFileHashes),
        sourceDirectoryName: storage.directoryName
      });
      setStatusMessage(`《${resolvedTrack.title}》已下载并保存到本地歌单。`);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, track.provider));
    } finally {
      setPending(null);
    }
  }, [
    localTracks,
    pending,
    setErrorMessage,
    setLocalTracks,
    setPending,
    setStatusMessage
  ]);

  return {
    cacheTrackForPlayback,
    playProviderTrack,
    queueProviderTrack,
    downloadTrack
  };
}
