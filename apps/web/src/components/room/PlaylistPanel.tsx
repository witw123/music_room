"use client";

import { useState, useTransition } from "react";
import type { AuthSession, Playlist, TrackMeta } from "@music-room/shared";
import { formatDuration, normalizePlaylistTitle } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

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
  onUpdatePlaylistTitle,
  onUpdatePlaylistTracks,
  onDeletePlaylist
}: PlaylistPanelProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState("Tonight Selects");
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;

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

  const startRename = (playlist: Playlist) => {
    setEditingPlaylistId(playlist.id);
    setEditingTitle(playlist.title);
  };

  const cancelRename = () => {
    setEditingPlaylistId(null);
    setEditingTitle("");
  };

  const saveRename = (playlist: Playlist) => {
    if (!editingTitle.trim() || isPending) return;
    const nextTitle = normalizePlaylistTitle(editingTitle, playlist.title);
    startTransition(async () => {
      await onUpdatePlaylistTitle(playlist.id, nextTitle);
      cancelRename();
    });
  };

  if (selectedPlaylist) {
    return (
      <PlaylistDetail
        editingPlaylistId={editingPlaylistId}
        editingTitle={editingTitle}
        isPending={isPending}
        onBack={() => {
          cancelRename();
          setSelectedPlaylistId(null);
        }}
        onDelete={() => deletePlaylist(selectedPlaylist.id)}
        onLoad={() => startTransition(() => void onLoadPlaylistIntoRoom(selectedPlaylist.id))}
        onStartRename={() => startRename(selectedPlaylist)}
        onCancelRename={cancelRename}
        onSaveRename={() => saveRename(selectedPlaylist)}
        onEditingTitleChange={setEditingTitle}
        onRemoveTrack={(trackId) =>
          startTransition(() =>
            void onUpdatePlaylistTracks(
              selectedPlaylist.id,
              selectedPlaylist.trackIds.filter((id) => id !== trackId)
            )
          )
        }
        playlist={selectedPlaylist}
        trackMap={trackMap}
      />
    );
  }

  return (
    <section className="flex w-full flex-col gap-4" data-testid="network-playlist-panel">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-surface-border pb-3">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-accent">Playlists</p>
          <h2 className="text-lg font-bold text-foreground">网络歌单</h2>
          <p className="mt-1 text-xs text-foreground-muted">保存的网易云音乐与 QQ 音乐歌单</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-surface-border bg-surface px-2 py-1 text-xs font-medium text-foreground-muted">
            {playlists.length} 个
          </span>
          <Button
            aria-label="保存当前队列为歌单"
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
  const providerName = getProviderName(playlist);

  return (
    <article className="group relative flex min-w-0 items-center rounded-xl border border-surface-border bg-surface/35 p-2 text-left transition hover:border-accent/40 hover:bg-surface-hover sm:p-2.5">
      <button
        aria-label={`打开歌单 ${playlist.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        onClick={onOpen}
        type="button"
      >
        <div className="relative shrink-0">
          <Artwork artworkUrl={playlist.coverUrl} title={playlist.title} size="row" />
          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/90">{providerName}</span>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <strong className="block truncate text-sm font-semibold text-foreground">{playlist.title}</strong>
          <p className="truncate text-xs text-foreground-muted">{playlist.description || "暂无简介"}</p>
          <p className="truncate text-xs text-foreground-muted">{playlist.trackIds.length} 首歌曲 · {playlist.isCollaborative ? "协作歌单" : "个人歌单"}</p>
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
  trackMap,
  editingPlaylistId,
  editingTitle,
  isPending,
  onBack,
  onLoad,
  onStartRename,
  onCancelRename,
  onSaveRename,
  onEditingTitleChange,
  onRemoveTrack,
  onDelete
}: {
  playlist: Playlist;
  trackMap: Map<string, TrackMeta>;
  editingPlaylistId: string | null;
  editingTitle: string;
  isPending: boolean;
  onBack: () => void;
  onLoad: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSaveRename: () => void;
  onEditingTitleChange: (value: string) => void;
  onRemoveTrack: (trackId: string) => void;
  onDelete: () => void;
}) {
  return (
    <section className="flex w-full flex-col" data-testid="network-playlist-detail">
      <Button className="mb-4 self-start gap-2" onClick={onBack} size="sm" type="button" variant="ghost">
        <ArrowLeftIcon />
        返回歌单
      </Button>

      <div className="flex flex-col gap-4 border-b border-surface-border pb-5 sm:flex-row sm:items-end">
        <Artwork artworkUrl={playlist.coverUrl} title={playlist.title} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">Network playlist</p>
          <h2 className="mt-2 truncate text-2xl font-bold text-foreground sm:text-3xl">{playlist.title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-foreground-muted">{playlist.description || "暂无简介"}</p>
          <p className="mt-3 text-xs text-foreground-muted">
            {playlist.trackIds.length} 首歌曲 · {getProviderName(playlist)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button disabled={isPending || playlist.trackIds.length === 0} onClick={onLoad} size="sm" type="button">
            <PlayIcon />
            加入房间
          </Button>
          <Button aria-label="重命名歌单" disabled={isPending} onClick={onStartRename} size="icon" title="重命名歌单" type="button" variant="outline">
            <EditIcon />
          </Button>
          <Button aria-label="删除歌单" className="text-red-300 hover:bg-red-500/10 hover:text-red-200" disabled={isPending} onClick={onDelete} size="icon" title="删除歌单" type="button" variant="ghost">
            <TrashIcon />
          </Button>
        </div>
      </div>

      {editingPlaylistId === playlist.id ? (
        <div className="mt-5 flex flex-col gap-2 rounded-xl border border-surface-border bg-surface/25 p-3 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="room-playlist-title">歌单名称</label>
          <input
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            id="room-playlist-title"
            maxLength={160}
            onChange={(event) => onEditingTitleChange(event.target.value)}
            value={editingTitle}
          />
          <div className="flex shrink-0 gap-2">
            <Button disabled={isPending} onClick={onCancelRename} size="sm" type="button" variant="ghost">取消</Button>
            <Button disabled={isPending || !editingTitle.trim()} onClick={onSaveRename} size="sm" type="button">保存</Button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-2xl border border-surface-border bg-surface/25">
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 border-b border-surface-border px-4 py-3 text-xs text-foreground-muted sm:grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,0.8fr)_7rem_auto]">
          <span>#</span>
          <span>标题</span>
          <span className="hidden sm:block">专辑</span>
          <span className="hidden text-right sm:block">时长</span>
          <span aria-hidden="true" />
        </div>
        {playlist.trackIds.length > 0 ? playlist.trackIds.map((trackId, index) => {
          const track = trackMap.get(trackId);
          return (
            <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-surface-border px-4 py-3 last:border-b-0 sm:grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,0.8fr)_7rem_auto]" key={`${playlist.id}:${trackId}`}>
              <span className="text-xs tabular-nums text-foreground-muted">{String(index + 1).padStart(2, "0")}</span>
              <div className="flex min-w-0 items-center gap-3">
                <Artwork artworkUrl={track?.artworkUrl ?? null} title={track?.title ?? trackId} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{track?.title ?? trackId}</p>
                  <p className="mt-1 truncate text-xs text-foreground-muted">{track?.artist ?? "曲目信息不可用"}</p>
                </div>
              </div>
              <span className="hidden truncate text-xs text-foreground-muted sm:block">{track?.album ?? "未知专辑"}</span>
              <span className="hidden text-right text-xs tabular-nums text-foreground-muted sm:block">{track ? formatDuration(track.durationMs) : "--:--"}</span>
              <Button
                aria-label={`从歌单移除${track ? `《${track.title}》` : "歌曲"}`}
                className="h-8 w-8 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                disabled={isPending}
                onClick={() => onRemoveTrack(trackId)}
                size="icon"
                title="从歌单移除"
                type="button"
                variant="ghost"
              >
                <TrashIcon />
              </Button>
            </div>
          );
        }) : <div className="px-6 py-8 text-center text-sm text-foreground-muted">这个歌单还没有歌曲。</div>}
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

function getProviderName(playlist: Playlist) {
  const sourceTag = playlist.tags.find((tag) => tag.startsWith("network:"));
  if (sourceTag?.startsWith("network:qqmusic:")) return "QQ 音乐";
  if (sourceTag?.startsWith("network:netease:")) return "网易云音乐";
  return "网络歌单";
}

function PlusIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="M12 5v14M5 12h14" /></svg>;
}

function ArrowLeftIcon() {
  return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m15 18-6-6 6-6" /></svg>;
}

function PlayIcon() {
  return <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M8 5v14l11-7z" /></svg>;
}

function EditIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="m4 16-.7 4.7L8 20l11.3-11.3a2.1 2.1 0 0 0-3-3L4 16Z" /><path d="m14.8 7.2 2 2" /></svg>;
}

function TrashIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}
