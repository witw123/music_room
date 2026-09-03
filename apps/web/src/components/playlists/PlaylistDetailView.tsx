import React, { useEffect, useState } from "react";
import type { LocalPlaylistTrackRecord } from "@/features/playlist/local-playlist";
import {
  hashAudioBlob,
  providerTrackKey,
  toCachedProviderTrack,
  toProviderTrackRecord,
  upsertLocalPlaylistTrack
} from "@/features/playlist/local-playlist";
import {
  ensureLocalAudioDirectoryWriteAccess,
  normalizeLocalAudioMimeType,
  saveAudioFileToLocalDirectory
} from "@/features/library/local-audio-storage";
import {
  cacheProviderTrackForPlayback,
  hasProviderTrackPlaybackCache,
  providerPlaybackCacheChangedEvent
} from "@/features/playback/provider-track-cache";
import { analyzeAudioBlobLoudness } from "@/features/playback/loudness";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import type { AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { Button } from "@/components/ui/button";
import type { PlaylistSelection } from "./playlist-dialogs";
import {
  Artwork,
  getNetworkPlaylistSource,
  getPlaylistArtworkCandidates,
  getTrackArtworkUrls,
  resolveProviderArtwork,
  tracksForLocalPlaylist,
  uniqueArtworkUrls
} from "./playlist-artwork";
import { LocalTrackRow, PlaylistOrderButtons } from "./LocalTrackRow";

export function PlaylistDetailView({
  localTracks,
  networkArtworkUrls,
  roomTrackIndex,
  player,
  selection,
  onBack,
  onDelete,
  onArtworkResolved,
  onTrackUpdated,
  isFavorite,
  isTogglingFavorite,
  onToggleFavorite,
  onUpdateTracks,
  onMoveTrack,
  pending
}: {
  localTracks: LocalPlaylistTrackRecord[];
  networkArtworkUrls?: readonly string[] | null;
  roomTrackIndex: Map<string, LocalPlaylistTrackRecord>;
  player: ReturnType<typeof useLocalPlayer>;
  selection: PlaylistSelection;
  onBack: () => void;
  onDelete?: () => void;
  onArtworkResolved?: (artworkUrl: string) => void;
  onTrackUpdated?: (track: LocalPlaylistTrackRecord) => void;
  isFavorite: (track: LocalPlaylistTrackRecord) => boolean;
  isTogglingFavorite: (track: LocalPlaylistTrackRecord) => boolean;
  onToggleFavorite: (track: LocalPlaylistTrackRecord) => void;
  onUpdateTracks: (trackIds: string[]) => void;
  onMoveTrack?: (track: LocalPlaylistTrackRecord, anchor: AnchoredDialogAnchor) => void;
  pending: boolean;
}) {
  const isLocal = selection.kind === "local";
  const localPlaylist = selection.kind === "local" ? selection.playlist : null;
  const networkPlaylist = selection.kind === "network" ? selection.playlist : null;
  const networkSource = networkPlaylist ? getNetworkPlaylistSource(networkPlaylist) : null;
  const networkProvider = networkSource?.provider ?? null;
  const networkPlaylistId = networkSource?.playlistId ?? null;
  const [remoteTracks, setRemoteTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);
  const [downloadTrackId, setDownloadTrackId] = useState<string | null>(null);
  const [playbackTracks, setPlaybackTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [playbackTrackId, setPlaybackTrackId] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ completed: 0, total: 0 });
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  useEffect(() => {
    const handlePlaybackCacheChange = (event: Event) => {
      const fileHashes = new Set((event as CustomEvent<{ fileHashes?: string[] }>).detail?.fileHashes ?? []);
      setPlaybackTracks((current) => current.filter((track) => !fileHashes.has(track.fileHash ?? "")));
    };
    window.addEventListener(providerPlaybackCacheChangedEvent, handlePlaybackCacheChange);
    return () => window.removeEventListener(providerPlaybackCacheChangedEvent, handlePlaybackCacheChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRemoteTracks([]);
    setRemoteError(null);
    setDownloadMessage(null);
    if (isLocal || !networkProvider || !networkPlaylistId) {
      setRemoteLoading(false);
      return;
    }

    setRemoteLoading(true);
    const load =
      networkProvider === "netease"
        ? musicRoomApi.getNeteasePlaylist(networkPlaylistId)
        : musicRoomApi.getQqMusicPlaylist(networkPlaylistId);
    void load
      .then((detail) => {
        if (cancelled) return;
        setRemoteTracks(
          detail.tracks.map((track) => {
            const trackId = providerTrackKey(track.provider, track.providerTrackId);
            return toProviderTrackRecord(track, roomTrackIndex.get(trackId));
          })
        );
      })
      .catch((error) => {
        if (!cancelled)
          setRemoteError(error instanceof Error ? error.message : "网络歌单详情加载失败。");
      })
      .finally(() => {
        if (!cancelled) setRemoteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLocal, networkPlaylistId, networkProvider, roomTrackIndex]);

  const localPlaylistTracks = localPlaylist ? tracksForLocalPlaylist(localPlaylist, localTracks) : [];
  const title = isLocal ? localPlaylist?.title ?? "本地歌单" : networkPlaylist?.title ?? "网络歌单";
  const description = isLocal
    ? localPlaylist?.description || `${localPlaylist?.sourceDirectoryName || "项目根目录"}中的本地歌曲`
    : networkPlaylist?.description ||
      (networkSource?.provider === "qqmusic"
        ? "来自 QQ 音乐的网络歌单"
        : networkSource?.provider === "netease"
          ? "来自网易云音乐的网络歌单"
          : "保存的网络歌单");
  const remoteTrackMap = new Map(remoteTracks.map((track) => [track.id, track]));
  const localTrackMap = new Map(localTracks.map((track) => [track.id, track]));
  const networkTracks = (networkPlaylist?.trackIds ?? []).map((trackId, index) => ({
    track:
      remoteTrackMap.get(trackId) ??
      (trackId.startsWith("local:") ? remoteTracks[index] : undefined) ??
      roomTrackIndex.get(trackId) ??
      localTrackMap.get(trackId),
    index,
    trackId
  }));
  const artworkUrls = isLocal
    ? getTrackArtworkUrls(localPlaylistTracks)
    : uniqueArtworkUrls([
        ...(networkArtworkUrls ?? []),
        ...(networkPlaylist
          ? getPlaylistArtworkCandidates(networkPlaylist, roomTrackIndex, localTracks)
          : []),
        ...networkTracks.map(({ track }) => track?.artworkUrl)
      ]);
  const rows = isLocal
    ? localPlaylistTracks.map((track, index) => ({ track, index, trackId: track.id }))
    : networkTracks;
  const currentTrackIds = rows.map(({ trackId }) => trackId);
  const canEditTracks = !pending;

  function reorderTracks(targetTrackId: string) {
    if (!draggingTrackId || draggingTrackId === targetTrackId || !canEditTracks) return;
    const fromIndex = currentTrackIds.indexOf(draggingTrackId);
    const toIndex = currentTrackIds.indexOf(targetTrackId);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextTrackIds = [...currentTrackIds];
    const [movedTrackId] = nextTrackIds.splice(fromIndex, 1);
    nextTrackIds.splice(toIndex, 0, movedTrackId);
    setDraggingTrackId(null);
    setDragOverTrackId(null);
    onUpdateTracks(nextTrackIds);
  }

  function moveTrackByOffset(trackId: string, direction: -1 | 1) {
    if (!canEditTracks) return;
    const currentIndex = currentTrackIds.indexOf(trackId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentTrackIds.length) return;

    const nextTrackIds = [...currentTrackIds];
    [nextTrackIds[currentIndex], nextTrackIds[targetIndex]] = [
      nextTrackIds[targetIndex],
      nextTrackIds[currentIndex]
    ];
    onUpdateTracks(nextTrackIds);
  }

  const sequenceTracks = rows
    .map((row) => row.track)
    .filter((track): track is LocalPlaylistTrackRecord => Boolean(track))
    .filter(
      (track, index, list) => list.findIndex((candidate) => candidate.id === track.id) === index
    );
  const canPrepareTrack = (track: LocalPlaylistTrackRecord) =>
    player.isTrackPlayable(track) || !!toCachedProviderTrack(track);
  const playableTracks = sequenceTracks.filter(canPrepareTrack);
  const downloadableTracks = sequenceTracks.filter(
    (track) =>
      (track.provider === "netease" || track.provider === "qqmusic") &&
      !!track.providerTrackId &&
      !track.availableOffline
  );
  const showBatchDownload =
    sequenceTracks.length > 0 && (!isLocal || downloadableTracks.length > 0);

  async function prepareTrackForPlayback(track: LocalPlaylistTrackRecord) {
    if (player.isTrackPlayable(track)) return track;
    const cachedTrack = playbackTracks.find((item) => item.id === track.id);
    if (
      cachedTrack?.fileHash &&
      (await hasProviderTrackPlaybackCache(cachedTrack.fileHash))
    )
      return cachedTrack;
    if (cachedTrack)
      setPlaybackTracks((current) => current.filter((item) => item.id !== cachedTrack.id));
    const providerTrack = toCachedProviderTrack(track);
    if (!providerTrack) return null;
    const record = await cacheProviderTrackForPlayback(providerTrack);
    setPlaybackTracks((current) => [
      ...current.filter((item) => item.id !== record.id),
      record
    ]);
    return record;
  }

  async function playPlaylistTrack(track: LocalPlaylistTrackRecord) {
    if (downloadTrackId || playbackTrackId) return;
    setPlaybackTrackId(track.id);
    setDownloadMessage(null);
    try {
      const record = await prepareTrackForPlayback(track);
      if (!record) {
        setDownloadMessage(`《${track.title}》没有可用的播放音频。`);
        return;
      }
      await player.playTrack(record);
      setDownloadMessage(`正在播放《${track.title}》，歌曲已保留在本机缓存中。`);
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : "歌曲播放失败，请重试。");
    } finally {
      setPlaybackTrackId(null);
    }
  }

  async function playAllTracks() {
    if (
      isDownloadingAll ||
      downloadTrackId ||
      playbackTrackId ||
      playableTracks.length === 0
    )
      return;
    setDownloadMessage(null);
    const records: LocalPlaylistTrackRecord[] = [];
    try {
      for (const track of sequenceTracks) {
        setPlaybackTrackId(track.id);
        const record = await prepareTrackForPlayback(track);
        if (record) records.push(record);
      }
      if (records.length > 0) {
        await player.playTracks(records, 0);
        setDownloadMessage(`正在播放“${title}”，歌曲已保留在本机缓存中。`);
      }
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : "播放歌单失败，请重试。");
    } finally {
      setPlaybackTrackId(null);
    }
  }

  async function downloadTrack(track: LocalPlaylistTrackRecord) {
    const provider =
      track.provider === "netease" || track.provider === "qqmusic" ? track.provider : null;
    if (!provider || !track.providerTrackId || track.availableOffline || downloadTrackId)
      return false;
    setDownloadTrackId(track.id);
    setDownloadMessage(null);
    try {
      const resolvedTrack = await resolveProviderArtwork(track, provider);
      if (resolvedTrack.artworkUrl) {
        onArtworkResolved?.(resolvedTrack.artworkUrl);
        onTrackUpdated?.(resolvedTrack);
      }
      await ensureLocalAudioDirectoryWriteAccess();
      const response =
        provider === "netease"
          ? await musicRoomApi.downloadNeteaseTrack(resolvedTrack.providerTrackId!)
          : await musicRoomApi.downloadQqMusicTrack(resolvedTrack.providerTrackId!);
      const fileHash = await hashAudioBlob(response.blob);
      const mimeType = normalizeLocalAudioMimeType(
        response.contentType || response.blob.type
      );
      const loudness = await analyzeAudioBlobLoudness(response.blob);
      const lyricPayload = resolvedTrack.lyrics
        ? null
        : await (provider === "netease"
            ? musicRoomApi.getNeteaseLyrics(resolvedTrack.providerTrackId!)
            : musicRoomApi.getQqMusicLyrics(resolvedTrack.providerTrackId!)
          ).catch(() => null);
      const lyrics =
        resolvedTrack.lyrics ??
        lyricPayload?.wordSyncedLyric ??
        lyricPayload?.plainLyric ??
        null;
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
          provider,
          providerTrackId: resolvedTrack.providerTrackId,
          durationMs: resolvedTrack.durationMs,
          sizeBytes: response.blob.size
        }
      });
      const updatedTrack: LocalPlaylistTrackRecord = {
        ...resolvedTrack,
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
      onTrackUpdated?.(updatedTrack);
      setRemoteTracks((current) =>
        current.map((item) => (item.id === updatedTrack.id ? updatedTrack : item))
      );
      setDownloadMessage(`《${resolvedTrack.title}》已下载到本地目录。`);
      return true;
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : "歌曲下载失败，请重试。");
      return false;
    } finally {
      setDownloadTrackId(null);
    }
  }

  async function downloadAllTracks() {
    if (isDownloadingAll || downloadTrackId || downloadableTracks.length === 0) return;
    setIsDownloadingAll(true);
    setDownloadProgress({ completed: 0, total: downloadableTracks.length });
    setDownloadMessage(null);
    let downloadedCount = 0;
    let failedCount = 0;
    try {
      for (let index = 0; index < downloadableTracks.length; index += 1) {
        const downloaded = await downloadTrack(downloadableTracks[index]);
        if (downloaded) downloadedCount += 1;
        else failedCount += 1;
        setDownloadProgress({ completed: index + 1, total: downloadableTracks.length });
      }
      setDownloadMessage(
        failedCount > 0
          ? `已下载 ${downloadedCount} 首，${failedCount} 首下载失败。`
          : `已下载 ${downloadedCount} 首歌曲。`
      );
    } finally {
      setIsDownloadingAll(false);
    }
  }

  return (
    <section className="mt-5" data-testid="playlist-detail">
      <Button className="mb-4 gap-2" onClick={onBack} size="sm" type="button" variant="ghost">
        <svg
          aria-hidden="true"
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
          width="16"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        返回歌单
      </Button>

      <div className="flex flex-col gap-4 border-b border-surface-border pb-5 sm:flex-row sm:items-end">
        <Artwork artworkUrls={artworkUrls} size="lg" title={title} />
        <div className="min-w-0 flex-1">
          <p className="workspace-page__eyebrow">
            {isLocal ? "Local playlist" : "Network playlist"}
          </p>
          <h2 className="workspace-page__title truncate">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-foreground-muted">{description}</p>
          <p className="mt-3 text-xs text-foreground-muted">
            {rows.length} 首歌曲{isLocal ? "" : " · 网络歌单"}
          </p>
          {remoteLoading ? (
            <p className="mt-2 text-xs text-accent">正在同步平台歌单详情…</p>
          ) : null}
          {remoteError ? (
            <p className="mt-2 text-xs text-amber-300">
              {remoteError} 当前显示已保存的歌曲索引。
            </p>
          ) : null}
        </div>
        {onDelete ? (
          <Button
            aria-label="删除网络歌单"
            className="text-red-300 hover:bg-red-500/10 hover:text-red-200"
            onClick={onDelete}
            size="sm"
            type="button"
            variant="ghost"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
              width="14"
            >
              <path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" />
            </svg>
            删除
          </Button>
        ) : null}
        {showBatchDownload ? (
          <Button
            disabled={
              isDownloadingAll || downloadTrackId !== null || downloadableTracks.length === 0
            }
            onClick={() => void downloadAllTracks()}
            type="button"
            variant="outline"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
              width="14"
            >
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
            </svg>
            {isDownloadingAll
              ? `下载中 ${downloadProgress.completed}/${downloadProgress.total}`
              : downloadableTracks.length > 0
                ? "一键下载"
                : "已全部下载"}
          </Button>
        ) : null}
        <Button
          disabled={
            playableTracks.length === 0 ||
            playbackTrackId !== null ||
            downloadTrackId !== null
          }
          onClick={() => void playAllTracks()}
          type="button"
        >
          <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14">
            <path d="M8 5v14l11-7z" />
          </svg>
          播放全部
        </Button>
      </div>

      {downloadMessage ? (
        <p
          className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
          role="status"
        >
          {downloadMessage}
        </p>
      ) : null}

      <div className="mt-6 space-y-1">
        {rows.length ? (
          rows.map(({ track, index, trackId }) => {
            if (!track) {
              return (
                <article
                  className={`group flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl transition-all hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] ${
                    dragOverTrackId === trackId ? "bg-accent/10 border-accent/60" : ""
                  } ${canEditTracks ? "cursor-grab active:cursor-grabbing" : ""}`}
                  draggable={canEditTracks}
                  key={`${selection.kind}:${trackId}`}
                  onDragEnd={() => {
                    setDraggingTrackId(null);
                    setDragOverTrackId(null);
                  }}
                  onDragOver={(event) => {
                    if (!canEditTracks) return;
                    event.preventDefault();
                    setDragOverTrackId(trackId);
                  }}
                  onDragStart={(event) => {
                    if (!canEditTracks) return;
                    event.dataTransfer.effectAllowed = "move";
                    setDraggingTrackId(trackId);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    reorderTracks(trackId);
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-6 shrink-0 flex items-center justify-center text-xs font-semibold tabular-nums text-foreground-muted">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white/80">{trackId}</p>
                      <p className="mt-0.5 text-xs text-foreground-muted">曲目信息不可用</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canEditTracks ? (
                      <PlaylistOrderButtons
                        index={index}
                        onMove={(direction) => moveTrackByOffset(trackId, direction)}
                        title={trackId}
                        total={currentTrackIds.length}
                      />
                    ) : null}
                    {canEditTracks ? (
                      <Button
                        aria-label="从歌单移除歌曲"
                        className="h-8 w-8 rounded-lg text-foreground-muted hover:text-red-400 hover:bg-red-500/10"
                        onClick={() =>
                          onUpdateTracks(currentTrackIds.filter((id) => id !== trackId))
                        }
                        size="icon"
                        title="从歌单移除"
                        type="button"
                        variant="ghost"
                      >
                        <svg
                          aria-hidden="true"
                          fill="none"
                          height="14"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                          viewBox="0 0 24 24"
                          width="14"
                        >
                          <path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" />
                        </svg>
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            }
            const playable = canPrepareTrack(track);
            const queueable =
              player.isTrackPlayable(track) ||
              playbackTracks.some((item) => item.id === track.id && !!item.fileHash);
            return (
              <LocalTrackRow
                draggable={canEditTracks}
                index={index}
                isCurrent={player.currentTrack?.id === track.id}
                isDownloading={downloadTrackId === track.id}
                isDragTarget={dragOverTrackId === trackId}
                isFavorite={isFavorite(track)}
                isPlayable={playable}
                isPreparingPlayback={playbackTrackId === track.id}
                isQueueable={queueable}
                isQueued={player.queue.some((item) => item.trackId === track.id)}
                isTogglingFavorite={isTogglingFavorite(track)}
                key={`${selection.kind}:${track.id}`}
                onAddToQueue={() => player.addToQueue(track)}
                onDownload={
                  track.providerTrackId &&
                  (track.provider === "netease" || track.provider === "qqmusic")
                    ? () => void downloadTrack(track)
                    : undefined
                }
                onDragEnd={() => {
                  setDraggingTrackId(null);
                  setDragOverTrackId(null);
                }}
                onDragOver={() => setDragOverTrackId(trackId)}
                onDragStart={() => setDraggingTrackId(trackId)}
                onDrop={() => reorderTracks(trackId)}
                onMove={(anchor) => onMoveTrack?.(track, anchor)}
                onMoveOrder={(direction) => moveTrackByOffset(trackId, direction)}
                onPlay={() => void playPlaylistTrack(track)}
                onRemove={
                  canEditTracks
                    ? () =>
                        onUpdateTracks(
                          currentTrackIds.filter((itemTrackId) => itemTrackId !== trackId)
                        )
                    : undefined
                }
                onToggleFavorite={() => onToggleFavorite(track)}
                total={rows.length}
                track={track}
              />
            );
          })
        ) : (
          <div className="px-6 py-8 text-center text-sm text-foreground-muted">
            这个歌单还没有歌曲。
          </div>
        )}
      </div>
    </section>
  );
}
