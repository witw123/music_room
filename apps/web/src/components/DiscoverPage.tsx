"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProviderPlaylistDetail,
  ProviderPlaylistSummary,
  ProviderTrackCandidate
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { ProviderPlaylistDetailView } from "@/components/ProviderPlaylistDetailView";
import { ProviderPlaylistPickerDialog, type ProviderPlaylistPickerOption } from "@/components/ProviderPlaylistPickerDialog";
import { ProviderSearchPage } from "@/components/ProviderSearchPage";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import type { AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { MusicRoomApiError, musicRoomApi } from "@/lib/network/music-room-api";
import { getProfileProviderRecommendations, type DiscoverPlaylistRecommendation, type DiscoverTrackRecommendation, type ProfileProviderRecommendations } from "@/features/discovery/profile-provider-recommendations";
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
  VolumeIcon,
  ZapIcon,
  SakuraIcon,
  LaptopIcon,
  MoonIcon,
  LandmarkIcon,
  PlayIcon
} from "@/components/icons/DiscoverIcons";
import { TasteColdStartDialog } from "@/components/discovery/TasteColdStartDialog";

type Provider = "netease" | "qqmusic";
type Track = ProviderTrackCandidate;
type DiscoverData = ProfileProviderRecommendations;
type Detail = { summary: ProviderPlaylistSummary; value: ProviderPlaylistDetail };
type DiscoverPlaylistCard = DiscoverPlaylistRecommendation & {
  tracks?: Track[];
};

const genreFilterPills = [
  { id: "all", label: "全部", icon: SparklesIcon },
  { id: "pop", label: "流行", icon: MicIcon, keywords: ["流行", "pop", "主打"] },
  { id: "rock", label: "摇滚", icon: VolumeIcon, keywords: ["摇滚", "rock", "朋克", "金属", "metal", "punk"] },
  { id: "electronic", label: "电子", icon: ZapIcon, keywords: ["电子", "edm", "house", "techno", "电音", "synth"] },
  { id: "acg", label: "ACG", icon: SakuraIcon, keywords: ["acg", "anime", "二次元", "动漫", "动画", "游戏", "vocaloid", "日系", "j-pop"] },
  { id: "focus", label: "专注", icon: LaptopIcon, keywords: ["专注", "学习", "工作", "轻音乐", "纯音乐", "lo-fi", "chill", "白噪音"] },
  { id: "night", label: "夜听", icon: MoonIcon, keywords: ["夜听", "深夜", "夜晚", "晚安", "治愈", "r&b", "soul"] },
  { id: "guofeng", label: "国风", icon: LandmarkIcon, keywords: ["国风", "古风", "仙侠", "华语", "戏腔", "新中式"] }
];

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
      // A slower earlier request must not overwrite the detail the user asked
      // for last; the version check mirrors the list loader above.
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

  const activeFilter = genreFilterPills.find((p) => p.id === activeFilterId);
  const matchesFilter = (text: string) => {
    if (!activeFilter || activeFilter.id === "all" || !activeFilter.keywords) return true;
    const lower = text.toLowerCase();
    return activeFilter.keywords.some((kw) => lower.includes(kw.toLowerCase()));
  };

  const filterTrackList = (list: DiscoverTrackRecommendation[]) => {
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
  
  const hasContent = Boolean(data?.forYou.length || data?.familiarArtists.length || data?.moodDiscovery.length || data?.deepCuts.length || data?.playlists.length);
  const noProfile = Boolean(data && !hasContent);
  const noAccounts = Boolean(data && data.providers.length === 0);

  const timeContext = getTimeContext();

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

        {/* Familiar Artists & Radios (Circle Avatar Rail) */}
        {familiarArtists.length && activeFilterId === "all" ? (
          <DiscoverArtistRail
            artists={familiarArtists}
            onStartRadio={async (track) => trackActions.onStartRadio(track)}
            pending={pending}
          />
        ) : null}

        {/* Featured / Recommended Playlists Area (Sole Recommendation Area) */}
        {filteredPlaylists.length ? (
          <DiscoverSection title={activeFilterId === "all" ? "推荐歌单" : `${activeFilter?.label ?? ""}风格歌单`}>
            <DiscoverPlaylistRail items={filteredPlaylists} loadingKey={detailLoading} onOpen={openPlaylist} />
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

type DiscoverTrackActions = {
  pending: string | null;
  isFavorite: (track: Track) => boolean;
  isFavoritePending: (track: Track) => boolean;
  isDownloaded: (track: Track) => boolean;
  isQueued: (track: Track) => boolean;
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  onDownload: (track: Track) => void;
  onAddToPlaylist: (track: Track, anchor: AnchoredDialogAnchor) => void;
  onStartRadio: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  onFeedback: (track: Track, action: "not-interested" | "exclude-from-profile") => void;
};

type DiscoverArtistItem = {
  artistName: string;
  representativeTrack: Track;
  artworkUrl: string | null;
  trackCount: number;
  reason: string;
};

function extractDiscoverArtists(data: ProfileProviderRecommendations): DiscoverArtistItem[] {
  const map = new Map<string, DiscoverArtistItem>();
  const candidates = [...data.familiarArtists, ...data.forYou];
  for (const item of candidates) {
    const artist = item.candidate.artist?.trim();
    if (!artist) continue;
    if (!map.has(artist)) {
      map.set(artist, {
        artistName: artist,
        representativeTrack: item.candidate,
        artworkUrl: item.candidate.artworkUrl ?? null,
        trackCount: 1,
        reason: item.reasons[0] ?? "常听歌手"
      });
    } else {
      map.get(artist)!.trackCount += 1;
    }
  }
  return Array.from(map.values()).slice(0, 8);
}

function DiscoverArtistRail({
  artists,
  onStartRadio,
  pending
}: {
  artists: DiscoverArtistItem[];
  onStartRadio: (track: Track) => Promise<void>;
  pending: string | null;
}) {
  if (!artists.length) return null;
  return (
    <DiscoverSection
      title="常听歌手与单曲漫游"
      subtitle="基于你的听歌画像，一键开启专属风格电台漫游"
      icon={<MicIcon className="w-5 h-5 text-accent" />}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {artists.map((item) => {
          return (
            <button
              key={item.artistName}
              type="button"
              disabled={pending !== null}
              onClick={() => void onStartRadio(item.representativeTrack)}
              className="group flex flex-col items-center text-center p-3 rounded-2xl border border-white/[0.06] bg-gradient-to-b from-[#12141c]/80 to-[#0c0e15]/90 hover:border-white/[0.14] hover:bg-[#181a26]/90 transition-all hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent shadow-sm"
              title={`开启 ${item.artistName} 专属漫游`}
            >
              <div className="relative aspect-square w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-surface-elevated border-2 border-white/10 shadow-md group-hover:border-accent transition-all">
                <Artwork
                  alt={item.artistName}
                  className="h-full w-full object-cover block transition duration-300 group-hover:scale-110"
                  src={item.artworkUrl}
                />
                <span className="absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/35" />
                <span className="absolute inset-0 flex items-center justify-center text-white opacity-0 transition group-hover:opacity-100 scale-90 group-hover:scale-100">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white shadow-[0_2px_10px_var(--accent-glow)]">
                    <PlayIcon className="w-3.5 h-3.5 ml-0.5" />
                  </span>
                </span>
              </div>
              <p className="mt-2.5 truncate w-full text-xs font-semibold text-white group-hover:text-accent transition-colors">
                {item.artistName}
              </p>
              <p className="mt-0.5 truncate w-full text-[10px] text-foreground-muted">
                {item.reason}
              </p>
            </button>
          );
        })}
      </div>
    </DiscoverSection>
  );
}

function DiscoverSection({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10 sm:mt-12">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">{title}</h2>
        </div>
        {subtitle ? <p className="mt-1 text-xs text-foreground-muted">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function getTimeContext() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) {
    return {
      greeting: "清晨时光",
      badge: "晨光清醒",
      subtitle: "用元气旋律唤醒灵感，开启清爽充沛的一天。"
    };
  }
  if (hour >= 11 && hour < 14) {
    return {
      greeting: "正午小憩",
      badge: "午后放松",
      subtitle: "轻快旋律伴你舒缓身心，享受片刻惬意闲适。"
    };
  }
  if (hour >= 14 && hour < 18) {
    return {
      greeting: "午后专注",
      badge: "工作专注",
      subtitle: "沉浸式器乐与流动节拍，提升思考与专注效率。"
    };
  }
  if (hour >= 18 && hour < 22) {
    return {
      greeting: "傍晚微醺",
      badge: "晚间放松",
      subtitle: "卸下一天的疲惫，在律动与温润声线中归于平静。"
    };
  }
  return {
    greeting: "深夜私享",
    badge: "夜听疗愈",
    subtitle: "漫漫长夜，用温柔纯净的声响陪伴静谧思绪。"
  };
}

function DiscoverPlaylistRail({ items, onOpen, loadingKey }: { items: DiscoverPlaylistCard[]; onOpen: (card: DiscoverPlaylistCard) => Promise<void>; loadingKey: string | null }) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => {
        const { playlist } = item;
        const loading = !item.tracks && loadingKey === `playlist:${playlist.provider}:${playlist.providerPlaylistId}`;
        const isDailyMix = playlist.providerPlaylistId.startsWith("music-room-curated:daily-mix-");
        const mixNumber = isDailyMix ? playlist.providerPlaylistId.replace("music-room-curated:daily-mix-", "") : null;
        return (
          <button
            aria-label={`打开歌单《${playlist.title}》`}
            className="group flex min-w-0 max-w-full flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-[#12141c]/80 to-[#0c0e15]/90 p-2.5 text-left transition-all duration-200 hover:-translate-y-1 hover:border-white/[0.14] hover:bg-[#181a26]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            disabled={loading}
            key={providerPlaylistKey(playlist.provider, playlist.providerPlaylistId)}
            onClick={() => void onOpen(item)}
            type="button"
          >
            <div className="relative aspect-square min-w-0 w-full max-w-full overflow-hidden rounded-xl bg-surface-elevated border border-white/10 shadow-md">
              <Artwork
                alt={playlist.title}
                className="absolute inset-0 h-full w-full object-cover block transition duration-300 group-hover:scale-105"
                src={playlist.artworkUrl}
              />
              <span className="absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/25" />
              {isDailyMix && mixNumber ? (
                <div className="absolute top-2 left-2 z-10 rounded-md bg-black/70 backdrop-blur-md px-2 py-0.5 text-[9px] font-black tracking-widest uppercase text-white border border-white/20 shadow-md">
                  MIX {mixNumber}
                </div>
              ) : null}
              <span className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white opacity-100 shadow-[0_4px_16px_var(--accent-glow)] transition-all duration-200 sm:opacity-0 sm:group-hover:opacity-100 scale-100 sm:scale-95 sm:group-hover:scale-100">
                {loading ? <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <PlayIcon className="w-4 h-4" />}
              </span>
            </div>
            <p className="mt-2.5 line-clamp-2 text-xs sm:text-sm font-semibold leading-tight text-white group-hover:text-accent transition-colors" title={playlist.title}>
              {playlist.title}
            </p>
            <p className="mt-1 truncate text-[11px] text-foreground-muted" title={playlist.description ?? playlist.creatorName ?? ""}>
              {playlist.description || (playlist.providerPlaylistId.startsWith("music-room-curated:") ? "Music Room 精选" : `${providerLabel(playlist.provider)}${playlist.creatorName ? ` · ${playlist.creatorName}` : ""}`)}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function PlaylistPicker({ track, anchor, options, loading, pending, onClose, onSelect }: { track: Track | null; anchor: AnchoredDialogAnchor | null; options: ProviderPlaylistPickerOption[]; loading: boolean; pending: string | null; onClose: () => void; onSelect: (option: ProviderPlaylistPickerOption) => Promise<void> }) {
  if (!track || !anchor) return null;
  return <ProviderPlaylistPickerDialog anchor={anchor} loading={loading} options={options} pending={pending !== null} subjectLabel={`《${track.title}》 · ${track.artist}`} onClose={onClose} onSelect={(option) => void onSelect(option)} />;
}

function Feedback({ statusMessage, errorMessage }: { statusMessage: string | null; errorMessage: string | null }) {
  return <>{statusMessage ? <p className="mt-5 rounded-2xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-xs text-white" role="status">{statusMessage}</p> : null}{errorMessage ? <p className="mt-5 rounded-2xl bg-red-950/30 border border-red-500/20 px-4 py-3 text-xs text-red-300" role="alert">{errorMessage}</p> : null}</>;
}

function DiscoverEmptyState({ title, description, actionHref, actionLabel, onAction }: { title: string; description: string; actionHref?: string; actionLabel: string; onAction?: () => void }) {
  return (
    <section className="mt-10 flex min-h-64 flex-col items-center justify-center rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#12141c]/90 to-[#0c0e15]/95 px-6 py-12 text-center shadow-xl">
      <div className="p-3.5 rounded-2xl bg-accent/15 border border-accent/25 text-accent mb-4">
        <DiscoverCompassIcon className="w-8 h-8" />
      </div>
      <h2 className="text-base font-bold text-white">{title}</h2>
      <p className="mt-1.5 max-w-sm text-xs text-foreground-muted leading-relaxed">{description}</p>
      {actionHref ? (
        <a className="mt-5 rounded-xl bg-accent hover:bg-accent-hover px-6 py-2.5 text-xs font-semibold text-white transition-all shadow-[0_4px_16px_var(--accent-glow)]" href={actionHref}>
          {actionLabel}
        </a>
      ) : (
        <button className="mt-5 rounded-xl bg-accent hover:bg-accent-hover px-6 py-2.5 text-xs font-semibold text-white transition-all shadow-[0_4px_16px_var(--accent-glow)] active:scale-95" onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </section>
  );
}

function DiscoverSkeleton() {
  return (
    <div aria-label="正在加载个性化发现内容" className="mt-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="animate-pulse p-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.04]" key={index}>
          <div className="aspect-square rounded-xl bg-white/[0.06]" />
          <div className="mt-3 h-3 w-4/5 rounded bg-white/[0.06]" />
          <div className="mt-2 h-2 w-1/2 rounded bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

function Artwork({ alt, src, className = "" }: { alt: string; src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const source = src ? getArtworkSourceUrl(src) : null;
  if (!source || failed) return <span aria-label={alt || undefined} className={`flex min-w-0 max-w-full items-center justify-center overflow-hidden bg-white/[0.06] text-xl text-foreground-muted ${className}`}>♪</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className={`block min-w-0 max-w-full object-cover ${className}`} loading="lazy" onError={() => setFailed(true)} src={source} style={{ display: "block", height: "100%", maxHeight: "100%", maxWidth: "100%", width: "100%" }} />;
}

function toPlaylistTrackActions(actions: DiscoverTrackActions) {
  return {
    isDownloaded: actions.isDownloaded,
    isPlayable: () => true,
    isQueueable: () => true,
    isQueued: actions.isQueued,
    isDownloading: (track: Track) => actions.pending === `download:${track.provider}:${track.providerTrackId}`,
    isPreparingPlayback: (track: Track) => actions.pending === `play:${track.provider}:${track.providerTrackId}` || actions.pending === `queue:${track.provider}:${track.providerTrackId}`,
    onDownload: actions.onDownload,
    onAddToQueue: actions.onQueue,
    onPlay: actions.onPlay,
    onAddToPlaylist: actions.onAddToPlaylist,
    isFavorite: actions.isFavorite,
    isTogglingFavorite: actions.isFavoritePending,
    onToggleFavorite: actions.onToggleFavorite
  };
}

function providerTrackKey(track: Pick<Track, "provider" | "providerTrackId">) {
  return `${track.provider}:${track.providerTrackId}`;
}

function providerPlaylistKey(provider: Provider, playlistId: string) {
  return `${provider}:${playlistId}`;
}

const genreCategoryPresets = [
  { id: "rock", title: "摇滚与能量专栏", description: "充满张力与力量感的摇滚、朋克与独立之声。", tags: ["摇滚", "独立", "能量", "朋克"], keywords: ["摇滚", "rock", "朋克", "金属", "metal", "punk", "硬核"] },
  { id: "electronic", title: "电子律动空间", description: "跳跃节奏与合成器声场，沉浸式电音精选。", tags: ["电子", "EDM", "电音", "律动"], keywords: ["电子", "edm", "house", "techno", "电音", "synth", "dance", "舞曲"] },
  { id: "focus", title: "专注与纯音小憩", description: "清透静谧的器乐与氛围音乐，伴你沉浸思考。", tags: ["专注", "纯音", "学习", "轻音乐"], keywords: ["专注", "学习", "工作", "轻音乐", "纯音乐", "lo-fi", "chill", "白噪音", "钢琴", "古典"] },
  { id: "night", title: "夜听与疗愈私享", description: "深夜温暖陪伴，抚平情绪的治愈与慢调旋律。", tags: ["夜听", "深夜", "治愈", "R&B"], keywords: ["夜听", "深夜", "夜晚", "晚安", "治愈", "r&b", "soul", "放空", "疗愈"] },
  { id: "acg", title: "ACG 与二次元幻想", description: "动漫游戏原声与日系旋律，开启异次元共鸣。", tags: ["ACG", "动漫", "二次元", "J-pop"], keywords: ["acg", "anime", "二次元", "动漫", "动画", "游戏", "vocaloid", "日系", "j-pop", "日语"] },
  { id: "guofeng", title: "新国风与古韵雅集", description: "丝竹戏腔与现代编曲交织的华夏音韵。", tags: ["国风", "古风", "新中式", "仙侠"], keywords: ["国风", "古风", "仙侠", "华语", "戏腔", "新中式", "武侠"] },
  { id: "rnb", title: "R&B 与都市律动", description: "丝滑转音与慵懒节奏，都市夜色中的随性律动。", tags: ["R&B", "都市", "律动", "Soul"], keywords: ["r&b", "rnb", "soul", "嘻哈", "说唱", "hip-hop", "rap", "都市"] },
  { id: "folk", title: "民谣与温暖叙事", description: "一把木吉他与质朴故事，诉说人间烟火与诗意。", tags: ["民谣", "木吉他", "温暖", "故事"], keywords: ["民谣", "folk", "吉他", "不插电", "民乐"] }
];

function buildCuratedPlaylistCards(data: ProfileProviderRecommendations): DiscoverPlaylistCard[] {
  const getArtistsExcerpt = (tracks: Track[]) => {
    const artists = Array.from(new Set(tracks.map((t) => t.artist).filter(Boolean))).slice(0, 3);
    return artists.length ? `包含 ${artists.join(" · ")} 等` : "为您量身定制的专属精选";
  };

  const familiarTracks = data.familiarArtists.map((i) => i.candidate);
  const deepTracks = data.deepCuts.map((i) => i.candidate);
  const moodTracks = data.moodDiscovery.map((i) => i.candidate);
  const forYouTracks = data.forYou.map((i) => i.candidate);

  const allPool = [
    ...(data.dailyRadar?.tracks ?? []),
    ...forYouTracks,
    ...moodTracks,
    ...deepTracks,
    ...familiarTracks
  ];
  const uniquePool = Array.from(
    new Map(allPool.map((t) => [providerTrackKey(t), t])).values()
  );

  const slowTracks = uniquePool.filter((track) => {
    const text = `${track.title} ${track.artist} ${track.album ?? ""} ${(track.tags ?? []).join(" ")}`.toLowerCase();
    return ["夜听", "深夜", "纯音乐", "轻音乐", "治愈", "r&b", "soul", "民谣", "lo-fi", "chill"].some((kw) => text.includes(kw));
  });

  const dailyMixes = [
    {
      id: "daily-mix-1",
      title: "Daily Mix 1 · 核心偏好",
      description: `精选最契合你听歌画像的常听歌手与代表作。${getArtistsExcerpt(familiarTracks.length ? familiarTracks : forYouTracks)}`,
      tags: ["Daily Mix", "常听", "精选", "偏好"],
      tracks: familiarTracks.length ? familiarTracks : forYouTracks
    },
    {
      id: "daily-mix-2",
      title: "Daily Mix 2 · 深度宝藏",
      description: `挖掘符合你品味但低热度的小众私藏曲目。${getArtistsExcerpt(deepTracks)}`,
      tags: ["Daily Mix", "深度", "宝藏", "小众"],
      tracks: deepTracks.length ? deepTracks : forYouTracks
    },
    {
      id: "daily-mix-3",
      title: "Daily Mix 3 · 探索律动",
      description: `跳出舒适圈，发现令人耳目一新的探索风味。${getArtistsExcerpt(moodTracks)}`,
      tags: ["Daily Mix", "探索", "新歌", "律动"],
      tracks: moodTracks.length ? moodTracks : forYouTracks
    },
    {
      id: "daily-mix-4",
      title: "Daily Mix 4 · 慢调私享",
      description: `舒缓慢调与治愈陪伴旋律，抚平思绪。${getArtistsExcerpt(slowTracks)}`,
      tags: ["Daily Mix", "夜听", "疗愈", "慢调"],
      tracks: slowTracks.length ? slowTracks : forYouTracks
    }
  ];

  const dynamicGroups = genreCategoryPresets.flatMap((preset) => {
    const matched = uniquePool.filter((track) => {
      const text = `${track.title} ${track.artist} ${track.album ?? ""} ${(track.tags ?? []).join(" ")}`.toLowerCase();
      return preset.keywords.some((kw) => text.includes(kw.toLowerCase()));
    });
    if (matched.length < 2) return [];
    return [{
      id: `genre-${preset.id}`,
      title: preset.title,
      description: preset.description,
      tags: preset.tags,
      tracks: matched
    }];
  });

  const allGroups = [...dailyMixes, ...dynamicGroups];

  return allGroups.flatMap(({ id, title, description, tags, tracks }) => {
    if (!tracks.length) return [];
    const firstTrack = tracks[0]!;
    return [{
      playlist: {
        provider: firstTrack.provider,
        providerPlaylistId: `music-room-curated:${id}`,
        title,
        description,
        tags,
        artworkUrl: firstTrack.artworkUrl ?? null,
        creatorName: "Music Room",
        trackCount: tracks.length
      },
      tracks,
      score: 100,
      reasons: ["画像推荐"]
    } satisfies DiscoverPlaylistCard];
  });
}

function providerLabel(provider: Provider) {
  return provider === "netease" ? "网易云音乐" : "QQ 音乐";
}

function toErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "NETEASE_ACCOUNT_REQUIRED" || error.code === "QQMUSIC_ACCOUNT_REQUIRED") return "部分推荐需要先绑定对应音乐平台账号。";
    return error.message;
  }
  return error instanceof Error ? error.message : "内容加载失败，请稍后重试。";
}

function AppPageBackground() {
  return <div aria-hidden="true" className="workspace-page-background" />;
}
