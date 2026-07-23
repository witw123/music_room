"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type {
  NeteaseAccountStatus,
  NeteaseTrackCandidate,
  ProviderAlbumDetail,
  ProviderAlbumSummary,
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
  isLocalPlaylistMirror
} from "@/lib/local-playlist-database";
import { formatDuration } from "@/lib/music-room-ui";
import {
  ensureDefaultLocalPlaylist,
  getDefaultLocalPlaylistTrackIds,
  hashAudioBlob,
  localPlaylistTrackId,
  listMergedLocalPlaylistTracks,
  restoreLocalPlaylistsFromRepository,
  toProviderTrackRecord
} from "@/features/playlist/local-playlist";
import {
  ensureLocalAudioDirectoryWriteAccess,
  getLocalAudioStorageState,
  normalizeLocalAudioMimeType,
  saveCachedAudioFileToLocalDirectory,
  saveAudioFileToLocalDirectory
} from "@/features/upload/local-audio-storage";
import {
  upsertLocalPlaylistTrack,
  upsertCachedLibraryTrack,
  type LocalPlaylistTrackRecord
} from "@/lib/indexeddb";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { getAnchoredDialogAnchor, type AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { ProviderAlbumDetailView, type ProviderAlbumTrackActions } from "@/components/ProviderAlbumDetailView";
import { ProviderPlaylistPickerDialog, type ProviderPlaylistPickerOption } from "@/components/ProviderPlaylistPickerDialog";
import { FavoriteTrackButton } from "@/components/FavoriteTrackButton";
import { ProviderPlaylistDetailView } from "@/components/ProviderPlaylistDetailView";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import {
  getCachedFavorites,
  getCachedProviderAccount,
  setCachedFavorites,
  setCachedProviderAccount
} from "@/features/workspace/page-data-cache";
import { useFavoriteTracks } from "@/features/favorites/use-favorite-tracks";

type Provider = "netease" | "qqmusic";
type Track = NeteaseTrackCandidate | QqMusicTrackCandidate;
type Account = NeteaseAccountStatus | QqMusicAccountStatus;
type ContentTab = "songs" | "playlists" | "albums";

const enabledProviders: Provider[] = [
  ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
  ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : [])
];

type ProviderSearchPageProps = {
  onClose?: () => void;
  initialProvider?: Provider;
  embedded?: boolean;
  keywords?: string;
  onKeywordsChange?: (keywords: string) => void;
};

export function ProviderSearchPage({
  onClose,
  initialProvider,
  embedded = false,
  keywords: controlledKeywords,
  onKeywordsChange
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
    activeSession ? getCachedProviderAccount(activeSession.userId, defaultProvider) ?? null : null
  );
  const [uncontrolledKeywords, setUncontrolledKeywords] = useState("");
  const keywords = controlledKeywords ?? uncontrolledKeywords;
  const [results, setResults] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<ProviderPlaylistSummary[]>([]);
  const [playlist, setPlaylist] = useState<ProviderPlaylistDetail | null>(null);
  const [albums, setAlbums] = useState<ProviderAlbumSummary[]>([]);
  const [album, setAlbum] = useState<ProviderAlbumDetail | null>(null);
  const [contentTab, setContentTab] = useState<ContentTab>("songs");
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
      activeSession
        ? getCachedProviderAccount(activeSession.userId, provider) ?? null
        : null
    );
    setResults([]);
    setPlaylists([]);
    setPlaylist(null);
    setAlbums([]);
    setAlbum(null);
    setErrorMessage(null);
    setStatusMessage(null);
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

  const isConnected = account?.connected === true;
  const providerName = provider === "netease" ? "网易云音乐" : "QQ 音乐";

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

  const searchTracksForQuery = useCallback(async (query: string) => {
    const requestId = ++searchRequestRef.current;
    if (!query || !isConnected) return;
    setPending("search");
    setErrorMessage(null);
    setContentTab("songs");
    try {
      const response = provider === "netease"
        ? await musicRoomApi.searchNeteaseTracks(query)
        : await musicRoomApi.searchQqMusicTracks(query);
      if (searchRequestRef.current === requestId) {
        setResults(response.items);
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
  }, [isConnected, provider]);

  useEffect(() => {
    const query = keywords.trim();
    const requestId = ++searchRequestRef.current;
    setResults([]);
    if (!query || !isConnected) {
      setPending((current) => current === "search" ? null : current);
      return;
    }

    const timerId = window.setTimeout(() => {
      if (searchRequestRef.current === requestId) {
        void searchTracksForQuery(query);
      }
    }, 320);
    return () => window.clearTimeout(timerId);
  }, [isConnected, keywords, searchTracksForQuery]);

  function searchTracks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchTracksForQuery(keywords.trim());
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

  async function downloadTrack(track: Track) {
    const downloadKey = `download:${track.provider}:${track.providerTrackId}`;
    if (pending || localTracks.some((item) =>
      item.provider === track.provider &&
      item.providerTrackId === track.providerTrackId &&
      item.availableOffline
    )) return;

    setPending(downloadKey);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const resolvedTrack = await resolveTrackArtwork(track);
      if (!await ensureLocalAudioDirectoryWriteAccess()) {
        throw new Error("请先在我的页面选择本地歌曲保存位置。");
      }
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
      const updatedTrack = {
        ...toProviderTrackRecord(resolvedTrack, localTracks.find((item) => item.id === localPlaylistTrackId(resolvedTrack))),
        fileHash,
        fileName: saved.fileName,
        sizeBytes: response.blob.size,
        mimeType,
        lyrics,
        availableOffline: true,
        updatedAt: new Date().toISOString()
      };
      await upsertLocalPlaylistTrack(updatedTrack);
      const nextTracks = [...localTracks.filter((item) => item.id !== updatedTrack.id), updatedTrack];
      setLocalTracks(nextTracks);

      const storage = await getLocalAudioStorageState();
      const savedFileHashes = new Set(storage.savedFileHashes);
      const mergedTracks = await listMergedLocalPlaylistTracks();
      await restoreLocalPlaylistsFromRepository();
      ensureDefaultLocalPlaylist({
        trackIds: getDefaultLocalPlaylistTrackIds(mergedTracks, savedFileHashes),
        sourceDirectoryName: storage.directoryName
      });
      setStatusMessage(`《${resolvedTrack.title}》已下载并保存到本地歌单。`);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error, track.provider));
    } finally {
      setPending(null);
    }
  }

  async function cacheTrackForPlayback(track: Track) {
    const trackId = localPlaylistTrackId(track);
    const savedTrack = localTracks.find((item) => item.id === trackId);
    if (savedTrack?.fileHash && player.isTrackPlayable(savedTrack)) return savedTrack;
    const cachedTrack = playbackTracks.find((item) => item.id === trackId);
    if (cachedTrack?.fileHash && player.isTrackPlayable(cachedTrack)) return cachedTrack;

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
    if (pending) return;
    setPending(`play:${track.provider}:${track.providerTrackId}`);
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
    if (pending) return;
    setPending(`queue:${track.provider}:${track.providerTrackId}`);
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

  async function loadAlbumById(id: string, itemProvider: Provider = provider) {
    if (!id || pending || !isConnected) return;
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

  if (!hydrated || !activeSession) return <div className="min-h-[100dvh] bg-black" />;

  const searchContent = (
    <>
      {enabledProviders.length > 0 ? (
        <>
          <div className={`${embedded ? "mt-7" : "mt-10"} flex items-center gap-7 border-b border-white/[0.1]`} role="tablist" aria-label="搜索结果类型">
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
            />
          ) : null}
           {contentTab === "playlists" ? (
            <PlaylistsContent playlists={playlists} playlist={playlist} pending={pending} onBack={() => setPlaylist(null)} onOpen={loadPlaylist} onSave={saveProviderPlaylist} trackActions={providerTrackActions()} />
           ) : null}
           {contentTab === "albums" ? (
            <AlbumsContent albums={albums} album={album} pending={pending} favoriteAlbumIds={favoriteAlbumIds} onOpen={(item) => loadAlbumById(item.providerAlbumId, item.provider)} onBack={() => setAlbum(null)} onToggleFavorite={toggleFavoriteAlbum} onAddAlbumToPlaylist={openAlbumPlaylistPicker} trackActions={providerTrackActions()} />
          ) : null}
        </>
      ) : (
        <div className={`${embedded ? "mt-7" : "mt-10"} rounded-2xl border border-white/[0.1] bg-black p-8 text-sm text-white/55`}>当前没有启用音乐平台。</div>
      )}

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

  if (embedded) {
    return (
      <div className="min-w-0">
        {searchContent}
        {playlistPicker}
      </div>
    );
  }

  return (
    <main className="h-[100dvh] min-h-[100dvh] overflow-y-auto hide-scrollbar bg-black pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground md:pl-60 lg:pb-28">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1320px] flex-col px-4 pb-12 pt-3 sm:px-7 sm:pt-6 md:px-10 md:pt-8">
        <header className="flex justify-center">
          <form className="flex h-12 w-full min-w-0 items-center gap-1 rounded-xl border border-white/[0.12] bg-black p-1 shadow-[0_12px_35px_rgba(0,0,0,0.18)] sm:max-w-[650px]" onSubmit={(event) => void searchTracks(event)}>
            {onClose ? (
              <button aria-label="返回发现" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/45 transition hover:bg-white/[0.07] hover:text-white" onClick={onClose} title="返回发现" type="button"><Icon name="arrow-left" /></button>
            ) : (
              <Link aria-label="返回首页" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/45 transition hover:bg-white/[0.07] hover:text-white" href="/app" title="返回首页"><Icon name="arrow-left" /></Link>
            )}
            <span className="flex h-10 w-8 shrink-0 items-center justify-center text-white/45"><Icon name="search" /></span>
            <label className="sr-only" htmlFor="provider-search-input">搜索歌曲、歌单或专辑</label>
            <input
              id="provider-search-input"
              className="h-full min-w-0 flex-1 bg-transparent px-1 text-base text-white outline-none placeholder:text-white/30"
              disabled={!isConnected}
              autoFocus={Boolean(onClose)}
              maxLength={100}
              onChange={(event) => updateKeywords(event.target.value)}
              placeholder="搜索歌曲、歌手、歌单或专辑"
              type="search"
              value={keywords}
            />
            {enabledProviders.length > 1 ? (
              <select aria-label="选择音乐平台" className="h-10 w-[4.75rem] shrink-0 rounded-lg border border-white/[0.08] bg-black px-1.5 text-[11px] text-white/75 outline-none sm:w-auto sm:px-2 sm:text-xs" onChange={(event) => setProvider(event.target.value as Provider)} value={provider}>
                {enabledProviders.map((item) => <option key={item} value={item}>{item === "netease" ? "网易云" : "QQ 音乐"}</option>)}
              </select>
            ) : null}
          </form>
        </header>
        {searchContent}
      </div>
      {playlistPicker}
    </main>
  );
}

function SongsResults({
  results,
  pending,
  localTracks,
  onAlbum,
  onDownload,
  onImportPlaylist,
  isFavorite,
  isTogglingFavorite,
  onToggleFavorite
}: {
  results: Track[];
  pending: string | null;
  localTracks: LocalPlaylistTrackRecord[];
  onAlbum: (track: Track) => Promise<void>;
  onDownload: (track: Track) => Promise<void>;
  onImportPlaylist: (track: Track, anchor: AnchoredDialogAnchor) => Promise<void>;
  isFavorite: (track: Track) => boolean;
  isTogglingFavorite: (track: Track) => boolean;
  onToggleFavorite: (track: Track) => void;
}) {
  return (
    <section className="mt-7">
      {results.length ? <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-black">
        <div className="hidden grid-cols-[42px_minmax(0,1.4fr)_minmax(120px,0.75fr)_minmax(140px,1fr)_90px_64px] gap-3 border-b border-white/[0.08] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30 md:grid">
          <span>#</span><span>单曲</span><span>歌手</span><span>专辑</span><span>时长</span><span className="text-right">操作</span>
        </div>
        {results.map((track, index) => (
          <article className="grid gap-3 border-b border-white/[0.07] px-4 py-4 last:border-0 md:grid-cols-[42px_minmax(0,1.4fr)_minmax(120px,0.75fr)_minmax(140px,1fr)_90px_64px] md:items-center md:gap-3 md:px-5" key={`${track.provider}-${track.providerTrackId}`}>
            <span className="hidden text-sm tabular-nums text-white/25 md:block">{String(index + 1).padStart(2, "0")}</span>
            <div className="flex min-w-0 items-center gap-3">
              <Artwork alt={track.album ?? track.title} src={track.artworkUrl} size="sm" />
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-white/90">{track.title}</h3>
                <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs text-white/40 md:hidden">{track.artist}<span aria-hidden="true">·</span><TrackAlbumLink pending={pending} track={track} onAlbum={onAlbum} /></p>
              </div>
            </div>
            <span className="hidden truncate text-xs text-white/55 md:block">{track.artist}</span>
            <TrackAlbumLink className="hidden truncate text-xs md:block" pending={pending} track={track} onAlbum={onAlbum} />
            <span className="hidden text-xs tabular-nums text-white/35 md:block">{formatDuration(track.durationMs)}</span>
            <div className="flex items-center justify-start md:justify-end">
              {(() => {
                const downloaded = localTracks.some((item) =>
                  item.provider === track.provider &&
                  item.providerTrackId === track.providerTrackId &&
                  item.availableOffline
                );
                const downloading = pending === `download:${track.provider}:${track.providerTrackId}`;
                return (
                  <Button
                    aria-label={downloaded ? `《${track.title}》已下载` : `下载《${track.title}》`}
                    className="h-10 w-10"
                    disabled={pending !== null || downloaded || downloading}
                    onClick={() => void onDownload(track)}
                    size="icon"
                    title={downloaded ? "已下载" : downloading ? "下载中" : "下载到本地歌单"}
                    type="button"
                    variant="ghost"
                  >
                    <Icon name={downloading ? "loading" : "download"} />
                  </Button>
                );
              })()}
              <Button aria-label={`加入歌单 ${track.title}`} disabled={pending !== null} onClick={(event) => void onImportPlaylist(track, getAnchoredDialogAnchor(event.currentTarget))} size="icon" title="加入歌单" variant="ghost" type="button"><Icon name="playlist-add" /></Button>
              <FavoriteTrackButton isFavorite={isFavorite(track)} onToggle={() => onToggleFavorite(track)} pending={isTogglingFavorite(track)} track={track} />
            </div>
          </article>
        ))}
      </div> : <SearchEmptyState title="还没有搜索结果" description="输入关键词后按回车开始搜索。" />}
    </section>
  );
}

function TrackAlbumLink({ track, pending, onAlbum, className = "" }: { track: Track; pending: string | null; onAlbum: (track: Track) => Promise<void>; className?: string }) {
  if (!track.album) return <span className={`${className} text-white/30`}>未知专辑</span>;
  return <button className={`${className} truncate text-left text-accent/80 transition hover:text-accent`} disabled={pending !== null} onClick={() => void onAlbum(track)} title={`查看专辑 ${track.album}`} type="button">{track.album}</button>;
}

function PlaylistsContent({
  playlists,
  playlist,
  pending,
  onBack,
  onOpen,
  onSave,
  trackActions
}: {
  playlists: ProviderPlaylistSummary[];
  playlist: ProviderPlaylistDetail | null;
  pending: string | null;
  onBack: () => void;
  onOpen: (item: ProviderPlaylistSummary) => Promise<void>;
  onSave: (playlist: ProviderPlaylistDetail) => Promise<void>;
  trackActions: ProviderAlbumTrackActions;
}) {
  if (playlist) {
    return (
      <ProviderPlaylistDetailView
        isFavorite={false}
        onBack={onBack}
        onToggleFavorite={() => onSave(playlist)}
        pending={pending}
        playlist={playlist}
        trackActions={trackActions}
      />
    );
  }

  return (
    <section className="mt-7">
      {playlists.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {playlists.map((item) => (
          <button className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-black text-left transition hover:border-accent/50 hover:bg-white/[0.06]" key={`${item.provider}-${item.providerPlaylistId}`} onClick={() => void onOpen(item)} type="button">
            <Artwork alt={item.title} src={item.artworkUrl} className="aspect-[1.5] w-full rounded-none" size="lg" />
            <span className="block truncate px-4 pt-4 text-sm font-medium text-white/85">{item.title}</span>
            <span className="block truncate px-4 pb-4 pt-1 text-xs text-white/40">{item.creatorName ?? "网络歌单"} · {item.trackCount} 首</span>
          </button>
        ))}
      </div> : <SearchEmptyState title="还没有歌单结果" description="在搜索框输入关键词，再打开歌单标签。" />}
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
  onToggleFavorite,
  onAddAlbumToPlaylist,
  trackActions
}: {
  albums: ProviderAlbumSummary[];
  album: ProviderAlbumDetail | null;
  pending: string | null;
  favoriteAlbumIds: Set<string>;
  onOpen: (item: ProviderAlbumSummary) => Promise<void>;
  onBack: () => void;
  onToggleFavorite: (album: ProviderAlbumSummary | ProviderAlbumDetail) => Promise<void>;
  onAddAlbumToPlaylist: (album: ProviderAlbumDetail, anchor: AnchoredDialogAnchor) => void;
  trackActions: ProviderAlbumTrackActions;
}) {
  if (album) {
    const favoriteId = albumKey(album.provider, album.providerAlbumId);
    return (
      <ProviderAlbumDetailView
        album={album}
        isFavorite={favoriteAlbumIds.has(favoriteId)}
        onBack={onBack}
        onToggleFavorite={() => onToggleFavorite(album)}
        pending={pending}
        onAddAlbumToPlaylist={(anchor) => onAddAlbumToPlaylist(album, anchor)}
        trackActions={trackActions}
      />
    );
  }

  return <section className="mt-7">{albums.length ? <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{albums.map((item) => { const favoriteId = albumKey(item.provider, item.providerAlbumId); return <article className="group min-w-0" key={`${item.provider}-${item.providerAlbumId}`}><button className="block w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-black text-left transition hover:border-accent/50 hover:bg-white/[0.06]" onClick={() => void onOpen(item)} type="button"><Artwork alt={item.title} src={item.artworkUrl} className="aspect-square w-full rounded-none" size="lg" /><span className="block truncate px-3 pt-3 text-sm font-medium text-white/85">{item.title}</span><span className="block truncate px-3 pb-4 pt-1 text-xs text-white/40">{item.artist}</span></button><button aria-label={favoriteAlbumIds.has(favoriteId) ? `取消收藏${item.title}` : `收藏${item.title}`} className={`mt-2 flex items-center gap-1.5 px-1 text-xs ${favoriteAlbumIds.has(favoriteId) ? "text-accent-hover" : "text-white/35 hover:text-white/70"}`} disabled={pending !== null} onClick={() => void onToggleFavorite(item)} type="button"><Icon name="heart" filled={favoriteAlbumIds.has(favoriteId)} />{favoriteAlbumIds.has(favoriteId) ? "已收藏" : "收藏"}</button></article>; })}</div> : <SearchEmptyState title="还没有专辑结果" description="在搜索框输入关键词，再打开专辑标签。" />}</section>;
}

function albumKey(provider: Provider, providerAlbumId: string) {
  return `${provider}:${providerAlbumId}`;
}

function SearchTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button aria-selected={active} className={`relative min-h-11 px-1 pb-3 text-sm font-semibold transition ${active ? "text-white" : "text-white/40 hover:text-white/70"}`} onClick={onClick} role="tab" type="button">{children}{active ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" /> : null}</button>;
}

function Artwork({ alt, src, size, className = "" }: { alt: string; src: string | null | undefined; size: "sm" | "md" | "lg"; className?: string }) {
  const sizes = { sm: "h-10 w-10 rounded-lg", md: "h-20 w-20 rounded-xl", lg: "rounded-2xl" };
  // External provider artwork is intentionally rendered without Next image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img alt={alt} className={`object-cover ${sizes[size]} ${className}`} loading="lazy" src={getArtworkSourceUrl(src)} /> : <span aria-label={alt} className={`flex items-center justify-center bg-[linear-gradient(135deg,#252a32,#15171b)] text-white/25 ${sizes[size]} ${className}`}><Icon name="music" /></span>;
}

function SearchEmptyState({ title, description }: { title: string; description: string }) {
  return <div className="flex min-h-[430px] flex-col items-center justify-center rounded-2xl border border-white/[0.1] bg-black px-6 text-center"><Icon name="search" /><p className="mt-4 text-sm font-medium text-white/60">{title}</p><p className="mt-2 text-xs text-white/30">{description}</p></div>;
}

function Icon({ name, filled = false }: { name: "search" | "heart" | "arrow-left" | "close" | "music" | "chevron-right" | "playlist-add" | "download" | "loading"; filled?: boolean }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: filled ? "currentColor" : "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" /></svg>;
  if (name === "playlist-add") return <svg {...common}><path d="M4 5.5h10M4 9.5h10M4 13.5h6" /><path d="M17 13v7M13.5 16.5h7" /></svg>;
  if (name === "download") return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>;
  if (name === "loading") return <svg {...common} className="animate-spin"><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
  if (name === "arrow-left") return <svg {...common}><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "chevron-right") return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  return <svg {...common}><path d="M4 19.5V5.8a1.8 1.8 0 0 1 2.4-1.7l12 4.5a1.8 1.8 0 0 1 1.2 1.7v8.2" /><circle cx="8" cy="19" r="2.5" /><circle cx="18" cy="17" r="2.5" /></svg>;
}

function toProviderErrorMessage(error: unknown, provider: Provider) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "NETEASE_ACCOUNT_REQUIRED" || error.code === "QQMUSIC_ACCOUNT_REQUIRED") return "请先在我的页面绑定对应平台账号。";
    if (error.code === "NETEASE_AUTH_EXPIRED" || error.code === "QQMUSIC_AUTH_EXPIRED") return "平台登录已失效，请回我的页面重新绑定。";
    if (error.code === "NETEASE_DISABLED" || error.code === "QQMUSIC_DISABLED") return "该音乐平台当前未启用。";
    if (error.code === "QQMUSIC_TRACK_NOT_FOUND") return "该歌曲没有可用的公开音频，可能受到 VIP 或版权限制；免费歌曲也无法播放时请重新绑定 QQ 音乐。";
    return error.message;
  }
  return error instanceof Error ? error.message : `${provider === "netease" ? "网易云" : "QQ 音乐"}操作失败，请稍后重试。`;
}
