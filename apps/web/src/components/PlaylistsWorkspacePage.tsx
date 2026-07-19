"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Playlist } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import {
  listMergedLocalPlaylistTracks,
  listRoomPlaylistTrackIndex
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

export function PlaylistsWorkspacePage() {
  const router = useRouter();
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo: "/app/playlists" });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const [localTracks, setLocalTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [roomPlaylists, setRoomPlaylists] = useState<Playlist[]>([]);
  const [roomTrackIndex, setRoomTrackIndex] = useState<Map<string, LocalPlaylistTrackRecord>>(new Map());
  const [selectedRoomPlaylist, setSelectedRoomPlaylist] = useState<Playlist | null>(null);
  const [storageState, setStorageState] = useState<LocalAudioStorageState | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const player = useLocalPlayer();

  useEffect(() => {
    if (hydrated && !activeSession) router.replace(authEntryHref as Route);
  }, [activeSession, authEntryHref, hydrated, router]);

  const refresh = async () => {
    const [tracks, playlists, storage, roomTracks] = await Promise.all([
      listMergedLocalPlaylistTracks(),
      musicRoomApi.listMyPlaylists(),
      getLocalAudioStorageState(),
      listRoomPlaylistTrackIndex()
    ]);
    setLocalTracks(tracks);
    setRoomPlaylists(playlists);
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
    try {
      await chooseLocalAudioDirectory();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "选择本地目录失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  if (!hydrated || !activeSession) return <div className="min-h-screen bg-black" />;

  return (
    <main className="relative min-h-screen overflow-hidden bg-black pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1400px] flex-col px-4 pb-10 pt-10 sm:px-6 sm:pt-12 md:mx-0 md:px-8 md:pt-28">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-accent">Playlists</p>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">我的歌单</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-foreground-muted">本地歌单读取本地保存的音频和平台元数据，房间歌单用于快速恢复协作队列。</p>
          </div>
          <div className="flex items-center gap-2">
            <Link className="text-sm text-accent hover:text-accent/80" href="/app/search">去搜索音乐</Link>
            <Button disabled={pending || storageState?.supported === false} onClick={() => void chooseFolder()} size="sm" variant="outline" type="button">{storageState?.directoryName ? "更改本地目录" : "选择本地目录"}</Button>
          </div>
        </div>

        <section className="mt-8 flex flex-col gap-4" data-testid="local-playlists">
          <div className="flex items-end justify-between border-b border-surface-border pb-3">
            <div><p className="text-lg font-bold text-foreground">本地歌单</p><p className="mt-1 text-xs text-foreground-muted">{storageState?.directoryName ? `目录：${storageState.directoryName}` : "尚未选择本地目录"}</p></div>
            <span className="text-xs text-foreground-muted">{localTracks.length} 首</span>
          </div>
          {localTracks.length ? (
            <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface/30">
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 border-b border-surface-border px-4 py-3 text-xs text-foreground-muted sm:grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,0.8fr)_7rem_auto]">
                <span>#</span><span>标题</span><span className="hidden sm:block">专辑</span><span className="hidden text-right sm:block">时长</span><span aria-hidden="true" />
              </div>
              {localTracks.map((track, index) => (
                <LocalTrackRow
                  index={index}
                  isCurrent={player.currentTrack?.id === track.id}
                  isPlayable={player.isTrackPlayable(track)}
                  key={track.id}
                  onPlay={() => void player.playTrack(track)}
                  track={track}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-surface-border px-6 py-14 text-center text-sm text-foreground-muted">从搜索页下载歌曲或导入歌单后，会显示在这里。</div>
          )}
        </section>

        <section className="mt-10 flex flex-col gap-4" data-testid="room-playlists">
          <div className="flex items-end justify-between border-b border-surface-border pb-3"><div><p className="text-lg font-bold text-foreground">房间歌单</p><p className="mt-1 text-xs text-foreground-muted">账号保存的协作队列</p></div><span className="text-xs text-foreground-muted">{roomPlaylists.length} 个</span></div>
          {roomPlaylists.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {roomPlaylists.map((playlist) => <RoomPlaylistCard key={playlist.id} playlist={playlist} onOpen={() => setSelectedRoomPlaylist(playlist)} />)}
            </div>
          ) : <div className="rounded-2xl border border-dashed border-surface-border px-6 py-14 text-center text-sm text-foreground-muted">在房间中保存队列后，会显示房间歌单。</div>}
        </section>

        {selectedRoomPlaylist ? (
          <RoomPlaylistDetail
            playlist={selectedRoomPlaylist}
            roomTrackIndex={roomTrackIndex}
            isTrackPlayable={player.isTrackPlayable}
            onPlayTracks={(tracks, index) => void player.playTracks(tracks, index)}
            onClose={() => setSelectedRoomPlaylist(null)}
          />
        ) : null}
        {message ? <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">{message}</p> : null}
      </div>
    </main>
  );
}

function LocalTrackRow({
  track,
  index,
  isCurrent,
  isPlayable,
  onPlay
}: {
  track: LocalPlaylistTrackRecord;
  index: number;
  isCurrent: boolean;
  isPlayable: boolean;
  onPlay: () => void;
}) {
  return (
    <article className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-surface-border px-4 py-3 last:border-b-0 hover:bg-surface-hover/50 sm:grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,0.8fr)_7rem_auto] ${isCurrent ? "bg-accent/10" : ""}`}>
      <span className="text-xs text-foreground-muted">{String(index + 1).padStart(2, "0")}</span>
      <div className="flex min-w-0 items-center gap-3">
        <Artwork artworkUrl={track.artworkUrl} title={track.title} />
        <div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{track.title}</p><p className="mt-1 truncate text-xs text-foreground-muted">{track.artist}{track.lyrics ? " · 有歌词" : ""}{track.availableOffline ? " · 已下载" : " · 需下载"}</p></div>
      </div>
      <span className="hidden truncate text-xs text-foreground-muted sm:block">{track.album ?? "未知专辑"}</span>
      <span className="hidden text-right text-xs tabular-nums text-foreground-muted sm:block">{formatDuration(track.durationMs)}</span>
      <Button
        aria-label={isPlayable ? `播放《${track.title}》` : `《${track.title}》需要下载后播放`}
        className="h-8 w-8 shrink-0"
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
    </article>
  );
}

function RoomPlaylistCard({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) {
  return <button className="flex min-h-36 items-center gap-4 rounded-2xl border border-surface-border bg-surface/35 p-4 text-left transition hover:border-accent/30 hover:bg-surface-hover" onClick={onOpen} type="button"><Artwork artworkUrl={playlist.coverUrl} title={playlist.title} size="lg" /><span className="min-w-0"><strong className="block truncate text-base text-foreground">{playlist.title}</strong><span className="mt-2 block text-xs text-foreground-muted">{playlist.trackIds.length} 首 · {playlist.isCollaborative ? "协作歌单" : "个人歌单"}</span><span className="mt-1 block truncate text-xs text-foreground-muted">{playlist.description || "暂无简介"}</span></span></button>;
}

function RoomPlaylistDetail({
  playlist,
  roomTrackIndex,
  isTrackPlayable,
  onPlayTracks,
  onClose
}: {
  playlist: Playlist;
  roomTrackIndex: Map<string, LocalPlaylistTrackRecord>;
  isTrackPlayable: (track: LocalPlaylistTrackRecord) => boolean;
  onPlayTracks: (tracks: LocalPlaylistTrackRecord[], index: number) => void;
  onClose: () => void;
}) {
  const resolvedTracks = playlist.trackIds
    .map((trackId, index) => ({ trackId, index, track: roomTrackIndex.get(trackId) }))
    .filter((item): item is { trackId: string; index: number; track: LocalPlaylistTrackRecord } => Boolean(item.track));
  const playableTracks = resolvedTracks.map((item) => item.track);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onMouseDown={onClose} role="presentation">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-surface-border bg-surface p-5" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold text-foreground">{playlist.title}</h2><p className="mt-1 text-xs text-foreground-muted">{playlist.trackIds.length} 首曲目</p></div>
          <Button onClick={onClose} size="sm" variant="ghost" type="button">关闭</Button>
        </div>
        <div className="mt-4 divide-y divide-surface-border">
          {playlist.trackIds.map((trackId, index) => {
            const record = roomTrackIndex.get(trackId);
            const playable = Boolean(record && isTrackPlayable(record));
            const resolvedIndex = record ? playableTracks.findIndex((track) => track.id === record.id) : -1;
            return (
              <div className="flex items-center gap-3 py-3" key={`${playlist.id}:${trackId}`}>
                <span className="w-6 shrink-0 text-xs tabular-nums text-foreground-muted">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{record?.title ?? trackId}</p>
                  <p className="truncate text-xs text-foreground-muted">{record?.artist ?? "曲目信息不可用"}{playable ? " · 已下载" : " · 需下载后播放"}</p>
                </div>
                <Button
                  aria-label={playable ? `播放《${record?.title ?? trackId}》` : "需要下载后播放"}
                  className="h-8 w-8 shrink-0"
                  disabled={!playable}
                  onClick={() => onPlayTracks(playableTracks, resolvedIndex)}
                  size="icon"
                  title={playable ? "播放" : "需要下载后播放"}
                  type="button"
                  variant="ghost"
                >
                  <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M8 5v14l11-7z" /></svg>
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Artwork({ artworkUrl, title, size = "sm" }: { artworkUrl: string | null; title: string; size?: "sm" | "lg" }) {
  return <div aria-label={`${title} 封面`} className={`${size === "lg" ? "h-24 w-24 rounded-xl" : "h-10 w-10 rounded-lg"} shrink-0 border border-surface-border bg-surface`} style={artworkUrl ? { backgroundImage: `url(${artworkUrl})`, backgroundPosition: "center", backgroundSize: "cover" } : undefined} />;
}

function AppPageBackground() {
  return <div className="fixed inset-0 -z-10 overflow-hidden bg-black"><div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" /><div className="absolute left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[120px]" /><div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-fuchsia-600/10 blur-[150px]" /></div>;
}
