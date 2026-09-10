"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProviderPlaylistDetail,
  ProviderTrackCandidate
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import {
  ProviderAlbumTrackTable,
  ProviderPlaylistDetailView,
  ProviderSearchPage,
  type ProviderPlaylistPickerOption
} from "@/components/provider-search";
import type { AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { getProfileProviderRecommendations } from "@/features/discovery/profile-provider-recommendations";
import { personalizationChangedEvent } from "@/features/personalization/use-personalization-reporter";
import { useFavoriteTracks } from "@/features/favorites/use-favorite-tracks";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import {
  listMergedLocalPlaylistTracks,
  localPlaylistTrackId,
  toProviderTrackRecord,
  upsertLocalPlaylistTrack,
  type LocalPlaylistTrackRecord
} from "@/features/playlist/local-playlist";
import { isLocalPlaylistMirror } from "@/features/playlist/local-playlist-database";
import {
  buildPlaybackStatusMessage,
  prepareTrackForImmediatePlayback,
  preloadProviderTracksInBackground,
  toPlaybackPreparationErrorMessage,
  type BackgroundPreloadHandle
} from "@/features/playback/provider-playback-preparation";
import { downloadProviderTrackToLibrary } from "@/features/playback/provider-track-download";
import {
  getCachedDiscoverData,
  setCachedDiscoverData,
  invalidateDiscoverDataCache
} from "@/features/workspace/page-data-cache";
import {
  SparklesIcon,
  CompassIcon as DiscoverCompassIcon,
  SlidersIcon,
  MicIcon,
  PlayIcon
} from "@/components/icons/DiscoverIcons";
import {
  TasteColdStartDialog,
  DiscoverSection,
  DiscoverArtistRail,
  DiscoverPlaylistRail,
  MoodStationRail,
  PlaylistPicker,
  Feedback,
  DiscoverEmptyState,
  DiscoverSkeleton,
  AppPageBackground,
  genreFilterPills,
  buildCuratedPlaylistCards,
  extractDiscoverArtists,
  providerTrackKey,
  providerPlaylistKey,
  toPlaylistTrackActions,
  toErrorMessage,
  moodStations,
  type Track,
  type DiscoverData,
  type Detail,
  type DiscoverPlaylistCard,
  type DiscoverTrackActions
} from "./index";

export function DiscoverPage() {
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
  const [data, setData] = useState<DiscoverData | null>(() =>
    activeSession ? getCachedDiscoverData(activeSession.userId) ?? null : null
  );
  const [loading, setLoading] = useState(() =>
    !(activeSession && getCachedDiscoverData(activeSession.userId))
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [favoritePlaylistKeys, setFavoritePlaylistKeys] = useState<Set<string>>(new Set());
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(null);
  const [playlistPickerAnchor, setPlaylistPickerAnchor] = useState<AnchoredDialogAnchor | null>(null);
  const [playlistPickerOptions, setPlaylistPickerOptions] = useState<ProviderPlaylistPickerOption[]>([]);
  const [playlistPickerLoading, setPlaylistPickerLoading] = useState(false);
  const [activeFilterId, setActiveFilterId] = useState<string>("all");
  const [showColdStartDialog, setShowColdStartDialog] = useState(false);
  const [localTracks, setLocalTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  // Background preloader for "play all"-style flows; cancelled when a new flow
  // starts or the page unmounts so stale downloads never keep running.
  const queuePreloadRef = useRef<BackgroundPreloadHandle | null>(null);

  useEffect(() => () => queuePreloadRef.current?.cancel(), []);

  const startQueuePreload = useCallback((tracks: Track[]) => {
    queuePreloadRef.current?.cancel();
    queuePreloadRef.current = preloadProviderTracksInBackground(tracks, {
      concurrency: 2,
      onPrepared: (prepared) => player.updateQueueRecord(prepared.record),
      onSettled: (summary) => {
        if (!summary.cancelled && summary.failed > 0) {
          setErrorMessage(`${summary.failed} 首歌曲预加载失败，播放到对应歌曲时会自动跳过。`);
        }
      }
    });
  }, [player]);

  useEffect(() => {
    if (!activeSession) return;
    let cancelled = false;
    void musicRoomApi.listMyPlaylists().then((lists) => {
      if (cancelled) return;
      const keys = new Set<string>();
      for (const pl of lists) {
        for (const tag of pl.tags) {
          if (tag.startsWith("network:")) {
            const parts = tag.split(":");
            if (parts.length >= 3) {
              keys.add(`${parts[1]}:${parts.slice(2).join(":")}`);
            }
          }
        }
      }
      setFavoritePlaylistKeys(keys);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  useEffect(() => {
    let cancelled = false;
    void listMergedLocalPlaylistTracks().then((tracks) => {
      if (!cancelled) setLocalTracks(tracks);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  const requestVersionRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const lastProfileRefreshAtRef = useRef(0);
  const profileRefreshTimerRef = useRef<number | null>(null);

  const load = useCallback(async (force = false) => {
    if (!activeSession) return;
    if (!force) {
      const cached = getCachedDiscoverData(activeSession.userId);
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }
    }
    const version = ++requestVersionRef.current;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setLoading(true);
    setErrorMessage(null);

    try {
      const recommendations = await getProfileProviderRecommendations({
        signal: controller.signal
      });
      if (controller.signal.aborted || requestVersionRef.current !== version) return;
      setCachedDiscoverData(activeSession.userId, recommendations);
      setData(recommendations);
    } catch (error) {
      if (controller.signal.aborted || requestVersionRef.current !== version) return;
      setErrorMessage(toErrorMessage(error));
    } finally {
      if (requestVersionRef.current === version) setLoading(false);
    }
  }, [activeSession]);

  useEffect(() => {
    if (hydrated && !activeSession) window.location.assign(authEntryHref);
  }, [activeSession, authEntryHref, hydrated]);

  useEffect(() => {
    if (!activeSession) return;
    const cached = getCachedDiscoverData(activeSession.userId);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    void load();
  }, [activeSession, load]);

  useEffect(() => {
    if (!activeSession) return;
    const handlePersonalizationChange = () => {
      const now = Date.now();
      if (now - lastProfileRefreshAtRef.current < 4000) return;
      lastProfileRefreshAtRef.current = now;
      if (profileRefreshTimerRef.current !== null) {
        window.clearTimeout(profileRefreshTimerRef.current);
      }
      profileRefreshTimerRef.current = window.setTimeout(() => {
        invalidateDiscoverDataCache(activeSession.userId);
        void load(true);
      }, 500);
    };

    window.addEventListener(personalizationChangedEvent, handlePersonalizationChange);
    return () => {
      window.removeEventListener(personalizationChangedEvent, handlePersonalizationChange);
      if (profileRefreshTimerRef.current !== null) {
        window.clearTimeout(profileRefreshTimerRef.current);
      }
    };
  }, [activeSession, load]);

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

  async function downloadTrack(track: Track): Promise<boolean> {
    const existing = localTracks.find((item) => item.id === localPlaylistTrackId(track));
    if (existing?.availableOffline) return true;
    if (pending) return false;
    setPending(`download:${track.provider}:${track.providerTrackId}`);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const updatedTrack = await downloadProviderTrackToLibrary({ track, existing });
      setLocalTracks((current) => [...current.filter((item) => item.id !== updatedTrack.id), updatedTrack]);
      setStatusMessage(`《${updatedTrack.title}》已下载到本地音乐目录。`);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "歌曲下载失败，请稍后重试。");
      return false;
    } finally {
      setPending(null);
    }
  }

  async function openPlaylistPicker(track: Track, anchor: AnchoredDialogAnchor) {
    if (pending) return;
    setPlaylistPickerTrack(track);
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
      setPlaylistPickerAnchor(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加入歌单失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  const playDailyRadarAll = async (tracks: Track[]) => {
    if (!tracks.length) return;
    try {
      setPending("dailyRadar");
      setErrorMessage(null);
      const first = tracks[0]!;
      // First track first: prepare -> play -> preload the rest in background.
      const prepared = await prepareTrackForImmediatePlayback(first);
      await player.playTrack(prepared.record);
      const rest = tracks.slice(1);
      for (const track of rest) {
        player.addToQueue(toProviderTrackRecord(track));
      }
      startQueuePreload(rest);
      setStatusMessage(`已开启今日聚焦全部 ${tracks.length} 首歌曲播放`);
    } catch (error) {
      setErrorMessage(toPlaybackPreparationErrorMessage(error, "播放聚焦歌曲失败，请稍后重试。"));
    } finally {
      setPending(null);
    }
  };

  const trackActions: DiscoverTrackActions = {
    pending,
    isFavorite: (track) => isFavoriteTrack(track),
    isFavoritePending: (track) => pendingFavoriteKey === `${track.provider}:${track.providerTrackId}`,
    isDownloaded: (track) => localTracks.some((item) => item.id === localPlaylistTrackId(track) && item.availableOffline),
    isQueued: (track) => player.queue.some((item) => item.trackId === localPlaylistTrackId(track)),
    onPlay: async (track) => {
      setPending(`play:${track.provider}:${track.providerTrackId}`);
      setErrorMessage(null);
      try {
        const prepared = await prepareTrackForImmediatePlayback(track);
        await player.playTrack(prepared.record);
        setStatusMessage(buildPlaybackStatusMessage(track.title, prepared.source));
      } catch (error) {
        setErrorMessage(toPlaybackPreparationErrorMessage(error, `《${track.title}》播放失败，请稍后重试。`));
      } finally {
        setPending(null);
      }
    },
    onQueue: async (track) => {
      setPending(`queue:${track.provider}:${track.providerTrackId}`);
      setErrorMessage(null);
      try {
        // Queueing prepares the audio too, otherwise the queued item could
        // never start playing once its turn arrives.
        const prepared = await prepareTrackForImmediatePlayback(track);
        player.addToQueue(prepared.record);
        setStatusMessage(`已将《${track.title}》加入播放队列`);
      } catch (error) {
        setErrorMessage(toPlaybackPreparationErrorMessage(error, `《${track.title}》加入队列失败，请稍后重试。`));
      } finally {
        setPending(null);
      }
    },
    onDownload: (track) => {
      void downloadTrack(track);
    },
    onAddToPlaylist: (track, anchor) => {
      void openPlaylistPicker(track, anchor);
    },
    onStartRadio: async (track) => {
      try {
        const radioTracks = await musicRoomApi.getTrackRadio({ seedTrack: track, limit: 15 });
        const prepared = await prepareTrackForImmediatePlayback(track);
        await player.playTrack(prepared.record);
        const queuedTracks = radioTracks.slice(0, 10);
        for (const nextTrack of queuedTracks) {
          player.addToQueue(toProviderTrackRecord(nextTrack));
        }
        startQueuePreload(queuedTracks);
        setStatusMessage(`已开启从《${track.title}》出发的单曲漫游`);
      } catch (error) {
        setErrorMessage(toPlaybackPreparationErrorMessage(error, "开启漫游失败，请稍后重试。"));
      }
    },
    onToggleFavorite: async (track) => {
      await toggleFavoriteTrack(track as ProviderTrackCandidate);
    },
    onFeedback: () => {}
  };

  const playPlaylistAll = useCallback(async (tracks: Track[], title?: string) => {
    if (!tracks.length) return;
    try {
      setPending("playPlaylist");
      setErrorMessage(null);
      const first = tracks[0]!;
      const prepared = await prepareTrackForImmediatePlayback(first);
      await player.playTrack(prepared.record);
      const rest = tracks.slice(1);
      for (const track of rest) {
        player.addToQueue(toProviderTrackRecord(track));
      }
      startQueuePreload(rest);
      setStatusMessage(title ? `正在播放歌单《${title}》` : `已开启全部 ${tracks.length} 首歌曲播放`);
    } catch (error) {
      setErrorMessage(toPlaybackPreparationErrorMessage(error, "播放歌单歌曲失败，请稍后重试。"));
    } finally {
      setPending(null);
    }
  }, [player, startQueuePreload]);

  const toggleFavoritePlaylist = async (playlistDetail: ProviderPlaylistDetail) => {
    const key = providerPlaylistKey(playlistDetail.provider, playlistDetail.providerPlaylistId);
    if (pending) return;
    setPending(`favorite-playlist:${key}`);
    setErrorMessage(null);
    try {
      if (favoritePlaylistKeys.has(key)) {
        const myLists = await musicRoomApi.listMyPlaylists();
        const found = myLists.find((l) => l.tags.includes(`network:${key}`));
        if (found) {
          await musicRoomApi.deletePlaylist(found.id);
        }
        setFavoritePlaylistKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setStatusMessage(`已取消收藏歌单《${playlistDetail.title}》。`);
      } else {
        await musicRoomApi.createPlaylist({
          title: playlistDetail.title,
          description: playlistDetail.description,
          coverUrl: playlistDetail.artworkUrl ?? playlistDetail.tracks.find((t) => t.artworkUrl)?.artworkUrl ?? null,
          isCollaborative: false,
          tags: ["network", `network:${key}`, ...playlistDetail.tags].slice(0, 20),
          trackIds: playlistDetail.tracks.map((t) => `provider:${t.provider}:${t.providerTrackId}`)
        });
        await Promise.all(playlistDetail.tracks.map(async (track) => {
          try {
            await upsertLocalPlaylistTrack(toProviderTrackRecord(track));
          } catch {
            // The saved network playlist remains authoritative even if local cache fails
          }
        }));
        setFavoritePlaylistKeys((prev) => new Set(prev).add(key));
        setStatusMessage(`《${playlistDetail.title}》已保存到我的歌单。`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "操作歌单失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  };

  const openPlaylist = async (card: DiscoverPlaylistCard) => {
    const { playlist } = card;
    const key = `playlist:${playlist.provider}:${playlist.providerPlaylistId}`;

    // If tracks are already present in memory (e.g. Daily Mix or curated genre playlists):
    if (card.tracks && card.tracks.length > 0) {
      setDetail({
        summary: playlist,
        value: {
          ...playlist,
          tracks: card.tracks
        }
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // If it's a curated playlist with no tracks:
    if (playlist.providerPlaylistId.startsWith("music-room-curated:")) {
      setDetail({
        summary: playlist,
        value: {
          ...playlist,
          tracks: []
        }
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const version = ++requestVersionRef.current;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setDetailLoading(key);
    try {
      const full = playlist.provider === "netease"
        ? await musicRoomApi.getNeteasePlaylist(playlist.providerPlaylistId)
        : await musicRoomApi.getQqMusicPlaylist(playlist.providerPlaylistId);
      if (controller.signal.aborted || requestVersionRef.current !== version) return;
      setDetail({
        summary: playlist,
        value: full
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      if (controller.signal.aborted || requestVersionRef.current !== version) return;
      setErrorMessage(toErrorMessage(err));
    } finally {
      if (requestVersionRef.current === version) setDetailLoading(null);
    }
  };

  const playPlaylistCard = useCallback(async (card: DiscoverPlaylistCard) => {
    const { playlist } = card;
    const playKey = `play:playlist:${playlist.provider}:${playlist.providerPlaylistId}`;
    setDetailLoading(playKey);
    try {
      let tracks = card.tracks;
      if (!tracks || !tracks.length) {
        if (!playlist.providerPlaylistId.startsWith("music-room-curated:")) {
          const full = playlist.provider === "netease"
            ? await musicRoomApi.getNeteasePlaylist(playlist.providerPlaylistId)
            : await musicRoomApi.getQqMusicPlaylist(playlist.providerPlaylistId);
          tracks = full.tracks;
        }
      }
      if (tracks && tracks.length > 0) {
        await playPlaylistAll(tracks, playlist.title);
      } else {
        setErrorMessage(`歌单《${playlist.title}》暂无可用曲目。`);
      }
    } catch (err) {
      setErrorMessage(toErrorMessage(err));
    } finally {
      setDetailLoading(null);
    }
  }, [playPlaylistAll]);

  if (!hydrated || !activeSession) return <div className="min-h-[100dvh] bg-background" />;

  if (detail) {
    return (
      <main className="workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
        <AppPageBackground />
        <div className="workspace-page__inner workspace-page__inner--wide pt-3 sm:pt-6 md:pt-8">
          <ProviderPlaylistDetailView
            isFavorite={favoritePlaylistKeys.has(providerPlaylistKey(detail.value.provider, detail.value.providerPlaylistId))}
            onBack={() => setDetail(null)}
            onPlayAll={(tracks) => playPlaylistAll(tracks, detail.value.title)}
            onToggleFavorite={() => toggleFavoritePlaylist(detail.value)}
            pending={pending}
            playlist={detail.value}
            trackActions={toPlaylistTrackActions(trackActions)}
          />
          <Feedback errorMessage={errorMessage} statusMessage={statusMessage} />
        </div>
        <PlaylistPicker
          anchor={playlistPickerAnchor}
          loading={playlistPickerLoading}
          pending={pending}
          track={playlistPickerTrack}
          options={playlistPickerOptions}
          onClose={() => {
            if (!pending) {
              setPlaylistPickerTrack(null);
              setPlaylistPickerAnchor(null);
            }
          }}
          onSelect={addTrackToPlaylist}
        />
      </main>
    );
  }

  const activeFilter = genreFilterPills.find((pill) => pill.id === activeFilterId);
  const matchesFilter = (text: string) => {
    if (!activeFilter || activeFilter.id === "all") return true;
    const lower = text.toLowerCase();
    return (activeFilter.keywords ?? []).some((kw) => lower.includes(kw.toLowerCase()));
  };

  const filterTrackList = (list: { candidate: Track; reasons: string[] }[]) => {
    if (activeFilterId === "all") return list;
    return list.filter((item) =>
      matchesFilter(item.candidate.title) ||
      matchesFilter(item.candidate.artist) ||
      matchesFilter(item.candidate.album ?? "") ||
      (item.candidate.tags ?? []).some(matchesFilter) ||
      item.reasons.some(matchesFilter)
    );
  };

  const curatedPlaylists = data ? buildCuratedPlaylistCards(data) : [];
  const recommendedPlaylists: DiscoverPlaylistCard[] = data
    ? [...data.playlists, ...curatedPlaylists]
    : [];
  const filteredPlaylists = activeFilterId === "all"
    ? recommendedPlaylists
    : recommendedPlaylists.filter((p) => matchesFilter(p.playlist.title) || matchesFilter(p.playlist.description ?? "") || (p.playlist.tags ?? []).some(matchesFilter));

  const allRecommendedTracks = data
    ? [...data.forYou, ...data.deepCuts, ...data.moodDiscovery, ...data.familiarArtists]
    : [];
  const filteredTopTracks = filterTrackList(allRecommendedTracks).map((item) => item.candidate).slice(0, 10);
  const familiarArtists = data ? extractDiscoverArtists(data) : [];

  const topArtistItem = data?.familiarArtists[0] || data?.forYou[0];
  const topArtist = topArtistItem?.candidate.artist ?? null;
  const inspiredTracks = topArtist
    ? Array.from(
        new Map(
          allRecommendedTracks
            .filter(
              (item) =>
                item.candidate.artist.toLowerCase().includes(topArtist.toLowerCase()) ||
                item.reasons.some((r) => r.includes(topArtist))
            )
            .map((item) => [providerTrackKey(item.candidate), item.candidate])
        ).values()
      ).slice(0, 6)
    : [];

  const deepCutTracks = (data?.deepCuts ?? []).map((i) => i.candidate).slice(0, 6);
  const dailyMixCards = recommendedPlaylists.filter((p) => p.playlist.providerPlaylistId.startsWith("music-room-curated:daily-mix-"));
  const otherPlaylists = filteredPlaylists.filter((p) => !p.playlist.providerPlaylistId.startsWith("music-room-curated:daily-mix-"));

  const hasContent = Boolean(data?.forYou.length || data?.familiarArtists.length || data?.moodDiscovery.length || data?.deepCuts.length || data?.playlists.length);
  const noProfile = Boolean(data && !hasContent);
  const noAccounts = Boolean(data && data.providers.length === 0);

  const playMoodStation = async (station: (typeof moodStations)[0]) => {
    setPending(`mood:${station.id}`);
    try {
      const allPool = [
        ...(data?.dailyRadar?.tracks ?? []),
        ...(data?.forYou ?? []).map((i) => i.candidate),
        ...(data?.moodDiscovery ?? []).map((i) => i.candidate),
        ...(data?.deepCuts ?? []).map((i) => i.candidate),
        ...(data?.familiarArtists ?? []).map((i) => i.candidate)
      ];
      const uniquePool = Array.from(
        new Map(allPool.map((t) => [providerTrackKey(t), t])).values()
      );
      const matched = uniquePool.filter((track) => {
        const text = `${track.title} ${track.artist} ${track.album ?? ""} ${(track.tags ?? []).join(" ")}`.toLowerCase();
        return (station.keywords ?? []).some((kw) => text.includes(kw.toLowerCase()));
      });
      const tracksToPlay = matched.length > 0 ? matched : uniquePool;
      if (tracksToPlay.length > 0) {
        const first = tracksToPlay[0]!;
        const prepared = await prepareTrackForImmediatePlayback(first);
        await player.playTrack(prepared.record);
        const queuedTracks = tracksToPlay.slice(1, 10);
        for (const t of queuedTracks) {
          player.addToQueue(toProviderTrackRecord(t));
        }
        startQueuePreload(queuedTracks);
        setStatusMessage(`正在播放「${station.title}」专属场景电台`);
      }
    } catch (error) {
      setErrorMessage(toPlaybackPreparationErrorMessage(error, "播放电台失败，请稍后重试。"));
    } finally {
      setPending(null);
    }
  };

  return (
    <main className="workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="workspace-page__inner workspace-page__inner--wide pb-[calc(var(--room-mobile-bottom-inset)+2.5rem)] pt-[calc(0.875rem+env(safe-area-inset-top))] sm:pt-8 md:pt-10 md:pb-28">
        {/* Mobile Page Header for proper ergonomics */}
        <header className="workspace-page__header mb-2.5 flex items-center justify-between md:hidden">
          <div>
            <h1 className="workspace-page__title">发现</h1>
          </div>
          <Link
            aria-label="打开个人中心"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-foreground-muted shadow-sm transition-all hover:bg-white/10 hover:text-foreground active:scale-95"
            href="/app/profile"
          >
            <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>
          </Link>
        </header>

        {/* Search header integration */}
        <ProviderSearchPage embedded inlineSearch />

        {/* Genre & Scene Filter Pills (Artistic Capsules) */}
        <div className="mt-3 mb-6 flex items-center gap-2 overflow-x-auto pb-1 hide-scrollbar touch-pan-x">
          {genreFilterPills.map((pill) => {
            const IconComp = pill.icon;
            const active = activeFilterId === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setActiveFilterId(pill.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150 border ${
                  active
                    ? "bg-white/[0.12] text-white border-white/[0.16]"
                    : "bg-white/[0.03] hover:bg-white/[0.06] text-foreground-muted hover:text-white border-white/[0.06]"
                }`}
              >
                <IconComp className="w-3.5 h-3.5 shrink-0" />
                <span>{pill.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowColdStartDialog(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground-muted hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] ml-auto shrink-0 transition-colors"
            title="定制偏好"
          >
            <SlidersIcon className="w-3.5 h-3.5 text-accent" />
            <span className="hidden sm:inline">偏好定制</span>
          </button>
        </div>

        {loading && !data ? <DiscoverSkeleton /> : null}

        {/* Filtered Genre Radar Spotlight */}
        {activeFilterId !== "all" && filteredTopTracks.length > 0 ? (
          <section className="relative mb-8 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#121216] p-4 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="space-y-0.5">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">{activeFilter?.label}精选推荐</h2>
              </div>
              <Button
                type="button"
                disabled={pending !== null}
                onClick={() => playDailyRadarAll(filteredTopTracks)}
                size="sm"
                className="rounded-lg px-4 py-2 bg-accent hover:bg-accent-hover text-white font-medium shadow-sm transition-all active:scale-95 text-xs sm:text-sm self-start sm:self-auto"
              >
                <PlayIcon className="w-3.5 h-3.5 mr-1.5" />
                <span>播放全部</span>
              </Button>
            </div>
            <div className="pt-2 border-t border-white/[0.06]">
              <div className="max-h-[560px] overflow-y-auto hide-scrollbar">
                <ProviderAlbumTrackTable
                  actions={toPlaylistTrackActions(trackActions)}
                  showToolbar={false}
                  tracks={filteredTopTracks}
                />
              </div>
            </div>
          </section>
        ) : null}

        {!loading && noAccounts ? <DiscoverEmptyState title="连接音乐平台后开始发现" description="绑定网易云音乐或 QQ 音乐后，发现页会从你的听歌画像召回新的歌曲和歌单。" actionHref="/app/settings" actionLabel="前往绑定" /> : null}
        {!loading && !noAccounts && noProfile ? <DiscoverEmptyState title="开始探索你的专属推荐" description="在 Music Room 播放或收藏歌曲，或通过偏好设置快速定制你的专属雷达。" actionLabel="定制音乐偏好" onAction={() => setShowColdStartDialog(true)} /> : null}
        {!loading && !noAccounts && !noProfile && !hasContent ? <DiscoverEmptyState title="暂无新内容" description="可以稍后刷新，或继续聆听几首歌曲来扩展推荐线索。" actionLabel="重新加载" onAction={() => void load()} /> : null}

        {/* Section 1: Made For You · Daily Mix Matrix */}
        {dailyMixCards.length && activeFilterId === "all" ? (
          <DiscoverSection
            title="Daily Mix"
            icon={<SparklesIcon className="w-4 h-4 text-accent" />}
          >
            <DiscoverPlaylistRail items={dailyMixCards} loadingKey={detailLoading} onOpen={openPlaylist} onPlay={playPlaylistCard} />
          </DiscoverSection>
        ) : null}

        {/* Section 2: Familiar Artists & Radios (Circle Avatar Rail) */}
        {familiarArtists.length && activeFilterId === "all" ? (
          <DiscoverArtistRail
            artists={familiarArtists}
            onStartRadio={async (track) => trackActions.onStartRadio(track)}
            pending={pending}
          />
        ) : null}

        {/* Section 3: All-Day Mood & Atmosphere Stations */}
        {activeFilterId === "all" ? (
          <MoodStationRail onPlayStation={playMoodStation} pending={pending} />
        ) : null}

        {/* Section 4: Contextual Attribution - Inspired By Top Artist */}
        {inspiredTracks.length > 0 && topArtist && activeFilterId === "all" ? (
          <DiscoverSection
            title={`常听歌手 · ${topArtist}`}
            icon={<MicIcon className="w-4 h-4 text-accent" />}
          >
            <div className="rounded-xl border border-white/[0.06] bg-[#121216] p-2 sm:p-4 shadow-sm">
              <ProviderAlbumTrackTable
                actions={toPlaylistTrackActions(trackActions)}
                showToolbar={false}
                tracks={inspiredTracks}
              />
            </div>
          </DiscoverSection>
        ) : null}

        {/* Section 5: Deep Cuts & Hidden Gems */}
        {deepCutTracks.length > 0 && activeFilterId === "all" ? (
          <DiscoverSection
            title="宝藏单曲"
            icon={<DiscoverCompassIcon className="w-4 h-4 text-accent" />}
          >
            <div className="rounded-xl border border-white/[0.06] bg-[#121216] p-2 sm:p-4 shadow-sm">
              <ProviderAlbumTrackTable
                actions={toPlaylistTrackActions(trackActions)}
                showToolbar={false}
                tracks={deepCutTracks}
              />
            </div>
          </DiscoverSection>
        ) : null}

        {/* Section 6: Curated & Thematic Genre Playlists */}
        {otherPlaylists.length ? (
          <DiscoverSection
            title={activeFilterId === "all" ? "精选歌单" : `${activeFilter?.label ?? ""}风格歌单`}
          >
            <DiscoverPlaylistRail items={otherPlaylists} loadingKey={detailLoading} onOpen={openPlaylist} onPlay={playPlaylistCard} />
          </DiscoverSection>
        ) : null}

        <Feedback errorMessage={errorMessage} statusMessage={statusMessage} />
      </div>

      <PlaylistPicker
        anchor={playlistPickerAnchor}
        loading={playlistPickerLoading}
        pending={pending}
        track={playlistPickerTrack}
        options={playlistPickerOptions}
        onClose={() => {
          if (!pending) {
            setPlaylistPickerTrack(null);
            setPlaylistPickerAnchor(null);
          }
        }}
        onSelect={addTrackToPlaylist}
      />

      <TasteColdStartDialog
        isOpen={showColdStartDialog}
        onClose={() => setShowColdStartDialog(false)}
        onCompleted={() => void load()}
      />
    </main>
  );
}
