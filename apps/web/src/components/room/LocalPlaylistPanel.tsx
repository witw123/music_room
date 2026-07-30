"use client";

import { useEffect, useState } from "react";
import type { TrackMeta } from "@music-room/shared";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/music-room-ui";
import type { CachedLibraryTrack } from "@/features/upload/audio-utils";
import type { LocalPlaylistRecord } from "@/features/playlist/local-playlist";
import type { LocalPlaylistTrackRecord } from "@/lib/indexeddb";

type LocalPlaylistPanelProps = {
  localPlaylists: LocalPlaylistRecord[];
  localTracks: LocalPlaylistTrackRecord[];
  roomTracks: TrackMeta[];
  localFolderName: string | null;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  pendingCachedImport: string | null;
};

export function LocalPlaylistPanel({
  localPlaylists,
  localTracks,
  roomTracks,
  localFolderName,
  onImportCachedTrack,
  pendingCachedImport
}: LocalPlaylistPanelProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const selectedPlaylist = localPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;
  const tracksById = new Map(localTracks.map((track) => [track.id, track]));

  useEffect(() => {
    if (selectedPlaylistId && !selectedPlaylist) {
      setSelectedPlaylistId(null);
    }
  }, [selectedPlaylist, selectedPlaylistId]);

  if (selectedPlaylist) {
    return (
      <LocalPlaylistDetail
        localFolderName={localFolderName}
        onBack={() => setSelectedPlaylistId(null)}
        onImportCachedTrack={onImportCachedTrack}
        pendingCachedImport={pendingCachedImport}
        playlist={selectedPlaylist}
        roomTracks={roomTracks}
        tracks={selectedPlaylist.trackIds
          .map((trackId) => tracksById.get(trackId))
          .filter((track): track is LocalPlaylistTrackRecord => !!track)}
      />
    );
  }

  return (
    <section className="flex w-full flex-col gap-3" data-testid="local-playlist-panel">
      {localPlaylists.length > 0 ? (
        <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface/40">
          {localPlaylists.map((playlist) => {
            const playlistTracks = playlist.trackIds
              .map((trackId) => tracksById.get(trackId))
              .filter((track): track is LocalPlaylistTrackRecord => !!track);
            return (
              <LocalPlaylistCard
                key={playlist.id}
                onOpen={() => setSelectedPlaylistId(playlist.id)}
                playlist={playlist}
                tracks={playlistTracks}
              />
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-surface-border px-4 py-4">
          <p className="text-xs text-foreground-muted">当前没有本地歌单。</p>
          <Link className="mt-3 inline-flex items-center border border-accent/35 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20" href="/app/profile/playlists">
            创建本地歌单
          </Link>
        </div>
      )}
    </section>
  );
}

function LocalPlaylistCard({
  playlist,
  tracks,
  onOpen
}: {
  playlist: LocalPlaylistRecord;
  tracks: LocalPlaylistTrackRecord[];
  onOpen: () => void;
}) {
  return (
    <article className="group flex min-w-0 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-hover">
      <button
        aria-label={`打开本地歌单 ${playlist.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        onClick={onOpen}
        type="button"
      >
        <PlaylistArtwork title={playlist.title} tracks={tracks} />
        <div className="min-w-0 flex-1 space-y-1">
          <strong className="block truncate text-sm font-semibold text-foreground">{playlist.title}</strong>
          <p className="truncate text-[10px] text-foreground-muted">本地歌单 · {playlist.trackIds.length} 首歌曲</p>
        </div>
      </button>
      <span className="shrink-0 text-[10px] text-foreground-muted">查看</span>
    </article>
  );
}

function LocalPlaylistDetail({
  playlist,
  tracks,
  roomTracks,
  localFolderName,
  onBack,
  onImportCachedTrack,
  pendingCachedImport
}: {
  playlist: LocalPlaylistRecord;
  tracks: LocalPlaylistTrackRecord[];
  roomTracks: TrackMeta[];
  localFolderName: string | null;
  onBack: () => void;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  pendingCachedImport: string | null;
}) {
  const roomFileHashes = new Set(roomTracks.map((track) => track.fileHash));
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [isImportingSelected, setIsImportingSelected] = useState(false);
  const selectableTracks = tracks.filter((track) => {
    const cachedTrack = toCachedLibraryTrack(track);
    return !!cachedTrack && !!track.fileHash && !roomFileHashes.has(track.fileHash);
  });
  const selectableTrackIds = selectableTracks.map((track) => track.id);
  const selectableTrackIdsKey = JSON.stringify(selectableTrackIds);
  const selectedTracks = selectableTracks.filter((track) => selectedTrackIds.includes(track.id));
  const allSelectableSelected = selectableTracks.length > 0 && selectedTracks.length === selectableTracks.length;
  const isImportBusy = isImportingSelected || pendingCachedImport !== null;

  useEffect(() => {
    const availableIds = new Set(JSON.parse(selectableTrackIdsKey) as string[]);
    setSelectedTrackIds((current) => {
      const next = current.filter((trackId) => availableIds.has(trackId));
      return next.length === current.length ? current : next;
    });
  }, [selectableTrackIdsKey]);

  const importTrack = async (track: LocalPlaylistTrackRecord) => {
    const cachedTrack = toCachedLibraryTrack(track);
    if (!cachedTrack || !track.fileHash || roomFileHashes.has(track.fileHash)) return;
    await onImportCachedTrack(cachedTrack);
    setSelectedTrackIds((current) => current.filter((trackId) => trackId !== track.id));
  };

  const importSelectedTracks = async () => {
    if (isImportBusy || selectedTracks.length === 0) return;
    setIsImportingSelected(true);
    try {
      for (const track of selectedTracks) {
        await importTrack(track);
      }
    } finally {
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
    <section className="flex w-full flex-col gap-4" data-testid="local-playlist-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button className="gap-2" onClick={onBack} size="sm" type="button" variant="ghost">
          <BackIcon />
          返回本地歌单
        </Button>
        <Link className="text-xs font-semibold text-accent hover:text-accent/80" href="/app/profile/playlists">
          管理歌单
        </Link>
      </div>

      <div className="flex items-center gap-3 border-b border-surface-border pb-4">
        <PlaylistArtwork size="lg" title={playlist.title} tracks={tracks} />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">Local playlist</p>
          <h2 className="mt-1 truncate text-xl font-bold text-foreground">{playlist.title}</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            {playlist.description || (localFolderName ? `来自 ${localFolderName} 的本地歌曲` : "本地歌曲")}
          </p>
          <p className="mt-2 text-[10px] text-foreground-muted">{playlist.trackIds.length} 首歌曲</p>
        </div>
      </div>

      {tracks.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface/40 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border bg-surface/40 px-3 py-2">
            <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[11px] text-foreground-muted">
              <input
                type="checkbox"
                checked={allSelectableSelected}
                disabled={selectableTracks.length === 0 || isImportBusy}
                onChange={toggleSelectAll}
                className="h-4 w-4 accent-accent"
              />
              <span>{allSelectableSelected ? "取消全选" : "全选未导入歌曲"}</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-foreground-muted">已选择 {selectedTracks.length} 首</span>
              <button
                type="button"
                disabled={selectedTracks.length === 0 || isImportBusy}
                onClick={() => void importSelectedTracks()}
                className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isImportBusy ? "导入中…" : "导入所选歌曲"}
              </button>
            </div>
          </div>
          <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface/40">
            {tracks.map((track) => {
              const cachedTrack = toCachedLibraryTrack(track);
              const isInRoom = !!track.fileHash && roomFileHashes.has(track.fileHash);
              const isPending = !!track.fileHash && pendingCachedImport === track.fileHash;
              const canImport = !!cachedTrack && !isInRoom;
              return (
                <article key={track.id} className="flex min-w-0 flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2">
                    <input
                      type="checkbox"
                      checked={canImport && selectedTrackIds.includes(track.id)}
                      disabled={!canImport || isImportBusy}
                      onChange={() => toggleTrackSelection(track.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                      aria-label={`选择《${track.title}》`}
                    />
                    <TrackArtwork artworkUrl={track.artworkUrl} title={track.title} />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                      <p className="mt-0.5 truncate text-[10px] text-foreground-muted">
                        {track.artist} · {track.album || "本地歌曲"} · {formatDuration(track.durationMs)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!canImport || isPending || isImportBusy}
                    onClick={() => {
                      if (cachedTrack) void importTrack(track);
                    }}
                    className={`shrink-0 rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                      isInRoom
                        ? "cursor-default border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                        : canImport
                          ? "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                          : "cursor-default border-surface-border text-foreground-muted"
                    }`}
                  >
                    {isInRoom ? "已在本房间" : isPending ? "导入中…" : cachedTrack ? "导入曲库" : "未保存到本地"}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-surface-border px-4 py-6 text-center text-xs text-foreground-muted">
          该本地歌单暂无可用歌曲。
        </div>
      )}
    </section>
  );
}

function PlaylistArtwork({
  title,
  tracks,
  size = "sm"
}: {
  title: string;
  tracks: LocalPlaylistTrackRecord[];
  size?: "sm" | "lg";
}) {
  const artworkUrl = tracks.find((track) => track.artworkUrl)?.artworkUrl ?? null;
  const sizeClass = size === "lg" ? "h-20 w-20 text-2xl" : "h-10 w-10 text-base";
  return (
    <div
      aria-label={`${title} 封面`}
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-surface-border bg-surface font-bold text-foreground-muted ${sizeClass}`}
      style={artworkUrl ? { backgroundImage: `url(${artworkUrl})`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}
    >
      {!artworkUrl ? title.slice(0, 1).toUpperCase() : null}
    </div>
  );
}

function TrackArtwork({ artworkUrl, title }: { artworkUrl: string | null; title: string }) {
  return (
    <div
      aria-label={`${title} 封面`}
      className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-surface-border bg-surface text-base font-bold text-foreground-muted"
      style={artworkUrl ? { backgroundImage: `url(${artworkUrl})`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}
    >
      {!artworkUrl ? title.slice(0, 1).toUpperCase() : null}
    </div>
  );
}

function toCachedLibraryTrack(track: LocalPlaylistTrackRecord): CachedLibraryTrack | null {
  if (!track.fileHash || !track.availableOffline) {
    return null;
  }

  return {
    fileHash: track.fileHash,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artworkUrl: track.artworkUrl,
    lyrics: track.lyrics,
    provider: track.provider,
    providerTrackId: track.providerTrackId,
    sourceDirectoryId: track.sourceDirectoryId,
    sourceFileName: track.fileName,
    mimeType: track.mimeType,
    durationMs: track.durationMs,
    sizeBytes: track.sizeBytes,
    cachedAt: track.updatedAt,
    sourceTrackIds: track.providerTrackId ? [track.providerTrackId] : [],
    sourceRoomIds: [],
    lastSourceTrackId: track.providerTrackId,
    lastSourceRoomId: null,
    lastOwnerNickname: null
  };
}

function BackIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="m15 18-6-6 6-6" /></svg>;
}
