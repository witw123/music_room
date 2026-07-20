"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type {
  NeteaseAccountStatus,
  NeteaseTrackCandidate,
  Playlist,
  ProviderAlbumDetail,
  ProviderAlbumSummary,
  ProviderLyrics,
  ProviderPlaylistDetail,
  ProviderPlaylistSummary,
  QqMusicAccountStatus,
  QqMusicTrackCandidate
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";
import {
  isLocalPlaylistMirror,
  localPlaylistIdFromMirror,
  syncLocalPlaylistToDatabase
} from "@/lib/local-playlist-database";
import { formatDuration } from "@/lib/music-room-ui";
import {
  ensureLocalAudioDirectoryWriteAccess,
  saveAudioFileToLocalDirectory
} from "@/features/upload/local-audio-storage";
import {
  hashAudioBlob,
  listLocalPlaylists,
  restoreLocalPlaylistsFromRepository,
  localPlaylistTrackId,
  toProviderTrackRecord,
  toLocalPlaylistTrackInput,
  updateLocalPlaylist,
  type LocalPlaylistRecord
} from "@/features/playlist/local-playlist";
import {
  upsertLocalPlaylistTrack
} from "@/lib/indexeddb";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { AnchoredDialog, getAnchoredDialogAnchor, type AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";

type Provider = "netease" | "qqmusic";
type Track = NeteaseTrackCandidate | QqMusicTrackCandidate;
type Account = NeteaseAccountStatus | QqMusicAccountStatus;
type ContentTab = "songs" | "playlists" | "albums";
type PlaylistPickerOption =
  | { kind: "local"; playlist: LocalPlaylistRecord }
  | { kind: "network"; playlist: Playlist };

const enabledProviders: Provider[] = [
  ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
  ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : [])
];

export function ProviderSearchPage() {
  const router = useRouter();
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo: "/app/search" });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const defaultProvider = enabledProviders[0] ?? "netease";
  const [provider, setProvider] = useState<Provider>(defaultProvider);
  const [account, setAccount] = useState<Account | null>(null);
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [lyrics, setLyrics] = useState<ProviderLyrics | null>(null);
  const [playlists, setPlaylists] = useState<ProviderPlaylistSummary[]>([]);
  const [playlist, setPlaylist] = useState<ProviderPlaylistDetail | null>(null);
  const [albums, setAlbums] = useState<ProviderAlbumSummary[]>([]);
  const [album, setAlbum] = useState<ProviderAlbumDetail | null>(null);
  const [contentTab, setContentTab] = useState<ContentTab>("songs");
  const [pending, setPending] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [favoriteAlbumIds, setFavoriteAlbumIds] = useState<Set<string>>(new Set());
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(null);
  const [playlistPickerAnchor, setPlaylistPickerAnchor] = useState<AnchoredDialogAnchor | null>(null);
  const [playlistPickerOptions, setPlaylistPickerOptions] = useState<PlaylistPickerOption[]>([]);
  const [playlistPickerLoading, setPlaylistPickerLoading] = useState(false);

  useEffect(() => {
    if (hydrated && !activeSession) router.replace(authEntryHref as Route);
  }, [activeSession, authEntryHref, hydrated, router]);

  useEffect(() => {
    if (!activeSession) return;
    let cancelled = false;
    void musicRoomApi.listFavoriteAlbums()
      .then((items) => {
        if (!cancelled) {
          setFavoriteAlbumIds(new Set(items.map((item) => albumKey(item.provider, item.providerAlbumId))));
        }
      })
      .catch(() => {
        if (!cancelled) setFavoriteAlbumIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  useEffect(() => {
    if (!activeSession || !enabledProviders.includes(provider)) return;
    let cancelled = false;
    setAccount(null);
    setResults([]);
    setLyrics(null);
    setPlaylists([]);
    setPlaylist(null);
    setAlbums([]);
    setAlbum(null);
    setErrorMessage(null);
    setStatusMessage(null);
    const load = provider === "netease" ? musicRoomApi.getNeteaseAccount : musicRoomApi.getQqMusicAccount;
    void load()
      .then((nextAccount) => {
        if (!cancelled) setAccount(nextAccount);
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(toProviderErrorMessage(error, provider));
      });
    return () => {
      cancelled = true;
    };
  }, [activeSession, provider]);

  const isConnected = account?.connected === true;
  const providerName = provider === "netease" ? "网易云音乐" : "QQ 音乐";

  async function searchTracks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = keywords.trim();
    if (!query || pending || !isConnected) return;
    setPending("search");
    setErrorMessage(null);
    setContentTab("songs");
    try {
      const response = provider === "netease"
        ? await musicRoomApi.searchNeteaseTracks(query)
        : await musicRoomApi.searchQqMusicTracks(query);
      setResults(response.items);
      setLyrics(null);
      setStatusMessage(null);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  async function loadSearchPlaylists() {
    const query = keywords.trim();
    setContentTab("playlists");
    if (!query || pending || !isConnected) return;
    setPending("search-playlists");
    setErrorMessage(null);
    try {
      const response = provider === "netease"
        ? await musicRoomApi.searchNeteasePlaylists(query)
        : await musicRoomApi.searchQqMusicPlaylists(query);
      setPlaylists(response.items);
      setPlaylist(null);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  async function loadSearchAlbums() {
    const query = keywords.trim();
    setContentTab("albums");
    if (!query || pending || !isConnected) return;
    setPending("search-albums");
    setErrorMessage(null);
    try {
      const response = provider === "netease"
        ? await musicRoomApi.searchNeteaseAlbums(query)
        : await musicRoomApi.searchQqMusicAlbums(query);
      setAlbums(response.items);
      setAlbum(null);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  async function loadLyrics(track: Track) {
    if (pending) return;
    setPending(`lyrics:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      const nextLyrics = provider === "netease"
        ? await musicRoomApi.getNeteaseLyrics(track.providerTrackId)
        : await musicRoomApi.getQqMusicLyrics(track.providerTrackId);
      setLyrics(nextLyrics);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  async function getTrackLyrics(track: Track) {
    try {
      return track.provider === "netease"
        ? await musicRoomApi.getNeteaseLyrics(track.providerTrackId)
        : await musicRoomApi.getQqMusicLyrics(track.providerTrackId);
    } catch {
      return null;
    }
  }

  async function resolveTrackArtwork(track: Track) {
    if (track.artworkUrl) return track;
    try {
      return track.provider === "netease"
        ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
        : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
    } catch {
      return track;
    }
  }

  async function openPlaylistPicker(track: Track, anchor: AnchoredDialogAnchor) {
    if (pending) return;
    await restoreLocalPlaylistsFromRepository();
    setPlaylistPickerTrack(track);
    setPlaylistPickerAnchor(anchor);
    setPlaylistPickerLoading(true);
    setPlaylistPickerOptions(listLocalPlaylists().map((item) => ({ kind: "local", playlist: item })));
    setErrorMessage(null);
    setPending(`playlist-picker:${track.providerTrackId}`);
    try {
      const networkPlaylists = await musicRoomApi.listMyPlaylists();
      setPlaylistPickerOptions([
        ...listLocalPlaylists().map((item) => ({ kind: "local" as const, playlist: item })),
        ...networkPlaylists
          .filter((item) => !isLocalPlaylistMirror(item))
          .map((item) => ({ kind: "network" as const, playlist: item }))
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? `网络歌单加载失败：${error.message}` : "网络歌单加载失败，可先选择本地歌单。");
    } finally {
      setPlaylistPickerLoading(false);
      setPending(null);
    }
  }

  async function addTrackToPlaylist(option: PlaylistPickerOption) {
    const track = playlistPickerTrack;
    if (!track || pending) return;
    setPending(`add-playlist:${option.kind}:${option.playlist.id}:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      const resolvedTrack = await resolveTrackArtwork(track);
      const trackId = localPlaylistTrackId(resolvedTrack);
      if (option.kind === "local") {
        const trackLyrics = await getTrackLyrics(resolvedTrack);
        await upsertLocalPlaylistTrack(toLocalPlaylistTrackInput({ track: resolvedTrack, lyrics: trackLyrics }));
        const currentPlaylist = listLocalPlaylists().find((item) => item.id === option.playlist.id);
        if (!currentPlaylist) throw new Error("本地歌单不存在，请刷新后重试。");
        if (!currentPlaylist.trackIds.includes(trackId)) {
          const updatedPlaylist = updateLocalPlaylist(currentPlaylist.id, { trackIds: [...currentPlaylist.trackIds, trackId] });
          if (!updatedPlaylist) throw new Error("本地歌单更新失败，请重试。");
          const databasePlaylists = await musicRoomApi.listMyPlaylists();
          const databasePlaylist = databasePlaylists.find((item) => localPlaylistIdFromMirror(item) === updatedPlaylist.id);
          await syncLocalPlaylistToDatabase(updatedPlaylist, databasePlaylist?.id, databasePlaylist);
        }
        setStatusMessage(`《${resolvedTrack.title}》已加入“${currentPlaylist.title}”。`);
      } else {
        try {
          await upsertLocalPlaylistTrack(toProviderTrackRecord(resolvedTrack));
        } catch {
          // The network playlist remains authoritative when local metadata storage is unavailable.
        }
        if (option.playlist.trackIds.includes(trackId)) {
          setStatusMessage(`《${resolvedTrack.title}》已在“${option.playlist.title}”中。`);
        } else {
          await musicRoomApi.updatePlaylist(option.playlist.id, { trackIds: [...option.playlist.trackIds, trackId] });
          setStatusMessage(`《${resolvedTrack.title}》已加入“${option.playlist.title}”。`);
        }
      }
      setPlaylistPickerTrack(null);
      setPlaylistPickerAnchor(null);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  async function downloadToLocal(track: Track) {
    if (pending) return;
    setPending(`download:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      const resolvedTrack = await resolveTrackArtwork(track);
      await ensureLocalAudioDirectoryWriteAccess();
      const response = resolvedTrack.provider === "netease"
        ? await musicRoomApi.downloadNeteaseTrack(resolvedTrack.providerTrackId)
        : await musicRoomApi.downloadQqMusicTrack(resolvedTrack.providerTrackId);
      const fileHash = await hashAudioBlob(response.blob);
      const trackLyrics = await getTrackLyrics(resolvedTrack);
      const mimeType = response.contentType.startsWith("audio/") ? response.contentType : "audio/mpeg";
      const saved = await saveAudioFileToLocalDirectory({ file: response.blob, fileHash, title: resolvedTrack.title, mimeType });
      await upsertLocalPlaylistTrack(toLocalPlaylistTrackInput({
        track: resolvedTrack,
        lyrics: trackLyrics,
        fileHash,
        fileName: saved.fileName,
        sizeBytes: response.blob.size,
        mimeType,
        availableOffline: true
      }));
      setStatusMessage(`《${resolvedTrack.title}》已下载到本地目录。`);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  async function loadPlaylist(item: ProviderPlaylistSummary) {
    if (pending) return;
    setPending(`playlist:${item.providerPlaylistId}`);
    setErrorMessage(null);
    try {
      const detail = provider === "netease"
        ? await musicRoomApi.getNeteasePlaylist(item.providerPlaylistId)
        : await musicRoomApi.getQqMusicPlaylist(item.providerPlaylistId);
      setPlaylist(detail);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  async function saveProviderPlaylist(detail: ProviderPlaylistDetail) {
    if (pending) return;
    setPending(`save-playlist:${detail.provider}:${detail.providerPlaylistId}`);
    setErrorMessage(null);
    try {
      await musicRoomApi.createPlaylist({
        title: detail.title,
        description: detail.description,
        coverUrl: detail.artworkUrl ?? detail.tracks.find((track) => track.artworkUrl)?.artworkUrl ?? null,
        isCollaborative: false,
        tags: ["network", `network:${detail.provider}:${detail.providerPlaylistId}`],
        trackIds: detail.tracks.map((track) => `provider:${track.provider}:${track.providerTrackId}`)
      });
      await Promise.all(detail.tracks.map(async (track) => {
        try {
          await upsertLocalPlaylistTrack(toProviderTrackRecord(track));
        } catch {
          // The saved network playlist remains usable when local metadata storage is unavailable.
        }
      }));
      setStatusMessage(`《${detail.title}》已保存到网络歌单。`);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  async function loadAlbumById(id: string) {
    if (!id || pending || !isConnected) return;
    setPending(`album:${id}`);
    setErrorMessage(null);
    setContentTab("albums");
    try {
      const detail = provider === "netease"
        ? await musicRoomApi.getNeteaseAlbum(id)
        : await musicRoomApi.getQqMusicAlbum(id);
      setAlbum(detail);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  async function toggleFavoriteAlbum(item: ProviderAlbumSummary | ProviderAlbumDetail) {
    if (!activeSession) return;
    const id = albumKey(item.provider, item.providerAlbumId);
    setErrorMessage(null);
    try {
      if (favoriteAlbumIds.has(id)) {
        await musicRoomApi.deleteFavoriteAlbum(item.provider, item.providerAlbumId);
        setFavoriteAlbumIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setStatusMessage(`已取消收藏《${item.title}》。`);
      } else {
        await musicRoomApi.saveFavoriteAlbum({
          provider: item.provider,
          providerAlbumId: item.providerAlbumId,
          title: item.title,
          artist: item.artist,
          artworkUrl: item.artworkUrl,
          description: item.description,
          releaseTime: item.releaseTime,
          trackCount: item.trackCount
        });
        setFavoriteAlbumIds((current) => new Set(current).add(id));
        setStatusMessage(`已收藏《${item.title}》。`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "收藏操作失败，请稍后重试。");
    }
  }

  async function loadAlbumForTrack(track: Track) {
    if (track.providerAlbumId) await loadAlbumById(track.providerAlbumId);
  }

  if (!hydrated || !activeSession) return <div className="min-h-screen bg-[#111214]" />;

  return (
    <main className="min-h-screen bg-[#111214] pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground md:pl-60 lg:pb-28">
      <div className="mx-auto flex min-h-screen w-full max-w-[1320px] flex-col px-4 pb-12 pt-8 sm:px-7 sm:pt-10 md:px-10 md:pt-14">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Music library</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">搜索</h1>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/45">
            <span>{isConnected ? `${providerName} · ${account?.nickname ?? "已连接"}` : `${providerName}未连接`}</span>
            <Link className="text-accent hover:text-accent-hover" href="/app/profile">管理账号</Link>
          </div>
        </header>

        {enabledProviders.length > 0 ? (
          <>
            <form className="mt-8 flex min-h-14 gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.055] p-2 shadow-2xl" onSubmit={(event) => void searchTracks(event)}>
              <span className="flex w-11 shrink-0 items-center justify-center text-white/45"><Icon name="search" /></span>
              <label className="sr-only" htmlFor="provider-search-input">搜索歌曲、歌单或专辑</label>
              <input
                id="provider-search-input"
                className="min-w-0 flex-1 bg-transparent px-1 text-sm text-white outline-none placeholder:text-white/30"
                disabled={!isConnected}
                maxLength={100}
                onChange={(event) => setKeywords(event.target.value)}
                placeholder="搜索歌曲、歌手、歌单或专辑"
                type="search"
                value={keywords}
              />
              {enabledProviders.length > 1 ? (
                <select aria-label="选择音乐平台" className="hidden rounded-xl border border-white/[0.08] bg-[#202226] px-3 text-xs text-white/75 outline-none sm:block" onChange={(event) => setProvider(event.target.value as Provider)} value={provider}>
                  {enabledProviders.map((item) => <option key={item} value={item}>{item === "netease" ? "网易云" : "QQ 音乐"}</option>)}
                </select>
              ) : null}
              <Button className="rounded-xl px-5" disabled={!isConnected || !keywords.trim() || pending !== null} size="sm" type="submit">
                {pending === "search" ? "搜索中" : "搜索"}
              </Button>
            </form>

            <div className="mt-9 flex items-center gap-7 border-b border-white/[0.1]" role="tablist" aria-label="搜索结果类型">
              <SearchTab active={contentTab === "songs"} onClick={() => setContentTab("songs")}>单曲</SearchTab>
              <SearchTab active={contentTab === "playlists"} onClick={() => void loadSearchPlaylists()}>歌单</SearchTab>
              <SearchTab active={contentTab === "albums"} onClick={() => void loadSearchAlbums()}>专辑</SearchTab>
            </div>

            {!isConnected ? (
              <div className="mt-8 flex items-center justify-between gap-4 rounded-2xl border border-amber-300/20 bg-amber-200/[0.06] px-5 py-4 text-sm text-amber-100/80">
                <span>请先绑定 {providerName} 账号。</span>
                <Link className="shrink-0 text-xs font-semibold text-amber-200 hover:text-white" href="/app/profile">去绑定</Link>
              </div>
            ) : null}

            {contentTab === "songs" ? (
              <SongsResults results={results} pending={pending} lyrics={lyrics} onLyrics={loadLyrics} onAlbum={loadAlbumForTrack} onDownload={downloadToLocal} onImportPlaylist={openPlaylistPicker} />
            ) : null}
            {contentTab === "playlists" ? (
              <PlaylistsContent playlists={playlists} playlist={playlist} pending={pending} onOpen={loadPlaylist} onSave={saveProviderPlaylist} />
            ) : null}
            {contentTab === "albums" ? (
              <AlbumsContent albums={albums} album={album} pending={pending} favoriteAlbumIds={favoriteAlbumIds} onOpen={loadAlbumById} onBack={() => setAlbum(null)} onToggleFavorite={toggleFavoriteAlbum} />
            ) : null}
          </>
        ) : (
          <div className="mt-10 rounded-2xl border border-white/[0.1] bg-white/[0.04] p-8 text-sm text-white/55">当前没有启用音乐平台。</div>
        )}

        {statusMessage ? <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-xs text-emerald-200" role="status">{statusMessage}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-xs text-red-200" role="alert">{errorMessage}</p> : null}
      </div>
      {playlistPickerTrack && playlistPickerAnchor ? (
        <PlaylistPickerDialog
          anchor={playlistPickerAnchor}
          loading={playlistPickerLoading}
          options={playlistPickerOptions}
          pending={pending !== null}
          track={playlistPickerTrack}
          onClose={() => {
            if (!pending) {
              setPlaylistPickerTrack(null);
              setPlaylistPickerAnchor(null);
            }
          }}
          onSelect={(option) => void addTrackToPlaylist(option)}
        />
      ) : null}
    </main>
  );
}

function SongsResults({
  results,
  pending,
  lyrics,
  onLyrics,
  onAlbum,
  onDownload,
  onImportPlaylist
}: {
  results: Track[];
  pending: string | null;
  lyrics: ProviderLyrics | null;
  onLyrics: (track: Track) => Promise<void>;
  onAlbum: (track: Track) => Promise<void>;
  onDownload: (track: Track) => Promise<void>;
  onImportPlaylist: (track: Track, anchor: AnchoredDialogAnchor) => Promise<void>;
}) {
  return (
    <section className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
        <div className="hidden grid-cols-[42px_minmax(0,1.4fr)_minmax(120px,0.8fr)_90px_220px] gap-3 border-b border-white/[0.08] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30 md:grid">
          <span>#</span><span>单曲</span><span>歌手</span><span>时长</span><span className="text-right">操作</span>
        </div>
        {results.length ? results.map((track, index) => (
          <article className="grid gap-3 border-b border-white/[0.07] px-4 py-4 last:border-0 md:grid-cols-[42px_minmax(0,1.4fr)_minmax(120px,0.8fr)_90px_220px] md:items-center md:gap-3 md:px-5" key={`${track.provider}-${track.providerTrackId}`}>
            <span className="hidden text-sm tabular-nums text-white/25 md:block">{String(index + 1).padStart(2, "0")}</span>
            <div className="flex min-w-0 items-center gap-3">
              <Artwork alt={track.album ?? track.title} src={track.artworkUrl} size="sm" />
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-white/90">{track.title}</h3>
                <p className="mt-1 truncate text-xs text-white/40 md:hidden">{track.artist} · {track.album ?? "未知专辑"}</p>
              </div>
            </div>
            <span className="hidden truncate text-xs text-white/55 md:block">{track.artist}</span>
            <span className="hidden text-xs tabular-nums text-white/35 md:block">{formatDuration(track.durationMs)}</span>
            <div className="flex flex-wrap items-center justify-start gap-1 md:justify-end">
              <Button disabled={pending !== null} onClick={() => void onDownload(track)} size="sm" variant="ghost" type="button">{pending === `download:${track.providerTrackId}` ? "下载中" : "下载"}</Button>
              <Button disabled={pending !== null} onClick={(event) => void onImportPlaylist(track, getAnchoredDialogAnchor(event.currentTarget))} size="sm" variant="ghost" type="button">加入歌单</Button>
              <Button disabled={pending !== null} onClick={() => void onLyrics(track)} size="sm" variant="ghost" type="button">{pending === `lyrics:${track.providerTrackId}` ? "加载中" : "歌词"}</Button>
              {track.providerAlbumId ? <Button aria-label="打开专辑" disabled={pending !== null} onClick={() => void onAlbum(track)} size="icon" variant="ghost" type="button"><Icon name="album" /></Button> : null}
            </div>
          </article>
        )) : <EmptyState title="还没有搜索结果" description="输入关键词后按回车开始搜索。" />}
      </div>
      <aside className="min-h-[220px] rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white/85">歌词</h2>
          <span className="text-[10px] uppercase tracking-[0.14em] text-white/25">Lyrics</span>
        </div>
        {lyrics ? <div className="mt-5 max-h-[34rem] overflow-y-auto whitespace-pre-wrap text-center text-xs leading-7 text-white/60">{lyrics.plainLyric ?? "暂无歌词"}</div> : <p className="mt-5 text-xs leading-6 text-white/35">选择歌曲查看歌词。</p>}
      </aside>
    </section>
  );
}

function PlaylistsContent({
  playlists,
  playlist,
  pending,
  onOpen,
  onSave
}: {
  playlists: ProviderPlaylistSummary[];
  playlist: ProviderPlaylistDetail | null;
  pending: string | null;
  onOpen: (item: ProviderPlaylistSummary) => Promise<void>;
  onSave: (playlist: ProviderPlaylistDetail) => Promise<void>;
}) {
  return (
    <section className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {playlists.length ? playlists.map((item) => (
          <button className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] text-left transition hover:border-accent/50 hover:bg-white/[0.06]" key={`${item.provider}-${item.providerPlaylistId}`} onClick={() => void onOpen(item)} type="button">
            <Artwork alt={item.title} src={item.artworkUrl} className="aspect-[1.5] w-full rounded-none" size="lg" />
            <span className="block truncate px-4 pt-4 text-sm font-medium text-white/85">{item.title}</span>
            <span className="block truncate px-4 pb-4 pt-1 text-xs text-white/40">{item.creatorName ?? "网络歌单"} · {item.trackCount} 首</span>
          </button>
        )) : <div className="sm:col-span-2 xl:col-span-3"><EmptyState title="还没有歌单结果" description="在搜索框输入关键词，再打开歌单标签。" /></div>}
      </div>
      <div className="min-h-[300px] rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
        {playlist ? <>
          <div className="flex items-start gap-3"><Artwork alt={playlist.title} src={playlist.artworkUrl} size="md" /><div className="min-w-0"><h2 className="truncate text-base font-semibold text-white/90">{playlist.title}</h2><p className="mt-1 text-xs text-white/40">{playlist.tracks.length} 首歌曲</p></div></div>
          <p className="mt-4 line-clamp-3 text-xs leading-6 text-white/45">{playlist.description || "暂无简介"}</p>
          <Button className="mt-4" disabled={pending !== null} onClick={() => void onSave(playlist)} size="sm" type="button">{pending?.startsWith("save-playlist:") ? "保存中" : "保存到歌单"}</Button>
          <div className="mt-5 max-h-[28rem] overflow-y-auto divide-y divide-white/[0.07]">{playlist.tracks.map((track, index) => <p className="py-2 text-xs text-white/55" key={track.providerTrackId}>{String(index + 1).padStart(2, "0")}　{track.title} · {track.artist}</p>)}</div>
        </> : <EmptyState title="选择一个歌单" description="歌单详情会显示在这里。" />}
      </div>
    </section>
  );
}

function AlbumsContent({
  albums,
  album,
  pending,
  favoriteAlbumIds,
  onOpen,
  onBack,
  onToggleFavorite
}: {
  albums: ProviderAlbumSummary[];
  album: ProviderAlbumDetail | null;
  pending: string | null;
  favoriteAlbumIds: Set<string>;
  onOpen: (albumId: string) => Promise<void>;
  onBack: () => void;
  onToggleFavorite: (album: ProviderAlbumSummary | ProviderAlbumDetail) => Promise<void>;
}) {
  if (album) {
    const favoriteId = albumKey(album.provider, album.providerAlbumId);
    return (
      <section className="mt-7">
        <button className="inline-flex items-center gap-2 text-xs font-semibold text-white/50 transition hover:text-white" onClick={onBack} type="button"><Icon name="arrow-left" />返回专辑</button>
        <div className="mt-5 grid gap-7 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div><Artwork alt={album.title} src={album.artworkUrl} className="aspect-square w-full" size="lg" /><button aria-pressed={favoriteAlbumIds.has(favoriteId)} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition ${favoriteAlbumIds.has(favoriteId) ? "border-accent/50 bg-accent/15 text-accent-hover" : "border-white/[0.1] bg-white/[0.04] text-white/65 hover:border-accent/40 hover:text-white"}`} disabled={pending !== null} onClick={() => void onToggleFavorite(album)} type="button"><Icon name="heart" filled={favoriteAlbumIds.has(favoriteId)} />{favoriteAlbumIds.has(favoriteId) ? "已收藏" : "收藏专辑"}</button></div>
          <div className="min-w-0 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6"><p className="text-xs uppercase tracking-[0.2em] text-accent">Album</p><h2 className="mt-3 text-2xl font-bold text-white">{album.title}</h2><p className="mt-2 text-sm text-white/55">{album.artist} · {album.releaseTime || "发行时间未知"} · {album.trackCount} 首</p><p className="mt-5 max-w-2xl text-sm leading-7 text-white/45">{album.description || "暂无专辑简介"}</p><div className="mt-7 overflow-hidden rounded-xl border border-white/[0.07]">{album.tracks.length ? album.tracks.map((track, index) => <div className="grid grid-cols-[42px_minmax(0,1fr)_90px] items-center gap-3 border-b border-white/[0.07] px-4 py-3 last:border-0" key={track.providerTrackId}><span className="text-xs tabular-nums text-white/25">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><p className="truncate text-sm text-white/80">{track.title}</p><p className="mt-1 truncate text-xs text-white/35">{track.artist}</p></div><span className="text-right text-xs tabular-nums text-white/35">{formatDuration(track.durationMs)}</span></div>) : <p className="px-4 py-8 text-center text-xs text-white/35">暂无歌曲</p>}</div></div>
        </div>
      </section>
    );
  }

  return <section className="mt-7 grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{albums.length ? albums.map((item) => { const favoriteId = albumKey(item.provider, item.providerAlbumId); return <article className="group min-w-0" key={`${item.provider}-${item.providerAlbumId}`}><button className="block w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] text-left transition hover:border-accent/50 hover:bg-white/[0.06]" onClick={() => void onOpen(item.providerAlbumId)} type="button"><Artwork alt={item.title} src={item.artworkUrl} className="aspect-square w-full rounded-none" size="lg" /><span className="block truncate px-3 pt-3 text-sm font-medium text-white/85">{item.title}</span><span className="block truncate px-3 pb-4 pt-1 text-xs text-white/40">{item.artist}</span></button><button aria-label={favoriteAlbumIds.has(favoriteId) ? `取消收藏${item.title}` : `收藏${item.title}`} className={`mt-2 flex items-center gap-1.5 px-1 text-xs ${favoriteAlbumIds.has(favoriteId) ? "text-accent-hover" : "text-white/35 hover:text-white/70"}`} disabled={pending !== null} onClick={() => void onToggleFavorite(item)} type="button"><Icon name="heart" filled={favoriteAlbumIds.has(favoriteId)} />{favoriteAlbumIds.has(favoriteId) ? "已收藏" : "收藏"}</button></article>; }) : <div className="col-span-full"><EmptyState title="还没有专辑结果" description="在搜索框输入关键词，再打开专辑标签。" /></div>}</section>;
}

function albumKey(provider: Provider, providerAlbumId: string) {
  return `${provider}:${providerAlbumId}`;
}

function PlaylistPickerDialog({ anchor, loading, options, pending, track, onClose, onSelect }: { anchor: AnchoredDialogAnchor; loading: boolean; options: PlaylistPickerOption[]; pending: boolean; track: Track; onClose: () => void; onSelect: (option: PlaylistPickerOption) => void }) {
  const localOptions = options.filter((option) => option.kind === "local");
  const networkOptions = options.filter((option) => option.kind === "network");
  return <AnchoredDialog anchor={anchor} ariaLabelledBy="playlist-picker-title" className="max-w-md" onClose={onClose}>
    <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h2 className="text-lg font-semibold text-foreground" id="playlist-picker-title">选择目标歌单</h2><p className="mt-1 truncate text-xs text-foreground-muted">《{track.title}》 · {track.artist}</p></div><Button aria-label="关闭" disabled={pending} onClick={onClose} size="icon" type="button" variant="ghost"><Icon name="close" /></Button></div>
    {loading ? <p className="mt-6 text-center text-sm text-foreground-muted">正在加载可用歌单…</p> : null}
    {!loading && options.length === 0 ? <div className="mt-6 text-center"><p className="text-sm text-foreground-muted">还没有可添加的歌单。</p><Link className="mt-3 inline-block text-sm text-accent hover:text-accent/80" href="/app/playlists">前往歌单页创建</Link></div> : null}
    {localOptions.length ? <PlaylistPickerSection label="本地歌单" options={localOptions} pending={pending} onSelect={onSelect} /> : null}
    {networkOptions.length ? <PlaylistPickerSection label="网络歌单" options={networkOptions} pending={pending} onSelect={onSelect} /> : null}
  </AnchoredDialog>;
}

function PlaylistPickerSection({ label, options, pending, onSelect }: { label: string; options: PlaylistPickerOption[]; pending: boolean; onSelect: (option: PlaylistPickerOption) => void }) {
  return <section className="mt-5 first:mt-6"><h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground-muted">{label}</h3><div className="space-y-2">{options.map((option) => { const item = option.playlist; return <button className="flex w-full items-center gap-3 rounded-xl border border-surface-border bg-background/60 px-3 py-3 text-left transition-colors hover:border-accent/40 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50" disabled={pending} key={`${option.kind}:${item.id}`} onClick={() => onSelect(option)} type="button"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon name="music" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{item.title}</span><span className="mt-1 block truncate text-xs text-foreground-muted">{item.trackIds.length} 首歌曲</span></span><Icon name="chevron-right" /></button>; })}</div></section>;
}

function SearchTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button aria-selected={active} className={`relative px-1 pb-4 text-sm font-semibold transition ${active ? "text-white" : "text-white/40 hover:text-white/70"}`} onClick={onClick} role="tab" type="button">{children}{active ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" /> : null}</button>;
}

function Artwork({ alt, src, size, className = "" }: { alt: string; src: string | null | undefined; size: "sm" | "md" | "lg"; className?: string }) {
  const sizes = { sm: "h-10 w-10 rounded-lg", md: "h-20 w-20 rounded-xl", lg: "rounded-2xl" };
  return src ? <img alt={alt} className={`object-cover ${sizes[size]} ${className}`} loading="lazy" src={src} /> : <span aria-label={alt} className={`flex items-center justify-center bg-[linear-gradient(135deg,#252a32,#15171b)] text-white/25 ${sizes[size]} ${className}`}><Icon name="music" /></span>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.12] px-6 text-center"><Icon name="search" /><p className="mt-4 text-sm font-medium text-white/60">{title}</p><p className="mt-2 text-xs text-white/30">{description}</p></div>;
}

function Icon({ name, filled = false }: { name: "search" | "heart" | "album" | "arrow-left" | "close" | "music" | "chevron-right"; filled?: boolean }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: filled ? "currentColor" : "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" /></svg>;
  if (name === "album") return <svg {...common}><rect height="14" rx="2" width="14" x="5" y="5" /><circle cx="12" cy="12" r="3" /><path d="M12 9v6M9 12h6" /></svg>;
  if (name === "arrow-left") return <svg {...common}><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "chevron-right") return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  return <svg {...common}><path d="M4 19.5V5.8a1.8 1.8 0 0 1 2.4-1.7l12 4.5a1.8 1.8 0 0 1 1.2 1.7v8.2" /><circle cx="8" cy="19" r="2.5" /><circle cx="18" cy="17" r="2.5" /></svg>;
}

function toProviderErrorMessage(error: unknown, provider: Provider) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "NETEASE_ACCOUNT_REQUIRED" || error.code === "QQMUSIC_ACCOUNT_REQUIRED") return "请先在个人中心绑定对应平台账号。";
    if (error.code === "NETEASE_AUTH_EXPIRED" || error.code === "QQMUSIC_AUTH_EXPIRED") return "平台登录已失效，请回个人中心重新绑定。";
    if (error.code === "NETEASE_DISABLED" || error.code === "QQMUSIC_DISABLED") return "该音乐平台当前未启用。";
    return error.message;
  }
  return error instanceof Error ? error.message : `${provider === "netease" ? "网易云" : "QQ 音乐"}操作失败，请稍后重试。`;
}
