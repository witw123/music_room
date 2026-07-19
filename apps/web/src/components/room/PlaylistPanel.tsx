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

type ProviderTrack = NeteaseTrackCandidate | QqMusicTrackCandidate;
type NetworkPlaylistSource = { provider: "netease" | "qqmusic"; playlistId: string };
type PlaylistTrackInfo = Pick<TrackMeta, "id" | "title" | "artist" | "album" | "durationMs" | "artworkUrl">;

type PlaylistPanelProps = {
  playlists: Playlist[];
  tracks: TrackMeta[];
  activeSession: AuthSession | null;
  canCreatePlaylist: boolean;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
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
  onLoadPlaylistIntoRoom,
  onDeletePlaylist
}: PlaylistPanelProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState("Tonight Selects");
  const [isPending, startTransition] = useTransition();
  const [remoteTracks, setRemoteTracks] = useState<PlaylistTrackInfo[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;
  const selectedSource = selectedPlaylist ? getNetworkPlaylistSource(selectedPlaylist) : null;
  const selectedProvider = selectedSource?.provider ?? null;
  const selectedProviderPlaylistId = selectedSource?.playlistId ?? null;
  const roomTrackMap = new Map(tracks.map((track) => [track.id, toPlaylistTrackInfo(track)]));
  const remoteTrackMap = new Map(remoteTracks.map((track) => [track.id, track]));
  const selectedPlaylistTracks = selectedPlaylist
    ? selectedPlaylist.trackIds.map((trackId) => roomTrackMap.get(trackId) ?? remoteTrackMap.get(trackId) ?? null)
    : [];

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
        if (!cancelled) setRemoteTracks(detail.tracks.map(toPlaylistTrackInfo));
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
        isPending={isPending}
        onBack={() => {
          setSelectedPlaylistId(null);
        }}
        onLoad={() => startTransition(() => void onLoadPlaylistIntoRoom(selectedPlaylist.id))}
        playlist={selectedPlaylist}
        remoteError={remoteError}
        remoteLoading={remoteLoading}
        tracks={selectedPlaylistTracks}
      />
    );
  }

  return (
    <section className="flex w-full flex-col gap-3" data-testid="network-playlist-panel">
      <div className="flex justify-end">
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

      {playlists.length > 0 ? (
        <div className="flex flex-col gap-2">
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
        <div className="rounded-2xl border border-dashed border-surface-border px-6 py-8 text-center">
          <p className="text-sm text-foreground-muted">当前房间还没有网络歌单。</p>
          <Button
            className="mt-4"
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
  return (
    <article className="group relative flex min-w-0 items-center rounded-xl border border-surface-border bg-surface/35 p-2 text-left transition hover:border-accent/40 hover:bg-surface-hover sm:p-2.5">
      <button
        aria-label={`打开歌单 ${playlist.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        onClick={onOpen}
        type="button"
      >
        <Artwork artworkUrl={playlist.coverUrl} title={playlist.title} size="row" />
        <div className="min-w-0 flex-1 space-y-1">
          <strong className="block truncate text-sm font-semibold text-foreground">{playlist.title}</strong>
          <p className="truncate text-xs text-foreground-muted">{playlist.trackIds.length} 首歌曲</p>
        </div>
      </button>
      <Button
        aria-label={`删除歌单 ${playlist.title}`}
        className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 bg-black/55 text-white/80 opacity-100 backdrop-blur-sm transition-opacity hover:bg-red-500/80 hover:text-white sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
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
  isPending,
  onBack,
  onLoad,
  tracks,
  remoteLoading,
  remoteError
}: {
  playlist: Playlist;
  isPending: boolean;
  onBack: () => void;
  onLoad: () => void;
  tracks: Array<PlaylistTrackInfo | null>;
  remoteLoading: boolean;
  remoteError: string | null;
}) {
  return (
    <section className="flex w-full flex-col" data-testid="network-playlist-detail">
      <Button className="mb-4 self-start gap-2" onClick={onBack} size="sm" type="button" variant="ghost">
        <ArrowLeftIcon />
        返回歌单
      </Button>

      <div className="flex items-center gap-4 border-b border-surface-border pb-5">
        <Artwork artworkUrl={playlist.coverUrl} title={playlist.title} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold text-foreground">{playlist.title}</h2>
          <p className="mt-2 text-sm text-foreground-muted">{playlist.trackIds.length} 首歌曲</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-accent/20 bg-accent/10 p-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">导入到当前房间</p>
          <p className="mt-1 truncate text-xs text-foreground-muted">将 {playlist.trackIds.length} 首歌曲加入房间队列</p>
        </div>
        <Button disabled={isPending || playlist.trackIds.length === 0} onClick={onLoad} size="sm" type="button">
          <ImportIcon />
          导入
        </Button>
      </div>

      <div className="mt-4 overflow-hidden border border-surface-border bg-surface" data-testid="network-playlist-tracks">
        {remoteLoading ? <p className="px-3 py-4 text-xs text-foreground-muted">正在加载歌曲信息…</p> : null}
        {remoteError ? <p className="px-3 py-4 text-xs text-amber-200">歌曲信息加载失败，当前显示已保存的歌曲索引。</p> : null}
        {tracks.length > 0 ? tracks.map((track, index) => (
          <article className="grid gap-2 border-b border-surface-border px-3 py-2.5 last:border-b-0 transition-colors hover:bg-surface-hover sm:px-3.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" key={`${playlist.id}:${playlist.trackIds[index]}`}>
            <div className="flex min-w-0 items-start gap-3">
              <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[10px] text-foreground-muted/60">{String(index + 1).padStart(2, "0")}</span>
              <div className="min-w-0 space-y-0.5">
                <h3 className="truncate text-sm font-semibold text-foreground">{track?.title ?? playlist.trackIds[index]}</h3>
                <p className="truncate text-xs text-foreground-muted">
                  {track ? `${track.artist} · ${formatDuration(track.durationMs)}` : "歌曲信息不可用"}
                </p>
                {track?.album ? <p className="truncate text-[10px] text-foreground-muted/60">{track.album}</p> : null}
              </div>
            </div>
          </article>
        )) : (
          <p className="px-3 py-8 text-center text-xs text-foreground-muted">这个歌单还没有歌曲。</p>
        )}
      </div>
    </section>
  );
}

function SavePlaylistDialog({ title, isPending, onTitleChange, onSubmit, onCancel }: { title: string; isPending: boolean; onTitleChange: (value: string) => void; onSubmit: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="presentation">
      <form
        aria-labelledby="room-save-playlist-title"
        className="w-full max-w-md rounded-2xl border border-surface-border bg-surface p-5 shadow-2xl"
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
        <div className="mt-5 flex justify-end gap-2">
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

function toPlaylistTrackInfo(track: TrackMeta | ProviderTrack): PlaylistTrackInfo {
  return {
    id: "provider" in track ? `provider:${track.provider}:${track.providerTrackId}` : track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    artworkUrl: track.artworkUrl
  };
}

function PlusIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="M12 5v14M5 12h14" /></svg>;
}

function ArrowLeftIcon() {
  return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m15 18-6-6 6-6" /></svg>;
}

function ImportIcon() {
  return <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 21h14" /></svg>;
}

function TrashIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}
