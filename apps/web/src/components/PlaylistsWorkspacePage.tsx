"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import type {
  Playlist
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import {
  createLocalPlaylist,
  defaultLocalPlaylistId,
  deleteLocalPlaylist,
  ensureDefaultLocalPlaylist,
  flushLocalPlaylistPersistence,
  importLocalPlaylistDirectoryTracks,
  listLocalPlaylists,
  mergeLocalPlaylists,
  restoreLocalPlaylistsFromRepository,
  listMergedLocalPlaylistTracks,
  listRoomPlaylistTrackIndex,
  syncSelectedLocalDirectoryTracks,
  hashAudioBlob,
  providerTrackKey,
  toProviderTrackRecord,
  updateLocalPlaylist,
  type LocalPlaylistRecord
} from "@/features/playlist/local-playlist";
import {
  chooseLocalAudioDirectory,
  ensureLocalAudioDirectoryWriteAccess,
  normalizeLocalAudioMimeType,
  saveAudioFileToLocalDirectory,
  type LocalAudioStorageState,
  getLocalAudioStorageState
} from "@/features/upload/local-audio-storage";
import { upsertLocalPlaylistTrack, type LocalPlaylistTrackRecord } from "@/lib/indexeddb";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  isLocalPlaylistMirror,
  localPlaylistIdFromMirror,
  syncLocalPlaylistToDatabase
} from "@/lib/local-playlist-database";
import { formatDuration } from "@/lib/music-room-ui";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import { AnchoredDialog, getAnchoredDialogAnchor, type AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";

type PlaylistSelection =
  | { kind: "local"; playlist: LocalPlaylistRecord }
  | { kind: "network"; playlist: Playlist };

type NetworkPlaylistSource = { provider: "netease" | "qqmusic"; playlistId: string };
type PlaylistDeleteTarget =
  | { kind: "local"; playlist: LocalPlaylistRecord }
  | { kind: "network"; playlist: Playlist };
type TrackMoveRequest = {
  track: LocalPlaylistTrackRecord;
  source: PlaylistSelection;
  anchor: AnchoredDialogAnchor;
};

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
  const [localPlaylistDatabaseIds, setLocalPlaylistDatabaseIds] = useState<Record<string, string>>({});
  const [networkArtworkById, setNetworkArtworkById] = useState<Record<string, string[]>>({});
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
  const [moveTarget, setMoveTarget] = useState<TrackMoveRequest | null>(null);
  const refreshVersion = useRef(0);
  const player = useLocalPlayer();

  useEffect(() => {
    if (hydrated && !activeSession) router.replace(authEntryHref as Route);
  }, [activeSession, authEntryHref, hydrated, router]);

  const refresh = async () => {
    const version = ++refreshVersion.current;
    await flushLocalPlaylistPersistence();
    const scannedTrackCount = await syncSelectedLocalDirectoryTracks();
    const [tracks, restoredLocalPlaylists, storage, roomTracks] = await Promise.all([
      listMergedLocalPlaylistTracks(),
      restoreLocalPlaylistsFromRepository(),
      getLocalAudioStorageState(),
      listRoomPlaylistTrackIndex()
    ]);
    let initialDatabasePlaylists: Playlist[] = [];
    try {
      initialDatabasePlaylists = await musicRoomApi.listMyPlaylists();
    } catch {
      // The local repository can still be opened while the server retries its database connection.
    }
    const mergedLocalPlaylists = mergeLocalPlaylistsWithDatabase(
      restoredLocalPlaylists,
      initialDatabasePlaylists.filter(isLocalPlaylistMirror)
    );
    mergeLocalPlaylists(mergedLocalPlaylists);
    let localPlaylistRecords: LocalPlaylistRecord[];
    localPlaylistRecords = ensureDefaultLocalPlaylist({
      trackIds: tracks
        .filter((track) => track.source === "directory-scan" && track.availableOffline)
        .map((track) => track.id),
      sourceDirectoryName: storage.directoryName
    });
    if (version !== refreshVersion.current) return scannedTrackCount;
    setLocalTracks(tracks);
    setLocalPlaylists(localPlaylistRecords);
    setStorageState(storage);
    setRoomTrackIndex(roomTracks);
    setSelectedPlaylist((current) => {
      if (!current) return null;
      if (current.kind === "local") {
        const playlist = localPlaylistRecords.find((item) => item.id === current.playlist.id);
        return playlist ? { kind: "local", playlist } : null;
      }
      const playlist = networkPlaylists.find((item) => item.id === current.playlist.id);
      return playlist ? { kind: "network", playlist } : null;
    });
    try {
      let playlists = initialDatabasePlaylists;
      if (playlists.length === 0) playlists = await musicRoomApi.listMyPlaylists();
      const localPlaylistDatabaseIds = await syncLocalPlaylistsToDatabase(localPlaylistRecords, playlists);
      if (Object.keys(localPlaylistDatabaseIds).length > 0) {
        playlists = await musicRoomApi.listMyPlaylists();
      }
      if (version === refreshVersion.current) {
        setLocalPlaylistDatabaseIds(localPlaylistDatabaseIds);
        setNetworkPlaylists(playlists.filter((playlist) => !isLocalPlaylistMirror(playlist)));
        setSelectedPlaylist((current) => {
          if (!current || current.kind !== "network") return current;
          const playlist = playlists.find((item) => item.id === current.playlist.id);
          return playlist ? { kind: "network", playlist } : null;
        });
      }
    } catch {
      if (version === refreshVersion.current && networkPlaylists.length === 0) {
        setMessage("歌单数据库加载失败，请稍后重试；本地音频仍可使用。");
      }
    }
    return scannedTrackCount;
  };

  useEffect(() => {
    if (!activeSession) return;
    void refresh().catch(() => setMessage("歌单数据加载失败，请刷新重试。"));
  }, [activeSession]);

  useEffect(() => {
    let cancelled = false;
    if (networkPlaylists.length === 0) {
      setNetworkArtworkById({});
      return;
    }

    const loadNetworkArtwork = async () => {
      setNetworkArtworkById((current) => {
        const next = { ...current };
        for (const playlist of networkPlaylists) {
          const cachedArtwork = getPlaylistArtworkCandidates(playlist, roomTrackIndex, localTracks);
          if (cachedArtwork.length > 0) {
            next[playlist.id] = uniqueArtworkUrls([
              ...cachedArtwork,
              ...(current[playlist.id] ?? [])
            ]);
          }
        }
        return next;
      });

      await Promise.all(networkPlaylists.map(async (playlist) => {
        const source = getNetworkPlaylistSource(playlist);
        const cachedArtwork = getPlaylistArtworkCandidates(playlist, roomTrackIndex, localTracks);
        let artworkUrls = cachedArtwork;

        if (source) {
          try {
            const detail = source.provider === "netease"
              ? await musicRoomApi.getNeteasePlaylist(source.playlistId)
              : await musicRoomApi.getQqMusicPlaylist(source.playlistId);
            artworkUrls = uniqueArtworkUrls([
              detail.artworkUrl,
              ...detail.tracks.map((track) => track.artworkUrl),
              ...cachedArtwork
            ]);
          } catch {
            const legacyArtwork = await resolveLegacyNetworkPlaylistArtwork(playlist, roomTrackIndex);
            artworkUrls = uniqueArtworkUrls([...cachedArtwork, ...legacyArtwork]);
          }
        } else {
          const legacyArtwork = await resolveLegacyNetworkPlaylistArtwork(playlist, roomTrackIndex);
          artworkUrls = uniqueArtworkUrls([...cachedArtwork, ...legacyArtwork]);
        }

        if (!cancelled && artworkUrls.length > 0) {
          setNetworkArtworkById((current) => ({
            ...current,
            [playlist.id]: uniqueArtworkUrls([
              ...artworkUrls,
              ...(current[playlist.id] ?? [])
            ])
          }));
        }
      }));
    };

    void loadNetworkArtwork();
    return () => {
      cancelled = true;
    };
  }, [localTracks, networkPlaylists, roomTrackIndex]);

  useEffect(() => {
    let cancelled = false;
    const unresolvedTracks = localTracks.filter((track) =>
      !track.artworkUrl &&
      (track.provider === "netease" || track.provider === "qqmusic") &&
      !!track.providerTrackId
    );
    if (unresolvedTracks.length === 0) return;

    const resolveMissingArtwork = async () => {
      const resolvedTracks = await Promise.all(unresolvedTracks.slice(0, 24).map(async (track) => {
        const provider = track.provider === "netease" || track.provider === "qqmusic" ? track.provider : null;
        if (!provider) return null;
        const resolved = await resolveProviderArtwork(track, provider);
        if (!resolved.artworkUrl) return null;
        try {
          await upsertLocalPlaylistTrack(resolved);
        } catch {
          // The card can still use the resolved URL for this session.
        }
        return resolved;
      }));
      if (cancelled) return;

      const resolvedById = new Map(
        resolvedTracks
          .filter((track): track is LocalPlaylistTrackRecord => !!track)
          .map((track) => [track.id, track])
      );
      if (resolvedById.size === 0) return;
      setLocalTracks((current) => current.map((track) => resolvedById.get(track.id) ?? track));
    };

    void resolveMissingArtwork();
    return () => {
      cancelled = true;
    };
  }, [localTracks]);

  async function chooseFolder() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    setStatusMessage(null);
    try {
      await chooseLocalAudioDirectory();
      const scannedTrackCount = await refresh();
      setStatusMessage(`本地目录已更新，识别到 ${scannedTrackCount} 首歌曲。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "选择本地目录失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  async function openCreateDialog(kind: "local" | "network") {
    if (pending) return;
    setMessage(null);
    if (kind === "local" && (!storageState?.directoryName || storageState.permission !== "granted")) {
      setPending(true);
      try {
        await chooseLocalAudioDirectory();
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "选择项目根目录失败，请重试。 ");
        return;
      } finally {
        setPending(false);
      }
    }
    setCreateDialogKind(kind);
  }

  async function createPlaylist(kind: "local" | "network") {
    const title = newPlaylistTitle.trim();
    if (!title || pending) return;
    setPending(true);
    setMessage(null);
    setStatusMessage(null);
    try {
      let playlist: LocalPlaylistRecord | Playlist;
      if (kind === "local") {
        if (!await ensureLocalAudioDirectoryWriteAccess()) {
          throw new Error("请先选择 Music Room 的项目根目录。 ");
        }
        const imported = await importLocalPlaylistDirectoryTracks();
        playlist = createLocalPlaylist({
          title,
          description: newPlaylistDescription,
          trackIds: imported.tracks.map((track) => track.id),
          sourceDirectoryId: imported.sourceDirectoryId,
          sourceDirectoryName: imported.directoryName
        });
      } else {
        playlist = await musicRoomApi.createPlaylist({
          title,
          description: newPlaylistDescription.trim() || null,
          tags: ["network"],
          isCollaborative: false
        });
      }
      await refresh();
      setCreateDialogKind(null);
      setNewPlaylistTitle("");
      setNewPlaylistDescription("");
      if (kind === "local") {
        setSelectedPlaylist({ kind: "local", playlist: playlist as LocalPlaylistRecord });
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
        if (target.playlist.id === defaultLocalPlaylistId) {
          throw new Error("默认本地歌单不能删除。 ");
        }
        deleteLocalPlaylist(target.playlist.id);
        const databasePlaylistId = localPlaylistDatabaseIds[target.playlist.id];
        if (databasePlaylistId) {
          await musicRoomApi.deletePlaylist(databasePlaylistId);
        }
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
        await syncLocalPlaylistToDatabase(updated, localPlaylistDatabaseIds[target.playlist.id]);
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

  async function moveTrackToPlaylist(request: TrackMoveRequest, target: PlaylistSelection) {
    if (pending) return;
    if (request.source.kind === target.kind && request.source.playlist.id === target.playlist.id) {
      setMoveTarget(null);
      return;
    }

    setPending(true);
    setMessage(null);
    setStatusMessage(null);
    try {
      const trackId = request.track.id;
      if (target.kind === "local") {
        const targetPlaylist = listLocalPlaylists().find((playlist) => playlist.id === target.playlist.id);
        if (!targetPlaylist) throw new Error("目标本地歌单不存在，请刷新后重试。");
        await upsertLocalPlaylistTrack(request.track);
        if (!targetPlaylist.trackIds.includes(trackId)) {
          const updatedTarget = updateLocalPlaylist(targetPlaylist.id, { trackIds: [...targetPlaylist.trackIds, trackId] });
          if (updatedTarget) await syncLocalPlaylistToDatabase(updatedTarget, localPlaylistDatabaseIds[targetPlaylist.id]);
        }
      } else {
        if (!request.track.providerTrackId || request.track.provider === "local_upload") {
          throw new Error("本地上传歌曲只能移动到本地歌单。");
        }
        if (!target.playlist.trackIds.includes(trackId)) {
          await musicRoomApi.updatePlaylist(target.playlist.id, {
            trackIds: [...target.playlist.trackIds, trackId]
          });
        }
      }

      if (request.source.kind === "local") {
        const sourcePlaylist = listLocalPlaylists().find((playlist) => playlist.id === request.source.playlist.id);
        if (!sourcePlaylist) throw new Error("来源本地歌单不存在，请刷新后重试。");
        let updatedSource = sourcePlaylist;
        updatedSource = updateLocalPlaylist(sourcePlaylist.id, {
          trackIds: sourcePlaylist.trackIds.filter((id) => id !== trackId)
        }) ?? sourcePlaylist;
        await syncLocalPlaylistToDatabase(updatedSource, localPlaylistDatabaseIds[sourcePlaylist.id]);
        await refresh();
        setSelectedPlaylist({ kind: "local", playlist: updatedSource });
      } else {
        const updatedSource = await musicRoomApi.updatePlaylist(request.source.playlist.id, {
          trackIds: request.source.playlist.trackIds.filter((id) => id !== trackId)
        });
        await refresh();
        setSelectedPlaylist({ kind: "network", playlist: updatedSource });
      }

      setMoveTarget(null);
      setStatusMessage(`《${request.track.title}》已移动到“${target.playlist.title}”。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移动歌曲失败，请重试。");
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
            networkArtworkUrls={selectedPlaylist.kind === "network" ? networkArtworkById[selectedPlaylist.playlist.id] : null}
            player={player}
            roomTrackIndex={roomTrackIndex}
            selection={selectedPlaylist}
            pending={pending}
            onBack={() => setSelectedPlaylist(null)}
            onArtworkResolved={selectedPlaylist.kind === "network"
              ? (artworkUrl) => setNetworkArtworkById((current) => ({
                  ...current,
                  [selectedPlaylist.playlist.id]: uniqueArtworkUrls([
                    ...(current[selectedPlaylist.playlist.id] ?? []),
                    artworkUrl
                  ])
                }))
              : undefined}
            onTrackUpdated={(track) => setLocalTracks((current) => {
              const index = current.findIndex((item) => item.id === track.id);
              if (index < 0) return [...current, track];
              const next = [...current];
              next[index] = track;
              return next;
            })}
            onUpdateTracks={(trackIds) => void updatePlaylistTracks(selectedPlaylist, trackIds)}
            onMoveTrack={(track, anchor) => setMoveTarget({ anchor, track, source: selectedPlaylist })}
            onDelete={selectedPlaylist.kind === "local" && selectedPlaylist.playlist.id !== defaultLocalPlaylistId
              ? () => setDeleteTarget({ kind: "local", playlist: selectedPlaylist.playlist })
              : selectedPlaylist.kind === "network"
                ? () => setDeleteTarget({ kind: "network", playlist: selectedPlaylist.playlist })
                : undefined}
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
                  <Button onClick={() => void openCreateDialog("local")} size="sm" variant="outline" type="button">
                    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 5v14M5 12h14" /></svg>
                    新建本地歌单
                  </Button>
                </div>
                {localPlaylists.length ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                    {localPlaylists.map((playlist) => (
                      <LocalPlaylistCard
                        key={playlist.id}
                        onDelete={playlist.id === defaultLocalPlaylistId ? undefined : () => setDeleteTarget({ kind: "local", playlist })}
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
                  <Button onClick={() => void openCreateDialog("network")} size="sm" variant="outline" type="button">
                    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 5v14M5 12h14" /></svg>
                    新建网络歌单
                  </Button>
                </div>
                {networkPlaylists.length ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                    {networkPlaylists.map((playlist) => (
                      <NetworkPlaylistCard
                        key={playlist.id}
                        onDelete={() => setDeleteTarget({ kind: "network", playlist })}
                        onOpen={() => setSelectedPlaylist({ kind: "network", playlist })}
                        playlist={playlist}
                        artworkUrls={uniqueArtworkUrls([
                          ...(networkArtworkById[playlist.id] ?? []),
                          ...getPlaylistArtworkCandidates(playlist, roomTrackIndex, localTracks)
                        ])}
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
        {moveTarget ? (
          <PlaylistMoveDialog
            localPlaylists={localPlaylists}
            networkPlaylists={networkPlaylists}
            onCancel={() => {
              if (!pending) setMoveTarget(null);
            }}
            onSelect={(target) => void moveTrackToPlaylist(moveTarget, target)}
            pending={pending}
            source={moveTarget.source}
            track={moveTarget.track}
            anchor={moveTarget.anchor}
          />
        ) : null}
      </div>
    </main>
  );
}

function mergeLocalPlaylistsWithDatabase(
  localPlaylists: LocalPlaylistRecord[],
  databasePlaylists: Playlist[]
) {
  const merged = new Map(localPlaylists.map((playlist) => [playlist.id, playlist]));
  for (const databasePlaylist of databasePlaylists) {
    const localId = localPlaylistIdFromMirror(databasePlaylist);
    if (!localId || merged.has(localId)) continue;
    merged.set(localId, {
      id: localId,
      title: databasePlaylist.title,
      description: databasePlaylist.description,
      trackIds: databasePlaylist.trackIds,
      sourceDirectoryId: null,
      sourceDirectoryName: null,
      createdAt: databasePlaylist.createdAt,
      updatedAt: databasePlaylist.updatedAt
    });
  }
  return [...merged.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function syncLocalPlaylistsToDatabase(
  localPlaylists: LocalPlaylistRecord[],
  databasePlaylists: Playlist[]
) {
  const databaseByLocalId = new Map(
    databasePlaylists
      .map((playlist) => [localPlaylistIdFromMirror(playlist), playlist] as const)
      .filter((entry): entry is readonly [string, Playlist] => !!entry[0])
  );
  const ids: Record<string, string> = {};
  for (const playlist of localPlaylists) {
    const existing = databaseByLocalId.get(playlist.id);
    const synced = await syncLocalPlaylistToDatabase(playlist, existing?.id, existing);
    ids[playlist.id] = synced.id;
  }
  return ids;
}

function LocalTrackRow({
  track,
  index,
  isCurrent,
  isPlayable,
  isQueued,
  onAddToQueue,
  onDownload,
  onMove,
  onPlay,
  onRemove,
  isDownloading = false,
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
  onDownload?: () => void;
  onMove?: (event: MouseEvent<HTMLButtonElement>) => void;
  onPlay: () => void;
  onRemove?: () => void;
  isDownloading?: boolean;
  draggable?: boolean;
  isDragTarget?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <article
      className={`grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 border-b border-surface-border px-4 py-3 last:border-b-0 hover:bg-surface-hover/50 sm:grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,0.8fr)_7rem_auto] ${isCurrent ? "bg-accent/10" : ""} ${isDragTarget ? "border-accent/60 bg-accent/10" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
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
      <div className="col-start-2 flex shrink-0 items-center justify-end gap-1 sm:col-auto">
        {onDownload ? (
          <Button
            aria-label={track.availableOffline ? `《${track.title}》已下载` : `下载《${track.title}》`}
            className="h-8 w-8"
            disabled={track.availableOffline || isDownloading}
            onClick={onDownload}
            size="icon"
            title={track.availableOffline ? "已下载" : isDownloading ? "下载中" : "下载到本地"}
            type="button"
            variant="ghost"
          >
            {isDownloading ? (
              <svg aria-hidden="true" className="animate-spin" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
            ) : (
              <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>
            )}
          </Button>
        ) : null}
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
        {onMove ? (
          <Button
            aria-label={`移动《${track.title}》到其他歌单`}
            className="h-8 w-8"
            disabled={!track.providerTrackId && track.provider !== "local_upload"}
            onClick={onMove}
            size="icon"
            title="移动到其他歌单"
            type="button"
            variant="ghost"
          >
            <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M5 7h10M11 3l4 4-4 4M19 17H9m4-4-4 4 4 4" /></svg>
          </Button>
        ) : null}
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
  onOpen,
  onDelete,
  playlist,
  tracks
}: {
  onOpen: () => void;
  onDelete?: () => void;
  playlist: LocalPlaylistRecord;
  tracks: LocalPlaylistTrackRecord[];
}) {
  const artworkUrls = getTrackArtworkUrls(tracks);
  const downloadedCount = tracks.filter((track) => track.availableOffline).length;

  return (
    <article className="group relative min-w-0">
      <button
        aria-label={`打开本地歌单 ${playlist.title}`}
        className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        onClick={onOpen}
        type="button"
      >
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-surface shadow-[0_12px_28px_rgba(0,0,0,0.18)] transition-transform duration-200 group-hover:-translate-y-1">
          <Artwork artworkUrls={artworkUrls} title={playlist.title} size="cover" />
          <span className="absolute bottom-3 left-3 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-sm">本地</span>
        </div>
        <div className="min-w-0 px-1 pt-3">
          <strong className="block truncate text-[15px] font-semibold text-foreground">{playlist.title}</strong>
          <p className="mt-1 truncate text-sm text-foreground-muted">{tracks.length} 首歌曲 · 已下载 {downloadedCount}</p>
        </div>
      </button>
      {onDelete ? (
        <Button
          aria-label={`删除本地歌单 ${playlist.title}`}
          className="absolute right-2 top-2 h-8 w-8 bg-black/60 text-white/80 opacity-100 backdrop-blur-sm transition-opacity hover:bg-red-500/80 hover:text-white sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
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

function NetworkPlaylistCard({ playlist, artworkUrls, onOpen, onDelete }: { playlist: Playlist; artworkUrls: readonly string[]; onOpen: () => void; onDelete: () => void }) {
  const source = getNetworkPlaylistSource(playlist);
  const providerName = source?.provider === "qqmusic" ? "QQ 音乐" : source?.provider === "netease" ? "网易云音乐" : "网络歌单";

  return (
    <article className="group relative min-w-0">
      <button
        aria-label={`打开歌单 ${playlist.title}`}
        className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        onClick={onOpen}
        type="button"
      >
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-surface shadow-[0_12px_28px_rgba(0,0,0,0.18)] transition-transform duration-200 group-hover:-translate-y-1">
          <Artwork artworkUrls={artworkUrls} title={playlist.title} size="cover" />
        </div>
        <div className="min-w-0 px-1 pt-3">
          <strong className="block truncate text-[15px] font-semibold text-foreground">{playlist.title}</strong>
          <p className="mt-1 truncate text-sm text-foreground-muted">{providerName} · {playlist.trackIds.length} 首歌曲</p>
        </div>
      </button>
      <Button
        aria-label={`删除歌单 ${playlist.title}`}
        className="absolute right-2 top-2 h-8 w-8 bg-black/60 text-white/80 opacity-100 backdrop-blur-sm transition-opacity hover:bg-red-500/80 hover:text-white sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
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
  networkArtworkUrls,
  roomTrackIndex,
  player,
  selection,
  onBack,
  onDelete,
  onArtworkResolved,
  onTrackUpdated,
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
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ completed: 0, total: 0 });
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

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
    const load = networkProvider === "netease"
      ? musicRoomApi.getNeteasePlaylist(networkPlaylistId)
      : musicRoomApi.getQqMusicPlaylist(networkPlaylistId);
    void load
      .then((detail) => {
        if (cancelled) return;
        setRemoteTracks(detail.tracks.map((track) => {
          const trackId = providerTrackKey(track.provider, track.providerTrackId);
          return toProviderTrackRecord(track, roomTrackIndex.get(trackId));
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
  const remoteTrackMap = new Map(remoteTracks.map((track) => [track.id, track]));
  const localTrackMap = new Map(localTracks.map((track) => [track.id, track]));
  const networkTracks = (networkPlaylist?.trackIds ?? []).map((trackId, index) => ({
    track: remoteTrackMap.get(trackId)
      ?? (trackId.startsWith("local:") ? remoteTracks[index] : undefined)
      ?? roomTrackIndex.get(trackId)
      ?? localTrackMap.get(trackId),
    index,
    trackId
  }));
  const artworkUrls = isLocal
    ? getTrackArtworkUrls(localPlaylistTracks)
    : uniqueArtworkUrls([
        ...(networkArtworkUrls ?? []),
        ...(networkPlaylist ? getPlaylistArtworkCandidates(networkPlaylist, roomTrackIndex, localTracks) : []),
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

  const sequenceTracks = rows
    .map((row) => row.track)
    .filter((track): track is LocalPlaylistTrackRecord => Boolean(track))
    .filter((track, index, list) => list.findIndex((candidate) => candidate.id === track.id) === index);
  const playableTracks = sequenceTracks.filter((track) => player.isTrackPlayable(track));
  const downloadableTracks = sequenceTracks.filter((track) =>
    (track.provider === "netease" || track.provider === "qqmusic") &&
    !!track.providerTrackId &&
    !track.availableOffline
  );
  const showBatchDownload = sequenceTracks.length > 0 && (!isLocal || downloadableTracks.length > 0);
  const sequenceIndexById = new Map(sequenceTracks.map((track, index) => [track.id, index]));

  async function downloadTrack(track: LocalPlaylistTrackRecord) {
    const provider = track.provider === "netease" || track.provider === "qqmusic" ? track.provider : null;
    if (!provider || !track.providerTrackId || track.availableOffline || downloadTrackId) return false;
    setDownloadTrackId(track.id);
    setDownloadMessage(null);
    try {
      const resolvedTrack = await resolveProviderArtwork(track, provider);
      if (resolvedTrack.artworkUrl) {
        onArtworkResolved?.(resolvedTrack.artworkUrl);
        onTrackUpdated?.(resolvedTrack);
      }
      await ensureLocalAudioDirectoryWriteAccess();
      const response = provider === "netease"
        ? await musicRoomApi.downloadNeteaseTrack(resolvedTrack.providerTrackId!)
        : await musicRoomApi.downloadQqMusicTrack(resolvedTrack.providerTrackId!);
      const fileHash = await hashAudioBlob(response.blob);
      const mimeType = normalizeLocalAudioMimeType(response.contentType || response.blob.type);
      const lyricPayload = resolvedTrack.lyrics
        ? null
        : await (provider === "netease"
          ? musicRoomApi.getNeteaseLyrics(resolvedTrack.providerTrackId!)
          : musicRoomApi.getQqMusicLyrics(resolvedTrack.providerTrackId!)
        ).catch(() => null);
      const lyrics = resolvedTrack.lyrics ?? lyricPayload?.plainLyric ?? null;
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
          provider,
          providerTrackId: resolvedTrack.providerTrackId,
          durationMs: resolvedTrack.durationMs,
          sizeBytes: response.blob.size
        }
      });
      const updatedTrack: LocalPlaylistTrackRecord = {
        ...resolvedTrack,
        fileHash,
        fileName: saved.fileName,
        sizeBytes: response.blob.size,
        mimeType,
        lyrics,
        availableOffline: true,
        updatedAt: new Date().toISOString()
      };
      await upsertLocalPlaylistTrack(updatedTrack);
      onTrackUpdated?.(updatedTrack);
      setRemoteTracks((current) => current.map((item) => item.id === updatedTrack.id ? updatedTrack : item));
      setDownloadMessage(`《${resolvedTrack.title}》已下载到本地目录。`);
      return true;
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : "歌曲下载失败，请重试。" );
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
        <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m15 18-6-6 6-6" /></svg>
        返回歌单
      </Button>

      <div className="flex flex-col gap-4 border-b border-surface-border pb-5 sm:flex-row sm:items-end">
        <Artwork artworkUrls={artworkUrls} title={title} size="lg" />
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
        {showBatchDownload ? (
          <Button
            disabled={isDownloadingAll || downloadTrackId !== null || downloadableTracks.length === 0}
            onClick={() => void downloadAllTracks()}
            type="button"
            variant="outline"
          >
            <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>
            {isDownloadingAll ? `下载中 ${downloadProgress.completed}/${downloadProgress.total}` : downloadableTracks.length > 0 ? "一键下载" : "已全部下载"}
          </Button>
        ) : null}
        <Button disabled={playableTracks.length === 0} onClick={() => void player.playTracks(sequenceTracks, 0)} type="button">
          <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M8 5v14l11-7z" /></svg>
          播放全部
        </Button>
      </div>

      {downloadMessage ? <p className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300" role="status">{downloadMessage}</p> : null}

      <div className="mt-6 overflow-hidden rounded-2xl border border-surface-border bg-surface/25">
        <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-surface-border px-4 py-3 text-xs text-foreground-muted sm:grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,0.8fr)_7rem_auto]">
          <span>#</span><span>标题</span><span className="hidden sm:block">专辑</span><span className="hidden text-right sm:block">时长</span><span aria-hidden="true" className="hidden sm:block" />
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
               isDragTarget={dragOverTrackId === trackId}
              key={`${selection.kind}:${track.id}`}
              onAddToQueue={() => player.addToQueue(track)}
              onDownload={track.providerTrackId && (track.provider === "netease" || track.provider === "qqmusic")
                ? () => void downloadTrack(track)
                : undefined}
              isDownloading={downloadTrackId === track.id}
              onDragEnd={() => {
                setDraggingTrackId(null);
                setDragOverTrackId(null);
              }}
               onDragOver={() => setDragOverTrackId(trackId)}
               onDragStart={() => setDraggingTrackId(trackId)}
               onDrop={() => reorderTracks(trackId)}
              onMove={(event) => onMoveTrack?.(track, getAnchoredDialogAnchor(event.currentTarget))}
               onRemove={canEditTracks ? () => onUpdateTracks(currentTrackIds.filter((itemTrackId) => itemTrackId !== trackId)) : undefined}
              onPlay={() => {
                const sequenceIndex = sequenceIndexById.get(track.id);
                if (sequenceIndex !== undefined) void player.playTracks(sequenceTracks, sequenceIndex);
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

function Artwork({ artworkUrl, artworkUrls, title, size = "sm" }: {
  artworkUrl?: string | null;
  artworkUrls?: readonly (string | null | undefined)[];
  title: string;
  size?: "sm" | "lg" | "row" | "cover";
}) {
  const sizeClass = size === "cover"
    ? "aspect-square w-full rounded-none"
    : size === "lg"
      ? "h-24 w-24 rounded-xl"
      : size === "row"
        ? "h-16 w-16 rounded-lg"
      : "h-10 w-10 rounded-lg";
  const sources = uniqueArtworkUrls([...(artworkUrls ?? []), artworkUrl]);
  const sourceKey = sources.join("\u001f");
  const [failedSourceIndex, setFailedSourceIndex] = useState(0);

  useEffect(() => {
    setFailedSourceIndex(0);
  }, [sourceKey]);

  const activeArtworkUrl = sources[failedSourceIndex] ?? null;

  return (
    <div
      aria-label={`${title} 封面`}
      className={`${sizeClass} flex shrink-0 items-center justify-center overflow-hidden border border-surface-border bg-surface text-lg font-bold text-foreground-muted`}
    >
      {activeArtworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className="h-full w-full object-cover"
          decoding="async"
          draggable={false}
          onError={() => setFailedSourceIndex((current) => current + 1)}
          src={activeArtworkUrl}
        />
      ) : title.slice(0, 1).toUpperCase()}
    </div>
  );
}

function getTrackArtworkUrls(tracks: readonly Pick<LocalPlaylistTrackRecord, "artworkUrl">[]) {
  return uniqueArtworkUrls(tracks.map((track) => track.artworkUrl));
}

function getPlaylistArtworkCandidates(
  playlist: Playlist,
  roomTrackIndex: ReadonlyMap<string, LocalPlaylistTrackRecord>,
  localTracks: readonly LocalPlaylistTrackRecord[] = []
) {
  const localTrackIndex = new Map(localTracks.map((track) => [track.id, track]));
  return uniqueArtworkUrls([
    playlist.coverUrl,
    ...playlist.trackIds.flatMap((trackId) => [
      roomTrackIndex.get(trackId)?.artworkUrl,
      localTrackIndex.get(trackId)?.artworkUrl
    ])
  ]);
}

function uniqueArtworkUrls(urls: readonly (string | null | undefined)[]) {
  const result: string[] = [];
  for (const value of urls) {
    if (typeof value !== "string") continue;
    const url = value.trim();
    if (!url) continue;
    const secureUrl = url.replace(/^http:\/\//i, "https://");
    if (!result.includes(secureUrl)) result.push(secureUrl);
    if (secureUrl !== url && !result.includes(url)) result.push(url);
  }
  return result;
}

async function resolveLegacyNetworkPlaylistArtwork(
  playlist: Playlist,
  roomTrackIndex: ReadonlyMap<string, LocalPlaylistTrackRecord>
) {
  const sources = playlist.trackIds
    .map((trackId) => parseProviderTrackSource(trackId))
    .filter((source): source is { provider: "netease" | "qqmusic"; trackId: string } => !!source)
    .slice(0, 4);
  if (sources.length === 0) return [];

  const resolvedArtwork = await Promise.all(sources.map(async (source) => {
    const cached = [...roomTrackIndex.values()].find((track) =>
      track.provider === source.provider && track.providerTrackId === source.trackId
    );
    if (cached?.artworkUrl) return cached.artworkUrl;
    try {
      const track = source.provider === "netease"
        ? await musicRoomApi.getNeteaseTrack(source.trackId)
        : await musicRoomApi.getQqMusicTrack(source.trackId);
      const resolved = toProviderTrackRecord(track, cached);
      if (resolved.artworkUrl) {
        try {
          await upsertLocalPlaylistTrack(resolved);
        } catch {
          // The remote candidate is still usable for the current render.
        }
      }
      return resolved.artworkUrl;
    } catch {
      return null;
    }
  }));
  return uniqueArtworkUrls(resolvedArtwork);
}

function parseProviderTrackSource(trackId: string) {
  const [, provider, ...trackIdParts] = trackId.split(":");
  if (provider !== "netease" && provider !== "qqmusic") return null;
  const resolvedTrackId = trackIdParts.join(":").trim();
  return resolvedTrackId ? { provider, trackId: resolvedTrackId } : null;
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
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  return playlist.trackIds
    .map((trackId) => trackMap.get(trackId))
    .filter((track): track is LocalPlaylistTrackRecord => Boolean(track));
}

async function resolveProviderArtwork(
  track: LocalPlaylistTrackRecord,
  provider: "netease" | "qqmusic"
) {
  if (track.artworkUrl || !track.providerTrackId) return track;
  try {
    const providerTrack = provider === "netease"
      ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
      : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
    return toProviderTrackRecord(providerTrack, track);
  } catch {
    return track;
  }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 px-4 py-6 backdrop-blur-sm" role="presentation">
      <form
        aria-labelledby={titleId}
        className="max-h-[calc(100dvh-3rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-[#151a21] p-5 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.72)] sm:p-6"
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
            <p className="mt-1 text-xs text-foreground-muted">{isLocal ? "创建时选择本地歌曲目录，歌单会直接读取所选目录中的歌曲。" : "网络歌单无需本地目录，可从搜索页保存网易云音乐或 QQ 音乐歌单。"}</p>
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

function PlaylistMoveDialog({
  anchor,
  track,
  source,
  localPlaylists,
  networkPlaylists,
  pending,
  onCancel,
  onSelect
}: {
  anchor: AnchoredDialogAnchor;
  track: LocalPlaylistTrackRecord;
  source: PlaylistSelection;
  localPlaylists: LocalPlaylistRecord[];
  networkPlaylists: Playlist[];
  pending: boolean;
  onCancel: () => void;
  onSelect: (target: PlaylistSelection) => void;
}) {
  const canMoveToNetwork = Boolean(track.providerTrackId && track.provider !== "local_upload");
  const options: PlaylistSelection[] = [
    ...localPlaylists.map((playlist) => ({ kind: "local" as const, playlist })),
    ...networkPlaylists.map((playlist) => ({ kind: "network" as const, playlist }))
  ];

  return (
    <AnchoredDialog
      anchor={anchor}
      ariaLabelledBy="playlist-move-title"
      className="max-w-md"
      onClose={onCancel}
    >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground" id="playlist-move-title">移动到歌单</h2>
            <p className="mt-1 truncate text-xs text-foreground-muted">《{track.title}》 · {track.artist}</p>
          </div>
          <Button aria-label="关闭" disabled={pending} onClick={onCancel} size="icon" type="button" variant="ghost">
            <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </Button>
        </div>

        {options.length ? (
          <div className="mt-5 space-y-2">
            {options.map((target) => {
              const isSource = source.kind === target.kind && source.playlist.id === target.playlist.id;
              const networkUnavailable = target.kind === "network" && !canMoveToNetwork;
              const disabled = pending || isSource || networkUnavailable;
              return (
                <button
                  aria-disabled={disabled}
                  className="flex w-full items-center gap-3 rounded-xl border border-surface-border bg-background/60 px-3 py-3 text-left transition-colors hover:border-accent/40 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={disabled}
                  key={`${target.kind}:${target.playlist.id}`}
                  onClick={() => onSelect(target)}
                  title={isSource ? "当前歌单" : networkUnavailable ? "本地上传歌曲只能移动到本地歌单" : undefined}
                  type="button"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="17"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10l2 2h6.5A1.5 1.5 0 0 1 20 7.5v10A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" /><path d="M8 12h8m-3-3 3 3-3 3" /></svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{target.playlist.title}</span>
                    <span className="mt-1 block truncate text-xs text-foreground-muted">
                      {`${target.playlist.trackIds.length} 首歌曲`}
                    </span>
                  </span>
                  <svg aria-hidden="true" className="shrink-0 text-foreground-muted" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-6 text-center text-sm text-foreground-muted">还没有可移动的歌单。</p>
        )}
    </AnchoredDialog>
  );
}

function DeletePlaylistDialog({ kind, playlist, pending, onConfirm, onCancel }: { kind: "local" | "network"; playlist: { title: string }; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  const label = kind === "local" ? "本地歌单" : "网络歌单";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 px-4 py-6 backdrop-blur-sm" role="presentation">
      <div aria-labelledby="delete-playlist-title" className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#151a21] p-5 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.72)] sm:p-6" role="dialog" aria-modal="true">
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
