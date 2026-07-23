"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import type {
  NeteaseTrackCandidate,
  ProviderAlbumDetail,
  ProviderAlbumSummary,
  ProviderDiscoveryBanner,
  ProviderPlaylistCategory,
  ProviderPlaylistDetail,
  ProviderPlaylistSummary,
  QqMusicTrackCandidate
} from "@music-room/shared";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import { ProviderSearchPage } from "@/components/ProviderSearchPage";
import { ProviderPlaylistDetailView } from "@/components/ProviderPlaylistDetailView";
import type { ProviderAlbumTrackActions } from "@/components/ProviderAlbumDetailView";
import { ProviderPlaylistPickerDialog, type ProviderPlaylistPickerOption } from "@/components/ProviderPlaylistPickerDialog";
import { type AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import {
  hashAudioBlob,
  listMergedLocalPlaylistTracks,
  localPlaylistTrackId,
  toProviderTrackRecord
} from "@/features/playlist/local-playlist";
import { isLocalPlaylistMirror } from "@/lib/local-playlist-database";
import {
  upsertCachedLibraryTrack,
  upsertLocalPlaylistTrack,
  type LocalPlaylistTrackRecord
} from "@/lib/indexeddb";
import {
  normalizeLocalAudioMimeType,
  saveCachedAudioFileToLocalDirectory,
  saveAudioFileToLocalDirectory,
  ensureLocalAudioDirectoryWriteAccess
} from "@/features/upload/local-audio-storage";
import {
  appSettingsChangeEvent,
  getAppSettings,
  type DiscoverProvider
} from "@/features/settings/settings-store";

type Provider = DiscoverProvider;
type Track = NeteaseTrackCandidate | QqMusicTrackCandidate;
type Detail =
  | { kind: "playlist"; summary: ProviderPlaylistSummary; value: ProviderPlaylistDetail }
  | { kind: "album"; summary: ProviderAlbumSummary; value: ProviderAlbumDetail };
type HeroItem = ProviderDiscoveryBanner & { fallbackPlaylist?: ProviderPlaylistSummary };

const enabledProviders: Provider[] = [
  ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
  ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : [])
];

type ProviderDiscoveryData = {
  recommended: ProviderPlaylistSummary[];
  playlists: ProviderPlaylistSummary[];
  toplists: ProviderPlaylistSummary[];
  albums: ProviderAlbumSummary[];
  dailyPlaylists: ProviderPlaylistSummary[];
  dailyTracks: Track[];
  banners: ProviderDiscoveryBanner[];
  categories: ProviderPlaylistCategory[];
};

const emptyProviderData: ProviderDiscoveryData = {
  recommended: [],
  playlists: [],
  toplists: [],
  albums: [],
  dailyPlaylists: [],
  dailyTracks: [],
  banners: [],
  categories: []
};

export function DiscoverPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo: "/app/discover" });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const player = useLocalPlayer();
  const [data, setData] = useState<Partial<Record<Provider, ProviderDiscoveryData>>>({});
  const [discoverProvider, setDiscoverProvider] = useState<Provider>(enabledProviders[0] ?? "netease");
  const discoverProviderRef = useRef(discoverProvider);
  discoverProviderRef.current = discoverProvider;
  const [loading, setLoading] = useState(true);
  const [refreshingCategory, setRefreshingCategory] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [recommendationsExpanded, setRecommendationsExpanded] = useState(false);
  const [playlistsExpanded, setPlaylistsExpanded] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [localTracks, setLocalTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [playbackTracks, setPlaybackTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [favoritePlaylistKeys, setFavoritePlaylistKeys] = useState<Set<string>>(new Set());
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(null);
  const [playlistPickerAnchor, setPlaylistPickerAnchor] = useState<AnchoredDialogAnchor | null>(null);
  const [playlistPickerOptions, setPlaylistPickerOptions] = useState<ProviderPlaylistPickerOption[]>([]);
  const [playlistPickerLoading, setPlaylistPickerLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(() => searchParams.get("search") === "1");
  const [searchKeywords, setSearchKeywords] = useState(() => searchParams.get("q") ?? "");

  useEffect(() => {
    const nextSearchOpen = searchParams.get("search") === "1";
    setSearchOpen(nextSearchOpen);
    setSearchKeywords(nextSearchOpen ? searchParams.get("q") ?? "" : "");
  }, [searchParams]);

  useEffect(() => {
    if (hydrated && !activeSession) {
      window.location.assign(authEntryHref);
    }
  }, [activeSession, authEntryHref, hydrated]);

  useEffect(() => {
    if (!activeSession) return;
    let cancelled = false;
    void listMergedLocalPlaylistTracks()
      .then((tracks) => {
        if (!cancelled) setLocalTracks(tracks);
      })
      .catch(() => undefined);
    void musicRoomApi.listMyPlaylists()
      .then((playlists) => {
        if (!cancelled) {
          setFavoritePlaylistKeys(new Set(
            playlists.flatMap((playlist) => playlist.tags
              .filter((tag) => tag.startsWith("network:"))
              .map((tag) => tag.slice("network:".length)))
          ));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  useEffect(() => {
    const syncDiscoverProvider = () => {
      const savedProvider = getAppSettings().discover.provider;
      if (enabledProviders.includes(savedProvider)) {
        setDiscoverProvider(savedProvider);
      } else if (enabledProviders[0]) {
        setDiscoverProvider(enabledProviders[0]);
      }
    };
    syncDiscoverProvider();
    window.addEventListener(appSettingsChangeEvent, syncDiscoverProvider);
    window.addEventListener("storage", syncDiscoverProvider);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, syncDiscoverProvider);
      window.removeEventListener("storage", syncDiscoverProvider);
    };
  }, []);

  useEffect(() => {
    setData({});
    setLoading(true);
    setErrorMessage(null);
    setRefreshingCategory(false);
    setDetailLoading(null);
    setSelectedCategory("all");
    setDetail(null);
  }, [discoverProvider]);

  const load = useCallback(async () => {
    const provider = enabledProviders.includes(discoverProvider) ? discoverProvider : null;
    if (!activeSession || !provider) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    const result = await loadProviderData(provider);
    if (discoverProviderRef.current !== provider) return;
    const nextData: Partial<Record<Provider, ProviderDiscoveryData>> = { [provider]: result.data };
    setData(nextData);
    setLoading(false);
    if (result.rejectedCount > 0 && !hasDiscoveryContent(nextData)) {
      setErrorMessage("发现内容暂时不可用，请稍后重试。");
    }
  }, [activeSession, discoverProvider]);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryOptions = useMemo(() => {
    const options: Array<{ key: string; label: string; provider: Provider; category: ProviderPlaylistCategory }> = [];
    const categories = data[discoverProvider]?.categories ?? [];
    for (const category of categories) {
      options.push({ key: `${discoverProvider}:${category.id}`, label: category.name, provider: discoverProvider, category });
    }
    return options;
  }, [data, discoverProvider]);

  async function selectCategory(option: (typeof categoryOptions)[number] | null) {
    setSelectedCategory(option?.key ?? "all");
    if (!option) {
      await load();
      return;
    }

    setRefreshingCategory(true);
    try {
      const response = option.provider === "netease"
        ? await musicRoomApi.listNeteaseDiscoveryPlaylists({ category: option.category.name, order: "hot", limit: 50 })
        : await musicRoomApi.listQqMusicDiscoveryPlaylists({
          categoryId: Number(option.category.id),
          sortId: Number(option.category.sortOptions[0]?.id ?? 5),
          limit: 50
        });
      setData((current) => {
        const nextData = {
          ...current,
          [option.provider]: {
            ...(current[option.provider] ?? emptyProviderData),
            playlists: response.items
          }
        };
        return nextData;
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setRefreshingCategory(false);
    }
  }

  function refreshAll() {
    setSelectedCategory("all");
    void load();
  }

  function openSearch() {
    setSearchOpen(true);
    setDetail(null);
    const params = new URLSearchParams({ search: "1" });
    const query = searchKeywords.trim();
    if (query) params.set("q", query);
    router.replace(`${pathname}?${params.toString()}` as Route, { scroll: false });
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchKeywords("");
    router.replace(pathname as Route, { scroll: false });
  }

  async function openPlaylist(summary: ProviderPlaylistSummary) {
    const key = `playlist:${summary.provider}:${summary.providerPlaylistId}`;
    setDetailLoading(key);
    setErrorMessage(null);
    try {
      const value = summary.provider === "netease"
        ? await musicRoomApi.getNeteasePlaylist(summary.providerPlaylistId)
        : await musicRoomApi.getQqMusicPlaylist(summary.providerPlaylistId);
      setDetail({ kind: "playlist", summary, value });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setDetailLoading(null);
    }
  }

  async function openAlbum(summary: ProviderAlbumSummary) {
    const key = `album:${summary.provider}:${summary.providerAlbumId}`;
    setDetailLoading(key);
    setErrorMessage(null);
    try {
      const value = summary.provider === "netease"
        ? await musicRoomApi.getNeteaseAlbum(summary.providerAlbumId)
        : await musicRoomApi.getQqMusicAlbum(summary.providerAlbumId);
      setDetail({ kind: "album", summary, value });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setDetailLoading(null);
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

  async function cacheTrackForPlayback(track: Track) {
    const trackId = localPlaylistTrackId(track);
    const savedTrack = localTracks.find((item) => item.id === trackId);
    if (savedTrack?.fileHash && player.isTrackPlayable(savedTrack)) return savedTrack;
    const queuedTrack = playbackTracks.find((item) => item.id === trackId);
    if (queuedTrack?.fileHash && player.queue.some((item) => item.trackId === trackId)) return queuedTrack;

    const resolvedTrack = await resolveTrackArtwork(track);
    const response = resolvedTrack.provider === "netease"
      ? await musicRoomApi.downloadNeteaseTrack(resolvedTrack.providerTrackId)
      : await musicRoomApi.downloadQqMusicTrack(resolvedTrack.providerTrackId);
    const fileHash = await hashAudioBlob(response.blob);
    const mimeType = normalizeLocalAudioMimeType(response.contentType || response.blob.type);
    const lyricPayload = await (resolvedTrack.provider === "netease"
      ? musicRoomApi.getNeteaseLyrics(resolvedTrack.providerTrackId)
      : musicRoomApi.getQqMusicLyrics(resolvedTrack.providerTrackId)
    ).catch(() => null);
    const lyrics = lyricPayload?.plainLyric ?? null;

    await upsertCachedLibraryTrack({
      fileHash,
      title: resolvedTrack.title,
      artist: resolvedTrack.artist,
      album: resolvedTrack.album,
      artworkUrl: resolvedTrack.artworkUrl,
      lyrics,
      provider: resolvedTrack.provider,
      providerTrackId: resolvedTrack.providerTrackId,
      mimeType,
      durationMs: resolvedTrack.durationMs,
      sizeBytes: response.blob.size,
      file: response.blob,
      sourceTrackIds: [],
      sourceRoomIds: [],
      lastSourceTrackId: null,
      lastSourceRoomId: null,
      lastOwnerNickname: null
    });
    const cachedFile = await saveCachedAudioFileToLocalDirectory({
      file: response.blob,
      fileHash,
      title: resolvedTrack.title,
      mimeType,
      provider: resolvedTrack.provider
    });
    const record: LocalPlaylistTrackRecord = {
      ...toProviderTrackRecord(resolvedTrack),
      fileHash,
      fileName: cachedFile?.fileName ?? null,
      sizeBytes: response.blob.size,
      mimeType,
      lyrics,
      availableOffline: false,
      updatedAt: new Date().toISOString()
    };
    player.registerTransientCache(fileHash);
    setPlaybackTracks((current) => [...current.filter((item) => item.id !== record.id), record]);
    return record;
  }

  async function playProviderTrack(track: Track) {
    const key = `play:${track.provider}:${track.providerTrackId}`;
    if (pending) return;
    setPending(key);
    setErrorMessage(null);
    try {
      const record = await cacheTrackForPlayback(track);
      await player.playTrack(record);
      setStatusMessage(`正在播放《${track.title}》，歌曲仅保留在当前队列缓存中。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "歌曲播放失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  async function queueProviderTrack(track: Track) {
    const key = `queue:${track.provider}:${track.providerTrackId}`;
    if (pending) return;
    setPending(key);
    setErrorMessage(null);
    try {
      const record = await cacheTrackForPlayback(track);
      player.addToQueue(record);
      setStatusMessage(`《${track.title}》已加入播放队列。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加入队列失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  async function downloadProviderTrack(track: Track) {
    const existing = localTracks.find((item) => item.id === localPlaylistTrackId(track));
    if (existing?.availableOffline || pending) return;
    const key = `download:${track.provider}:${track.providerTrackId}`;
    setPending(key);
    setErrorMessage(null);
    try {
      const resolvedTrack = await resolveTrackArtwork(track);
      await ensureLocalAudioDirectoryWriteAccess();
      const response = resolvedTrack.provider === "netease"
        ? await musicRoomApi.downloadNeteaseTrack(resolvedTrack.providerTrackId)
        : await musicRoomApi.downloadQqMusicTrack(resolvedTrack.providerTrackId);
      const fileHash = await hashAudioBlob(response.blob);
      const mimeType = normalizeLocalAudioMimeType(response.contentType || response.blob.type);
      const lyrics = await (resolvedTrack.provider === "netease"
        ? musicRoomApi.getNeteaseLyrics(resolvedTrack.providerTrackId)
        : musicRoomApi.getQqMusicLyrics(resolvedTrack.providerTrackId)
      ).then((value) => value.plainLyric ?? null).catch(() => null);
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
          provider: resolvedTrack.provider,
          providerTrackId: resolvedTrack.providerTrackId,
          durationMs: resolvedTrack.durationMs,
          sizeBytes: response.blob.size
        }
      });
      const record: LocalPlaylistTrackRecord = {
        ...toProviderTrackRecord(resolvedTrack, existing),
        fileHash,
        fileName: saved.fileName,
        sizeBytes: response.blob.size,
        mimeType,
        lyrics,
        availableOffline: true,
        updatedAt: new Date().toISOString()
      };
      await upsertLocalPlaylistTrack(record);
      setLocalTracks((current) => [...current.filter((item) => item.id !== record.id), record]);
      setStatusMessage(`《${resolvedTrack.title}》已下载到本地。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "歌曲下载失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  async function openPlaylistPicker(track: Track, anchor: AnchoredDialogAnchor) {
    if (pending) return;
    setPlaylistPickerTrack(track);
    setPlaylistPickerAnchor(anchor);
    setPlaylistPickerOptions([]);
    setPlaylistPickerLoading(true);
    setPending(`playlist-picker:${track.provider}:${track.providerTrackId}`);
    try {
      const playlists = await musicRoomApi.listMyPlaylists();
      setPlaylistPickerOptions(playlists.filter((item) => !isLocalPlaylistMirror(item)).map((playlist) => ({ kind: "network" as const, playlist })));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "歌单加载失败，请稍后重试。");
    } finally {
      setPlaylistPickerLoading(false);
      setPending(null);
    }
  }

  async function addTrackToPlaylist(option: ProviderPlaylistPickerOption) {
    const track = playlistPickerTrack;
    if (!track || pending) return;
    setPending(`add-playlist:${option.playlist.id}:${track.provider}:${track.providerTrackId}`);
    try {
      const resolvedTrack = await resolveTrackArtwork(track);
      const trackId = localPlaylistTrackId(resolvedTrack);
      const record = toProviderTrackRecord(resolvedTrack, localTracks.find((item) => item.id === trackId));
      await upsertLocalPlaylistTrack(record);
      setLocalTracks((current) => [...current.filter((item) => item.id !== record.id), record]);
      if (option.playlist.trackIds.includes(trackId)) {
        setStatusMessage(`《${resolvedTrack.title}》已在“${option.playlist.title}”中。`);
      } else {
        await musicRoomApi.updatePlaylist(option.playlist.id, { trackIds: [...option.playlist.trackIds, trackId] });
        setStatusMessage(`《${resolvedTrack.title}》已加入“${option.playlist.title}”。`);
      }
      setPlaylistPickerTrack(null);
      setPlaylistPickerAnchor(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加入歌单失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  async function toggleFavoritePlaylist(playlist: ProviderPlaylistDetail) {
    const key = providerPlaylistKey(playlist.provider, playlist.providerPlaylistId);
    if (pending) return;
    setPending(`favorite-playlist:${key}`);
    setErrorMessage(null);
    try {
      const playlists = await musicRoomApi.listMyPlaylists();
      const saved = playlists.find((item) => item.tags.includes(`network:${key}`));
      if (saved) {
        await musicRoomApi.deletePlaylist(saved.id);
        setFavoritePlaylistKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        setStatusMessage(`已取消收藏《${playlist.title}》。`);
      } else {
        await musicRoomApi.createPlaylist({
          title: playlist.title,
          description: playlist.description,
          coverUrl: playlist.artworkUrl ?? playlist.tracks.find((track) => track.artworkUrl)?.artworkUrl ?? null,
          isCollaborative: false,
          tags: ["network", `network:${key}`],
          trackIds: playlist.tracks.map((track) => localPlaylistTrackId(track))
        });
        await Promise.all(playlist.tracks.map(async (track) => {
          try {
            await upsertLocalPlaylistTrack(toProviderTrackRecord(track));
          } catch {
            // The network playlist remains usable when local metadata storage is unavailable.
          }
        }));
        setFavoritePlaylistKeys((current) => new Set(current).add(key));
        setStatusMessage(`已收藏《${playlist.title}》。`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "收藏歌单失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  function playlistTrackActions(): ProviderAlbumTrackActions {
    return {
      isDownloaded: (track) => localTracks.some((item) => item.id === localPlaylistTrackId(track) && item.availableOffline),
      isPlayable: () => true,
      isQueued: (track) => player.queue.some((item) => item.trackId === localPlaylistTrackId(track)),
      isDownloading: (track) => pending === `download:${track.provider}:${track.providerTrackId}` || pending === `play:${track.provider}:${track.providerTrackId}` || pending === `queue:${track.provider}:${track.providerTrackId}`,
      onDownload: (track) => void downloadProviderTrack(track),
      onAddToQueue: (track) => void queueProviderTrack(track),
      onPlay: (track) => void playProviderTrack(track),
      onAddToPlaylist: (track, anchor) => void openPlaylistPicker(track, anchor)
    };
  }

  if (!hydrated || !activeSession) return <div className="min-h-[100dvh] bg-background" />;

  if (detail && !searchOpen) {
    return (
      <main className="h-[100dvh] min-h-[100dvh] overflow-y-auto bg-background pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground md:pl-60 lg:pb-28">
        {detail.kind === "playlist" ? (
          <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1320px] flex-col px-4 pb-12 pt-3 sm:px-7 sm:pt-6 md:px-10 md:pt-8">
            <ProviderPlaylistDetailView
              isFavorite={favoritePlaylistKeys.has(providerPlaylistKey(detail.value.provider, detail.value.providerPlaylistId))}
              onBack={() => setDetail(null)}
              onToggleFavorite={() => toggleFavoritePlaylist(detail.value)}
              pending={pending}
              playlist={detail.value}
              trackActions={playlistTrackActions()}
            />
            {statusMessage ? <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-xs text-emerald-200" role="status">{statusMessage}</p> : null}
            {errorMessage ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-xs text-red-200" role="alert">{errorMessage}</p> : null}
          </div>
        ) : (
          <DetailView detail={detail} onBack={() => setDetail(null)} />
        )}
        {(playlistPickerTrack && playlistPickerAnchor) ? (
          <ProviderPlaylistPickerDialog
            anchor={playlistPickerAnchor}
            loading={playlistPickerLoading}
            options={playlistPickerOptions}
            pending={pending !== null}
            subjectLabel={`《${playlistPickerTrack.title}》 · ${playlistPickerTrack.artist}`}
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

  const activeData = data[discoverProvider] ?? emptyProviderData;
  const banners = activeData.banners;
  const recommended = activeData.recommended;
  const playlists = activeData.playlists;
  const toplists = activeData.toplists;
  const albums = activeData.albums;
  const dailyPlaylists = activeData.dailyPlaylists;
  const dailyTracks = activeData.dailyTracks;
  const heroItems: HeroItem[] = banners.length > 0
    ? banners
    : recommended.slice(0, 4).map((item) => ({ ...toFallbackBanner(item), fallbackPlaylist: item }));

  return (
    <main className="h-[100dvh] min-h-[100dvh] overflow-y-auto bg-background pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground md:pl-60 lg:pb-28">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1480px] flex-col px-4 pb-12 pt-6 sm:px-7 sm:pt-10 md:px-10 md:pt-14">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">Music Room</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">发现</h1>
            <p className="mt-2 text-sm text-foreground-muted">从今天开始，找到下一首喜欢的歌。</p>
          </div>
          <form className="group flex h-11 w-full max-w-[460px] items-center gap-3 rounded-full border border-surface-border bg-surface px-3 text-sm text-foreground-muted shadow-sm transition-[background-color,border-color,transform] duration-200 hover:border-accent/40 hover:bg-surface-hover focus-within:border-accent/60 focus-within:bg-surface-hover sm:w-[min(42vw,460px)]" onSubmit={(event) => {
            event.preventDefault();
            openSearch();
          }}>
            <SearchIcon />
            <label className="sr-only" htmlFor="discover-search-input">搜索歌曲、歌手、专辑或歌单</label>
            <input
              autoFocus={searchOpen}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
              id="discover-search-input"
              maxLength={100}
              onChange={(event) => setSearchKeywords(event.target.value)}
              onFocus={() => {
                if (!searchOpen) openSearch();
              }}
              placeholder="搜索歌曲、歌手、专辑或歌单"
              type="search"
              value={searchKeywords}
            />
            {searchOpen ? (
              <button className="shrink-0 text-xs font-semibold text-foreground-muted transition hover:text-foreground" onClick={closeSearch} type="button">取消</button>
            ) : (
              <button aria-label="搜索" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground-muted transition hover:bg-surface hover:text-foreground active:scale-95" type="submit"><SearchIcon /></button>
            )}
          </form>
        </header>

        {searchOpen ? (
          <ProviderSearchPage
            embedded
            initialProvider={discoverProvider}
            keywords={searchKeywords}
            onKeywordsChange={setSearchKeywords}
          />
        ) : (
          <>
            {heroItems.length > 0 ? <HeroRail items={heroItems} onOpenPlaylist={openPlaylist} loadingKey={detailLoading} /> : null}

            {categoryOptions.length > 0 ? (
              <section className="mt-9" aria-label="探索分类">
                <div className={`gap-2 pb-1 ${categoriesExpanded ? "flex flex-wrap" : "hide-scrollbar flex overflow-x-auto"}`}>
                  <CategoryButton active={selectedCategory === "all"} label="全部" onClick={() => void selectCategory(null)} />
                  {categoryOptions.slice(0, categoriesExpanded ? categoryOptions.length : 14).map((option) => (
                    <CategoryButton key={option.key} active={selectedCategory === option.key} label={option.label} loading={refreshingCategory && selectedCategory === option.key} onClick={() => void selectCategory(option)} />
                  ))}
                </div>
                {categoryOptions.length > 14 ? (
                  <button className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-foreground-muted transition hover:text-foreground" onClick={() => setCategoriesExpanded((current) => !current)} type="button">
                    {categoriesExpanded ? "收起分类" : "展开全部分类"}
                    <ChevronIcon expanded={categoriesExpanded} />
                  </button>
                ) : null}
              </section>
            ) : null}

            {loading ? <DiscoverSkeleton /> : null}
            {!loading && recommended.length === 0 && playlists.length === 0 && albums.length === 0 && dailyTracks.length === 0 ? (
              <EmptyDiscoverState onRetry={refreshAll} />
            ) : null}

            {recommended.length > 0 ? <DiscoverySection eyebrow="为你推荐" title="今天想听什么" actionLabel="更多歌单" onAction={() => void selectCategory(null)}><PlaylistRail expanded={recommendationsExpanded} items={recommended} onOpen={openPlaylist} loadingKey={detailLoading} onToggleExpanded={() => setRecommendationsExpanded((current) => !current)} /></DiscoverySection> : null}
            {playlists.length > 0 ? <DiscoverySection eyebrow="歌单" title="按心情挑一张" actionLabel={refreshingCategory ? "加载中" : "换一批"} onAction={refreshAll}><PlaylistRail expanded={playlistsExpanded} items={playlists} onOpen={openPlaylist} loadingKey={detailLoading} onToggleExpanded={() => setPlaylistsExpanded((current) => !current)} /></DiscoverySection> : null}
            {toplists.length > 0 ? <DiscoverySection eyebrow="排行榜" title="正在发生" actionLabel="查看榜单" onAction={refreshAll}><ToplistRail items={toplists} onOpen={openPlaylist} loadingKey={detailLoading} /></DiscoverySection> : null}
            {albums.length > 0 ? <DiscoverySection eyebrow="新专辑" title="刚刚发行" actionLabel="浏览专辑" onAction={refreshAll}><AlbumRail items={albums} onOpen={openAlbum} loadingKey={detailLoading} /></DiscoverySection> : null}
            {dailyPlaylists.length > 0 || dailyTracks.length > 0 ? <DailySection playlists={dailyPlaylists} tracks={dailyTracks} onOpenPlaylist={openPlaylist} loadingKey={detailLoading} /> : null}

            {errorMessage ? <p className="mt-7 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-300" role="alert">{errorMessage}</p> : null}
          </>
        )}
      </div>
    </main>
  );
}

async function loadProviderData(provider: Provider) {
  const requests = provider === "netease"
    ? [
      musicRoomApi.listNeteaseRecommendedPlaylists({ limit: 50 }),
      musicRoomApi.listNeteaseDiscoveryPlaylists({ category: "全部", order: "hot", limit: 50 }),
      musicRoomApi.listNeteaseToplists(),
      musicRoomApi.listNeteaseNewAlbums({ area: "all", limit: 50 }),
      musicRoomApi.listNeteaseDailyPlaylists(),
      musicRoomApi.listNeteaseDailyTracks(),
      musicRoomApi.listNeteasePlaylistCategories()
    ] as const
    : [
      musicRoomApi.listQqMusicDiscoveryPlaylists({ categoryId: 10_000_000, sortId: 5, limit: 50 }),
      musicRoomApi.listQqMusicDiscoveryPlaylists({ categoryId: 10_000_000, sortId: 5, limit: 50 }),
      musicRoomApi.listQqMusicToplists(),
      musicRoomApi.listQqMusicDigitalAlbums({ limit: 50 }),
      Promise.resolve({ items: [] as ProviderPlaylistSummary[], limit: 1, offset: 0 }),
      Promise.resolve({ items: [] as Track[], limit: 1, offset: 0 }),
      musicRoomApi.listQqMusicPlaylistCategories(),
      musicRoomApi.listQqMusicBanners()
    ] as const;

  const settled = await Promise.allSettled(requests);
  const valueAt = <T,>(index: number, fallback: T) => settled[index]?.status === "fulfilled" ? settled[index].value as T : fallback;
  const data: ProviderDiscoveryData = provider === "netease"
    ? {
      recommended: valueAt(0, { items: [] }).items,
      playlists: valueAt(1, { items: [] }).items,
      toplists: valueAt(2, { items: [] }).items,
      albums: valueAt(3, { items: [] }).items,
      dailyPlaylists: valueAt(4, { items: [] }).items,
      dailyTracks: valueAt(5, { items: [] }).items,
      categories: valueAt(6, { items: [] }).items,
      banners: []
    }
    : {
      recommended: valueAt(0, { items: [] }).items,
      playlists: valueAt(1, { items: [] }).items,
      toplists: valueAt(2, { items: [] }).items,
      albums: valueAt(3, { items: [] }).items,
      dailyPlaylists: [],
      dailyTracks: [],
      categories: valueAt(6, { items: [] }).items,
      banners: valueAt(7, { items: [] }).items
    };
  return { data, rejectedCount: settled.filter((result) => result.status === "rejected").length };
}

function hasDiscoveryContent(data: Partial<Record<Provider, ProviderDiscoveryData>>) {
  return Object.values(data).some((value) => value && (
    value.recommended.length || value.playlists.length || value.toplists.length || value.albums.length || value.banners.length
  ));
}

function toFallbackBanner(summary: ProviderPlaylistSummary): ProviderDiscoveryBanner {
  return {
    provider: summary.provider,
    id: `playlist:${summary.providerPlaylistId}`,
    title: summary.title,
    artworkUrl: summary.artworkUrl,
    targetUrl: null
  };
}

function DiscoverySection({ eyebrow, title, actionLabel, onAction, children }: { eyebrow: string; title: string; actionLabel: string; onAction: () => void; children: ReactNode }) {
  return (
    <section className="mt-11">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h2>
        </div>
        <button className="shrink-0 text-xs font-semibold text-foreground-muted transition hover:text-foreground" onClick={onAction} type="button">{actionLabel}<span aria-hidden="true" className="ml-1">→</span></button>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function HeroRail({ items, onOpenPlaylist, loadingKey }: { items: HeroItem[]; onOpenPlaylist: (item: ProviderPlaylistSummary) => Promise<void>; loadingKey: string | null }) {
  return (
    <section className="mt-8 -mx-4 overflow-x-auto px-4 hide-scrollbar sm:-mx-7 sm:px-7 md:-mx-10 md:px-10" aria-label="精选推荐">
      <div className="flex snap-x gap-4">
        {items.slice(0, 4).map((item) => {
          const content = (
            <div className="relative aspect-[2.05/1] w-[min(86vw,660px)] shrink-0 snap-start overflow-hidden rounded-2xl border border-surface-border bg-surface sm:w-[min(76vw,660px)]">
              <Artwork alt={item.title} className="h-full w-full" src={item.artworkUrl} />
              <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/25 to-transparent" />
              <div className="absolute inset-y-0 left-0 flex max-w-[72%] flex-col justify-end p-5 sm:p-7">
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/65">{providerLabel(item.provider)}</span>
                <h2 className="mt-2 line-clamp-2 text-xl font-bold leading-tight text-white sm:text-3xl">{item.title}</h2>
                {item.targetUrl ? <span className="mt-3 text-xs text-white/65">打开活动页面</span> : item.fallbackPlaylist ? <span className="mt-3 text-xs text-white/65">查看歌单详情</span> : null}
              </div>
            </div>
          );
          if (item.targetUrl) {
            return <a href={item.targetUrl} key={`${item.provider}:${item.id}`} rel="noreferrer" target="_blank">{content}</a>;
          }
          if (item.fallbackPlaylist) {
            const playlist = item.fallbackPlaylist;
            const loading = loadingKey === `playlist:${playlist.provider}:${playlist.providerPlaylistId}`;
            return <button aria-label={`查看歌单 ${playlist.title}`} className="block text-left" disabled={loading} key={`${item.provider}:${item.id}`} onClick={() => void onOpenPlaylist(playlist)} type="button">{content}</button>;
          }
          return <div key={`${item.provider}:${item.id}`}>{content}</div>;
        })}
      </div>
    </section>
  );
}

function PlaylistRail({ items, onOpen, loadingKey, expanded, onToggleExpanded }: { items: ProviderPlaylistSummary[]; onOpen: (item: ProviderPlaylistSummary) => Promise<void>; loadingKey: string | null; expanded: boolean; onToggleExpanded: () => void }) {
  const visibleItems = expanded ? items : items.slice(0, 12);
  return (
    <>
      <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{visibleItems.map((item) => <PlaylistCard item={item} key={`${item.provider}:${item.providerPlaylistId}`} loading={loadingKey === `playlist:${item.provider}:${item.providerPlaylistId}`} onOpen={onOpen} />)}</div>
      {items.length > 12 ? <button className="mt-7 inline-flex items-center gap-1 text-xs font-semibold text-foreground-muted transition hover:text-foreground" onClick={onToggleExpanded} type="button">{expanded ? "收起推荐" : "展开全部推荐"}<ChevronIcon expanded={expanded} /></button> : null}
    </>
  );
}

function PlaylistCard({ item, onOpen, loading }: { item: ProviderPlaylistSummary; onOpen: (item: ProviderPlaylistSummary) => Promise<void>; loading: boolean }) {
  return (
    <button className="group min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" disabled={loading} onClick={() => void onOpen(item)} type="button">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-surface-border bg-surface shadow-[0_12px_28px_rgba(0,0,0,0.14)] transition-transform duration-200 group-hover:-translate-y-1">
        <Artwork alt={item.title} className="h-full w-full" src={item.artworkUrl} />
        <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-2 py-1 text-[10px] text-white/80 backdrop-blur-sm">{providerLabel(item.provider)}</span>
        {loading ? <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs text-white">加载中</span> : null}
      </div>
      <strong className="mt-3 block truncate text-sm font-semibold text-foreground">{item.title}</strong>
      <span className="mt-1 block truncate text-xs text-foreground-muted">{item.creatorName || `${item.trackCount} 首歌曲`}</span>
    </button>
  );
}

function ToplistRail({ items, onOpen, loadingKey }: { items: ProviderPlaylistSummary[]; onOpen: (item: ProviderPlaylistSummary) => Promise<void>; loadingKey: string | null }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.slice(0, 6).map((item, index) => <button className="group flex min-w-0 items-center gap-4 rounded-xl border border-surface-border bg-surface p-3 text-left transition hover:bg-surface-hover" disabled={loadingKey !== null} key={`${item.provider}:${item.providerPlaylistId}`} onClick={() => void onOpen(item)} type="button"><span className="w-7 shrink-0 text-center text-xl font-bold tabular-nums text-accent/80">{String(index + 1).padStart(2, "0")}</span><Artwork alt={item.title} className="h-16 w-16 shrink-0 rounded-lg" src={item.artworkUrl} /><span className="min-w-0"><strong className="block truncate text-sm font-semibold text-foreground">{item.title}</strong><span className="mt-1 block truncate text-xs text-foreground-muted">{item.trackCount} 首歌曲 · {providerLabel(item.provider)}</span></span></button>)}</div>;
}

function AlbumRail({ items, onOpen, loadingKey }: { items: ProviderAlbumSummary[]; onOpen: (item: ProviderAlbumSummary) => Promise<void>; loadingKey: string | null }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{items.slice(0, 12).map((item) => <button className="group min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" disabled={loadingKey !== null} key={`${item.provider}:${item.providerAlbumId}`} onClick={() => void onOpen(item)} type="button"><div className="relative aspect-square overflow-hidden rounded-xl border border-surface-border bg-surface transition-transform duration-200 group-hover:-translate-y-1"><Artwork alt={item.title} className="h-full w-full" src={item.artworkUrl} /></div><strong className="mt-3 block truncate text-sm font-semibold text-foreground">{item.title}</strong><span className="mt-1 block truncate text-xs text-foreground-muted">{item.artist}</span></button>)}</div>;
}

function DailySection({ playlists, tracks, onOpenPlaylist, loadingKey }: { playlists: ProviderPlaylistSummary[]; tracks: Track[]; onOpenPlaylist: (item: ProviderPlaylistSummary) => Promise<void>; loadingKey: string | null }) {
  return (
    <section className="mt-11">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Daily Mix</p><h2 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">每日推荐</h2></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.28fr)]">
        {playlists[0] ? <PlaylistCard item={playlists[0]} loading={loadingKey === `playlist:${playlists[0].provider}:${playlists[0].providerPlaylistId}`} onOpen={onOpenPlaylist} /> : <div className="flex min-h-40 items-center rounded-xl border border-dashed border-surface-border px-5 text-sm text-foreground-muted">绑定网易云音乐账号后查看每日歌单。</div>}
        <div className="divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface">
          {tracks.slice(0, 6).map((track, index) => <div className="flex min-w-0 items-center gap-3 px-4 py-3" key={`${track.provider}:${track.providerTrackId}`}><span className="w-5 shrink-0 text-center text-xs tabular-nums text-foreground-muted">{String(index + 1).padStart(2, "0")}</span><Artwork alt={track.album ?? track.title} className="h-11 w-11 shrink-0 rounded-lg" src={track.artworkUrl} /><div className="min-w-0"><strong className="block truncate text-sm font-medium text-foreground">{track.title}</strong><span className="mt-1 block truncate text-xs text-foreground-muted">{track.artist} · {track.album ?? "未知专辑"}</span></div></div>)}
          {!tracks.length ? <div className="px-5 py-10 text-center text-sm text-foreground-muted">今日歌曲暂不可用。</div> : null}
        </div>
      </div>
    </section>
  );
}

function CategoryButton({ active, label, loading = false, onClick }: { active: boolean; label: string; loading?: boolean; onClick: () => void }) {
  return <button aria-pressed={active} className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition ${active ? "border-accent bg-accent text-white" : "border-surface-border bg-surface text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`} disabled={loading} onClick={onClick} type="button">{loading ? "加载中" : label}</button>;
}

function DetailView({ detail, onBack }: { detail: Detail; onBack: () => void }) {
  const tracks = detail.value.tracks;
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1200px] flex-col px-4 pb-12 pt-6 sm:px-7 sm:pt-10 md:px-10 md:pt-14">
      <button className="inline-flex w-fit items-center gap-2 text-xs font-semibold text-foreground-muted transition hover:text-foreground" onClick={onBack} type="button"><ArrowLeftIcon />返回发现</button>
      <section className="mt-6 grid gap-6 border-b border-surface-border pb-8 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-end">
        <Artwork alt={detail.value.title} className="aspect-square w-48 rounded-2xl" src={detail.value.artworkUrl} />
        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">{detail.kind === "playlist" ? "Playlist" : "Album"}</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{detail.value.title}</h1><p className="mt-2 text-sm text-foreground-muted">{detail.kind === "playlist" ? `${detail.value.creatorName || "网络歌单"} · ` : `${detail.value.artist} · `}{tracks.length} 首歌曲</p><p className="mt-4 max-w-2xl text-sm leading-7 text-foreground-muted">{detail.value.description || "暂无简介"}</p></div>
      </section>
      <section className="mt-7"><div className="grid grid-cols-[32px_minmax(0,1fr)_minmax(120px,0.8fr)_64px] gap-3 border-b border-surface-border px-3 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-muted"><span>#</span><span>歌曲</span><span className="hidden sm:block">专辑</span><span className="text-right">时长</span></div><div className="divide-y divide-surface-border">{tracks.map((track, index) => <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 px-3 py-3 sm:grid-cols-[32px_minmax(0,1fr)_minmax(120px,0.8fr)_64px] sm:items-center" key={`${track.provider}:${track.providerTrackId}`}><span className="text-xs tabular-nums text-foreground-muted">{String(index + 1).padStart(2, "0")}</span><div className="flex min-w-0 items-center gap-3"><Artwork alt={track.album ?? track.title} className="h-10 w-10 shrink-0 rounded-lg" src={track.artworkUrl} /><div className="min-w-0"><strong className="block truncate text-sm font-medium text-foreground">{track.title}</strong><span className="mt-1 block truncate text-xs text-foreground-muted">{track.artist}</span></div></div><span className="hidden truncate text-xs text-foreground-muted sm:block">{track.album ?? "未知专辑"}</span><span className="col-start-2 text-xs tabular-nums text-foreground-muted sm:col-auto sm:text-right">{formatDuration(track.durationMs)}</span></div>)}</div></section>
    </div>
  );
}

function Artwork({ alt, src, className = "" }: { alt: string; src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const source = src ? getArtworkSourceUrl(src) : null;
  if (!source || failed) return <span aria-label={alt} className={`flex items-center justify-center bg-accent/15 text-2xl text-accent/70 ${className}`}>♪</span>;
  // Provider artwork URLs are external and are intentionally not optimized by Next.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className={`object-cover ${className}`} loading="lazy" onError={() => setFailed(true)} src={source} />;
}

function DiscoverSkeleton() {
  return <div aria-label="正在加载发现内容" className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div className="animate-pulse" key={index}><div className="aspect-square rounded-xl bg-surface" /><div className="mt-3 h-3 w-4/5 rounded bg-surface" /><div className="mt-2 h-2 w-1/2 rounded bg-surface" /></div>)}</div>;
}

function EmptyDiscoverState({ onRetry }: { onRetry: () => void }) {
  return <section className="mt-12 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-surface-border px-6 text-center"><CompassIcon /><h2 className="mt-4 text-base font-semibold text-foreground">暂时没有发现内容</h2><p className="mt-2 text-sm text-foreground-muted">稍后再来看看，或重新加载。</p><button className="mt-5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent-hover" onClick={onRetry} type="button">重新加载</button></section>;
}

function providerLabel(provider: Provider) {
  return provider === "netease" ? "网易云音乐" : "QQ 音乐";
}

function providerPlaylistKey(provider: Provider, playlistId: string) {
  return `${provider}:${playlistId}`;
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function toErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "NETEASE_ACCOUNT_REQUIRED" || error.code === "QQMUSIC_ACCOUNT_REQUIRED") return "部分个性化推荐需要先绑定对应音乐平台账号。";
    return error.message;
  }
  return error instanceof Error ? error.message : "内容加载失败，请稍后重试。";
}

function SearchIcon() { return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>; }
function ArrowLeftIcon() { return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>; }
function CompassIcon() { return <svg aria-hidden="true" fill="none" height="28" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24" width="28"><circle cx="12" cy="12" r="8.5" /><path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z" /></svg>; }
function ChevronIcon({ expanded }: { expanded: boolean }) { return <svg aria-hidden="true" className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="m6 9 6 6 6-6" /></svg>; }
