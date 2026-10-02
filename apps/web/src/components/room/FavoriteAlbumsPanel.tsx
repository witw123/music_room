"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AuthSession,
  BilibiliTrackCandidate,
  NeteaseTrackCandidate,
  Playlist,
  ProviderAlbumDetail,
  ProviderAlbumFavorite,
  ProviderTrackCandidate,
  QqMusicTrackCandidate,
  TrackMeta
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { musicRoomApi } from "@/lib/network/music-room-api";
import {
  getCachedFavorites,
  setCachedFavorites
} from "@/features/workspace/page-data-cache";
import { CheckIcon } from "@/components/icons/DiscoverIcons";
import { providerTrackKey } from "@/features/playlist/local-playlist";

type FavoriteTrack = ProviderTrackCandidate;

type FavoriteAlbumsPanelProps = {
  activeSession: AuthSession | null;
  roomTracks: TrackMeta[];
  canManageLibrary: boolean;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onImportBilibiliTrack?: (track: BilibiliTrackCandidate) => Promise<void>;
  onImportNeteaseTracks?: (tracks: NeteaseTrackCandidate[]) => Promise<void>;
  onImportQqMusicTracks?: (tracks: QqMusicTrackCandidate[]) => Promise<void>;
  onImportBilibiliTracks?: (tracks: BilibiliTrackCandidate[]) => Promise<void>;
  currentRoomId?: string | null;
  roomPlaylists?: Playlist[];
  onRefreshRoom?: () => Promise<unknown>;
};

export function FavoriteAlbumsPanel({
  activeSession,
  roomTracks,
  canManageLibrary,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onImportBilibiliTrack,
  onImportNeteaseTracks,
  onImportQqMusicTracks,
  onImportBilibiliTracks,
  currentRoomId,
  roomPlaylists,
  onRefreshRoom
}: FavoriteAlbumsPanelProps) {
  const [albums, setAlbums] = useState<ProviderAlbumFavorite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProviderAlbumDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addingToLibraryId, setAddingToLibraryId] = useState<string | null>(null);
  const [libraryFeedback, setLibraryFeedback] = useState<string | null>(null);

  const selectedAlbum = albums.find((album) => album.id === selectedAlbumId) ?? null;
  const roomTrackKeys = new Set(
    roomTracks
      .filter((track) => track.sourceRef)
      .map((track) => `${track.sourceRef?.provider}:${track.sourceRef?.trackId}`)
  );

  useEffect(() => {
    if (!activeSession) {
      setAlbums([]);
      setLoaded(false);
      return;
    }

    const cached = getCachedFavorites(activeSession.userId);
    if (cached) {
      setAlbums(cached);
      setLoaded(true);
    }

    let cancelled = false;
    void musicRoomApi.listFavoriteAlbums()
      .then((items) => {
        if (cancelled) return;
        setCachedFavorites(activeSession.userId, items);
        setAlbums(items);
        setLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoaded(true);
        setErrorMessage(error instanceof Error ? error.message : "收藏加载失败。");
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  useEffect(() => {
    if (!selectedAlbum) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    setErrorMessage(null);
    const request = selectedAlbum.provider === "netease"
      ? musicRoomApi.getNeteaseAlbum(selectedAlbum.providerAlbumId)
      : selectedAlbum.provider === "qqmusic"
        ? musicRoomApi.getQqMusicAlbum(selectedAlbum.providerAlbumId)
        : musicRoomApi.getBilibiliVideoParts(selectedAlbum.providerAlbumId).then((partsDetail) => ({
            provider: "bilibili" as const,
            providerAlbumId: partsDetail.bvid,
            title: partsDetail.title,
            artist: partsDetail.artist,
            description: partsDetail.rawTitle,
            artworkUrl: partsDetail.artworkUrl,
            releaseTime: null,
            trackCount: partsDetail.parts.length,
            tracks: partsDetail.parts
          }));
    void request
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail);
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : "专辑歌曲加载失败。");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAlbum]);

  const isAlbumInRoom = useCallback((targetAlbum: ProviderAlbumFavorite) => {
    if (!roomPlaylists || roomPlaylists.length === 0) return false;
    return roomPlaylists.some((rp) => {
      if (rp.tags?.includes(`source_album:${targetAlbum.id}`)) return true;
      if (rp.tags?.includes(`album:${targetAlbum.provider}:${targetAlbum.providerAlbumId}`)) return true;
      if (rp.tags?.includes(`network:${targetAlbum.provider}:${targetAlbum.providerAlbumId}`)) return true;
      return rp.title === targetAlbum.title && rp.trackIds.length === targetAlbum.trackCount;
    });
  }, [roomPlaylists]);

  const handleAddToLibrary = async (album: ProviderAlbumFavorite) => {
    if (!currentRoomId || !canManageLibrary || addingToLibraryId !== null) return;
    setAddingToLibraryId(album.id);
    setLibraryFeedback(null);
    try {
      let albumTracks: ProviderTrackCandidate[] = [];
      try {
        const d = album.provider === "netease"
          ? await musicRoomApi.getNeteaseAlbum(album.providerAlbumId)
          : album.provider === "qqmusic"
            ? await musicRoomApi.getQqMusicAlbum(album.providerAlbumId)
            : await musicRoomApi.getBilibiliVideoParts(album.providerAlbumId).then((p) => ({
                tracks: p.parts
              }));
        albumTracks = d.tracks;
      } catch {
        // Gracefully continue
      }

      // 默认先导入第 1 首歌曲资产，其余歌曲在曲库歌单详情中按需加载
      const firstCandidate = albumTracks[0] ?? null;
      if (firstCandidate) {
        const alreadyInRoom = roomTracks.some(
          (t) =>
            (t.sourceRef?.provider === firstCandidate.provider && t.sourceRef?.trackId === firstCandidate.providerTrackId) ||
            t.id === firstCandidate.providerTrackId
        );
        if (!alreadyInRoom) {
          if (firstCandidate.provider === "netease" && onImportNeteaseTrack) {
            await onImportNeteaseTrack(firstCandidate as NeteaseTrackCandidate);
          } else if (firstCandidate.provider === "qqmusic" && onImportQqMusicTrack) {
            await onImportQqMusicTrack(firstCandidate as QqMusicTrackCandidate);
          } else if (firstCandidate.provider === "bilibili" && onImportBilibiliTrack) {
            await onImportBilibiliTrack(firstCandidate as BilibiliTrackCandidate);
          }
        }
      }

      const tags = [
        "network",
        "favorite_album",
        `album:${album.provider}:${album.providerAlbumId}`,
        `source_album:${album.id}`
      ]
        .map((t) => t.trim().slice(0, 100))
        .slice(0, 50);

      const rawTrackIds = albumTracks.length > 0
        ? albumTracks.map((t) => providerTrackKey(t.provider, t.providerTrackId))
        : Array.from({ length: album.trackCount }, (_, i) => `network:${album.provider}:${album.providerAlbumId}:${i}`);
      const trackIds = rawTrackIds
        .filter((id) => typeof id === "string" && id.trim().length > 0)
        .slice(0, 1000);

      await musicRoomApi.createPlaylist({
        title: (album.title || "未命名专辑").trim().slice(0, 160),
        description: (album.description ?? `收藏专辑 / ${providerName(album.provider)}`).trim().slice(0, 4000),
        trackIds,
        tags,
        coverUrl: album.artworkUrl || null,
        roomId: currentRoomId
      });

      if (onRefreshRoom) {
        await onRefreshRoom();
      }

      setLibraryFeedback(`已将收藏《${album.title}》加入曲库（已导入首曲资产，其余歌曲可在曲库歌单中按需加载）。`);
    } catch (error) {
      setLibraryFeedback(error instanceof Error ? error.message : "添加到曲库失败。");
    } finally {
      setAddingToLibraryId(null);
    }
  };

  if (selectedAlbum) {
    return (
      <FavoriteAlbumDetail
        album={detail ?? selectedAlbum}
        detailLoading={detailLoading}
        errorMessage={errorMessage}
        onBack={() => setSelectedAlbumId(null)}
        canAddToLibrary={Boolean(currentRoomId && canManageLibrary)}
        isInLibrary={isAlbumInRoom(selectedAlbum)}
        isAddingToLibrary={addingToLibraryId === selectedAlbum.id}
        onAddToLibrary={() => void handleAddToLibrary(selectedAlbum)}
        onImportNeteaseTrack={onImportNeteaseTrack}
        onImportQqMusicTrack={onImportQqMusicTrack}
        onImportBilibiliTrack={onImportBilibiliTrack}
        onImportNeteaseTracks={onImportNeteaseTracks}
        onImportQqMusicTracks={onImportQqMusicTracks}
        onImportBilibiliTracks={onImportBilibiliTracks}
        canManageLibrary={canManageLibrary}
        roomTrackKeys={roomTrackKeys}
        tracks={detail?.tracks ?? []}
      />
    );
  }

  return (
    <section className="flex w-full flex-col gap-3" data-testid="favorite-albums-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">我的收藏</p>
          <p className="mt-1 truncate text-[10px] text-foreground-muted">收藏的网络音乐专辑与合集</p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {libraryFeedback ? (
            <span className="text-xs text-accent truncate max-w-xs">{libraryFeedback}</span>
          ) : null}
          <span className="font-mono text-[10px] text-foreground-muted">{albums.length} 张专辑/合集</span>
        </div>
      </div>

      {albums.length > 0 ? (
        <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface/40">
          {albums.map((album) => (
            <FavoriteAlbumCard
              album={album}
              key={album.id}
              canAddToLibrary={Boolean(currentRoomId && canManageLibrary)}
              isInLibrary={isAlbumInRoom(album)}
              isAddingToLibrary={addingToLibraryId === album.id}
              onAddToLibrary={() => void handleAddToLibrary(album)}
              onOpen={() => setSelectedAlbumId(album.id)}
            />
          ))}
        </div>
      ) : !loaded ? (
        <div className="rounded-lg border border-dashed border-surface-border px-4 py-4 text-xs text-foreground-muted">
          正在加载收藏…
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-surface-border px-4 py-4 text-xs text-foreground-muted">
          还没有收藏专辑，请先在搜索页收藏专辑。
        </div>
      )}
      {errorMessage ? <p className="text-xs text-amber-200" role="alert">{errorMessage}</p> : null}
    </section>
  );
}

function FavoriteAlbumCard({
  album,
  onOpen,
  canAddToLibrary,
  isInLibrary,
  isAddingToLibrary,
  onAddToLibrary
}: {
  album: ProviderAlbumFavorite;
  onOpen: () => void;
  canAddToLibrary?: boolean;
  isInLibrary?: boolean;
  isAddingToLibrary?: boolean;
  onAddToLibrary?: () => void;
}) {
  return (
    <article className="group flex min-w-0 items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-hover">
      <button
        aria-label={`打开专辑 ${album.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        onClick={onOpen}
        type="button"
      >
        <Artwork artworkUrl={album.artworkUrl} size="sm" title={album.title} />
        <div className="min-w-0 flex-1 space-y-1">
          <strong className="block truncate text-sm font-semibold text-foreground">{album.title}</strong>
          <p className="truncate text-[10px] text-foreground-muted">
            {album.artist} · {providerName(album.provider)} · {album.trackCount} 首歌曲
          </p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {canAddToLibrary ? (
          <button
            type="button"
            disabled={isInLibrary || isAddingToLibrary}
            onClick={(e) => {
              e.stopPropagation();
              onAddToLibrary?.();
            }}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
              isInLibrary
                ? "cursor-default border border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                : "border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            }`}
          >
            {isInLibrary ? (
              <>
                <CheckIcon className="h-3 w-3" />
                <span>已在曲库</span>
              </>
            ) : isAddingToLibrary ? (
              "添加中…"
            ) : (
              "加入曲库"
            )}
          </button>
        ) : null}
        <span className="shrink-0 text-[10px] text-foreground-muted">查看</span>
      </div>
    </article>
  );
}

function FavoriteAlbumDetail({
  album,
  tracks,
  roomTrackKeys,
  detailLoading,
  errorMessage,
  onBack,
  canAddToLibrary,
  isInLibrary,
  isAddingToLibrary,
  onAddToLibrary,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onImportBilibiliTrack,
  onImportNeteaseTracks,
  onImportQqMusicTracks,
  onImportBilibiliTracks,
  canManageLibrary
}: {
  album: ProviderAlbumDetail | ProviderAlbumFavorite;
  tracks: FavoriteTrack[];
  roomTrackKeys: Set<string>;
  detailLoading: boolean;
  errorMessage: string | null;
  onBack: () => void;
  canAddToLibrary?: boolean;
  isInLibrary?: boolean;
  isAddingToLibrary?: boolean;
  onAddToLibrary?: () => void;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onImportBilibiliTrack?: (track: BilibiliTrackCandidate) => Promise<void>;
  onImportNeteaseTracks?: (tracks: NeteaseTrackCandidate[]) => Promise<void>;
  onImportQqMusicTracks?: (tracks: QqMusicTrackCandidate[]) => Promise<void>;
  onImportBilibiliTracks?: (tracks: BilibiliTrackCandidate[]) => Promise<void>;
  canManageLibrary: boolean;
}) {
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [pendingTrackIds, setPendingTrackIds] = useState<Set<string>>(new Set());
  const pendingTrackIdsRef = useRef(new Set<string>());
  const [isImportingSelected, setIsImportingSelected] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const trackKey = (track: FavoriteTrack) => `${track.provider}:${track.providerTrackId}`;
  const selectableTracks = tracks.filter((track) => !roomTrackKeys.has(trackKey(track)));
  const selectableTrackIds = selectableTracks.map(trackKey);
  const selectableTrackIdsKey = JSON.stringify(selectableTrackIds);
  const selectedTracks = selectableTracks.filter((track) => selectedTrackIds.includes(trackKey(track)));
  const allSelectableSelected = selectableTracks.length > 0 && selectedTracks.length === selectableTracks.length;
  const isImportBusy = pendingTrackIds.size > 0 || isImportingSelected;

  useEffect(() => {
    const availableIds = new Set(JSON.parse(selectableTrackIdsKey) as string[]);
    setSelectedTrackIds((current) => {
      const next = current.filter((trackId) => availableIds.has(trackId));
      return next.length === current.length ? current : next;
    });
  }, [selectableTrackIdsKey]);

  const importTrack = async (track: FavoriteTrack) => {
    const key = trackKey(track);
    if (!canManageLibrary || pendingTrackIdsRef.current.has(key)) return;
    pendingTrackIdsRef.current.add(key);
    setPendingTrackIds((current) => new Set(current).add(key));
    setImportError(null);
    try {
      if (track.provider === "netease") {
        await onImportNeteaseTrack(track as NeteaseTrackCandidate);
      } else if (track.provider === "qqmusic") {
        await onImportQqMusicTrack(track as QqMusicTrackCandidate);
      } else if (track.provider === "bilibili" && onImportBilibiliTrack) {
        await onImportBilibiliTrack(track as BilibiliTrackCandidate);
      }
      setSelectedTrackIds((current) => current.filter((trackId) => trackId !== key));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "歌曲导入失败。");
    } finally {
      pendingTrackIdsRef.current.delete(key);
      setPendingTrackIds((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const importSelectedTracks = async () => {
    if (!canManageLibrary || isImportBusy || selectedTracks.length === 0) return;
    setIsImportingSelected(true);
    const neteaseTracks = selectedTracks
      .filter((t) => t.provider === "netease")
      .map((t) => t as NeteaseTrackCandidate);
    const qqTracks = selectedTracks
      .filter((t) => t.provider === "qqmusic")
      .map((t) => t as QqMusicTrackCandidate);
    const biliTracks = selectedTracks
      .filter((t) => t.provider === "bilibili")
      .map((t) => t as BilibiliTrackCandidate);

    for (const t of selectedTracks) {
      pendingTrackIdsRef.current.add(trackKey(t));
    }
    setPendingTrackIds(new Set(pendingTrackIdsRef.current));

    try {
      await Promise.allSettled([
        neteaseTracks.length > 0 && onImportNeteaseTracks ? onImportNeteaseTracks(neteaseTracks) : Promise.resolve(),
        qqTracks.length > 0 && onImportQqMusicTracks ? onImportQqMusicTracks(qqTracks) : Promise.resolve(),
        biliTracks.length > 0 && onImportBilibiliTracks ? onImportBilibiliTracks(biliTracks) : Promise.resolve()
      ]);
      setSelectedTrackIds([]);
    } finally {
      for (const t of selectedTracks) {
        pendingTrackIdsRef.current.delete(trackKey(t));
      }
      setPendingTrackIds(new Set(pendingTrackIdsRef.current));
      setIsImportingSelected(false);
    }
  };

  const toggleTrackSelection = (trackId: string) => {
    setSelectedTrackIds((current) => current.includes(trackId)
      ? current.filter((item) => item !== trackId)
      : [...current, trackId]);
  };

  const toggleSelectAll = () => {
    setSelectedTrackIds(allSelectableSelected ? [] : selectableTrackIds);
  };

  return (
    <section className="flex w-full flex-col gap-4" data-testid="favorite-album-detail">
      <Button className="mb-1 self-start gap-2" onClick={onBack} size="sm" type="button" variant="ghost">
        <BackIcon />
        返回我的收藏
      </Button>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-surface-border pb-4">
        <div className="flex items-center gap-3">
          <Artwork artworkUrl={album.artworkUrl} size="lg" title={album.title} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">Favorite album</p>
            <h2 className="mt-1 truncate text-xl font-bold text-foreground">{album.title}</h2>
            <p className="mt-1 truncate text-xs text-foreground-muted">{album.artist} · {providerName(album.provider)}</p>
            <p className="mt-2 text-[10px] text-foreground-muted">{detailLoading ? "正在加载歌曲…" : `${tracks.length} 首歌曲`}</p>
          </div>
        </div>
        {canAddToLibrary ? (
          <div className="shrink-0 self-start sm:self-center">
            <button
              type="button"
              disabled={isInLibrary || isAddingToLibrary}
              onClick={onAddToLibrary}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                isInLibrary
                  ? "cursor-default border border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                  : "border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
              }`}
            >
              {isInLibrary ? (
                <>
                  <CheckIcon className="h-3.5 w-3.5" />
                  <span>已在曲库</span>
                </>
              ) : isAddingToLibrary ? (
                "添加中…"
              ) : (
                "加入曲库"
              )}
            </button>
          </div>
        ) : null}
      </div>

      {errorMessage ? <p className="text-xs text-amber-200" role="alert">{errorMessage}</p> : null}
      {importError ? <p className="text-xs text-red-300" role="alert">{importError}</p> : null}
      {tracks.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface/40 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border bg-surface/40 px-3 py-2">
            <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[11px] text-foreground-muted">
              <input
                type="checkbox"
                checked={allSelectableSelected}
                disabled={!canManageLibrary || selectableTracks.length === 0 || isImportBusy}
                onChange={toggleSelectAll}
                className="h-4 w-4 accent-accent"
              />
              <span>{allSelectableSelected ? "取消全选" : "全选未导入歌曲"}</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-foreground-muted">已选择 {selectedTracks.length} 首</span>
              <button
                type="button"
                disabled={!canManageLibrary || selectedTracks.length === 0 || isImportBusy}
                onClick={() => void importSelectedTracks()}
                className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isImportBusy ? "导入中…" : "导入所选歌曲"}
              </button>
            </div>
          </div>
          <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface/40">
            {tracks.map((track) => {
              const key = trackKey(track);
              const isInRoom = roomTrackKeys.has(key);
              const isPending = pendingTrackIds.has(key);
              return (
                <article className="flex min-w-0 flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between" key={key}>
                  <div className="flex min-w-0 items-start gap-2">
                    <input
                      type="checkbox"
                      checked={!isInRoom && selectedTrackIds.includes(key)}
                      disabled={!canManageLibrary || isInRoom || isImportBusy}
                      onChange={() => toggleTrackSelection(key)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                      aria-label={`选择《${track.title}》`}
                    />
                    <Artwork artworkUrl={track.artworkUrl ?? album.artworkUrl} size="sm" title={track.title} />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                      <p className="mt-0.5 truncate text-[10px] text-foreground-muted">
                        {track.artist} · {track.album || album.title} · {formatDuration(track.durationMs)}
                      </p>
                    </div>
                  </div>
                  <button
                    className={`shrink-0 rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                      isInRoom
                        ? "cursor-default border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                        : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                    }`}
                    disabled={!canManageLibrary || isInRoom || isPending || isImportBusy}
                    onClick={() => void importTrack(track)}
                    type="button"
                  >
                    {isInRoom ? "已在曲库" : isPending ? "导入中…" : "导入曲库"}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      ) : detailLoading ? (
        <div className="rounded-lg border border-dashed border-surface-border px-4 py-6 text-center text-xs text-foreground-muted">
          正在加载歌曲信息…
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-surface-border px-4 py-6 text-center text-xs text-foreground-muted">
          该专辑暂无可用歌曲。
        </div>
      )}
    </section>
  );
}

function Artwork({ artworkUrl, title, size }: { artworkUrl: string | null; title: string; size: "sm" | "lg" }) {
  const sizeClass = size === "lg" ? "h-20 w-20 text-2xl" : "h-10 w-10 text-base";
  return artworkUrl ? (
    // External provider artwork is intentionally rendered without Next image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={`${title} 封面`} className={`shrink-0 rounded-lg border border-surface-border object-cover ${sizeClass}`} loading="lazy" src={artworkUrl} />
  ) : (
    <div aria-label={`${title} 封面`} className={`flex shrink-0 items-center justify-center rounded-lg border border-surface-border bg-surface font-bold text-foreground-muted ${sizeClass}`}>
      {title.slice(0, 1).toUpperCase()}
    </div>
  );
}

function providerName(provider: ProviderAlbumFavorite["provider"]) {
  return provider === "netease" ? "网易云音乐" : provider === "qqmusic" ? "QQ 音乐" : "哔哩哔哩";
}

function BackIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="m15 18-6-6 6-6" /></svg>;
}
