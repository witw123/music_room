"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NeteaseAccountStatus,
  ProviderAlbumDetail,
  ProviderAlbumSummary,
  ProviderPlaylistDetail,
  ProviderPlaylistSummary,
  QqMusicAccountStatus
} from "@music-room/shared";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { musicRoomApi } from "@/lib/network/music-room-api";
import {
  isLocalPlaylistMirror
} from "@/features/playlist/local-playlist-database";
import {
  localPlaylistTrackId,
  listMergedLocalPlaylistTracks,
  toProviderTrackRecord,
  upsertLocalPlaylistTrack,
  type LocalPlaylistTrackRecord
} from "@/features/playlist/local-playlist";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import type { ProviderAlbumTrackActions } from "./ProviderAlbumDetailView";
import { ProviderPlaylistPickerDialog, type ProviderPlaylistPickerOption } from "./ProviderPlaylistPickerDialog";
import { SearchSuggestions, type SearchSuggestionItem } from "./ProviderSearchSuggestions";
import { SearchBar } from "@/components/ui/search-bar";
import { Button } from "@/components/ui/button";
import { BilibiliImportDialog } from "./BilibiliImportDialog";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import {
  getCachedFavorites,
  getCachedProviderAccount,
  setCachedFavorites,
  setCachedProviderAccount
} from "@/features/workspace/page-data-cache";
import { useFavoriteTracks } from "@/features/favorites/use-favorite-tracks";
import { rankSearchResultsWithPersonalization } from "@/features/personalization/rank-search-results";
import {
  SongsResults,
  PlaylistsContent,
  AlbumsContent,
  SearchTab,
  Icon,
  albumKey,
  toProviderErrorMessage,
  useProviderTrackActions,
  resolveTrackArtwork,
  type Provider,
  type Track
} from "./index";

type Account = NeteaseAccountStatus | QqMusicAccountStatus;
type ContentTab = "songs" | "playlists" | "albums";

const enabledProviders: Provider[] = [
  ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
  ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : []),
  "bilibili" as const
];

const bilibiliCategories = [
  { label: "全部", tid: undefined },
  { label: "原创音乐", tid: 28 },
  { label: "翻唱", tid: 31 },
  { label: "VOCALOID", tid: 30 },
  { label: "演奏", tid: 59 }
] as const;

type ProviderSearchPageProps = {
  onClose?: () => void;
  initialProvider?: Provider;
  embedded?: boolean;
  isSearchActive?: boolean;
  keywords?: string;
  onKeywordsChange?: (keywords: string) => void;
  searchRequestKey?: number | null;
  onSearchActiveChange?: (active: boolean) => void;
  onBackToRecommendations?: () => void;
};

export function ProviderSearchPage({
  onClose,
  initialProvider,
  embedded = false,
  isSearchActive = false,
  keywords: controlledKeywords,
  onKeywordsChange,
  searchRequestKey,
  onSearchActiveChange,
  onBackToRecommendations
}: ProviderSearchPageProps = {}) {
  const router = useRouter();
  const player = useLocalPlayer();
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo: onClose ? "/app/discover?search=1" : "/app/search" });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const {
    isFavorite: isFavoriteTrack,
    pendingFavoriteKey,
    toggleFavorite: toggleFavoriteTrack
  } = useFavoriteTracks(activeSession?.userId);
  const defaultProvider = initialProvider && enabledProviders.includes(initialProvider)
    ? initialProvider
    : enabledProviders[0] ?? "netease";
  const [provider, setProvider] = useState<Provider>(defaultProvider);
  const [account, setAccount] = useState<Account | null>(() =>
    activeSession && defaultProvider !== "bilibili" ? getCachedProviderAccount(activeSession.userId, defaultProvider) ?? null : null
  );
  const [uncontrolledKeywords, setUncontrolledKeywords] = useState("");
  const keywords = controlledKeywords ?? uncontrolledKeywords;
  const isConnected = provider === "bilibili" || account?.connected === true;
  const providerName = provider === "netease" ? "网易云音乐" : provider === "qqmusic" ? "QQ 音乐" : "哔哩哔哩";
  const [results, setResults] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<ProviderPlaylistSummary[]>([]);
  const [playlist, setPlaylist] = useState<ProviderPlaylistDetail | null>(null);
  const [albums, setAlbums] = useState<ProviderAlbumSummary[]>([]);
  const [album, setAlbum] = useState<ProviderAlbumDetail | null>(null);
  const [contentTab, setContentTab] = useState<ContentTab>("songs");
  const [hasSearched, setHasSearched] = useState(false);
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [remoteSuggestions, setRemoteSuggestions] = useState<SearchSuggestionItem[]>([]);
  const [remoteHotWords, setRemoteHotWords] = useState<SearchSuggestionItem[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [localTracks, setLocalTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [playbackTracks, setPlaybackTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const searchRequestRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [favoriteAlbumIds, setFavoriteAlbumIds] = useState<Set<string>>(() => {
    const cachedItems = activeSession ? getCachedFavorites(activeSession.userId) ?? [] : [];
    return new Set(cachedItems.map((item) => albumKey(item.provider, item.providerAlbumId)));
  });
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(null);
  const [playlistPickerAlbum, setPlaylistPickerAlbum] = useState<ProviderAlbumDetail | null>(null);
  const [playlistPickerAnchor, setPlaylistPickerAnchor] = useState<AnchoredDialogAnchor | null>(null);
  const [playlistPickerOptions, setPlaylistPickerOptions] = useState<ProviderPlaylistPickerOption[]>([]);
  const [playlistPickerLoading, setPlaylistPickerLoading] = useState(false);
  const [bilibiliSubCategory, setBilibiliSubCategory] = useState<number | undefined>(undefined);
  const [bilibiliRankings, setBilibiliRankings] = useState<Track[]>([]);
  const [loadingRankings, setLoadingRankings] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const keywordsRef = useRef(keywords);
  keywordsRef.current = keywords;
  const lastSearchRequestKeyRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const skipKeywordResetRef = useRef(false);
  const isInteractingWithDropdownRef = useRef(false);

  const updateKeywords = useCallback((value: string) => {
    if (onKeywordsChange) {
      onKeywordsChange(value);
      return;
    }
    setUncontrolledKeywords(value);
  }, [onKeywordsChange]);

  useEffect(() => {
    if (hydrated && !activeSession) router.replace(authEntryHref as Route);
  }, [activeSession, authEntryHref, hydrated, router]);

  useEffect(() => {
    if (initialProvider && enabledProviders.includes(initialProvider)) {
      setProvider(initialProvider);
    }
  }, [initialProvider]);

  useEffect(() => {
    if (!searchSuggestionsOpen) {
      setRemoteSuggestions([]);
      setRemoteHotWords([]);
      return;
    }
    let cancelled = false;
    const query = keywords.trim();
    const timerId = window.setTimeout(async () => {
      try {
        const response = query
          ? provider === "netease"
            ? await musicRoomApi.searchNeteaseSuggestions(query)
            : await musicRoomApi.searchQqMusicSuggestions(query)
          : provider === "netease"
            ? await musicRoomApi.getNeteaseSearchHot()
            : await musicRoomApi.getQqMusicSearchHot();
        if (cancelled) return;
        const items = response.items.map((item) => ({
          label: item.label,
          hint: item.hint ?? (query ? "联想" : "热词"),
          provider: item.provider
        }));
        if (query) setRemoteSuggestions(items);
        else setRemoteHotWords(items);
      } catch {
        if (cancelled) return;
        if (query) setRemoteSuggestions([]);
        else setRemoteHotWords([]);
      }
    }, query ? 120 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [isConnected, keywords, provider, searchSuggestionsOpen]);

  useEffect(() => {
    if (!activeSession) return;
    const cachedItems = getCachedFavorites(activeSession.userId);
    if (cachedItems) {
      setFavoriteAlbumIds(new Set(cachedItems.map((item) => albumKey(item.provider, item.providerAlbumId))));
    }
    let cancelled = false;
    void musicRoomApi.listFavoriteAlbums()
      .then((items) => {
        if (!cancelled) {
          setCachedFavorites(activeSession.userId, items);
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
    setAccount(
      activeSession && provider !== "bilibili"
        ? getCachedProviderAccount(activeSession.userId, provider) ?? null
        : null
    );
    searchRequestRef.current += 1;
    setResults([]);
    setPlaylists([]);
    setPlaylist(null);
    setAlbums([]);
    setAlbum(null);
    setErrorMessage(null);
    setStatusMessage(null);
    setSearchSuggestionsOpen(false);
    setRemoteSuggestions([]);
    setRemoteHotWords([]);
    if (provider === "bilibili") {
      setAccount(null);
      return;
    }
    const load = provider === "netease" ? musicRoomApi.getNeteaseAccount : musicRoomApi.getQqMusicAccount;
    void load()
      .then((nextAccount) => {
        if (!cancelled) {
          setCachedProviderAccount(activeSession.userId, provider, nextAccount);
          setAccount(nextAccount);
        }
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(toProviderErrorMessage(error, provider));
      });
    return () => {
      cancelled = true;
    };
  }, [activeSession, provider]);

  useEffect(() => {
    let cancelled = false;
    void listMergedLocalPlaylistTracks()
      .then((tracks) => {
        if (!cancelled) setLocalTracks(tracks);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  const searchTracksForQuery = useCallback(async (query: string, customTid?: number) => {
    const requestId = ++searchRequestRef.current;
    if (!query) {
      setHasSearched(false);
      return;
    }
    setHasSearched(true);
    onSearchActiveChange?.(true);
    setPending("search");
    setErrorMessage(null);
    setContentTab("songs");
    try {
      const activeTid = customTid !== undefined ? customTid : bilibiliSubCategory;
      const response = provider === "netease"
        ? await musicRoomApi.searchNeteaseTracks(query)
        : provider === "qqmusic"
          ? await musicRoomApi.searchQqMusicTracks(query)
          : await musicRoomApi.searchBilibiliTracks(query, { tid: activeTid });
      const ranked = await rankSearchResultsWithPersonalization(response.items);
      if (searchRequestRef.current === requestId) {
        setResults(ranked);
        setStatusMessage(null);
      }
    } catch (error) {
      if (searchRequestRef.current === requestId) {
        setErrorMessage(toProviderErrorMessage(error, provider));
      }
    } finally {
      if (searchRequestRef.current === requestId) {
        setPending(null);
      }
    }
  }, [bilibiliSubCategory, onSearchActiveChange, provider]);

  useEffect(() => {
    if (provider !== "bilibili") return;
    let cancelled = false;
    setLoadingRankings(true);
    musicRoomApi.getBilibiliRanking(bilibiliSubCategory ? String(bilibiliSubCategory) : "3")
      .then((items) => {
        if (!cancelled) setBilibiliRankings(items);
      })
      .catch(() => {
        if (!cancelled) setBilibiliRankings([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRankings(false);
      });
    return () => { cancelled = true; };
  }, [provider, bilibiliSubCategory]);

  async function handleImportBilibiliSuccess(tracks: Track[], playlistTitle: string) {
    try {
      setPending("import-bilibili-favorite");
      await musicRoomApi.createPlaylist({
        title: playlistTitle,
        description: "导入自哔哩哔哩公开收藏夹",
        coverUrl: tracks[0]?.artworkUrl ?? null,
        isCollaborative: false,
        tags: ["network", "bilibili", "favorite"],
        trackIds: tracks.map((track) => `provider:bilibili:${track.providerTrackId}`)
      });
      await Promise.all(tracks.map(async (track) => {
        try {
          await upsertLocalPlaylistTrack(toProviderTrackRecord(track));
        } catch {
        }
      }));
      setStatusMessage(`收藏夹《${playlistTitle}》（${tracks.length} 首歌曲）已成功导入为网络歌单。`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "导入歌单失败");
    } finally {
      setPending(null);
    }
  }

  async function handleImportBilibiliQueue(tracks: Track[]) {
    try {
      const records = tracks.map((track) => toProviderTrackRecord(track));
      await Promise.all(records.map((r) => upsertLocalPlaylistTrack(r).catch(() => undefined)));
      setPlaybackTracks((prev) => [...prev, ...records]);
      setStatusMessage(`已将 ${tracks.length} 首歌曲添加到播放列表。`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "加入播放列表失败");
    }
  }

  useEffect(() => {
    if (skipKeywordResetRef.current) {
      skipKeywordResetRef.current = false;
      return;
    }
    searchRequestRef.current += 1;
    setResults([]);
    setPending((current) => current === "search" ? null : current);
    if (!keywords.trim()) setHasSearched(false);
  }, [keywords]);

  useEffect(() => {
    if (searchRequestKey == null || lastSearchRequestKeyRef.current === searchRequestKey) return;
    const query = keywordsRef.current.trim();
    if (!query) {
      lastSearchRequestKeyRef.current = searchRequestKey;
      searchRequestRef.current += 1;
      setPending((current) => current === "search" ? null : current);
      return;
    }
    lastSearchRequestKeyRef.current = searchRequestKey;
    void searchTracksForQuery(query);
  }, [searchRequestKey, searchTracksForQuery]);

  async function loadSearchPlaylists() {
    const query = keywords.trim();
    setContentTab("playlists");
    if (!query || pending) return;
    setHasSearched(true);
    onSearchActiveChange?.(true);
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
    if (!query || pending) return;
    setHasSearched(true);
    onSearchActiveChange?.(true);
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

  const {
    playProviderTrack,
    queueProviderTrack,
    downloadTrack
  } = useProviderTrackActions({
    localTracks,
    setLocalTracks,
    playbackTracks,
    setPlaybackTracks,
    player,
    pending,
    setPending,
    setErrorMessage,
    setStatusMessage
  });

  async function openPlaylistPicker(track: Track, anchor: AnchoredDialogAnchor) {
    if (pending) return;
    setPlaylistPickerTrack(track);
    setPlaylistPickerAlbum(null);
    setPlaylistPickerAnchor(anchor);
    setPlaylistPickerLoading(true);
    setPlaylistPickerOptions([]);
    setErrorMessage(null);
    setPending(`playlist-picker:${track.providerTrackId}`);
    try {
      const networkPlaylists = await musicRoomApi.listMyPlaylists();
      setPlaylistPickerOptions(
        networkPlaylists
          .filter((item) => !isLocalPlaylistMirror(item))
          .map((item) => ({ kind: "network" as const, playlist: item }))
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? `歌单加载失败：${error.message}` : "歌单加载失败，请稍后重试。");
    } finally {
      setPlaylistPickerLoading(false);
      setPending(null);
    }
  }

  async function openAlbumPlaylistPicker(albumToAdd: ProviderAlbumDetail, anchor: AnchoredDialogAnchor) {
    if (pending) return;
    setPlaylistPickerTrack(null);
    setPlaylistPickerAlbum(albumToAdd);
    setPlaylistPickerAnchor(anchor);
    setPlaylistPickerLoading(true);
    setPlaylistPickerOptions([]);
    setErrorMessage(null);
    setPending(`playlist-picker:album:${albumToAdd.providerAlbumId}`);
    try {
      const networkPlaylists = await musicRoomApi.listMyPlaylists();
      setPlaylistPickerOptions(
        networkPlaylists
          .filter((item) => !isLocalPlaylistMirror(item))
          .map((item) => ({ kind: "network" as const, playlist: item }))
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? `歌单加载失败：${error.message}` : "歌单加载失败，请稍后重试。");
    } finally {
      setPlaylistPickerLoading(false);
      setPending(null);
    }
  }

  async function addTrackToPlaylist(option: ProviderPlaylistPickerOption) {
    const track = playlistPickerTrack;
    if (!track || pending) return;
    setPending(`add-playlist:${option.kind}:${option.playlist.id}:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      const resolvedTrack = await resolveTrackArtwork(track);
      const trackId = localPlaylistTrackId(resolvedTrack);
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
      setPlaylistPickerTrack(null);
      setPlaylistPickerAlbum(null);
      setPlaylistPickerAnchor(null);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  function providerTrackActions(): ProviderAlbumTrackActions {
    return {
      isDownloaded: (track) => localTracks.some((item) => item.id === localPlaylistTrackId(track) && item.availableOffline),
      isPlayable: (track) => {
        const localTrack = localTracks.find((item) => item.id === localPlaylistTrackId(track));
        const cachedTrack = playbackTracks.find((item) => item.id === localPlaylistTrackId(track));
        return Boolean((localTrack && player.isTrackPlayable(localTrack)) || (cachedTrack && player.isTrackPlayable(cachedTrack)));
      },
      isQueued: (track) => player.queue.some((item) => item.trackId === localPlaylistTrackId(track)),
      isDownloading: (track) => pending === `download:${track.provider}:${track.providerTrackId}` || pending === `play:${track.provider}:${track.providerTrackId}` || pending === `queue:${track.provider}:${track.providerTrackId}`,
      onDownload: (track) => void downloadTrack(track),
      onAddToQueue: (track) => void queueProviderTrack(track),
      onPlay: (track) => void playProviderTrack(track),
      onAddToPlaylist: (track, anchor) => void openPlaylistPicker(track, anchor),
      isFavorite: (track) => isFavoriteTrack(track),
      isTogglingFavorite: (track) => pendingFavoriteKey === `${track.provider}:${track.providerTrackId}`,
      onToggleFavorite: (track) => {
        void toggleFavoriteTrack(track)
          .then(() => setStatusMessage(`已${isFavoriteTrack(track) ? "收藏" : "取消收藏"}《${track.title}》。`))
          .catch((error) => setErrorMessage(error instanceof Error ? error.message : "更新歌曲收藏失败。"));
      }
    };
  }

  async function addAlbumToPlaylist(option: ProviderPlaylistPickerOption) {
    const albumToAdd = playlistPickerAlbum;
    if (!albumToAdd || pending) return;
    setPending(`add-playlist-album:${option.playlist.id}:${albumToAdd.providerAlbumId}`);
    setErrorMessage(null);
    try {
      const resolvedTracks = await Promise.all(albumToAdd.tracks.map((track) => resolveTrackArtwork(track)));
      const trackIds = resolvedTracks.map((track) => localPlaylistTrackId(track));
      await Promise.all(resolvedTracks.map(async (track) => {
        try {
          await upsertLocalPlaylistTrack(toProviderTrackRecord(track));
        } catch {
          // The network playlist remains authoritative when local metadata storage is unavailable.
        }
      }));
      const existingIds = new Set(option.playlist.trackIds);
      const nextTrackIds = [...option.playlist.trackIds, ...trackIds.filter((trackId) => !existingIds.has(trackId))];
      const addedCount = nextTrackIds.length - option.playlist.trackIds.length;
      if (addedCount > 0) {
        await musicRoomApi.updatePlaylist(option.playlist.id, { trackIds: nextTrackIds });
      }
      setStatusMessage(addedCount > 0
        ? `专辑《${albumToAdd.title}》中的 ${addedCount} 首歌曲已加入“${option.playlist.title}”。`
        : `专辑《${albumToAdd.title}》中的歌曲已全部在“${option.playlist.title}”中。`);
      setPlaylistPickerAlbum(null);
      setPlaylistPickerAnchor(null);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, provider));
    } finally {
      setPending(null);
    }
  }

  async function loadPlaylist(item: ProviderPlaylistSummary) {
    if (pending) return;
    setPending(`playlist:${item.provider}:${item.providerPlaylistId}`);
    setErrorMessage(null);
    try {
      const detail = item.provider === "netease"
        ? await musicRoomApi.getNeteasePlaylist(item.providerPlaylistId)
        : await musicRoomApi.getQqMusicPlaylist(item.providerPlaylistId);
      setPlaylist(detail);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, item.provider));
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
        tags: ["network", `network:${detail.provider}:${detail.providerPlaylistId}`, ...detail.tags].slice(0, 20),
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

  async function loadAlbumById(id: string, itemProvider: Provider = provider) {
    if (!id || pending) return;
    setPending(`album:${itemProvider}:${id}`);
    setErrorMessage(null);
    setContentTab("albums");
    try {
      const detail = itemProvider === "netease"
        ? await musicRoomApi.getNeteaseAlbum(id)
        : await musicRoomApi.getQqMusicAlbum(id);
      setAlbum(detail);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, itemProvider));
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
        const cachedItems = getCachedFavorites(activeSession.userId) ?? [];
        setCachedFavorites(
          activeSession.userId,
          cachedItems.filter((candidate) => candidate.provider !== item.provider || candidate.providerAlbumId !== item.providerAlbumId)
        );
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
        const cachedItems = getCachedFavorites(activeSession.userId) ?? [];
        const nextItem = {
          id: `optimistic:${id}`,
          provider: item.provider,
          providerAlbumId: item.providerAlbumId,
          title: item.title,
          artist: item.artist,
          artworkUrl: item.artworkUrl,
          description: item.description,
          releaseTime: item.releaseTime,
          trackCount: item.trackCount,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        setCachedFavorites(
          activeSession.userId,
          [...cachedItems.filter((candidate) => candidate.provider !== item.provider || candidate.providerAlbumId !== item.providerAlbumId), nextItem]
        );
        setStatusMessage(`已收藏《${item.title}》。`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "收藏操作失败，请稍后重试。");
    }
  }

  async function loadAlbumForTrack(track: Track) {
    let albumId = track.providerAlbumId;
    if (!albumId) {
      if (pending) return;
      setPending(`track:${track.provider}:${track.providerTrackId}`);
      setErrorMessage(null);
      try {
        const detail = track.provider === "netease"
          ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
          : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
        albumId = detail.providerAlbumId;
      } catch (error) {
        setErrorMessage(toProviderErrorMessage(error, track.provider));
      } finally {
        setPending(null);
      }
    }
    if (albumId) await loadAlbumById(albumId, track.provider);
  }

  if (!hydrated) return <div className="min-h-[100dvh] bg-background" />;

  const showBackToRecommendations = onBackToRecommendations && (isSearchActive || hasSearched || Boolean(keywords.trim()));
  const prefixAction = showBackToRecommendations ? (
    <button
      aria-label="返回发现"
      className="flex h-7 items-center gap-1 rounded-full pl-1.5 pr-2.5 text-xs font-medium text-foreground-muted hover:text-foreground hover:bg-foreground/10 transition-colors shrink-0 -ml-1 mr-1"
      onClick={() => {
        setHasSearched(false);
        setSearchSuggestionsOpen(false);
        updateKeywords("");
        onSearchActiveChange?.(false);
        onBackToRecommendations?.();
      }}
      title="返回发现"
      type="button"
    >
      <Icon name="arrow-left" />
      <span className="hidden sm:inline text-[11px]">发现</span>
    </button>
  ) : !embedded ? (
    onClose ? (
      <button
        aria-label="返回发现"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground-muted transition hover:bg-foreground/10 hover:text-foreground -ml-1 mr-1"
        onClick={onClose}
        title="返回发现"
        type="button"
      >
        <Icon name="arrow-left" />
      </button>
    ) : (
      <Link
        aria-label="返回首页"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground-muted transition hover:bg-foreground/10 hover:text-foreground -ml-1 mr-1"
        href="/app"
        title="返回首页"
      >
        <Icon name="arrow-left" />
      </Link>
    )
  ) : undefined;

  const suffixAction = enabledProviders.length > 1 ? (
    <div className="relative flex items-center pl-1">
      <div className="h-3.5 w-px bg-surface-border mr-1.5" />
      <div className="relative flex items-center">
        <div className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground cursor-pointer select-none">
          <span className="font-medium text-[11px] sm:text-xs">
            {provider === "netease" ? "网易云" : provider === "qqmusic" ? "QQ 音乐" : "哔哩哔哩"}
          </span>
          <svg className="h-3 w-3 text-foreground-muted/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
          </svg>
        </div>
        <select
          aria-label="选择音乐平台"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(event) => setProvider(event.target.value as Provider)}
          value={provider}
        >
          {enabledProviders.map((item) => (
            <option key={item} value={item} className="bg-background text-foreground">
              {item === "netease" ? "网易云音乐" : item === "qqmusic" ? "QQ 音乐" : "哔哩哔哩"}
            </option>
          ))}
        </select>
      </div>
    </div>
  ) : undefined;

  const dropdownContent = searchSuggestionsOpen ? (
    <SearchSuggestions
      items={keywords.trim() ? remoteSuggestions : remoteHotWords}
      onInteractionChange={(active) => {
        isInteractingWithDropdownRef.current = active;
      }}
      onSelect={(value) => {
        skipKeywordResetRef.current = true;
        updateKeywords(value);
        setSearchSuggestionsOpen(false);
        void searchTracksForQuery(value);
      }}
    />
  ) : null;

  const searchBar = (
    <div className={`w-full ${embedded ? "max-w-md sm:max-w-lg" : "max-w-md sm:max-w-lg"}`}>
      <SearchBar
        ref={searchInputRef}
        id="provider-search-input"
        value={keywords}
        onChange={(val) => {
          updateKeywords(val);
          setSearchSuggestionsOpen(true);
        }}
        onSubmit={(query) => {
          setSearchSuggestionsOpen(false);
          void searchTracksForQuery(query);
        }}
        onClear={() => {
          setResults([]);
          setSearchSuggestionsOpen(false);
          setHasSearched(false);
          onSearchActiveChange?.(false);
          onBackToRecommendations?.();
        }}
        onFocus={() => setSearchSuggestionsOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            if (!isInteractingWithDropdownRef.current) {
              setSearchSuggestionsOpen(false);
            }
          }, 250);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setSearchSuggestionsOpen(false);
        }}
        placeholder="搜索歌曲、艺人或歌单"
        loading={pending === "search"}
        prefixAction={prefixAction}
        suffixAction={suffixAction}
        dropdownContent={dropdownContent}
        showSearchButton={false}
      />
    </div>
  );

  const shouldShowSearchContent = !embedded || isSearchActive || hasSearched || provider === "bilibili";
  const searchContent = (
    <>
      {shouldShowSearchContent && enabledProviders.length > 0 ? (
        <>
          {provider !== "bilibili" ? (
            <div className={`${embedded ? "mt-7" : "mt-10"} flex items-center gap-7 border-b border-surface-border`} role="tablist" aria-label="搜索结果类型">
              <SearchTab active={contentTab === "songs"} onClick={() => setContentTab("songs")}>单曲</SearchTab>
              <SearchTab active={contentTab === "playlists"} onClick={() => void loadSearchPlaylists()}>歌单</SearchTab>
              <SearchTab active={contentTab === "albums"} onClick={() => void loadSearchAlbums()}>专辑</SearchTab>
            </div>
          ) : (
            <div className={`${embedded ? "mt-4" : "mt-6"} flex flex-wrap items-center justify-between gap-3 border-b border-surface-border pb-3`}>
              <div className="flex items-center gap-1.5 overflow-x-auto py-1" role="tablist" aria-label="B站音乐分区">
                {bilibiliCategories.map((cat) => {
                  const active = bilibiliSubCategory === cat.tid;
                  return (
                    <button
                      key={cat.label}
                      type="button"
                      onClick={() => {
                        setBilibiliSubCategory(cat.tid);
                        if (keywords.trim()) {
                          void searchTracksForQuery(keywords.trim(), cat.tid);
                        }
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors select-none ${
                        active
                          ? "bg-foreground text-background font-semibold"
                          : "bg-surface text-foreground-muted hover:bg-surface-hover hover:text-foreground border border-surface-border"
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setImportDialogOpen(true)}
                className="text-xs text-foreground-muted hover:text-foreground flex items-center gap-1.5 border border-surface-border/80 px-2.5 py-1 rounded-md"
              >
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>导入收藏夹</span>
              </Button>
            </div>
          )}

          {!isConnected ? (
            <div className="mt-8 flex items-center justify-between gap-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-5 py-4 text-sm text-amber-900 dark:text-amber-100/90">
              <span>当前为免登录公开搜索，绑定 {providerName} 账号可使用完整播放及收藏导入等功能。</span>
              <Link className="shrink-0 text-xs font-semibold text-amber-700 hover:text-amber-900 dark:text-amber-200 dark:hover:text-white" href="/app/profile">去绑定</Link>
            </div>
          ) : null}

          {provider === "bilibili" && !hasSearched && !keywords.trim() ? (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                  音乐区热门榜单
                </h3>
                {loadingRankings && (
                  <span className="text-[11px] text-foreground-muted">加载中...</span>
                )}
              </div>
              <SongsResults
                results={bilibiliRankings}
                pending={pending}
                localTracks={localTracks}
                onAlbum={loadAlbumForTrack}
                onDownload={downloadTrack}
                onImportPlaylist={openPlaylistPicker}
                isFavorite={isFavoriteTrack}
                isTogglingFavorite={(track) => pendingFavoriteKey === `${track.provider}:${track.providerTrackId}`}
                onToggleFavorite={(track) => {
                  void toggleFavoriteTrack(track)
                    .then(() => setStatusMessage(`已${isFavoriteTrack(track) ? "收藏" : "取消收藏"}《${track.title}》。`))
                    .catch((error) => setErrorMessage(error instanceof Error ? error.message : "更新歌曲收藏失败。"));
                }}
                onPlay={playProviderTrack}
              />
            </div>
          ) : null}

          {contentTab === "songs" && (hasSearched || Boolean(keywords.trim()) || provider !== "bilibili") ? (
            <SongsResults
              results={results}
              pending={pending}
              localTracks={localTracks}
              onAlbum={loadAlbumForTrack}
              onDownload={downloadTrack}
              onImportPlaylist={openPlaylistPicker}
              isFavorite={isFavoriteTrack}
              isTogglingFavorite={(track) => pendingFavoriteKey === `${track.provider}:${track.providerTrackId}`}
              onToggleFavorite={(track) => {
                void toggleFavoriteTrack(track)
                  .then(() => setStatusMessage(`已${isFavoriteTrack(track) ? "收藏" : "取消收藏"}《${track.title}》。`))
                  .catch((error) => setErrorMessage(error instanceof Error ? error.message : "更新歌曲收藏失败。"));
              }}
              onPlay={playProviderTrack}
            />
          ) : null}
           {contentTab === "playlists" ? (
            <PlaylistsContent playlists={playlists} playlist={playlist} pending={pending} onBack={() => setPlaylist(null)} onOpen={loadPlaylist} onSave={saveProviderPlaylist} trackActions={providerTrackActions()} />
           ) : null}
           {contentTab === "albums" ? (
            <AlbumsContent albums={albums} album={album} pending={pending} favoriteAlbumIds={favoriteAlbumIds} onOpen={(item) => loadAlbumById(item.providerAlbumId, item.provider)} onBack={() => setAlbum(null)} onToggleFavorite={toggleFavoriteAlbum} onAddAlbumToPlaylist={openAlbumPlaylistPicker} trackActions={providerTrackActions()} />
          ) : null}
        </>
      ) : shouldShowSearchContent ? (
        <div className={`${embedded ? "mt-7" : "mt-10"} rounded-2xl border border-surface-border bg-surface p-8 text-sm text-foreground-muted`}>当前没有启用音乐平台。</div>
      ) : null}

      {statusMessage ? <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-xs text-emerald-200" role="status">{statusMessage}</p> : null}
      {errorMessage ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-xs text-red-200" role="alert">{errorMessage}</p> : null}
    </>
  );

  const playlistPicker = (playlistPickerTrack || playlistPickerAlbum) && playlistPickerAnchor ? (
    <ProviderPlaylistPickerDialog
      anchor={playlistPickerAnchor}
      loading={playlistPickerLoading}
      options={playlistPickerOptions}
      pending={pending !== null}
      subjectLabel={playlistPickerTrack ? `《${playlistPickerTrack.title}》 · ${playlistPickerTrack.artist}` : `专辑《${playlistPickerAlbum?.title ?? ""}》 · ${playlistPickerAlbum?.tracks.length ?? 0} 首歌曲`}
      onClose={() => {
        if (!pending) {
          setPlaylistPickerTrack(null);
          setPlaylistPickerAlbum(null);
          setPlaylistPickerAnchor(null);
        }
      }}
      onSelect={(option) => void (playlistPickerTrack ? addTrackToPlaylist(option) : addAlbumToPlaylist(option))}
    />
  ) : null;

  const bilibiliImportDialog = (
    <BilibiliImportDialog
      open={importDialogOpen}
      onClose={() => setImportDialogOpen(false)}
      onImportSuccess={(tracks, title) => void handleImportBilibiliSuccess(tracks, title)}
      onAddToQueue={(tracks) => void handleImportBilibiliQueue(tracks)}
    />
  );

  if (embedded) {
    return (
      <div className="min-w-0">
        <header className="sticky top-[env(safe-area-inset-top,0px)] z-20 bg-background/95 pb-2 pt-1 backdrop-blur-md">
          {searchBar}
        </header>
        {searchContent}
        {playlistPicker}
        {bilibiliImportDialog}
      </div>
    );
  }

  return (
    <main className="h-[100dvh] min-h-[100dvh] overflow-y-auto hide-scrollbar bg-background pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground md:pl-60 lg:pb-28">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1320px] flex-col px-4 pb-12 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-7 sm:pt-6 md:px-10 md:pt-8">
        <header className="flex">
          {searchBar}
        </header>
        {searchContent}
      </div>
      {playlistPicker}
      {bilibiliImportDialog}
    </main>
  );
}
