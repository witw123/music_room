"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type {
  NeteaseAccountStatus,
  NeteaseTrackCandidate,
  ProviderAlbumDetail,
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
import { formatDuration } from "@/lib/music-room-ui";
import { useRouter } from "next/navigation";
import type { Route } from "next";

type Provider = "netease" | "qqmusic";
type Track = NeteaseTrackCandidate | QqMusicTrackCandidate;
type Account = NeteaseAccountStatus | QqMusicAccountStatus;
type ContentTab = "songs" | "playlists" | "albums";

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
  const [album, setAlbum] = useState<ProviderAlbumDetail | null>(null);
  const [albumId, setAlbumId] = useState("");
  const [contentTab, setContentTab] = useState<ContentTab>("songs");
  const [pending, setPending] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && !activeSession) router.replace(authEntryHref as Route);
  }, [activeSession, authEntryHref, hydrated, router]);

  useEffect(() => {
    if (!activeSession || !enabledProviders.includes(provider)) return;
    let cancelled = false;
    setAccount(null);
    setResults([]);
    setLyrics(null);
    setPlaylists([]);
    setPlaylist(null);
    setAlbum(null);
    setErrorMessage(null);
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

  async function loadPlaylists() {
    if (pending || !isConnected) return;
    setPending("playlists");
    setErrorMessage(null);
    setContentTab("playlists");
    try {
      const response = provider === "netease"
        ? await musicRoomApi.listNeteasePlaylists()
        : await musicRoomApi.listQqMusicPlaylists();
      setPlaylists(response.items);
      setPlaylist(null);
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

  async function loadAlbum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = albumId.trim();
    await loadAlbumById(id);
  }

  async function loadAlbumById(id: string) {
    if (!id || pending || !isConnected) return;
    setPending("album");
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

  async function loadAlbumForTrack(track: Track) {
    if (!track.providerAlbumId) return;
    setAlbumId(track.providerAlbumId);
    setContentTab("albums");
    await loadAlbumById(track.providerAlbumId);
  }

  if (!hydrated || !activeSession) return <div className="min-h-screen bg-black" />;

  return (
    <main className="relative min-h-screen overflow-hidden bg-black pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1280px] flex-col px-4 pb-10 pt-10 sm:px-6 sm:pt-12 md:mx-0 md:max-w-[1400px] md:px-8 md:pt-28">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-accent">Search</p>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">搜索音乐</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-foreground-muted">
              搜索歌曲并查看歌词、歌单和专辑详情。数据来自官方平台账号，播放仍由房间播放器处理。
            </p>
          </div>
          <Link className="text-sm text-accent hover:text-accent/80" href="/app/profile">管理平台账号</Link>
        </div>

        {enabledProviders.length > 0 ? (
          <>
            <div className="mt-6 flex w-full max-w-md gap-1 rounded-xl border border-surface-border bg-surface/40 p-1 sm:mt-8" role="tablist" aria-label="音乐平台">
              {enabledProviders.map((item) => (
                <button
                  key={item}
                  aria-selected={provider === item}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${provider === item ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
                  onClick={() => setProvider(item)}
                  role="tab"
                  type="button"
                >
                  {item === "netease" ? "网易云" : "QQ 音乐"}
                </button>
              ))}
            </div>

            <section className="mt-4 rounded-2xl border border-surface-border bg-surface/35 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">{providerName}</h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {isConnected ? `已绑定 ${account?.nickname ?? `${providerName}账号`}` : "尚未绑定账号，搜索前请先完成扫码绑定。"}
                  </p>
                </div>
                {!isConnected ? <Link className="text-xs text-accent hover:text-accent/80" href="/app/profile">前往个人中心绑定</Link> : null}
              </div>

              <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void searchTracks(event)}>
                <label className="sr-only" htmlFor="provider-search-input">搜索歌曲</label>
                <input
                  id="provider-search-input"
                  className="min-w-0 flex-1 rounded-lg border border-surface-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
                  disabled={!isConnected}
                  maxLength={100}
                  onChange={(event) => setKeywords(event.target.value)}
                  placeholder="搜索歌曲、歌手或专辑"
                  type="search"
                  value={keywords}
                />
                <Button disabled={!isConnected || !keywords.trim() || pending !== null} size="sm" type="submit">
                  {pending === "search" ? "搜索中…" : "搜索"}
                </Button>
              </form>
            </section>

            <div className="mt-6 flex flex-wrap gap-2 border-b border-surface-border pb-2" role="tablist" aria-label="搜索内容">
              <ContentTabButton active={contentTab === "songs"} onClick={() => setContentTab("songs")}>歌曲</ContentTabButton>
              <ContentTabButton active={contentTab === "playlists"} onClick={() => void loadPlaylists()}>歌单</ContentTabButton>
              <ContentTabButton active={contentTab === "albums"} onClick={() => setContentTab("albums")}>专辑</ContentTabButton>
            </div>

            {contentTab === "songs" ? (
              <SongsResults results={results} pending={pending} lyrics={lyrics} onLyrics={loadLyrics} onAlbum={loadAlbumForTrack} />
            ) : null}
            {contentTab === "playlists" ? (
              <PlaylistsContent playlists={playlists} playlist={playlist} pending={pending} onOpen={loadPlaylist} />
            ) : null}
            {contentTab === "albums" ? (
              <AlbumsContent albumId={albumId} album={album} pending={pending} onChange={setAlbumId} onSubmit={loadAlbum} />
            ) : null}
          </>
        ) : (
          <div className="mt-10 rounded-2xl border border-surface-border bg-surface/35 p-8 text-sm text-foreground-muted">当前没有启用网易云或 QQ 音乐。</div>
        )}

        {errorMessage ? <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">{errorMessage}</p> : null}
      </div>
    </main>
  );
}

function SongsResults({
  results,
  pending,
  lyrics,
  onLyrics,
  onAlbum
}: {
  results: Track[];
  pending: string | null;
  lyrics: ProviderLyrics | null;
  onLyrics: (track: Track) => Promise<void>;
  onAlbum: (track: Track) => Promise<void>;
}) {
  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
          <div className="min-w-0 overflow-hidden rounded-xl border border-surface-border">
            {results.length ? results.map((track) => (
          <article className="flex flex-col items-start justify-between gap-3 border-b border-surface-border bg-surface/25 px-3 py-3 last:border-b-0 sm:flex-row sm:items-center sm:px-4" key={`${track.provider}-${track.providerTrackId}`}>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium text-foreground">{track.title}</h3>
              <p className="mt-1 truncate text-xs text-foreground-muted">{track.artist} · {track.album ?? "未知专辑"} · {formatDuration(track.durationMs)}</p>
            </div>
            <div className="flex w-full shrink-0 flex-wrap items-center gap-1 sm:w-auto">
              <Button className="flex-1 sm:flex-none" disabled={pending !== null} onClick={() => void onLyrics(track)} size="sm" variant="ghost" type="button">
                {pending === `lyrics:${track.providerTrackId}` ? "加载中…" : "查看歌词"}
              </Button>
              {track.providerAlbumId ? <Button className="flex-1 sm:flex-none" disabled={pending !== null} onClick={() => void onAlbum(track)} size="sm" variant="ghost" type="button">专辑</Button> : null}
            </div>
          </article>
        )) : <p className="px-4 py-10 text-center text-sm text-foreground-muted">输入关键词开始搜索。</p>}
      </div>
      <div className="min-h-40 rounded-xl border border-surface-border bg-surface/25 p-4">
        <h2 className="text-sm font-semibold text-foreground">歌词</h2>
        {lyrics ? (
          <div className="mt-3 max-h-[32rem] overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-foreground-muted">{lyrics.plainLyric ?? "暂无歌词"}</div>
        ) : <p className="mt-3 text-xs leading-6 text-foreground-muted">从左侧歌曲查看歌词。</p>}
      </div>
    </section>
  );
}

function PlaylistsContent({
  playlists,
  playlist,
  pending,
  onOpen
}: {
  playlists: ProviderPlaylistSummary[];
  playlist: ProviderPlaylistDetail | null;
  pending: string | null;
  onOpen: (item: ProviderPlaylistSummary) => Promise<void>;
}) {
  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(260px,0.65fr)_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-xl border border-surface-border">
        {playlists.length ? playlists.map((item) => (
          <button className="flex w-full items-center justify-between gap-3 border-b border-surface-border bg-surface/25 px-4 py-3 text-left last:border-b-0 hover:bg-surface-hover" key={item.providerPlaylistId} onClick={() => void onOpen(item)} type="button">
            <span className="min-w-0 truncate text-sm text-foreground">{item.title}</span>
            <span className="shrink-0 text-xs text-foreground-muted">{item.trackCount} 首</span>
          </button>
        )) : <p className="px-4 py-10 text-center text-sm text-foreground-muted">点击“歌单”加载已收藏歌单。</p>}
      </div>
      <div className="rounded-xl border border-surface-border bg-surface/25 p-4">
        {playlist ? (
          <>
            <h2 className="text-base font-semibold text-foreground">{playlist.title}</h2>
            <p className="mt-1 text-xs text-foreground-muted">{playlist.description || "暂无简介"} · {playlist.tracks.length} 首</p>
            <div className="mt-4 max-h-[28rem] overflow-y-auto divide-y divide-surface-border">{playlist.tracks.map((track) => <p className="py-2 text-xs text-foreground-muted" key={track.providerTrackId}>{track.title} · {track.artist}</p>)}</div>
          </>
        ) : <p className="text-sm text-foreground-muted">选择左侧歌单查看详情。</p>}
        {pending?.startsWith("playlist:") ? <p className="mt-3 text-xs text-accent">歌单加载中…</p> : null}
      </div>
    </section>
  );
}

function AlbumsContent({
  albumId,
  album,
  pending,
  onChange,
  onSubmit
}: {
  albumId: string;
  album: ProviderAlbumDetail | null;
  pending: string | null;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <section className="mt-4 rounded-xl border border-surface-border bg-surface/25 p-4">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void onSubmit(event)}>
        <label className="sr-only" htmlFor="provider-album-id">专辑 ID</label>
        <input className="min-w-0 flex-1 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent" id="provider-album-id" onChange={(event) => onChange(event.target.value)} placeholder="输入专辑 ID" value={albumId} />
        <Button disabled={!albumId.trim() || pending !== null} size="sm" type="submit">{pending === "album" ? "加载中…" : "查看专辑"}</Button>
      </form>
      {album ? (
        <div className="mt-5">
          <h2 className="text-base font-semibold text-foreground">{album.title}</h2>
          <p className="mt-1 text-xs text-foreground-muted">{album.artist} · {album.releaseTime || "发行时间未知"} · {album.trackCount} 首</p>
          <div className="mt-4 max-h-[28rem] overflow-y-auto divide-y divide-surface-border">{album.tracks.map((track) => <p className="py-2 text-xs text-foreground-muted" key={track.providerTrackId}>{track.title} · {track.artist}</p>)}</div>
        </div>
      ) : <p className="mt-4 text-xs text-foreground-muted">专辑 ID 可从平台链接中获取。</p>}
    </section>
  );
}

function ContentTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button aria-selected={active} className={`rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-white/10 text-foreground" : "text-foreground-muted hover:text-foreground"}`} onClick={onClick} role="tab" type="button">{children}</button>;
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

function AppPageBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-black">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      <div className="absolute left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-fuchsia-600/10 blur-[150px]" />
    </div>
  );
}
