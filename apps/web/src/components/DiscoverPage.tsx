"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProviderPlaylistDetail,
  ProviderTrackCandidate
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { ProviderPlaylistDetailView } from "@/components/ProviderPlaylistDetailView";
import { type ProviderPlaylistPickerOption } from "@/components/ProviderPlaylistPickerDialog";
import { ProviderSearchPage } from "@/components/ProviderSearchPage";
import type { AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { getProfileProviderRecommendations } from "@/features/discovery/profile-provider-recommendations";
import { personalizationChangedEvent } from "@/features/personalization/use-personalization-reporter";
import { useFavoriteTracks } from "@/features/favorites/use-favorite-tracks";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import {
  hashAudioBlob,
  listMergedLocalPlaylistTracks,
  localPlaylistTrackId,
  toProviderTrackRecord,
  upsertLocalPlaylistTrack,
  type LocalPlaylistTrackRecord
} from "@/features/playlist/local-playlist";
import { isLocalPlaylistMirror } from "@/features/playlist/local-playlist-database";
import {
  ensureLocalAudioDirectoryWriteAccess,
  normalizeLocalAudioMimeType,
  saveAudioFileToLocalDirectory
} from "@/features/library/local-audio-storage";
import { analyzeAudioBlobLoudness } from "@/features/playback/loudness";
import { ProviderAlbumTrackTable } from "@/components/ProviderAlbumDetailView";
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
  getTimeContext,
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
} from "@/components/discovery";

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
  const [favoritePlaylistKeys] = useState<Set<string>>(new Set());
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(null);
  const [playlistPickerAnchor, setPlaylistPickerAnchor] = useState<AnchoredDialogAnchor | null>(null);
  const [playlistPickerOptions, setPlaylistPickerOptions] = useState<ProviderPlaylistPickerOption[]>([]);
  const [playlistPickerLoading, setPlaylistPickerLoading] = useState(false);
  const [activeFilterId, setActiveFilterId] = useState<string>("all");
  const [showColdStartDialog, setShowColdStartDialog] = useState(false);
  const [localTracks, setLocalTracks] = useState<LocalPlaylistTrackRecord[]>([]);

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
      const resolvedTrack = await resolveTrackArtwork(track);
      await ensureLocalAudioDirectoryWriteAccess();
      const response = resolvedTrack.provider === "netease"
        ? await musicRoomApi.downloadNeteaseTrack(resolvedTrack.providerTrackId)
        : await musicRoomApi.downloadQqMusicTrack(resolvedTrack.providerTrackId);
      const fileHash = await hashAudioBlob(response.blob);
      const mimeType = normalizeLocalAudioMimeType(response.contentType || response.blob.type);
      const loudness = await analyzeAudioBlobLoudness(response.blob);
      const lyricPayload = existing?.lyrics
        ? null
        : await (resolvedTrack.provider === "netease"
          ? musicRoomApi.getNeteaseLyrics(resolvedTrack.providerTrackId)
          : musicRoomApi.getQqMusicLyrics(resolvedTrack.providerTrackId)
        ).catch(() => null);
      const lyrics = existing?.lyrics ?? lyricPayload?.wordSyncedLyric ?? lyricPayload?.plainLyric ?? null;
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
          translatedLyrics: lyricPayload?.translatedLyric ?? null,
          romanizedLyrics: lyricPayload?.romanizedLyric ?? null,
          provider: resolvedTrack.provider,
          providerTrackId: resolvedTrack.providerTrackId,
          durationMs: resolvedTrack.durationMs,
          sizeBytes: response.blob.size
        }
      });
      const updatedTrack: LocalPlaylistTrackRecord = {
        ...toProviderTrackRecord(resolvedTrack, existing),
        artworkUrl: saved.artworkUrl ?? resolvedTrack.artworkUrl,
        fileHash,
        fileName: saved.fileName,
        sizeBytes: response.blob.size,
        mimeType,
        lyrics,
        translatedLyrics: lyricPayload?.translatedLyric ?? null,
        romanizedLyrics: lyricPayload?.romanizedLyric ?? null,
        ...(loudness ? { loudness } : {}),
        availableOffline: true,
        updatedAt: new Date().toISOString()
      };
      await upsertLocalPlaylistTrack(updatedTrack);
      setLocalTracks((current) => [...current.filter((item) => item.id !== updatedTrack.id), updatedTrack]);
      setStatusMessage(`《${resolvedTrack.title}》已下载到本地目录。`);
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
      const seed = toProviderTrackRecord(tracks[0]);
      await player.playTrack(seed);
      for (const track of tracks.slice(1)) {
        player.addToQueue(toProviderTrackRecord(track));
      }
      setStatusMessage(`已开启今日聚焦全部 ${tracks.length} 首歌曲播放`);
    } catch {
      setErrorMessage("播放聚焦歌曲失败，请稍后重试。");
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
      const record = toProviderTrackRecord(track);
      await player.playTrack(record);
      setStatusMessage(`正在播放《${track.title}》`);
    },
    onQueue: (track) => {
      const record = toProviderTrackRecord(track);
      player.addToQueue(record);
      setStatusMessage(`已将《${track.title}》加入播放队列`);
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
        const seedRecord = toProviderTrackRecord(track);
        await player.playTrack(seedRecord);
        for (const nextTrack of radioTracks.slice(0, 10)) {
          player.addToQueue(toProviderTrackRecord(nextTrack));
        }
        setStatusMessage(`已开启从《${track.title}》出发的单曲漫游`);
      } catch {
        setErrorMessage("开启漫游失败，请稍后重试。");
      }
    },
    onToggleFavorite: async (track) => {
      await toggleFavoriteTrack(track as ProviderTrackCandidate);
    },
    onFeedback: () => {}
  };

  const toggleFavoritePlaylist = async (_playlist: ProviderPlaylistDetail) => {};

  const openPlaylist = async (card: DiscoverPlaylistCard) => {
    const { playlist } = card;
    const key = `playlist:${playlist.provider}:${playlist.providerPlaylistId}`;
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
    } catch {
      if (controller.signal.aborted || requestVersionRef.current !== version) return;
      setErrorMessage("打开歌单失败，请稍后重试。");
    } finally {
      if (requestVersionRef.current === version) setDetailLoading(null);
    }
  };

  if (!hydrated || !activeSession) return <div className="min-h-[100dvh] bg-background" />;

  if (detail) {
    return (
      <main className="workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
        <AppPageBackground />
        <div className="workspace-page__inner workspace-page__inner--wide pt-3 sm:pt-6 md:pt-8">
          <ProviderPlaylistDetailView
            isFavorite={favoritePlaylistKeys.has(providerPlaylistKey(detail.value.provider, detail.value.providerPlaylistId))}
            onBack={() => setDetail(null)}
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
  const timeContext = getTimeContext();

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
        await player.playTrack(toProviderTrackRecord(first));
        for (const t of tracksToPlay.slice(1, 10)) {
          player.addToQueue(toProviderTrackRecord(t));
        }
        setStatusMessage(`正在播放「${station.title}」专属场景电台`);
      }
    } catch {
      setErrorMessage("播放电台失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  };

  return (
    <main className="workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="workspace-page__inner workspace-page__inner--wide pb-[calc(var(--room-mobile-bottom-inset)+2.5rem)] pt-4 sm:pt-8 md:pt-10 md:pb-28">
        {/* Search header integration */}
        <ProviderSearchPage embedded inlineSearch />

        {/* Genre & Scene Filter Pills (Artistic Capsules) */}
        <div className="mt-4 mb-7 flex items-center gap-2 overflow-x-auto pb-1 hide-scrollbar touch-pan-x">
          {genreFilterPills.map((pill) => {
            const IconComp = pill.icon;
            const active = activeFilterId === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setActiveFilterId(pill.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-150 border ${
                  active
                    ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)] border-accent scale-[1.02]"
                    : "bg-[#10121a]/80 hover:bg-white/[0.08] text-foreground-muted hover:text-white border-white/[0.06]"
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
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-medium text-foreground-muted hover:text-white bg-[#10121a]/80 hover:bg-white/[0.08] border border-white/[0.06] ml-auto shrink-0 transition-colors"
            title="定制偏好"
          >
            <SlidersIcon className="w-3.5 h-3.5 text-accent" />
            <span className="hidden sm:inline">偏好定制</span>
          </button>
        </div>

        {loading && !data ? <DiscoverSkeleton /> : null}

        {/* Editorial Spotlight Hero Card (Aurora Discovery Stage) */}
        {data?.dailyRadar && data.dailyRadar.tracks.length > 0 && activeFilterId === "all" ? (
          <section className="relative mb-10 overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#161a29]/90 via-[#0f121d]/95 to-[#090b11] p-4 sm:p-6 md:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
            {/* Ambient Aurora Glow */}
            <div className="absolute -top-16 -right-16 w-80 h-80 rounded-full bg-[radial-gradient(circle,#0070f322_0%,#38bdf80a_50%,transparent_70%)] blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 left-1/3 w-64 h-64 rounded-full bg-[radial-gradient(circle,#c026d318_0%,transparent_65%)] blur-2xl pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2.5 max-w-2xl">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold text-accent bg-accent/15 border border-accent/20 uppercase tracking-wider">
                  <SparklesIcon className="w-3.5 h-3.5" />
                  <span>{timeContext.greeting} · 今日精选聚焦 ({data.dailyRadar.date})</span>
                </div>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight">
                  {data.dailyRadar.title}
                </h1>
                <p className="text-xs sm:text-sm text-foreground-muted/90 leading-relaxed">
                  {data.dailyRadar.subtitle || timeContext.subtitle}
                </p>
                {data.dailyRadar.summaryGenres.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1.5">
                    {data.dailyRadar.summaryGenres.map((g) => (
                      <span key={g} className="px-3 py-1 rounded-xl text-xs font-medium bg-white/[0.06] text-white border border-white/[0.08]">
                        #{g}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <Button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => playDailyRadarAll(data.dailyRadar!.tracks)}
                  className="rounded-xl px-6 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold shadow-[0_4px_20px_var(--accent-glow)] transition-all active:scale-95"
                >
                  <PlayIcon className="w-4 h-4 mr-2" />
                  <span>一键播放全部</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowColdStartDialog(true)}
                  className="rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white px-3.5 border-white/[0.08]"
                  title="调整偏好"
                >
                  <SlidersIcon className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Top Recommended Radar Tracklist */}
            <div className="relative z-10 mt-6 pt-5 border-t border-white/[0.08]">
              <div className="max-h-[560px] overflow-y-auto hide-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pr-0.5">
                <ProviderAlbumTrackTable
                  actions={toPlaylistTrackActions(trackActions)}
                  showToolbar={false}
                  tracks={data.dailyRadar.tracks}
                />
              </div>
            </div>
          </section>
        ) : null}

        {/* Filtered Genre Radar Spotlight */}
        {activeFilterId !== "all" && filteredTopTracks.length > 0 ? (
          <section className="relative mb-10 overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#161a29]/90 via-[#0f121d]/95 to-[#090b11] p-4 sm:p-6 md:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold text-accent bg-accent/15 border border-accent/20">
                  <SparklesIcon className="w-3.5 h-3.5" />
                  <span>{activeFilter?.label}精选雷达</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{activeFilter?.label}精选推荐单曲</h2>
              </div>
              <Button
                type="button"
                disabled={pending !== null}
                onClick={() => playDailyRadarAll(filteredTopTracks)}
                className="rounded-xl px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold shadow-[0_4px_16px_var(--accent-glow)] transition-all active:scale-95"
              >
                <PlayIcon className="w-4 h-4 mr-2" />
                <span>一键播放全部</span>
              </Button>
            </div>
            <div className="relative z-10 pt-2 border-t border-white/[0.08]">
              <div className="max-h-[560px] overflow-y-auto hide-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pr-0.5">
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
            title="专属定制 · Daily Mix"
            subtitle="根据你的听歌风格与歌手偏好，每日动态更新的 4 张专属混合歌单"
            icon={<SparklesIcon className="w-5 h-5 text-accent" />}
          >
            <DiscoverPlaylistRail items={dailyMixCards} loadingKey={detailLoading} onOpen={openPlaylist} />
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
            title={`因为你常听 ${topArtist} 推荐`}
            subtitle="延续你喜爱的音乐质感与编曲风格，精选相似风格单曲"
            icon={<MicIcon className="w-5 h-5 text-accent" />}
          >
            <div className="rounded-2xl border border-white/[0.06] bg-[#10121a]/80 p-3 sm:p-4 shadow-md backdrop-blur-xl">
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
            title="小众宝藏与深度挖掘"
            subtitle="低热度高契合度的私藏佳作与冷门好歌"
            icon={<DiscoverCompassIcon className="w-5 h-5 text-accent" />}
          >
            <div className="rounded-2xl border border-white/[0.06] bg-[#10121a]/80 p-3 sm:p-4 shadow-md backdrop-blur-xl">
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
            title={activeFilterId === "all" ? "精选推荐歌单" : `${activeFilter?.label ?? ""}风格歌单`}
            subtitle={activeFilterId === "all" ? "汇聚多元曲风、场景与平台精选歌单" : `探索更多关于${activeFilter?.label ?? ""}的精选合辑`}
          >
            <DiscoverPlaylistRail items={otherPlaylists} loadingKey={detailLoading} onOpen={openPlaylist} />
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
