"use client";

import { memo, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type {
  AuthSession,
  NeteaseAccountStatus,
  NeteaseTrackCandidate,
  Playlist,
  QqMusicAccountStatus,
  QqMusicTrackCandidate,
  TrackMeta
} from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import type { CachedLibraryTrack } from "@/features/upload/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import { musicRoomApi } from "@/lib/music-room-api";
import { PlaylistPanel } from "./PlaylistPanel";
import { LocalPlaylistPanel } from "./LocalPlaylistPanel";

type Provider = "netease" | "qqmusic";
type ProviderTrack = NeteaseTrackCandidate | QqMusicTrackCandidate;

const enabledSearchProviders: Provider[] = [
  ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
  ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : [])
];

type LocalStorageTabPanelProps = {
  tracks: TrackMeta[];
  playlists: Playlist[];
  activeSession: AuthSession | null;
  localStorageSummary: LocalStorageSummary;
  onCleanLocalStorage: () => Promise<void>;
  onChooseLocalFolder: () => Promise<void>;
  onRefreshLocalStorage: () => Promise<void>;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onUpdatePlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
};

function LocalStorageTabPanelBase({
  tracks,
  playlists,
  activeSession,
  localStorageSummary,
  onChooseLocalFolder,
  onImportCachedTrack,
  onSavePlaylistFromQueue,
  onLoadPlaylistIntoRoom,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onUpdatePlaylistTitle,
  onUpdatePlaylistTracks,
  onDeletePlaylist
}: LocalStorageTabPanelProps) {
  const [pendingCachedImport, setPendingCachedImport] = useState<string | null>(null);
  const [playlistTab, setPlaylistTab] = useState<"local" | "network">("local");

  const handleImportCachedTrack = async (track: CachedLibraryTrack) => {
    if (pendingCachedImport) return;
    setPendingCachedImport(track.fileHash);
    try {
      await onImportCachedTrack(track);
    } finally {
      setPendingCachedImport(null);
    }
  };

  return (
    <div className="animate-fade-in flex w-full flex-col gap-5">
      <div className="flex w-full max-w-xl gap-1 rounded-xl border border-surface-border bg-surface/40 p-1" role="tablist" aria-label="歌单类型">
        <button
          aria-selected={playlistTab === "local"}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${playlistTab === "local" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
          onClick={() => setPlaylistTab("local")}
          role="tab"
          type="button"
        >
          本地歌单
        </button>
        <button
          aria-selected={playlistTab === "network"}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${playlistTab === "network" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
          onClick={() => setPlaylistTab("network")}
          role="tab"
          type="button"
        >
          网络歌单
        </button>
      </div>
      {playlistTab === "local" ? <section className="flex flex-col gap-3" data-testid="local-playlist-section">
        <LocalPlaylistPanel
          localPlaylists={localStorageSummary.localPlaylists}
          localTracks={localStorageSummary.localPlaylistTracks}
          roomTracks={tracks}
          localFolderName={localStorageSummary.localFolderName}
          onChooseLocalFolder={onChooseLocalFolder}
          onImportCachedTrack={handleImportCachedTrack}
          pendingCachedImport={pendingCachedImport}
        />
      </section> : null}
      {playlistTab === "network" ? <section className="flex flex-col gap-3" data-testid="network-playlist-section">
        <NetworkPlaylistSearch
          roomTracks={tracks}
          onImportNeteaseTrack={onImportNeteaseTrack}
          onImportQqMusicTrack={onImportQqMusicTrack}
        />
        <PlaylistPanel
          activeSession={activeSession}
          canCreatePlaylist={!!activeSession}
          onDeletePlaylist={onDeletePlaylist}
          onLoadPlaylistIntoRoom={onLoadPlaylistIntoRoom}
          onImportNeteaseTrack={onImportNeteaseTrack}
          onImportQqMusicTrack={onImportQqMusicTrack}
          onSavePlaylistFromQueue={onSavePlaylistFromQueue}
          onUpdatePlaylistTitle={onUpdatePlaylistTitle}
          onUpdatePlaylistTracks={onUpdatePlaylistTracks}
          playlists={playlists}
          tracks={tracks}
        />
      </section> : null}
    </div>
  );
}

type ProviderAccount = NeteaseAccountStatus | QqMusicAccountStatus;

function NetworkPlaylistSearch({
  roomTracks,
  onImportNeteaseTrack,
  onImportQqMusicTrack
}: {
  roomTracks: TrackMeta[];
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [provider, setProvider] = useState<Provider>(enabledSearchProviders[0] ?? "netease");
  const [account, setAccount] = useState<ProviderAccount | null>(null);
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<ProviderTrack[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const searchRequestRef = useRef(0);

  useEffect(() => {
    if (!isExpanded || enabledSearchProviders.length === 0) return;
    let cancelled = false;
    searchRequestRef.current += 1;
    setAccount(null);
    setResults([]);
    setErrorMessage(null);
    const load = provider === "netease"
      ? musicRoomApi.getNeteaseAccount
      : musicRoomApi.getQqMusicAccount;
    void load()
      .then((nextAccount) => {
        if (!cancelled) setAccount(nextAccount);
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(toLocalSearchErrorMessage(error));
      });
    return () => {
      cancelled = true;
      searchRequestRef.current += 1;
    };
  }, [isExpanded, provider]);

  if (enabledSearchProviders.length === 0) {
    return (
      <section className="flex flex-col gap-1 border-b border-surface-border pb-3" data-testid="network-playlist-search">
        <span className="text-sm font-semibold text-foreground">搜索歌曲并导入曲库</span>
        <span className="text-xs text-foreground-muted">网易云音乐和 QQ 音乐当前未启用，请先在服务端配置对应平台。</span>
      </section>
    );
  }

  const providerName = provider === "netease" ? "网易云音乐" : "QQ 音乐";
  const isConnected = account?.connected === true;
  const libraryTrackIds = new Set(
    roomTracks
      .filter((track) => track.sourceType === provider && track.sourceRef?.provider === provider)
      .map((track) => track.sourceRef?.trackId)
      .filter((trackId): trackId is string => !!trackId)
  );

  const searchTracks = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = keywords.trim();
    if (!query || pending || !isConnected) return;
    setPending("search");
    setErrorMessage(null);
    setMessage(null);
    try {
      const response = provider === "netease"
        ? await musicRoomApi.searchNeteaseTracks(query)
        : await musicRoomApi.searchQqMusicTracks(query);
      const requestId = ++searchRequestRef.current;
      setResults(response.items);
      void enrichSearchResults(response.items)
        .then((enrichedResults) => {
          if (searchRequestRef.current === requestId) {
            setResults(enrichedResults);
          }
        })
        .catch(() => undefined);
      if (response.items.length === 0) setMessage("没有找到匹配的歌曲。");
    } catch (error) {
      setErrorMessage(toLocalSearchErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const importTrack = async (candidate: ProviderTrack) => {
    if (pending) return;
    setPending(`import:${candidate.providerTrackId}`);
    setErrorMessage(null);
    setMessage(null);
    try {
      if (candidate.provider === "netease") {
        await onImportNeteaseTrack(candidate);
      } else {
        await onImportQqMusicTrack(candidate);
      }
      setMessage(`《${candidate.title}》已导入曲库。`);
    } catch (error) {
      setErrorMessage(toLocalSearchErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  async function enrichSearchResults(items: ProviderTrack[]) {
    const missingArtwork = items.filter((track) => !track.artworkUrl);
    const albumIds = [...new Set(
      missingArtwork
        .map((track) => track.providerAlbumId)
        .filter((albumId): albumId is string => !!albumId)
    )].slice(0, 12);
    const artworkByAlbumId = new Map<string, string>();

    await Promise.all(albumIds.map(async (albumId) => {
      try {
        const album = provider === "netease"
          ? await musicRoomApi.getNeteaseAlbum(albumId)
          : await musicRoomApi.getQqMusicAlbum(albumId);
        if (album.artworkUrl) artworkByAlbumId.set(albumId, album.artworkUrl);
      } catch {
        // Search results remain usable when a provider album endpoint is unavailable.
      }
    }));

    const tracksWithoutAlbum = missingArtwork
      .filter((track) => !track.providerAlbumId)
      .slice(0, 6);
    const artworkByTrackId = new Map<string, string>();
    await Promise.all(tracksWithoutAlbum.map(async (track) => {
      try {
        const detail = track.provider === "netease"
          ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
          : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
        if (detail.artworkUrl) artworkByTrackId.set(track.providerTrackId, detail.artworkUrl);
      } catch {
        // Keep the search candidate when detail lookup fails.
      }
    }));

    return items.map((track) => ({
      ...track,
      artworkUrl: track.artworkUrl
        ?? (track.providerAlbumId ? artworkByAlbumId.get(track.providerAlbumId) : undefined)
        ?? artworkByTrackId.get(track.providerTrackId)
        ?? null
    }));
  }

  return (
    <section className="flex flex-col gap-3 border-b border-surface-border pb-3" data-testid="network-playlist-search">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((current) => !current)}
        className="flex items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-foreground">搜索歌曲并导入曲库</span>
          <span className="mt-1 block text-xs text-foreground-muted">从网易云音乐或 QQ 音乐导入当前房间曲库</span>
        </span>
        <span className={`shrink-0 text-xs text-foreground-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true">⌄</span>
      </button>

      {isExpanded ? (
        <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface/35 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1" role="tablist" aria-label="导入平台">
              {enabledSearchProviders.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={provider === item}
                  onClick={() => setProvider(item)}
                  className={`px-2.5 py-1.5 text-xs font-semibold transition ${provider === item ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
                >
                  {item === "netease" ? "网易云" : "QQ 音乐"}
                </button>
              ))}
            </div>
            {isConnected ? (
              <span className="text-[11px] text-emerald-300">已连接{account?.nickname ? ` · ${account.nickname}` : ""}</span>
            ) : (
              <Link className="text-[11px] text-accent hover:text-accent/80" href="/app/profile">前往个人中心绑定</Link>
            )}
          </div>

          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void searchTracks(event)}>
            <label className="sr-only" htmlFor="network-playlist-search-input">搜索歌曲</label>
            <input
              id="network-playlist-search-input"
              className="min-w-0 flex-1 border border-surface-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              disabled={!isConnected || pending !== null}
              maxLength={100}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder={`搜索${providerName}歌曲、歌手或专辑`}
              type="search"
              value={keywords}
            />
            <button
              type="submit"
              disabled={!isConnected || !keywords.trim() || pending !== null}
              className="border border-accent/35 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending === "search" ? "搜索中…" : "搜索"}
            </button>
          </form>

          {errorMessage ? <p className="text-xs text-red-300">{errorMessage}</p> : null}
          {message ? <p className="text-xs text-emerald-300">{message}</p> : null}

          {results.length > 0 ? (
            <div className="divide-y divide-surface-border border border-surface-border bg-background/40">
              {results.map((track) => {
                const isInLibrary = libraryTrackIds.has(track.providerTrackId);
                const isPending = pending === `import:${track.providerTrackId}`;
                return (
                  <article key={`${track.provider}:${track.providerTrackId}`} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
                    {track.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={track.artworkUrl} alt="" className="h-9 w-9 shrink-0 object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-surface text-[10px] text-foreground-muted">音乐</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                      <p className="mt-0.5 truncate text-[10px] text-foreground-muted">{track.artist}{track.album ? ` · ${track.album}` : ""} · {formatDuration(track.durationMs)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={pending !== null || isInLibrary}
                      onClick={() => void importTrack(track)}
                      className="shrink-0 border border-accent/35 bg-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isInLibrary ? "已在曲库" : isPending ? "导入中…" : "导入曲库"}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function toLocalSearchErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "音乐平台暂时不可用，请稍后重试。";
}

export const LocalStorageTabPanel = memo(LocalStorageTabPanelBase);
