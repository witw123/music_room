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
import { ProviderAlbumTrackTable, type ProviderAlbumTrackActions } from "@/components/ProviderAlbumDetailView";
import { ProviderPlaylistPickerDialog, type ProviderPlaylistPickerOption } from "@/components/ProviderPlaylistPickerDialog";
import { FavoriteTrackButton } from "@/components/FavoriteTrackButton";
import { MobileTrackActionsMenu, type MobileTrackAction } from "@/components/MobileTrackActionsMenu";
import { getAnchoredDialogAnchor, type AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
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
import { useFavoriteTracks } from "@/features/favorites/use-favorite-tracks";
import { Button } from "@/components/ui/button";

type Provider = DiscoverProvider;
type Track = NeteaseTrackCandidate | QqMusicTrackCandidate;
type Detail =
  | { kind: "playlist"; summary: ProviderPlaylistSummary; value: ProviderPlaylistDetail }
  | { kind: "album"; summary: ProviderAlbumSummary; value: ProviderAlbumDetail };
type HeroItem = ProviderDiscoveryBanner & { fallbackPlaylist?: ProviderPlaylistSummary };
type SearchSuggestion = { label: string; hint?: string };

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

const discoverSearchHistoryKey = "music-room-discover-search-history-v1";

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
  const {
    isFavorite: isFavoriteTrack,
    pendingFavoriteKey,
    toggleFavorite: toggleFavoriteTrack
  } = useFavoriteTracks(activeSession?.userId);
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
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const nextSearchOpen = searchParams.get("search") === "1";
    setSearchOpen(nextSearchOpen);
    setSearchKeywords(nextSearchOpen ? searchParams.get("q") ?? "" : "");
    setSearchSuggestionsOpen(false);
  }, [searchParams]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(discoverSearchHistoryKey) ?? "[]");
      if (Array.isArray(saved)) {
        setSearchHistory(saved.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 8));
      }
    } catch {
      setSearchHistory([]);
    }
  }, []);

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
    const query = searchKeywords.trim();
    if (query) {
      const nextHistory = [query, ...searchHistory.filter((item) => item !== query)].slice(0, 8);
      setSearchHistory(nextHistory);
      window.localStorage.setItem(discoverSearchHistoryKey, JSON.stringify(nextHistory));
    }
    setSearchOpen(true);
    setSearchSuggestionsOpen(false);
    setDetail(null);
    const params = new URLSearchParams({ search: "1" });
    if (query) params.set("q", query);
    router.replace(`${pathname}?${params.toString()}` as Route, { scroll: false });
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchSuggestionsOpen(false);
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
      setStatusMessage(`正在播放《${track.title}》，已保留在本机缓存中。`);
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

  function toggleDiscoverTrackFavorite(track: Track) {
    void toggleFavoriteTrack(track)
      .then(() => setStatusMessage(`已${isFavoriteTrack(track) ? "收藏" : "取消收藏"}《${track.title}》。`))
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : "更新歌曲收藏失败。"));
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
      onAddToPlaylist: (track, anchor) => void openPlaylistPicker(track, anchor),
      isFavorite: (track) => isFavoriteTrack(track),
      isTogglingFavorite: (track) => pendingFavoriteKey === `${track.provider}:${track.providerTrackId}`,
      onToggleFavorite: toggleDiscoverTrackFavorite
    };
  }

  if (!hydrated || !activeSession) return <div className="min-h-[100dvh] bg-background" />;

  if (detail && !searchOpen) {
    return (
      <main className="workspace-page overflow-y-auto md:pl-60 lg:pb-28">
        {detail.kind === "playlist" ? (
          <div className="workspace-page__inner workspace-page__inner--wide pt-3 sm:pt-6 md:pt-8">
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
          <DetailView
            detail={detail}
            onBack={() => setDetail(null)}
            trackActions={playlistTrackActions()}
          />
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
    : recommended.slice(0, 8).map((item) => ({ ...toFallbackBanner(item), fallbackPlaylist: item }));
  const searchSuggestions = buildSearchSuggestions(searchKeywords, searchHistory, activeData);

  return (
    <main className="workspace-page overflow-y-auto md:pl-60 lg:pb-28">
      <div className="workspace-page__inner workspace-page__inner--wide pt-6 sm:pt-10 md:pt-14">
        <header className="workspace-page__header flex-wrap">
          <div className="workspace-page__heading">
            <p className="workspace-page__eyebrow">Music Room</p>
            <h1 className="workspace-page__title">发现</h1>
            <p className="workspace-page__description">从今天开始，找到下一首喜欢的歌。</p>
          </div>
          <div className="relative w-full max-w-[460px] sm:w-[min(42vw,460px)]">
            <form className="group flex h-11 w-full items-center gap-3 rounded-full border border-surface-border bg-surface px-3 text-sm text-foreground-muted shadow-sm transition-[background-color,border-color,transform] duration-200 hover:border-accent/40 hover:bg-surface-hover focus-within:border-accent/60 focus-within:bg-surface-hover" onSubmit={(event) => {
              event.preventDefault();
              openSearch();
            }}>
              <SearchIcon />
              <label className="sr-only" htmlFor="discover-search-input">搜索歌曲、歌手、专辑或歌单</label>
              <input
                ref={searchInputRef}
                autoFocus={searchOpen}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
                id="discover-search-input"
                maxLength={100}
                onBlur={() => window.setTimeout(() => setSearchSuggestionsOpen(false), 120)}
                onChange={(event) => {
                  setSearchKeywords(event.target.value);
                  if (!searchOpen) setSearchSuggestionsOpen(true);
                }}
                onFocus={() => {
                  if (!searchOpen) setSearchSuggestionsOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSearchSuggestionsOpen(false);
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
            {!searchOpen && searchSuggestionsOpen ? (
              <SearchSuggestions
                items={searchSuggestions}
                onSelect={(value) => {
                  setSearchKeywords(value);
                  setSearchSuggestionsOpen(false);
                  searchInputRef.current?.focus();
                }}
              />
            ) : null}
          </div>
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
            {dailyPlaylists.length > 0 || dailyTracks.length > 0 ? (
              <DailySection
                onOpenPlaylist={openPlaylist}
                playlists={dailyPlaylists}
                tracks={dailyTracks}
                trackActions={playlistTrackActions()}
                loadingKey={detailLoading}
              />
            ) : null}

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

function buildSearchSuggestions(keywords: string, history: string[], data: ProviderDiscoveryData): SearchSuggestion[] {
  const query = keywords.trim().toLocaleLowerCase();
  const candidates: SearchSuggestion[] = [];
  const seen = new Set<string>();
  const add = (label: string | null | undefined, hint?: string) => {
    const value = label?.trim();
    if (!value) return;
    const key = `${value.toLocaleLowerCase()}:${hint ?? ""}`;
    if (seen.has(key)) return;
    if (query && !value.toLocaleLowerCase().includes(query)) return;
    seen.add(key);
    candidates.push({ label: value, hint });
  };

  history.forEach((item) => add(item, "最近搜索"));
  data.dailyTracks.slice(0, 8).forEach((track) => {
    add(track.title, "歌曲");
    add(track.artist, "歌手");
  });
  [...data.recommended, ...data.playlists].slice(0, 12).forEach((playlist) => add(playlist.title, "歌单"));
  data.albums.slice(0, 8).forEach((album) => {
    add(album.title, "专辑");
    add(album.artist, "歌手");
  });
  data.categories.slice(0, 12).forEach((category) => add(category.name, "分类"));

  if (!query) {
    ["华语流行", "林俊杰", "周杰伦", "轻音乐", "ACG", "经典老歌"].forEach((item) => add(item, "热门"));
  } else if (candidates.length === 0) {
    add(keywords, "搜索歌曲");
    add(`${keywords} 歌单`, "搜索歌单");
    add(`${keywords} 专辑`, "搜索专辑");
  }
  return candidates.slice(0, 8);
}

function DiscoverySection({ eyebrow, title, actionLabel, onAction, children }: { eyebrow: string; title: string; actionLabel: string; onAction: () => void; children: ReactNode }) {
  return (
    <section className="workspace-page__section">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="workspace-page__eyebrow">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-semibold leading-7 text-foreground">{title}</h2>
        </div>
        <button className="shrink-0 text-xs font-semibold text-foreground-muted transition hover:text-foreground" onClick={onAction} type="button">{actionLabel}<span aria-hidden="true" className="ml-1">→</span></button>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function HeroRail({ items, onOpenPlaylist, loadingKey }: { items: HeroItem[]; onOpenPlaylist: (item: ProviderPlaylistSummary) => Promise<void>; loadingKey: string | null }) {
  const visibleItems = items.slice(0, 8);
  const railRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const itemSignature = visibleItems.map((item) => `${item.provider}:${item.id}`).join("|");

  useEffect(() => {
    setActiveIndex(0);
    railRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, [itemSignature]);

  useEffect(() => {
    if (paused || visibleItems.length < 2) return;
    const timerId = window.setTimeout(() => {
      const nextIndex = (activeIndex + 1) % visibleItems.length;
      scrollHeroRail(railRef.current, nextIndex);
      setActiveIndex(nextIndex);
    }, 5_500);
    return () => window.clearTimeout(timerId);
  }, [activeIndex, paused, visibleItems.length]);

  function syncActiveIndex() {
    const rail = railRef.current;
    if (!rail) return;
    const slides = Array.from(rail.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    if (!slides.length) return;
    const nextIndex = slides.reduce((closestIndex, slide, index) => {
      const closest = slides[closestIndex];
      return Math.abs(slide.offsetLeft - rail.scrollLeft) < Math.abs(closest.offsetLeft - rail.scrollLeft)
        ? index
        : closestIndex;
    }, 0);
    setActiveIndex((current) => current === nextIndex ? current : nextIndex);
  }

  if (!visibleItems.length) return null;

  return (
    <section
      aria-label="精选推荐轮播"
      className="relative mt-8 -mx-4 px-4 sm:-mx-7 sm:px-7 md:-mx-10 md:px-10"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <div
        ref={railRef}
        className="flex snap-x gap-4 overflow-x-auto scroll-smooth hide-scrollbar"
        onPointerCancel={() => setPaused(false)}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onScroll={syncActiveIndex}
      >
        {visibleItems.map((item) => {
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
      {visibleItems.length > 1 ? (
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5" aria-label="选择推荐内容">
            {visibleItems.map((item, index) => (
              <button
                aria-current={activeIndex === index ? "true" : undefined}
                aria-label={`第 ${index + 1} 个推荐`}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${activeIndex === index ? "w-6 bg-accent" : "w-1.5 bg-foreground-muted/35 hover:bg-foreground-muted/70"}`}
                key={`${item.provider}:${item.id}:indicator`}
                onClick={() => {
                  scrollHeroRail(railRef.current, index);
                  setActiveIndex(index);
                }}
                type="button"
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button aria-label="上一张推荐" className="flex h-8 w-8 items-center justify-center rounded-full border border-surface-border text-foreground-muted transition hover:bg-surface-hover hover:text-foreground" onClick={() => {
              const nextIndex = (activeIndex - 1 + visibleItems.length) % visibleItems.length;
              scrollHeroRail(railRef.current, nextIndex);
              setActiveIndex(nextIndex);
            }} type="button"><ArrowLeftIcon /></button>
            <button aria-label="下一张推荐" className="flex h-8 w-8 items-center justify-center rounded-full border border-surface-border text-foreground-muted transition hover:bg-surface-hover hover:text-foreground" onClick={() => {
              const nextIndex = (activeIndex + 1) % visibleItems.length;
              scrollHeroRail(railRef.current, nextIndex);
              setActiveIndex(nextIndex);
            }} type="button"><ArrowRightIcon /></button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function scrollHeroRail(rail: HTMLDivElement | null, index: number) {
  if (!rail) return;
  const slide = rail.children[index];
  if (!(slide instanceof HTMLElement)) return;
  rail.scrollTo({ left: slide.offsetLeft, behavior: "smooth" });
}

function SearchSuggestions({ items, onSelect }: { items: SearchSuggestion[]; onSelect: (value: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-surface-border bg-surface/95 p-2 shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl" role="listbox">
      {items.map((item) => (
        <button
          className="flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-foreground"
          key={`${item.label}:${item.hint ?? ""}`}
          onClick={() => onSelect(item.label)}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          type="button"
        >
          <span className="shrink-0 text-foreground-muted/80"><SearchIcon /></span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint ? <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{item.hint}</span> : null}
        </button>
      ))}
    </div>
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

function DailySection({
  playlists,
  tracks,
  onOpenPlaylist,
  loadingKey,
  trackActions
}: {
  playlists: ProviderPlaylistSummary[];
  tracks: Track[];
  onOpenPlaylist: (item: ProviderPlaylistSummary) => Promise<void>;
  loadingKey: string | null;
  trackActions: ProviderAlbumTrackActions;
}) {
  return (
    <section className="workspace-page__section">
      <div><p className="workspace-page__eyebrow">Daily Mix</p><h2 className="mt-1 text-xl font-semibold leading-7 text-foreground">每日推荐</h2></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.28fr)]">
        {playlists[0] ? <PlaylistCard item={playlists[0]} loading={loadingKey === `playlist:${playlists[0].provider}:${playlists[0].providerPlaylistId}`} onOpen={onOpenPlaylist} /> : <div className="flex min-h-40 items-center rounded-xl border border-dashed border-surface-border px-5 text-sm text-foreground-muted">绑定网易云音乐账号后查看每日歌单。</div>}
        <div className="divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface">
          {tracks.slice(0, 6).map((track, index) => (
            <div
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:grid-cols-[1.5rem_minmax(0,1fr)_auto] ${trackActions.isPlayable?.(track) ? "cursor-pointer md:cursor-default" : ""}`}
              key={`${track.provider}:${track.providerTrackId}`}
              onClick={() => {
                if (!trackActions.onPlay || !trackActions.isPlayable?.(track) || trackActions.isDownloading?.(track)) return;
                if (window.matchMedia("(min-width: 768px)").matches) return;
                trackActions.onPlay(track);
              }}
            >
              <span className="hidden w-5 shrink-0 text-center text-xs tabular-nums text-foreground-muted md:block">{String(index + 1).padStart(2, "0")}</span>
              <div className="flex min-w-0 items-center gap-3"><Artwork alt={track.album ?? track.title} className="h-11 w-11 shrink-0 rounded-lg" src={track.artworkUrl} /><div className="min-w-0"><strong className="block truncate text-sm font-medium text-foreground">{track.title}</strong><span className="mt-1 block truncate text-xs text-foreground-muted">{track.artist} · {track.album ?? "未知专辑"}</span></div></div>
              <DiscoverTrackControls actions={trackActions} track={track} />
            </div>
          ))}
          {!tracks.length ? <div className="px-5 py-10 text-center text-sm text-foreground-muted">今日歌曲暂不可用。</div> : null}
        </div>
      </div>
    </section>
  );
}

function DiscoverTrackControls({ actions, track }: { actions: ProviderAlbumTrackActions; track: Track }) {
  const [menuAnchor, setMenuAnchor] = useState<AnchoredDialogAnchor | null>(null);
  const downloaded = actions.isDownloaded?.(track) ?? false;
  const playable = actions.isPlayable?.(track) ?? false;
  const queued = actions.isQueued?.(track) ?? false;
  const downloading = actions.isDownloading?.(track) ?? false;
  const menuItems: MobileTrackAction[] = [
    ...(actions.onPlay ? [{ id: "play", label: playable ? "播放" : "需要下载后播放", icon: "play" as const, disabled: downloading || !playable, onSelect: () => actions.onPlay?.(track) }] : []),
    ...(actions.onDownload ? [{ id: "download", label: downloaded ? "已下载" : downloading ? "下载中" : "下载到本地", icon: "download" as const, disabled: downloading || downloaded, onSelect: () => actions.onDownload?.(track) }] : []),
    ...(actions.onAddToQueue ? [{ id: "queue", label: queued ? "已在队列中" : playable ? "加入队列" : "需要下载后加入队列", icon: "queue" as const, disabled: downloading || queued || !playable, onSelect: () => actions.onAddToQueue?.(track) }] : []),
    ...(actions.onAddToPlaylist ? [{ id: "playlist", label: "加入歌单", icon: "plus" as const, disabled: downloading, onSelect: () => { if (menuAnchor) actions.onAddToPlaylist?.(track, menuAnchor); } }] : []),
    ...(actions.onToggleFavorite ? [{ id: "favorite", label: actions.isFavorite?.(track) ? "取消收藏" : "收藏歌曲", icon: "heart" as const, disabled: actions.isTogglingFavorite?.(track) ?? false, onSelect: () => void actions.onToggleFavorite?.(track) }] : [])
  ];

  return (
    <div className="flex items-center justify-end" onClick={(event) => event.stopPropagation()}>
      <div className="hidden md:block">
        {actions.onToggleFavorite ? <FavoriteTrackButton isFavorite={actions.isFavorite?.(track) ?? false} onToggle={() => actions.onToggleFavorite?.(track)} pending={actions.isTogglingFavorite?.(track) ?? false} track={track} /> : null}
      </div>
      <Button aria-label={`打开《${track.title}》的操作菜单`} className="h-10 w-10 md:hidden" onClick={(event) => { event.stopPropagation(); setMenuAnchor(getAnchoredDialogAnchor(event.currentTarget)); }} size="icon" title="更多操作" type="button" variant="ghost"><MoreIcon /></Button>
      {menuAnchor ? <MobileTrackActionsMenu anchor={menuAnchor} items={menuItems} onClose={() => setMenuAnchor(null)} subtitle={`${track.artist} · ${track.album ?? "未知专辑"}`} title={track.title} /> : null}
    </div>
  );
}

function MoreIcon() {
  return <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>;
}

function CategoryButton({ active, label, loading = false, onClick }: { active: boolean; label: string; loading?: boolean; onClick: () => void }) {
  return <button aria-pressed={active} className={`workspace-filter ${active ? "workspace-filter--active" : ""}`} disabled={loading} onClick={onClick} type="button">{loading ? "加载中" : label}</button>;
}

function DetailView({
  detail,
  onBack,
  trackActions
}: {
  detail: Detail;
  onBack: () => void;
  trackActions: ProviderAlbumTrackActions;
}) {
  const tracks = detail.value.tracks;
  return (
    <div className="workspace-page__inner workspace-page__inner--wide pt-6 sm:pt-10 md:pt-14">
      <button className="inline-flex w-fit items-center gap-2 text-xs font-semibold text-foreground-muted transition hover:text-foreground" onClick={onBack} type="button"><ArrowLeftIcon />返回发现</button>
      <section className="workspace-page__section grid gap-6 border-b border-surface-border pb-8 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-end">
        <Artwork alt={detail.value.title} className="aspect-square w-48 rounded-2xl" src={detail.value.artworkUrl} />
        <div className="min-w-0"><p className="workspace-page__eyebrow">{detail.kind === "playlist" ? "Playlist" : "Album"}</p><h1 className="workspace-page__title">{detail.value.title}</h1><p className="mt-2 text-sm text-foreground-muted">{detail.kind === "playlist" ? `${detail.value.creatorName || "网络歌单"} · ` : `${detail.value.artist} · `}{tracks.length} 首歌曲</p><p className="mt-4 max-w-2xl text-sm leading-7 text-foreground-muted">{detail.value.description || "暂无简介"}</p></div>
      </section>
      <ProviderAlbumTrackTable actions={trackActions} tracks={tracks} />
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

function toErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "NETEASE_ACCOUNT_REQUIRED" || error.code === "QQMUSIC_ACCOUNT_REQUIRED") return "部分个性化推荐需要先绑定对应音乐平台账号。";
    return error.message;
  }
  return error instanceof Error ? error.message : "内容加载失败，请稍后重试。";
}

function SearchIcon() { return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>; }
function ArrowLeftIcon() { return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>; }
function ArrowRightIcon() { return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m9 18 6-6-6-6" /><path d="M5 12h10" /></svg>; }
function CompassIcon() { return <svg aria-hidden="true" fill="none" height="28" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24" width="28"><circle cx="12" cy="12" r="8.5" /><path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z" /></svg>; }
function ChevronIcon({ expanded }: { expanded: boolean }) { return <svg aria-hidden="true" className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14"><path d="m6 9 6 6 6-6" /></svg>; }
