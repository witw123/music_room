"use client";

import { useEffect, useState, useTransition } from "react";
import type {
  AuthSession,
  NeteaseTrackCandidate,
  Playlist,
  QqMusicTrackCandidate,
  TrackMeta
} from "@music-room/shared";
import { formatDuration, normalizePlaylistTitle } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  listRoomPlaylistTrackIndex,
  providerTrackKey,
  toCachedProviderTrack
} from "@/features/playlist/local-playlist";
import type { LocalPlaylistTrackRecord } from "@/lib/indexeddb";

type ProviderTrack = NeteaseTrackCandidate | QqMusicTrackCandidate;
type NetworkPlaylistSource = { provider: "netease" | "qqmusic"; playlistId: string };
type PlaylistTrackInfo = Pick<TrackMeta, "id" | "title" | "artist" | "album" | "durationMs" | "artworkUrl"> & {
  providerTrack: ProviderTrack | null;
  isInRoom: boolean;
};

type PlaylistPanelProps = {
  playlists: Playlist[];
  tracks: TrackMeta[];
  activeSession: AuthSession | null;
  canCreatePlaylist: boolean;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onUpdatePlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
};

export function PlaylistPanel({
  playlists,
  tracks,
  activeSession,
  canCreatePlaylist,
  onSavePlaylistFromQueue,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onDeletePlaylist
}: PlaylistPanelProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState("Tonight Selects");
  const [isPending, startTransition] = useTransition();
  const [remoteTracks, setRemoteTracks] = useState<ProviderTrack[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [cachedTracks, setCachedTracks] = useState<Map<string, LocalPlaylistTrackRecord>>(new Map());
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;
  const selectedSource = selectedPlaylist ? getNetworkPlaylistSource(selectedPlaylist) : null;
  const selectedProvider = selectedSource?.provider ?? null;
  const selectedProviderPlaylistId = selectedSource?.playlistId ?? null;
  const roomProviderTrackKeys = new Set(
    tracks.flatMap((track) => {
      const source = track.sourceRef;
      return source ? [`${source.provider}:${source.trackId}`] : [];
    })
  );
  const roomTrackMap = new Map<string, PlaylistTrackInfo>();
  for (const track of tracks) {
    const providerKey = track.sourceRef
      ? providerTrackKey(track.sourceRef.provider, track.sourceRef.trackId)
      : null;
    const cached = providerKey ? cachedTracks.get(providerKey) : cachedTracks.get(track.id);
    const info = toPlaylistTrackInfo(track, roomProviderTrackKeys, cached);
    roomTrackMap.set(track.id, info);
    if (providerKey) roomTrackMap.set(providerKey, info);
  }
  const cachedTrackMap = new Map(
    [...cachedTracks.values()]
      .map((track) => {
        const providerTrack = toCachedProviderTrack(track);
        return providerTrack ? [providerTrackKey(providerTrack.provider, providerTrack.providerTrackId), toPlaylistTrackInfo(providerTrack, roomProviderTrackKeys, track)] as const : null;
      })
      .filter((entry): entry is readonly [string, PlaylistTrackInfo] => !!entry)
  );
  const remoteTrackMap = new Map(
    remoteTracks.map((track) => [
      providerTrackKey(track.provider, track.providerTrackId),
      toPlaylistTrackInfo(track, roomProviderTrackKeys, cachedTracks.get(providerTrackKey(track.provider, track.providerTrackId)))
    ])
  );
  const selectedPlaylistTracks = selectedPlaylist
    ? selectedPlaylist.trackIds.map((trackId, index) =>
        remoteTrackMap.get(trackId)
        ?? (trackId.startsWith("local:") && remoteTracks[index]
          ? toPlaylistTrackInfo(remoteTracks[index], roomProviderTrackKeys, cachedTracks.get(providerTrackKey(remoteTracks[index].provider, remoteTracks[index].providerTrackId)))
          : undefined)
        ?? cachedTrackMap.get(trackId)
        ?? roomTrackMap.get(trackId)
        ?? null
      )
    : [];

  useEffect(() => {
    let cancelled = false;
    void listRoomPlaylistTrackIndex()
      .then((index) => {
        if (!cancelled) setCachedTracks(index);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRemoteTracks([]);
    setRemoteError(null);

    if (!selectedPlaylistId || !selectedProvider || !selectedProviderPlaylistId) {
      setRemoteLoading(false);
      return;
    }

    setRemoteLoading(true);
    const request = selectedProvider === "netease"
      ? musicRoomApi.getNeteasePlaylist(selectedProviderPlaylistId)
      : musicRoomApi.getQqMusicPlaylist(selectedProviderPlaylistId);
    void request
      .then((detail) => {
        if (!cancelled) setRemoteTracks(detail.tracks);
      })
      .catch((error) => {
        if (!cancelled) setRemoteError(error instanceof Error ? error.message : "网络歌曲信息加载失败。");
      })
      .finally(() => {
        if (!cancelled) setRemoteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlaylistId, selectedProvider, selectedProviderPlaylistId]);

  const saveCurrentQueue = () => {
    if (!activeSession || !canCreatePlaylist || isPending) return;
    const nextTitle = normalizePlaylistTitle(playlistTitle);
    startTransition(async () => {
      await onSavePlaylistFromQueue(nextTitle);
      setPlaylistTitle(nextTitle);
      setIsCreateOpen(false);
    });
  };

  const deletePlaylist = (playlistId: string) => {
    if (isPending) return;
    startTransition(async () => {
      await onDeletePlaylist(playlistId);
      setSelectedPlaylistId(null);
    });
  };

  if (selectedPlaylist) {
    return (
      <PlaylistDetail
        onBack={() => {
          setSelectedPlaylistId(null);
        }}
        onImportNeteaseTrack={onImportNeteaseTrack}
        onImportQqMusicTrack={onImportQqMusicTrack}
        playlist={selectedPlaylist}
        remoteError={remoteError}
        remoteLoading={remoteLoading}
        tracks={selectedPlaylistTracks}
      />
    );
  }

  return (
    <section className="flex w-full flex-col gap-3" data-testid="network-playlist-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">网络歌单</p>
          <p className="mt-1 truncate text-[10px] text-foreground-muted">保存的网易云音乐与 QQ 音乐歌单</p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <span className="font-mono text-[10px] text-foreground-muted">{playlists.length} 个歌单</span>
          <Button
            aria-label="保存当前队列为歌单"
            className="h-8 w-8"
            disabled={!activeSession || !canCreatePlaylist || isPending}
            onClick={() => setIsCreateOpen(true)}
            size="icon"
            title="保存当前队列为歌单"
            type="button"
            variant="outline"
          >
            <PlusIcon />
          </Button>
        </div>
      </div>

      {playlists.length > 0 ? (
        <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface/40">
          {playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              onDelete={() => deletePlaylist(playlist.id)}
              onOpen={() => setSelectedPlaylistId(playlist.id)}
              playlist={playlist}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-surface-border px-4 py-4">
          <p className="text-xs text-foreground-muted">当前房间还没有网络歌单。</p>
          <Button
            className="mt-3"
            disabled={!activeSession || !canCreatePlaylist || isPending}
            onClick={() => setIsCreateOpen(true)}
            size="sm"
            type="button"
          >
            <PlusIcon />
            保存当前队列
          </Button>
        </div>
      )}

      {isCreateOpen ? (
        <SavePlaylistDialog
          isPending={isPending}
          onCancel={() => setIsCreateOpen(false)}
          onSubmit={saveCurrentQueue}
          onTitleChange={setPlaylistTitle}
          title={playlistTitle}
        />
      ) : null}
    </section>
  );
}

function PlaylistCard({ playlist, onOpen, onDelete }: { playlist: Playlist; onOpen: () => void; onDelete: () => void }) {
  const source = getNetworkPlaylistSource(playlist);
  const providerName = source?.provider === "qqmusic" ? "QQ 音乐" : source?.provider === "netease" ? "网易云音乐" : "网络歌单";

  return (
    <article className="group flex min-w-0 items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-hover">
      <button
        aria-label={`打开歌单 ${playlist.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        onClick={onOpen}
        type="button"
      >
        <Artwork artworkUrl={playlist.coverUrl} title={playlist.title} size="sm" />
        <div className="min-w-0 flex-1 space-y-1">
          <strong className="block truncate text-sm font-semibold text-foreground">{playlist.title}</strong>
          <p className="truncate text-[10px] text-foreground-muted">{providerName} · {playlist.trackIds.length} 首歌曲</p>
        </div>
      </button>
      <Button
        aria-label={`删除歌单 ${playlist.title}`}
        className="h-8 w-8 shrink-0 text-white/70 transition-colors hover:bg-red-500/15 hover:text-red-300"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        size="icon"
        title="删除歌单"
        type="button"
        variant="ghost"
      >
        <TrashIcon />
      </Button>
    </article>
  );
}

function PlaylistDetail({
  playlist,
  onBack,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  tracks,
  remoteLoading,
  remoteError
}: {
  playlist: Playlist;
  onBack: () => void;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  tracks: Array<PlaylistTrackInfo | null>;
  remoteLoading: boolean;
  remoteError: string | null;
}) {
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const selectableTracks = tracks.filter(
    (track): track is PlaylistTrackInfo => !!track?.providerTrack && !track.isInRoom
  );
  const selectedTracks = selectableTracks.filter((track) => selectedTrackIds.includes(track.id));
  const allSelectableSelected = selectableTracks.length > 0 && selectedTracks.length === selectableTracks.length;

  useEffect(() => {
    const availableIds = new Set(
      tracks
        .filter((track): track is PlaylistTrackInfo => !!track?.providerTrack && !track.isInRoom)
        .map((track) => track.id)
    );
    setSelectedTrackIds((current) => {
      const next = current.filter((trackId) => availableIds.has(trackId));
      return next.length === current.length ? current : next;
    });
  }, [tracks]);

  const importTrack = async (track: PlaylistTrackInfo) => {
    if (!track.providerTrack || track.isInRoom || pendingTrackId) return;
    setPendingTrackId(track.id);
    try {
      if (track.providerTrack.provider === "netease") {
        await onImportNeteaseTrack(track.providerTrack);
      } else {
        await onImportQqMusicTrack(track.providerTrack);
      }
      setSelectedTrackIds((current) => current.filter((trackId) => trackId !== track.id));
    } catch {
      // The upload pipeline reports the detailed error through the room status surface.
    } finally {
      setPendingTrackId(null);
    }
  };

  const importSelectedTracks = async () => {
    if (pendingTrackId || selectedTracks.length === 0) return;
    for (const track of selectedTracks) {
      await importTrack(track);
    }
  };

  const toggleTrackSelection = (trackId: string) => {
    setSelectedTrackIds((current) =>
      current.includes(trackId)
        ? current.filter((item) => item !== trackId)
        : [...current, trackId]
    );
  };

  const toggleSelectAll = () => {
    setSelectedTrackIds(allSelectableSelected ? [] : selectableTracks.map((track) => track.id));
  };

  return (
    <section className="flex w-full flex-col" data-testid="network-playlist-detail">
      <Button className="mb-4 self-start gap-2" onClick={onBack} size="sm" type="button" variant="ghost">
        <ArrowLeftIcon />
        返回歌单
      </Button>

      <div className="mt-2 overflow-hidden rounded-lg border border-surface-border bg-surface/40" data-testid="network-playlist-tracks">
        {remoteLoading ? <p className="px-3 py-4 text-xs text-foreground-muted">正在加载歌曲信息…</p> : null}
        {remoteError ? <p className="px-3 py-4 text-xs text-amber-200">歌曲信息加载失败，当前显示已保存的歌曲索引。</p> : null}
        {tracks.length > 0 ? (
          <div className="flex flex-col gap-2 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border bg-surface/40 px-3 py-2">
              <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[11px] text-foreground-muted">
                <input
                  type="checkbox"
                  checked={allSelectableSelected}
                  disabled={selectableTracks.length === 0 || pendingTrackId !== null}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 accent-accent"
                />
                <span>{allSelectableSelected ? "取消全选" : "全选未导入歌曲"}</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-muted">已选择 {selectedTracks.length} 首</span>
                <button
                  type="button"
                  disabled={selectedTracks.length === 0 || pendingTrackId !== null}
                  onClick={() => void importSelectedTracks()}
                  className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pendingTrackId ? "导入中…" : "导入所选歌曲"}
                </button>
              </div>
            </div>
            <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface/40">
              {tracks.map((track, index) => {
                const trackId = track?.id ?? playlist.trackIds[index];
                const isPending = pendingTrackId === track?.id;
                return (
                  <article className="flex min-w-0 flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between" key={`${playlist.id}:${playlist.trackIds[index]}`}>
                    <div className="flex min-w-0 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={!!track?.providerTrack && selectedTrackIds.includes(track.id)}
                        disabled={!track?.providerTrack || track.isInRoom || pendingTrackId !== null}
                        onChange={() => toggleTrackSelection(trackId)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                        aria-label={`选择《${track?.title ?? playlist.trackIds[index]}》`}
                      />
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-foreground">{track?.title ?? playlist.trackIds[index]}</h3>
                        <p className="mt-1 truncate text-[10px] text-foreground-muted">
                          {track
                            ? `${track.artist} · ${track.album ?? "未知专辑"} · ${formatDuration(track.durationMs)}`
                            : "歌曲信息不可用"}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!track?.providerTrack || track.isInRoom || pendingTrackId !== null}
                      onClick={() => {
                        if (track) void importTrack(track);
                      }}
                      className={`shrink-0 rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                        track?.isInRoom
                          ? "cursor-default border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                          : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                      }`}
                    >
                      {track?.isInRoom ? "已在当前房间" : isPending ? "导入中…" : "导入曲库"}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="px-3 py-8 text-center text-xs text-foreground-muted">这个歌单还没有歌曲。</p>
        )}
      </div>
    </section>
  );
}

function SavePlaylistDialog({ title, isPending, onTitleChange, onSubmit, onCancel }: { title: string; isPending: boolean; onTitleChange: (value: string) => void; onSubmit: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-4 sm:items-center sm:py-6" role="presentation">
      <form
        aria-labelledby="room-save-playlist-title"
        className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-surface-border bg-surface p-4 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground" id="room-save-playlist-title">保存当前队列</h2>
            <p className="mt-1 text-xs text-foreground-muted">把当前房间队列保存成网络歌单，之后可以再次载入房间。</p>
          </div>
          <Button aria-label="关闭" onClick={onCancel} size="icon" type="button" variant="ghost">
            <CloseIcon />
          </Button>
        </div>
        <label className="mt-5 block text-xs font-medium text-foreground-muted" htmlFor="room-new-playlist-title">歌单名称</label>
        <input
          autoFocus
          className="mt-2 w-full rounded-lg border border-surface-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          id="room-new-playlist-title"
          maxLength={160}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="例如：Tonight Selects"
          required
          value={title}
        />
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={isPending} onClick={onCancel} type="button" variant="ghost">取消</Button>
          <Button disabled={isPending || !title.trim()} type="submit">{isPending ? "保存中…" : "保存歌单"}</Button>
        </div>
      </form>
    </div>
  );
}

function Artwork({ artworkUrl, title, size = "sm" }: { artworkUrl: string | null; title: string; size?: "sm" | "lg" | "row" | "cover" }) {
  const sizeClass = size === "cover"
    ? "aspect-square w-full rounded-none"
    : size === "lg"
      ? "h-24 w-24 rounded-xl"
      : size === "row"
        ? "h-16 w-16 rounded-lg"
      : "h-10 w-10 rounded-lg";

  return (
    <div
      aria-label={`${title} 封面`}
      className={`${sizeClass} flex shrink-0 items-center justify-center overflow-hidden border border-surface-border bg-surface text-lg font-bold text-foreground-muted`}
      style={artworkUrl ? { backgroundImage: `url(${artworkUrl})`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}
    >
      {!artworkUrl ? title.slice(0, 1).toUpperCase() : null}
    </div>
  );
}

function getNetworkPlaylistSource(playlist: Playlist): NetworkPlaylistSource | null {
  const sourceTag = playlist.tags.find((tag) => tag.startsWith("network:"));
  if (!sourceTag) return null;
  const [, provider, ...playlistIdParts] = sourceTag.split(":");
  if (provider !== "netease" && provider !== "qqmusic") return null;
  const playlistId = playlistIdParts.join(":").trim();
  return playlistId ? { provider, playlistId } : null;
}

function toPlaylistTrackInfo(
  track: TrackMeta | ProviderTrack,
  roomProviderTrackKeys: Set<string>,
  cached?: LocalPlaylistTrackRecord
): PlaylistTrackInfo {
  const isProviderTrack = "providerTrackId" in track;
  return {
    id: isProviderTrack ? `provider:${track.provider}:${track.providerTrackId}` : track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    artworkUrl: track.artworkUrl ?? cached?.artworkUrl ?? null,
    providerTrack: isProviderTrack ? track : null,
    isInRoom: isProviderTrack
      ? roomProviderTrackKeys.has(`${track.provider}:${track.providerTrackId}`)
      : true
  };
}

function PlusIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="M12 5v14M5 12h14" /></svg>;
}

function ArrowLeftIcon() {
  return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m15 18-6-6 6-6" /></svg>;
}

function TrashIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}
