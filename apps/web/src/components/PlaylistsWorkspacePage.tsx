"use client";

import Link from "next/link";
import { useEffect, useState, type DragEvent } from "react";
import type {
  NeteaseTrackCandidate,
  Playlist,
  QqMusicTrackCandidate
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import {
  createLocalPlaylist,
  deleteLocalPlaylist,
  isDefaultLocalPlaylist,
  listLocalPlaylists,
  listMergedLocalPlaylistTracks,
  listRoomPlaylistTrackIndex,
  toLocalPlaylistTrackInput,
  updateLocalPlaylist,
  type LocalPlaylistRecord
} from "@/features/playlist/local-playlist";
import {
  chooseLocalAudioDirectory,
  type LocalAudioStorageState,
  getLocalAudioStorageState
} from "@/features/upload/local-audio-storage";
import type { LocalPlaylistTrackRecord } from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import { formatDuration } from "@/lib/music-room-ui";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useLocalPlayer } from "@/features/playback/local-player-context";

type PlaylistSelection =
  | { kind: "local"; playlist: LocalPlaylistRecord }
  | { kind: "network"; playlist: Playlist };

type ProviderTrack = NeteaseTrackCandidate | QqMusicTrackCandidate;
type NetworkPlaylistSource = { provider: "netease" | "qqmusic"; playlistId: string };
type PlaylistDeleteTarget =
  | { kind: "local"; playlist: LocalPlaylistRecord }
  | { kind: "network"; playlist: Playlist };

export function PlaylistsWorkspacePage() {
  const router = useRouter();
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo: "/app/playlists" });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const [localTracks, setLocalTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylistRecord[]>([]);
  const [networkPlaylists, setNetworkPlaylists] = useState<Playlist[]>([]);
  const [roomTrackIndex, setRoomTrackIndex] = useState<Map<string, LocalPlaylistTrackRecord>>(new Map());
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistSelection | null>(null);
  const [activeTab, setActiveTab] = useState<"local" | "network">("local");
  const [storageState, setStorageState] = useState<LocalAudioStorageState | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [createDialogKind, setCreateDialogKind] = useState<"local" | "network" | null>(null);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState("");
  const [newPlaylistDescription, setNewPlaylistDescription] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PlaylistDeleteTarget | null>(null);
  const player = useLocalPlayer();

  useEffect(() => {
    if (hydrated && !activeSession) router.replace(authEntryHref as Route);
  }, [activeSession, authEntryHref, hydrated, router]);

  const refresh = async () => {
    const [tracks, localPlaylistRecords, playlists, storage, roomTracks] = await Promise.all([
      listMergedLocalPlaylistTracks(),
      listLocalPlaylists(),
      musicRoomApi.listMyPlaylists(),
      getLocalAudioStorageState(),
      listRoomPlaylistTrackIndex()
    ]);
    setLocalTracks(tracks);
    setLocalPlaylists(localPlaylistRecords);
    setNetworkPlaylists(playlists);
    setStorageState(storage);
    setRoomTrackIndex(roomTracks);
  };

  useEffect(() => {
    if (!activeSession) return;
    void refresh().catch(() => setMessage("歌单数据加载失败，请刷新重试。"));
  }, [activeSession]);

  async function chooseFolder() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    setStatusMessage(null);
    try {
      await chooseLocalAudioDirectory();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "选择本地目录失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  async function createPlaylist(kind: "local" | "network") {
    const title = newPlaylistTitle.trim();
    if (!title || pending) return;
    setPending(true);
    setMessage(null);
    setStatusMessage(null);
    try {
      const playlist = kind === "local"
        ? createLocalPlaylist({ title, description: newPlaylistDescription })
        : await musicRoomApi.createPlaylist({
            title,
            description: newPlaylistDescription.trim() || null,
            tags: ["network"],
            isCollaborative: false
          });
      await refresh();
      setCreateDialogKind(null);
      setNewPlaylistTitle("");
      setNewPlaylistDescription("");
      if (kind === "local") {
        setSelectedPlaylist({ kind: "local", playlist });
      } else {
        setSelectedPlaylist({ kind: "network", playlist: playlist as Playlist });
      }
      setStatusMessage(kind === "local" ? "本地歌单已创建。" : "网络歌单已创建。可从搜索页保存网易云或 QQ 音乐歌单。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建歌单失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  async function deletePlaylist() {
    if (!deleteTarget || pending) return;
    const target = deleteTarget;
    setPending(true);
    setMessage(null);
    setStatusMessage(null);
    try {
      if (target.kind === "local") {
        deleteLocalPlaylist(target.playlist.id);
      } else {
        await musicRoomApi.deletePlaylist(target.playlist.id);
      }
      await refresh();
      if (selectedPlaylist?.kind === target.kind && selectedPlaylist.playlist.id === target.playlist.id) {
        setSelectedPlaylist(null);
      }
      setDeleteTarget(null);
      setStatusMessage(`歌单“${target.playlist.title}”已删除。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除歌单失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  async function updatePlaylistTracks(target: PlaylistSelection, trackIds: string[]) {
    if (pending) return;
    setPending(true);
    setMessage(null);
    setStatusMessage(null);
    try {
      if (target.kind === "local") {
        const updated = updateLocalPlaylist(target.playlist.id, { trackIds });
        if (!updated) throw new Error("本地歌单不存在，请刷新后重试。");
        await refresh();
        setSelectedPlaylist({ kind: "local", playlist: updated });
      } else {
        const updated = await musicRoomApi.updatePlaylist(target.playlist.id, { trackIds });
        await refresh();
        setSelectedPlaylist({ kind: "network", playlist: updated });
      }
      setStatusMessage("歌单歌曲已更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "歌单歌曲更新失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  if (!hydrated || !activeSession) return <div className="min-h-screen bg-black" />;

  return (
    <main className="relative min-h-screen overflow-hidden bg-black pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1400px] flex-col px-4 pb-10 pt-8 sm:px-6 sm:pt-10 md:mx-0 md:px-8 md:pt-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.28em] text-accent">Playlists</p>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">我的歌单</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">本地歌单读取本地保存的音频和平台元数据，网络歌单保存网易云音乐与 QQ 音乐的歌单信息。</p>
          </div>
          <div className="flex items-center gap-2">
            <Link className="text-sm text-accent hover:text-accent/80" href="/app/search">去搜索音乐</Link>
            <Button disabled={pending || storageState?.supported === false} onClick={() => void chooseFolder()} size="sm" variant="outline" type="button">{storageState?.directoryName ? "更改本地目录" : "选择本地目录"}</Button>
          </div>
        </div>

        {selectedPlaylist ? (
          <PlaylistDetailView
            localTracks={localTracks}
            player={player}
            roomTrackIndex={roomTrackIndex}
            selection={selectedPlaylist}
            pending={pending}
            onBack={() => setSelectedPlaylist(null)}
            onUpdateTracks={(trackIds) => void updatePlaylistTracks(selectedPlaylist, trackIds)}
            onDelete={selectedPlaylist.kind === "local"
              ? () => setDeleteTarget({ kind: "local", playlist: selectedPlaylist.playlist })
              : () => setDeleteTarget({ kind: "network", playlist: selectedPlaylist.playlist })}
          />
        ) : (
          <>
            <div className="mt-5 flex w-full max-w-xl gap-1 rounded-xl border border-surface-border bg-surface/40 p-1" role="tablist" aria-label="歌单类型">
              <button
                aria-selected={activeTab === "local"}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${activeTab === "local" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
                onClick={() => setActiveTab("local")}
                role="tab"
                type="button"
              >
                本地歌单 <span className="ml-1 text-xs opacity-70">{localPlaylists.length}</span>
              </button>
              <button
                aria-selected={activeTab === "network"}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${activeTab === "network" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
                onClick={() => setActiveTab("network")}
                role="tab"
                type="button"
              >
                网络歌单 <span className="ml-1 text-xs opacity-70">{networkPlaylists.length}</span>
              </button>
            </div>

            {activeTab === "local" ? (
              <section className="mt-4 flex flex-col gap-3" data-testid="local-playlists">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-surface-border pb-2">
                  <div>
                    <p className="text-lg font-bold text-foreground">本地歌单</p>
                    <p className="mt-1 text-xs text-foreground-muted">{storageState?.directoryName ? `目录：${storageState.directoryName}` : "尚未选择本地目录"}</p>
                  </div>
                  <Button onClick={() => setCreateDialogKind("local")} size="sm" variant="outline" type="button">
                    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 5v14M5 12h14" /></svg>
                    新建本地歌单
                  </Button>
                </div>
                {localPlaylists.length ? (
                  <div className="flex flex-col gap-2">
                    {localPlaylists.map((playlist) => (
                      <LocalPlaylistCard
                        folderName={storageState?.directoryName ?? null}
                        key={playlist.id}
                        onDelete={() => setDeleteTarget({ kind: "local", playlist })}
                        onOpen={() => setSelectedPlaylist({ kind: "local", playlist })}
                        playlist={playlist}
                        tracks={tracksForLocalPlaylist(playlist, localTracks)}
                      />
                    ))}
                  </div>
                ) : <div className="rounded-2xl border border-dashed border-surface-border px-6 py-8 text-center text-sm text-foreground-muted">当前没有本地歌单，可使用右上角按钮新建。</div>}
              </section>
            ) : (
              <section className="mt-4 flex flex-col gap-3" data-testid="network-playlists">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-surface-border pb-2">
                  <div><p className="text-lg font-bold text-foreground">网络歌单</p><p className="mt-1 text-xs text-foreground-muted">保存的网易云音乐与 QQ 音乐歌单</p></div>
                  <Button onClick={() => setCreateDialogKind("network")} size="sm" variant="outline" type="button">
                    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 5v14M5 12h14" /></svg>
                    新建网络歌单
                  </Button>
                </div>
                {networkPlaylists.length ? (
                  <div className="flex flex-col gap-2">
                    {networkPlaylists.map((playlist) => (
                      <NetworkPlaylistCard
                        key={playlist.id}
                        onDelete={() => setDeleteTarget({ kind: "network", playlist })}
                        onOpen={() => setSelectedPlaylist({ kind: "network", playlist })}
                        playlist={playlist}
                      />
                    ))}
                  </div>
                ) : <div className="rounded-2xl border border-dashed border-surface-border px-6 py-8 text-center text-sm text-foreground-muted">从搜索页保存网易云音乐或 QQ 音乐歌单后，会显示在这里。</div>}
              </section>
            )}
          </>
        )}
        {statusMessage ? <p className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300" role="status">{statusMessage}</p> : null}
        {message ? <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">{message}</p> : null}
        {createDialogKind ? (
          <PlaylistEditorDialog
            description={newPlaylistDescription}
            kind={createDialogKind}
            onCancel={() => setCreateDialogKind(null)}
            onDescriptionChange={setNewPlaylistDescription}
            onSubmit={() => void createPlaylist(createDialogKind)}
            onTitleChange={setNewPlaylistTitle}
            pending={pending}
            title={newPlaylistTitle}
          />
        ) : null}
        {deleteTarget ? (
          <DeletePlaylistDialog
            kind={deleteTarget.kind}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => void deletePlaylist()}
            pending={pending}
            playlist={deleteTarget.playlist}
          />
        ) : null}
      </div>
    </main>
  );
}

function LocalTrackRow({
  track,
  index,
  isCurrent,
  isPlayable,
  isQueued,
  onAddToQueue,
  onPlay,
  onRemove,
  draggable = false,
  isDragTarget = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  track: LocalPlaylistTrackRecord;
  index: number;
  isCurrent: boolean;
  isPlayable: boolean;
  isQueued: boolean;
  onAddToQueue: () => void;
  onPlay: () => void;
  onRemove?: () => void;
  draggable?: boolean;
  isDragTarget?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <article
      className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-surface-border px-4 py-3 last:border-b-0 hover:bg-surface-hover/50 sm:grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,0.8fr)_7rem_auto] ${isCurrent ? "bg-accent/10" : ""} ${isDragTarget ? "border-accent/60 bg-accent/10" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      draggable={draggable}
      onDragEnd={onDragEnd}
      onDragOver={(event: DragEvent<HTMLElement>) => {
        if (!onDragOver) return;
        event.preventDefault();
        onDragOver();
      }}
      onDragStart={(event: DragEvent<HTMLElement>) => {
        if (!onDragStart) return;
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDrop={(event: DragEvent<HTMLElement>) => {
        if (!onDrop) return;
        event.preventDefault();
        onDrop();
      }}
    >
      <span aria-label={draggable ? "拖动调整顺序" : undefined} className="flex items-center gap-1 text-xs text-foreground-muted" title={draggable ? "拖动调整顺序" : undefined}>
        {draggable ? <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" /></svg> : null}
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="flex min-w-0 items-center gap-3">
        <Artwork artworkUrl={track.artworkUrl} title={track.title} />
        <div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{track.title}</p><p className="mt-1 truncate text-xs text-foreground-muted">{track.artist}{track.lyrics ? " · 有歌词" : ""}{track.availableOffline ? " · 已下载" : " · 需下载"}</p></div>
      </div>
      <span className="hidden truncate text-xs text-foreground-muted sm:block">{track.album ?? "未知专辑"}</span>
      <span className="hidden text-right text-xs tabular-nums text-foreground-muted sm:block">{formatDuration(track.durationMs)}</span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          aria-label={isQueued ? `《${track.title}》已在队列中` : `将《${track.title}》加入队列`}
          className="h-8 w-8"
          disabled={isQueued || !isPlayable}
          onClick={onAddToQueue}
          size="icon"
          title={isQueued ? "已在队列中" : isPlayable ? "加入队列" : "需要下载后加入队列"}
          type="button"
          variant="ghost"
        >
          <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 5v14M5 12h14" /></svg>
        </Button>
        <Button
          aria-label={isPlayable ? `播放《${track.title}》` : `《${track.title}》需要下载后播放`}
          className="h-8 w-8"
          disabled={!isPlayable}
          onClick={onPlay}
          size="icon"
          title={isPlayable ? "播放" : "需要下载后播放"}
          type="button"
          variant={isCurrent ? "default" : "ghost"}
        >
          {isCurrent ? (
            <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg>
          ) : (
            <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M8 5v14l11-7z" /></svg>
          )}
        </Button>
        {onRemove ? (
          <Button aria-label={`从歌单移除《${track.title}》`} className="h-8 w-8 text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={onRemove} size="icon" title="从歌单移除" type="button" variant="ghost">
            <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" /></svg>
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function LocalPlaylistCard({
  folderName,
  onOpen,
  onDelete,
  playlist,
  tracks
}: {
  folderName: string | null;
  onOpen: () => void;
  onDelete?: () => void;
  playlist: LocalPlaylistRecord;
  tracks: LocalPlaylistTrackRecord[];
}) {
  const artworkUrl = tracks.find((track) => track.artworkUrl)?.artworkUrl ?? null;
  const downloadedCount = tracks.filter((track) => track.availableOffline).length;

  return (
    <article className="group relative flex min-w-0 items-center rounded-xl border border-surface-border bg-surface/35 p-2 text-left transition hover:border-accent/40 hover:bg-surface-hover sm:p-2.5">
      <button
        aria-label={`打开本地歌单 ${playlist.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        onClick={onOpen}
        type="button"
      >
        <div className="relative shrink-0">
          <Artwork artworkUrl={artworkUrl} title={playlist.title} size="row" />
          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/90">本地</span>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <strong className="block truncate text-sm font-semibold text-foreground">{playlist.title}</strong>
          <p className="truncate text-xs text-foreground-muted">{playlist.description || (folderName ? `目录：${folderName}` : "本地保存的歌曲")}</p>
          <p className="truncate text-xs text-foreground-muted">{tracks.length} 首歌曲 · 已下载 {downloadedCount}</p>
        </div>
      </button>
      {onDelete ? (
        <Button
          aria-label={`删除本地歌单 ${playlist.title}`}
          className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 bg-black/55 text-white/80 opacity-100 backdrop-blur-sm transition-opacity hover:bg-red-500/80 hover:text-white sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onDelete}
          size="icon"
          title="删除歌单"
          type="button"
          variant="ghost"
        >
          <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" /></svg>
        </Button>
      ) : null}
    </article>
  );
}

function NetworkPlaylistCard({ playlist, onOpen, onDelete }: { playlist: Playlist; onOpen: () => void; onDelete: () => void }) {
  const source = getNetworkPlaylistSource(playlist);
  const providerName = source?.provider === "qqmusic" ? "QQ 音乐" : source?.provider === "netease" ? "网易云音乐" : "网络歌单";

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
        onClick={onDelete}
        size="icon"
        title="删除歌单"
        type="button"
        variant="ghost"
      >
        <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" /></svg>
      </Button>
    </article>
  );
}

function PlaylistDetailView({
  localTracks,
  roomTrackIndex,
  player,
  selection,
  onBack,
  onDelete,
  onUpdateTracks,
  pending
}: {
  localTracks: LocalPlaylistTrackRecord[];
  roomTrackIndex: Map<string, LocalPlaylistTrackRecord>;
  player: ReturnType<typeof useLocalPlayer>;
  selection: PlaylistSelection;
  onBack: () => void;
  onDelete?: () => void;
  onUpdateTracks: (trackIds: string[]) => void;
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
  const [addTrackId, setAddTrackId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRemoteTracks([]);
    setRemoteError(null);
    if (isLocal || !networkProvider || !networkPlaylistId) {
      setRemoteLoading(false);
      return;
    }

    setRemoteLoading(true);
    const load = networkProvider === "netease"
      ? musicRoomApi.getNeteasePlaylist(networkPlaylistId)
      : musicRoomApi.getQqMusicPlaylist(networkPlaylistId);
    void load
      .then((detail) => {
        if (cancelled) return;
        setRemoteTracks(detail.tracks.map((track) => {
          const trackId = `provider:${track.provider}:${track.providerTrackId}`;
          return roomTrackIndex.get(trackId) ?? toProviderTrackRecord(track);
        }));
      })
      .catch((error) => {
        if (!cancelled) setRemoteError(error instanceof Error ? error.message : "网络歌单详情加载失败。");
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
    ? localPlaylist?.description || "本地目录中保存的歌曲"
    : networkPlaylist?.description || (networkSource?.provider === "qqmusic" ? "来自 QQ 音乐的网络歌单" : networkSource?.provider === "netease" ? "来自网易云音乐的网络歌单" : "保存的网络歌单");
  const artworkUrl = isLocal
    ? localPlaylistTracks.find((track) => track.artworkUrl)?.artworkUrl ?? null
    : networkPlaylist?.coverUrl ?? null;
  const remoteTrackMap = new Map(remoteTracks.map((track) => [track.id, track]));
  const localTrackMap = new Map(localTracks.map((track) => [track.id, track]));
  const networkTracks = (networkPlaylist?.trackIds ?? []).map((trackId, index) => ({
    track: roomTrackIndex.get(trackId) ?? remoteTrackMap.get(trackId) ?? localTrackMap.get(trackId),
    index,
    trackId
  }));
  const rows = isLocal
    ? localPlaylistTracks.map((track, index) => ({ track, index, trackId: track.id }))
    : networkTracks;
  const currentTrackIds = rows.map(({ track, trackId }) => track?.id ?? trackId);
  const canEditTracks = !pending;
  const candidateTracks = [...remoteTracks, ...localTracks]
    .filter((track, index, list) => !currentTrackIds.includes(track.id) && list.findIndex((candidate) => candidate.id === track.id) === index);

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

  function addSelectedTrack() {
    if (!addTrackId || !canEditTracks || currentTrackIds.includes(addTrackId)) return;
    setAddTrackId("");
    onUpdateTracks([...currentTrackIds, addTrackId]);
  }
  const playableTracks = rows
    .map((row) => row.track)
    .filter((track): track is LocalPlaylistTrackRecord => Boolean(track && player.isTrackPlayable(track)))
    .filter((track, index, list) => list.findIndex((candidate) => candidate.id === track.id) === index);
  const playableIndexById = new Map(playableTracks.map((track, index) => [track.id, index]));

  return (
    <section className="mt-5" data-testid="playlist-detail">
      <Button className="mb-4 gap-2" onClick={onBack} size="sm" type="button" variant="ghost">
        <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m15 18-6-6 6-6" /></svg>
        返回歌单
      </Button>

      <div className="flex flex-col gap-4 border-b border-surface-border pb-5 sm:flex-row sm:items-end">
        <Artwork artworkUrl={artworkUrl} title={title} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">{isLocal ? "Local playlist" : "Network playlist"}</p>
          <h2 className="mt-2 truncate text-2xl font-bold text-foreground sm:text-3xl">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-foreground-muted">{description}</p>
          <p className="mt-3 text-xs text-foreground-muted">{rows.length} 首歌曲{isLocal ? "" : " · 网络歌单"}</p>
          {remoteLoading ? <p className="mt-2 text-xs text-accent">正在同步平台歌单详情…</p> : null}
          {remoteError ? <p className="mt-2 text-xs text-amber-300">{remoteError} 当前显示已保存的歌曲索引。</p> : null}
        </div>
        {onDelete ? (
          <Button aria-label="删除网络歌单" className="text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={onDelete} size="sm" type="button" variant="ghost">
            <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" /></svg>
            删除
          </Button>
        ) : null}
        <Button disabled={playableTracks.length === 0} onClick={() => void player.playTracks(playableTracks, 0)} type="button">
          <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M8 5v14l11-7z" /></svg>
          播放全部
        </Button>
      </div>

      {canEditTracks && candidateTracks.length ? (
        <div className="mt-5 flex flex-col gap-2 rounded-xl border border-surface-border bg-surface/25 p-3 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="playlist-add-track">添加歌曲</label>
          <select
            className="min-w-0 flex-1 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            id="playlist-add-track"
            onChange={(event) => setAddTrackId(event.target.value)}
            value={addTrackId}
          >
            <option value="">选择要加入的歌曲</option>
            {candidateTracks.map((track) => <option key={track.id} value={track.id}>{track.title} · {track.artist}</option>)}
          </select>
          <Button disabled={!addTrackId || pending} onClick={addSelectedTrack} size="sm" type="button">
            <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 5v14M5 12h14" /></svg>
            添加歌曲
          </Button>
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-2xl border border-surface-border bg-surface/25">
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 border-b border-surface-border px-4 py-3 text-xs text-foreground-muted sm:grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,0.8fr)_7rem_auto]">
          <span>#</span><span>标题</span><span className="hidden sm:block">专辑</span><span className="hidden text-right sm:block">时长</span><span aria-hidden="true" />
        </div>
        {rows.length ? rows.map(({ track, index, trackId }) => {
          if (!track) {
            return (
              <article
                className={`flex items-center gap-3 border-b border-surface-border px-4 py-3 last:border-b-0 ${dragOverTrackId === trackId ? "bg-accent/10" : ""} ${canEditTracks ? "cursor-grab active:cursor-grabbing" : ""}`}
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
                <span className="w-8 shrink-0 text-xs text-foreground-muted">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm text-foreground">{trackId}</p><p className="mt-1 text-xs text-foreground-muted">曲目信息不可用</p></div>
                {canEditTracks ? <Button aria-label="从歌单移除歌曲" className="h-8 w-8 text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={() => onUpdateTracks(currentTrackIds.filter((id) => id !== trackId))} size="icon" title="从歌单移除" type="button" variant="ghost"><svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7" /></svg></Button> : null}
              </article>
            );
          }
          const playable = player.isTrackPlayable(track);
          return (
            <LocalTrackRow
              index={index}
              isCurrent={player.currentTrack?.id === track.id}
              isPlayable={playable}
              isQueued={player.queue.some((item) => item.trackId === track.id)}
              isDragTarget={dragOverTrackId === track.id}
              key={`${selection.kind}:${track.id}`}
              onAddToQueue={() => player.addToQueue(track)}
              onDragEnd={() => {
                setDraggingTrackId(null);
                setDragOverTrackId(null);
              }}
              onDragOver={() => setDragOverTrackId(track.id)}
              onDragStart={() => setDraggingTrackId(track.id)}
              onDrop={() => reorderTracks(track.id)}
              onRemove={canEditTracks ? () => onUpdateTracks(currentTrackIds.filter((trackId) => trackId !== track.id)) : undefined}
              onPlay={() => {
                const playableIndex = playableIndexById.get(track.id);
                if (playableIndex !== undefined) void player.playTracks(playableTracks, playableIndex);
              }}
              track={track}
              draggable={canEditTracks}
            />
          );
        }) : <div className="px-6 py-8 text-center text-sm text-foreground-muted">这个歌单还没有歌曲。</div>}
      </div>
    </section>
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

function tracksForLocalPlaylist(playlist: LocalPlaylistRecord, tracks: LocalPlaylistTrackRecord[]) {
  if (isDefaultLocalPlaylist(playlist) && playlist.isAggregate !== false) return tracks;
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  return playlist.trackIds
    .map((trackId) => trackMap.get(trackId))
    .filter((track): track is LocalPlaylistTrackRecord => Boolean(track));
}

function toProviderTrackRecord(track: ProviderTrack): LocalPlaylistTrackRecord {
  const now = new Date().toISOString();
  return {
    ...toLocalPlaylistTrackInput({ track, availableOffline: false }),
    createdAt: now,
    updatedAt: now
  };
}

function PlaylistEditorDialog({
  kind,
  title,
  description,
  pending,
  onTitleChange,
  onDescriptionChange,
  onSubmit,
  onCancel
}: {
  kind: "local" | "network";
  title: string;
  description: string;
  pending: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const isLocal = kind === "local";
  const titleId = `create-${kind}-playlist-title`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="presentation">
      <form
        aria-labelledby={titleId}
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
            <h2 className="text-lg font-semibold text-foreground" id={titleId}>{isLocal ? "新建本地歌单" : "新建网络歌单"}</h2>
            <p className="mt-1 text-xs text-foreground-muted">{isLocal ? "新歌单会保存在当前设备，可稍后整理本地歌曲。" : "也可以从搜索页直接保存网易云音乐或 QQ 音乐歌单。"}</p>
          </div>
          <Button aria-label="关闭" onClick={onCancel} size="icon" type="button" variant="ghost">
            <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </Button>
        </div>
        <label className="mt-5 block text-xs font-medium text-foreground-muted" htmlFor={`new-${kind}-playlist-title`}>歌单名称</label>
        <input
          autoFocus
          className="mt-2 w-full rounded-lg border border-surface-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          id={`new-${kind}-playlist-title`}
          maxLength={160}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="例如：通勤歌单"
          required
          value={title}
        />
        <label className="mt-4 block text-xs font-medium text-foreground-muted" htmlFor={`new-${kind}-playlist-description`}>歌单简介（可选）</label>
        <textarea
          className="mt-2 min-h-24 w-full resize-y rounded-lg border border-surface-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          id={`new-${kind}-playlist-description`}
          maxLength={1000}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="写点歌单备注"
          value={description}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button disabled={pending} onClick={onCancel} type="button" variant="ghost">取消</Button>
          <Button disabled={pending || !title.trim()} type="submit">{pending ? "创建中…" : "创建歌单"}</Button>
        </div>
      </form>
    </div>
  );
}

function DeletePlaylistDialog({ kind, playlist, pending, onConfirm, onCancel }: { kind: "local" | "network"; playlist: { title: string }; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  const label = kind === "local" ? "本地歌单" : "网络歌单";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="presentation">
      <div aria-labelledby="delete-playlist-title" className="w-full max-w-sm rounded-2xl border border-surface-border bg-surface p-5 shadow-2xl" role="dialog" aria-modal="true">
        <h2 className="text-lg font-semibold text-foreground" id="delete-playlist-title">删除{label}</h2>
        <p className="mt-3 text-sm leading-6 text-foreground-muted">确定删除“{playlist.title}”吗？已下载到本地的歌曲不会被删除。</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button disabled={pending} onClick={onCancel} type="button" variant="ghost">取消</Button>
          <Button className="bg-red-500 hover:bg-red-400" disabled={pending} onClick={onConfirm} type="button">{pending ? "删除中…" : "确认删除"}</Button>
        </div>
      </div>
    </div>
  );
}

function AppPageBackground() {
  return <div className="fixed inset-0 -z-10 overflow-hidden bg-black"><div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" /><div className="absolute left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[120px]" /><div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-fuchsia-600/10 blur-[150px]" /></div>;
}
