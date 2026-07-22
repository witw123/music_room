"use client";

import { useEffect, useState } from "react";
import type {
  AuthSession,
  NeteaseTrackCandidate,
  ProviderAlbumDetail,
  ProviderAlbumFavorite,
  QqMusicTrackCandidate,
  TrackMeta
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  getCachedFavorites,
  setCachedFavorites
} from "@/features/workspace/page-data-cache";

type FavoriteTrack = NeteaseTrackCandidate | QqMusicTrackCandidate;

type FavoriteAlbumsPanelProps = {
  activeSession: AuthSession | null;
  roomTracks: TrackMeta[];
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
};

export function FavoriteAlbumsPanel({
  activeSession,
  roomTracks,
  onImportNeteaseTrack,
  onImportQqMusicTrack
}: FavoriteAlbumsPanelProps) {
  const [albums, setAlbums] = useState<ProviderAlbumFavorite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProviderAlbumDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      : musicRoomApi.getQqMusicAlbum(selectedAlbum.providerAlbumId);
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

  if (selectedAlbum) {
    return (
      <FavoriteAlbumDetail
        album={detail ?? selectedAlbum}
        detailLoading={detailLoading}
        errorMessage={errorMessage}
        onBack={() => setSelectedAlbumId(null)}
        onImportNeteaseTrack={onImportNeteaseTrack}
        onImportQqMusicTrack={onImportQqMusicTrack}
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
          <p className="mt-1 truncate text-[10px] text-foreground-muted">收藏的网易云音乐与 QQ 音乐专辑</p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-foreground-muted">{albums.length} 张专辑</span>
      </div>

      {albums.length > 0 ? (
        <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface/40">
          {albums.map((album) => (
            <FavoriteAlbumCard album={album} key={album.id} onOpen={() => setSelectedAlbumId(album.id)} />
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

function FavoriteAlbumCard({ album, onOpen }: { album: ProviderAlbumFavorite; onOpen: () => void }) {
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
      <span className="shrink-0 text-[10px] text-foreground-muted">查看</span>
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
  onImportNeteaseTrack,
  onImportQqMusicTrack
}: {
  album: ProviderAlbumDetail | ProviderAlbumFavorite;
  tracks: FavoriteTrack[];
  roomTrackKeys: Set<string>;
  detailLoading: boolean;
  errorMessage: string | null;
  onBack: () => void;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
}) {
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const importTrack = async (track: FavoriteTrack) => {
    if (pendingTrackId) return;
    setPendingTrackId(track.providerTrackId);
    setImportError(null);
    try {
      if (track.provider === "netease") {
        await onImportNeteaseTrack(track);
      } else {
        await onImportQqMusicTrack(track);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "歌曲导入失败。");
    } finally {
      setPendingTrackId(null);
    }
  };

  return (
    <section className="flex w-full flex-col gap-4" data-testid="favorite-album-detail">
      <Button className="mb-1 self-start gap-2" onClick={onBack} size="sm" type="button" variant="ghost">
        <BackIcon />
        返回我的收藏
      </Button>

      <div className="flex items-center gap-3 border-b border-surface-border pb-4">
        <Artwork artworkUrl={album.artworkUrl} size="lg" title={album.title} />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">Favorite album</p>
          <h2 className="mt-1 truncate text-xl font-bold text-foreground">{album.title}</h2>
          <p className="mt-1 truncate text-xs text-foreground-muted">{album.artist} · {providerName(album.provider)}</p>
          <p className="mt-2 text-[10px] text-foreground-muted">{detailLoading ? "正在加载歌曲…" : `${tracks.length} 首歌曲`}</p>
        </div>
      </div>

      {errorMessage ? <p className="text-xs text-amber-200" role="alert">{errorMessage}</p> : null}
      {importError ? <p className="text-xs text-red-300" role="alert">{importError}</p> : null}
      {tracks.length > 0 ? (
        <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface/40">
          {tracks.map((track) => {
            const key = `${track.provider}:${track.providerTrackId}`;
            const isInRoom = roomTrackKeys.has(key);
            const isPending = pendingTrackId === track.providerTrackId;
            return (
              <article className="flex min-w-0 items-center gap-3 px-3 py-3" key={key}>
                <Artwork artworkUrl={track.artworkUrl ?? album.artworkUrl} size="sm" title={track.title} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                  <p className="mt-0.5 truncate text-[10px] text-foreground-muted">
                    {track.artist} · {track.album || album.title} · {formatDuration(track.durationMs)}
                  </p>
                </div>
                <button
                  className={`shrink-0 rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    isInRoom
                      ? "cursor-default border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                      : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
                  }`}
                  disabled={isInRoom || isPending || pendingTrackId !== null}
                  onClick={() => void importTrack(track)}
                  type="button"
                >
                  {isInRoom ? "已在曲库" : isPending ? "导入中…" : "导入曲库"}
                </button>
              </article>
            );
          })}
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
  return provider === "netease" ? "网易云音乐" : "QQ 音乐";
}

function BackIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="m15 18-6-6 6-6" /></svg>;
}
