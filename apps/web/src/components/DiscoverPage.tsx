"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProviderPlaylistDetail,
  ProviderPlaylistSummary,
  ProviderTrackCandidate
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { FavoriteTrackButton } from "@/components/FavoriteTrackButton";
import { MobileTrackActionsMenu, type MobileTrackAction } from "@/components/MobileTrackActionsMenu";
import { ProviderPlaylistDetailView } from "@/components/ProviderPlaylistDetailView";
import { ProviderPlaylistPickerDialog, type ProviderPlaylistPickerOption } from "@/components/ProviderPlaylistPickerDialog";
import { ProviderSearchPage } from "@/components/ProviderSearchPage";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import { getAnchoredDialogAnchor, type AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { MusicRoomApiError, musicRoomApi } from "@/lib/network/music-room-api";
import { getProfileProviderRecommendations, type DiscoverPlaylistRecommendation, type DiscoverTrackRecommendation, type ProfileProviderRecommendations } from "@/features/discovery/profile-provider-recommendations";
import { personalizationChangedEvent } from "@/features/personalization/use-personalization-reporter";
import { useFavoriteTracks } from "@/features/favorites/use-favorite-tracks";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import {
  cacheProviderTrackForPlayback,
  providerPlaybackCacheChangedEvent
} from "@/features/playback/provider-track-cache";
import { analyzeAudioBlobLoudness } from "@/features/playback/loudness";
import {
  hashAudioBlob,
  listMergedLocalPlaylistTracks,
  localPlaylistTrackId,
  toProviderTrackRecord,
  upsertLocalPlaylistTrack,
  type LocalPlaylistTrackRecord
} from "@/features/playlist/local-playlist";
import {
  ensureLocalAudioDirectoryWriteAccess,
  normalizeLocalAudioMimeType,
  saveAudioFileToLocalDirectory
} from "@/features/library/local-audio-storage";

import {
  SparklesIcon,
  CompassIcon as DiscoverCompassIcon,
  SlidersIcon,
  UsersIcon,
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

const profileRefreshIntervalMs = 90_000;

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
  const [data, setData] = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [localTracks, setLocalTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [playbackTracks, setPlaybackTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [favoritePlaylistKeys, setFavoritePlaylistKeys] = useState<Set<string>>(new Set());
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(null);
  const [playlistPickerAnchor, setPlaylistPickerAnchor] = useState<AnchoredDialogAnchor | null>(null);
  const [playlistPickerOptions, setPlaylistPickerOptions] = useState<ProviderPlaylistPickerOption[]>([]);
  const [playlistPickerLoading, setPlaylistPickerLoading] = useState(false);
  const [activeFilterId, setActiveFilterId] = useState<string>("all");
  const [showColdStartDialog, setShowColdStartDialog] = useState(false);

  const requestVersionRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const lastProfileRefreshAtRef = useRef(0);
  const profileRefreshTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!activeSession) return;
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
    lastProfileRefreshAtRef.current = Date.now();
    void load();
    const onProfileChanged = () => {
      const elapsed = Date.now() - lastProfileRefreshAtRef.current;
      if (elapsed < profileRefreshIntervalMs || profileRefreshTimerRef.current !== null) return;
      profileRefreshTimerRef.current = window.setTimeout(() => {
        profileRefreshTimerRef.current = null;
        lastProfileRefreshAtRef.current = Date.now();
        void load();
      }, 1_500);
    };
    window.addEventListener(personalizationChangedEvent, onProfileChanged);
    return () => {
      requestVersionRef.current += 1;
      requestAbortRef.current?.abort();
      if (profileRefreshTimerRef.current !== null) window.clearTimeout(profileRefreshTimerRef.current);
      profileRefreshTimerRef.current = null;
      window.removeEventListener(personalizationChangedEvent, onProfileChanged);
    };
  }, [activeSession, load]);

  useEffect(() => {
    if (!activeSession) return;
    let cancelled = false;
    void listMergedLocalPlaylistTracks().then((tracks) => {
      if (!cancelled) setLocalTracks(tracks);
    }).catch(() => undefined);
    void musicRoomApi.listMyPlaylists().then((playlists) => {
      if (!cancelled) {
        setFavoritePlaylistKeys(new Set(playlists.flatMap((playlist) => playlist.tags
          .filter((tag) => tag.startsWith("network:"))
          .map((tag) => tag.slice("network:".length)))));
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  useEffect(() => {
    let cancelled = false;
    const syncPlaybackTracks = () => {
      void listMergedLocalPlaylistTracks().then((tracks) => {
        if (!cancelled) setPlaybackTracks(tracks);
      }).catch(() => undefined);
    };
    syncPlaybackTracks();
    window.addEventListener(providerPlaybackCacheChangedEvent, syncPlaybackTracks);
    return () => {
      cancelled = true;
      window.removeEventListener(providerPlaybackCacheChangedEvent, syncPlaybackTracks);
    };
  }, []);

  async function resolveTrackArtwork(track: Track) {
    if (track.artworkUrl) return track;
    try {
      const detail = track.provider === "netease"
        ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
        : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
      if (detail.artworkUrl) {
        track.artworkUrl = detail.artworkUrl;
      }
    } catch {
      // Keep existing artwork URL on failure
    }
    return track;
  }

  async function cacheTrackForPlayback(track: Track): Promise<LocalPlaylistTrackRecord> {
    const resolvedTrack = await resolveTrackArtwork(track);
    const trackId = localPlaylistTrackId(resolvedTrack);
    const saved = localTracks.find((item) => item.id === trackId);
    if (saved?.fileHash && player.isTrackPlayable(saved)) return saved;
    const existing = playbackTracks.find((item) => item.id === trackId);
    if (existing?.fileHash && player.isTrackPlayable(existing)) return existing;
    const cached = await cacheProviderTrackForPlayback(resolvedTrack);
    setPlaybackTracks((current) => [...current.filter((item) => item.id !== cached.id), cached]);
    return cached;
  }

  async function playProviderTrack(track: Track) {
    const key = `play:${track.provider}:${track.providerTrackId}`;
    if (pending) return;
    setPending(key);
    setErrorMessage(null);
    try {
      const record = await cacheTrackForPlayback(track);
      await player.playTrack(record);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "播放失败，请稍后重试。");
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
      setStatusMessage(`已将《${track.title}》加入播放队列。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加入播放队列失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  async function startTrackRadio(seedTrack: Track) {
    const key = `radio:${seedTrack.provider}:${seedTrack.providerTrackId}`;
    if (pending) return;
    setPending(key);
    setErrorMessage(null);
    try {
      const radioTracks = await musicRoomApi.getTrackRadio({
        seedTrack,
        limit: 15
      });
      if (radioTracks.length === 0) {
        setStatusMessage(`已播放《${seedTrack.title}》，未找到更多相似曲目。`);
        await playProviderTrack(seedTrack);
        return;
      }
      const seedRecord = await cacheTrackForPlayback(seedTrack);
      await player.playTrack(seedRecord);
      for (const radioTrack of radioTracks.slice(0, 10)) {
        void cacheTrackForPlayback(radioTrack).then((rec) => player.addToQueue(rec)).catch(() => undefined);
      }
      setStatusMessage(`已开启从《${seedTrack.title}》出发的单曲漫游，已载入 ${radioTracks.length + 1} 首曲目。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "开启漫游失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  async function playDailyRadarAll(tracks: Track[]) {
    if (!tracks.length || pending) return;
    setPending("play:daily-radar");
    setErrorMessage(null);
    try {
      const first = tracks[0]!;
      const record = await cacheTrackForPlayback(first);
      await player.playTrack(record);
      for (const next of tracks.slice(1, 15)) {
        void cacheTrackForPlayback(next).then((rec) => player.addToQueue(rec)).catch(() => undefined);
      }
      setStatusMessage(`已开始播放今日主打精选，已载入 ${Math.min(15, tracks.length)} 首专属曲目。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "播放失败，请稍后重试。");
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
      const loudness = await analyzeAudioBlobLoudness(response.blob);
      const lyricPayload = await (resolvedTrack.provider === "netease"
        ? musicRoomApi.getNeteaseLyrics(resolvedTrack.providerTrackId)
        : musicRoomApi.getQqMusicLyrics(resolvedTrack.providerTrackId)
      ).catch(() => null);
      const lyrics = lyricPayload?.wordSyncedLyric ?? lyricPayload?.plainLyric ?? null;
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
      setStatusMessage(`《${resolvedTrack.title}》已下载至本地存储。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "下载失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  async function openPlaylistPicker(track: Track, anchor: AnchoredDialogAnchor) {
    setPlaylistPickerTrack(track);
    setPlaylistPickerAnchor(anchor);
    setPlaylistPickerLoading(true);
    try {
      const playlists = await musicRoomApi.listMyPlaylists();
      const options: ProviderPlaylistPickerOption[] = playlists.map((playlist) => ({
        kind: "network",
        playlist,
        containsTrack: playlist.trackIds.includes(localPlaylistTrackId(track))
      }));
      setPlaylistPickerOptions(options);
    } catch {
      setStatusMessage("加载歌单列表失败。");
    } finally {
      setPlaylistPickerLoading(false);
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
          tags: ["network", `network:${key}`, ...playlist.tags].slice(0, 20),
          trackIds: playlist.tracks.map((track) => localPlaylistTrackId(track))
        });
        await Promise.all(playlist.tracks.map((track) => upsertLocalPlaylistTrack(toProviderTrackRecord(track)).catch(() => undefined)));
        setFavoritePlaylistKeys((current) => new Set(current).add(key));
        setStatusMessage(`已收藏《${playlist.title}》。`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "收藏歌单失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  const trackActions: DiscoverTrackActions = {
    pending,
    isFavorite: isFavoriteTrack,
    isFavoritePending: (track) => pendingFavoriteKey === providerTrackKey(track),
    isDownloaded: (track) => Boolean(localTracks.find((item) => item.id === localPlaylistTrackId(track))?.availableOffline),
    isQueued: (track) => Boolean(playbackTracks.find((item) => item.id === localPlaylistTrackId(track))),
    onPlay: (track) => void playProviderTrack(track),
    onQueue: (track) => void queueProviderTrack(track),
    onDownload: (track) => void downloadProviderTrack(track),
    onAddToPlaylist: (track, anchor) => void openPlaylistPicker(track, anchor),
    onStartRadio: (track) => void startTrackRadio(track),
    onToggleFavorite: (track) => {
      void toggleFavoriteTrack(track);
    },
    onFeedback: (track, action) => {
      void musicRoomApi.recordPersonalizationFeedback({
        action,
        target: {
          kind: "track",
          key: `${track.provider}:${track.providerTrackId}`,
          label: track.title
        }
      }).then(() => {
        setData((current) => current ? {
          ...current,
          forYou: current.forYou.filter((item) => providerTrackKey(item.candidate) !== providerTrackKey(track)),
          familiarArtists: current.familiarArtists.filter((item) => providerTrackKey(item.candidate) !== providerTrackKey(track)),
          moodDiscovery: current.moodDiscovery.filter((item) => providerTrackKey(item.candidate) !== providerTrackKey(track)),
          deepCuts: current.deepCuts.filter((item) => providerTrackKey(item.candidate) !== providerTrackKey(track))
        } : current);
        setStatusMessage(action === "not-interested" ? "不会再推荐这首歌曲。" : "这首歌曲不会再影响你的品味画像。");
      }).catch((error) => setErrorMessage(error instanceof Error ? error.message : "反馈保存失败。"));
    }
  };

  const openPlaylist = async (card: DiscoverPlaylistCard) => {
    const { playlist } = card;
    if (card.tracks) {
      setDetail({
        summary: {
          provider: playlist.provider,
          providerPlaylistId: playlist.providerPlaylistId,
          title: playlist.title,
          tags: playlist.tags ?? [],
          description: playlist.description,
          artworkUrl: playlist.artworkUrl,
          trackCount: card.tracks.length,
          creatorName: playlist.creatorName
        },
        value: {
          ...playlist,
          tracks: card.tracks
        }
      });
      return;
    }

    const key = `playlist:${playlist.provider}:${playlist.providerPlaylistId}`;
    setDetailLoading(key);
    try {
      const full = playlist.provider === "netease"
        ? await musicRoomApi.getNeteasePlaylist(playlist.providerPlaylistId)
        : await musicRoomApi.getQqMusicPlaylist(playlist.providerPlaylistId);
      setDetail({
        summary: playlist,
        value: full
      });
    } catch {
      setErrorMessage("打开歌单失败，请稍后重试。");
    } finally {
      setDetailLoading(null);
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

  const filteredForYou = data ? filterTrackList(data.forYou) : [];
  const filteredDeepCuts = data ? filterTrackList(data.deepCuts) : [];
  const filteredFamiliar = data ? filterTrackList(data.familiarArtists) : [];
  const compactRecommendations = data ? uniqueRecommendations(filteredDeepCuts.length ? filteredDeepCuts : data.deepCuts).slice(0, 9) : [];
  
  const hasContent = Boolean(data?.forYou.length || data?.familiarArtists.length || data?.moodDiscovery.length || data?.deepCuts.length || data?.playlists.length);
  const noProfile = Boolean(data && !hasContent);
  const noAccounts = Boolean(data && data.providers.length === 0);

  return (
    <main className="workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="workspace-page__inner workspace-page__inner--wide pb-12 pt-4 sm:pt-8 md:pt-10">
        {/* Search header integration */}
        <ProviderSearchPage embedded inlineSearch />

        {/* Genre & Scene Filter Pills */}
        <div className="mt-4 mb-7 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {genreFilterPills.map((pill) => {
            const IconComp = pill.icon;
            const active = activeFilterId === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setActiveFilterId(pill.id)}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  active
                    ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)]"
                    : "bg-surface/50 hover:bg-surface text-foreground-muted hover:text-foreground"
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
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium text-foreground-muted hover:text-foreground bg-surface/50 hover:bg-surface ml-auto shrink-0 transition-colors"
            title="定制偏好"
          >
            <SlidersIcon className="w-3.5 h-3.5 text-accent" />
            <span className="hidden sm:inline">偏好定制</span>
          </button>
        </div>

        {loading && !data ? <DiscoverSkeleton /> : null}

        {/* Editorial Spotlight Hero Card */}
        {data?.dailyRadar && data.dailyRadar.tracks.length > 0 && activeFilterId === "all" ? (
          <section className="relative mb-10 overflow-hidden rounded-3xl bg-surface/35 p-6 sm:p-8 shadow-[var(--surface-shadow)] backdrop-blur-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-accent uppercase tracking-wider">
                  <SparklesIcon className="w-3.5 h-3.5" />
                  <span>今日精选聚焦 · {data.dailyRadar.date}</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
                  {data.dailyRadar.title}
                </h1>
                <p className="text-xs sm:text-sm text-foreground-muted max-w-xl leading-relaxed">
                  {data.dailyRadar.subtitle}
                </p>
                {data.dailyRadar.summaryGenres.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {data.dailyRadar.summaryGenres.map((g) => (
                      <span key={g} className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-surface-elevated text-foreground">
                        {g}
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
                  className="rounded-full px-6 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold shadow-[0_4px_16px_var(--accent-glow)] transition-all active:scale-95"
                >
                  <PlayIcon className="w-4 h-4 mr-2" />
                  <span>一键播放</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowColdStartDialog(true)}
                  className="rounded-full bg-surface/50 hover:bg-surface text-foreground-muted hover:text-foreground px-4 border-transparent"
                  title="调整偏好"
                >
                  <SlidersIcon className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {/* Live Interactive Rooms */}
        {data?.liveRooms && data.liveRooms.length > 0 ? (
          <DiscoverSection title="热门房间 (Live Rooms)">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {data.liveRooms.map((room) => (
                <a
                  key={room.roomId}
                  href={`/room/${room.roomId}`}
                  className="group flex items-center gap-3.5 p-3 rounded-2xl bg-surface/35 hover:bg-surface-hover transition-all"
                >
                  <div className="relative h-12 w-12 min-w-[3rem] min-h-[3rem] max-w-[3rem] max-h-[3rem] shrink-0 overflow-hidden rounded-xl bg-surface-elevated">
                    <Artwork alt="" className="h-full w-full object-cover block" src={room.currentTrack?.artworkUrl ?? null} />
                    <span className="absolute top-1.5 left-1.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground group-hover:text-accent transition-colors">
                        {room.roomTitle}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground-muted shrink-0">
                        <UsersIcon className="w-3 h-3 text-accent" />
                        {room.listenerCount > 0 ? `${room.listenerCount} 人` : "空闲"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-foreground-muted">
                      {room.currentTrack ? `${room.currentTrack.title} · ${room.currentTrack.artist}` : `房主: ${room.hostName}`}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </DiscoverSection>
        ) : null}

        {!loading && noAccounts ? <DiscoverEmptyState title="连接音乐平台后开始发现" description="绑定网易云音乐或 QQ 音乐后，发现页会从你的听歌画像召回新的歌曲和歌单。" actionHref="/app/settings" actionLabel="前往绑定" /> : null}
        {!loading && !noAccounts && noProfile ? <DiscoverEmptyState title="开始探索你的专属推荐" description="在 Music Room 播放或收藏歌曲，或通过 3 秒偏好设置快速定制你的专属雷达。" actionLabel="3 秒定制偏好" onAction={() => setShowColdStartDialog(true)} /> : null}
        {!loading && !noAccounts && !noProfile && !hasContent ? <DiscoverEmptyState title="暂无新内容" description="可以稍后刷新，或继续聆听几首歌曲来扩展推荐线索。" actionLabel="重新加载" onAction={() => void load()} /> : null}

        {/* Featured Playlists */}
        {filteredPlaylists.length ? (
          <DiscoverSection title={activeFilterId === "all" ? "推荐歌单 (Featured Playlists)" : `${activeFilter?.label ?? ""}风格歌单`}>
            <DiscoverPlaylistRail items={filteredPlaylists} loadingKey={detailLoading} onOpen={openPlaylist} />
          </DiscoverSection>
        ) : null}

        {/* New Releases / For You */}
        {filteredForYou.length ? (
          <DiscoverSection title={activeFilterId === "all" ? "新歌速递 (New Releases)" : `${activeFilter?.label ?? ""}精选`}>
            <DiscoverTrackRail actions={trackActions} tracks={filteredForYou} />
          </DiscoverSection>
        ) : null}

        {/* Deep Cuts / Featured Tracks */}
        {filteredDeepCuts.length ? (
          <DiscoverSection title="深度精选 (Deep Cuts)">
            <DiscoverTrackRail actions={trackActions} tracks={filteredDeepCuts} />
          </DiscoverSection>
        ) : null}

        {/* Artist Essentials */}
        {filteredFamiliar.length && activeFilterId === "all" ? (
          <DiscoverSection title="艺人代表作 (Artist Essentials)">
            <DiscoverTrackRail actions={trackActions} tracks={filteredFamiliar} />
          </DiscoverSection>
        ) : null}

        {/* Compact Grid */}
        {compactRecommendations.length && activeFilterId === "all" ? (
          <DiscoverSection title="猜你喜欢 (Top Picks)">
            <DiscoverCompactTrackGrid tracks={compactRecommendations} actions={trackActions} />
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

function DiscoverSection({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10 sm:mt-12">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function DiscoverPlaylistRail({ items, onOpen, loadingKey }: { items: DiscoverPlaylistCard[]; onOpen: (card: DiscoverPlaylistCard) => Promise<void>; loadingKey: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => {
        const { playlist } = item;
        const loading = !item.tracks && loadingKey === `playlist:${playlist.provider}:${playlist.providerPlaylistId}`;
        return (
          <button
            aria-label={`打开歌单《${playlist.title}》`}
            className="group flex flex-col overflow-hidden rounded-2xl bg-surface/35 p-2 sm:p-2.5 text-left transition-all duration-200 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            disabled={loading}
            key={providerPlaylistKey(playlist.provider, playlist.providerPlaylistId)}
            onClick={() => void onOpen(item)}
            type="button"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-surface-elevated">
              <Artwork
                alt={playlist.title}
                className="h-full w-full object-cover block transition duration-300 group-hover:scale-105"
                src={playlist.artworkUrl}
              />
              <span className="absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/25" />
              <span className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-[0_4px_16px_var(--accent-glow)] transition-all duration-200 group-hover:opacity-100 scale-95 group-hover:scale-100">
                {loading ? <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <PlayIcon className="w-4 h-4" />}
              </span>
            </div>
            <p className="mt-2.5 line-clamp-2 text-xs sm:text-sm font-semibold leading-tight text-foreground group-hover:text-accent transition-colors" title={playlist.title}>
              {playlist.title}
            </p>
            <p className="mt-1 truncate text-[11px] text-foreground-muted" title={playlist.creatorName ?? ""}>
              {playlist.providerPlaylistId.startsWith("music-room-curated:")
                ? "Music Room 精选"
                : `${providerLabel(playlist.provider)}${playlist.creatorName ? ` · ${playlist.creatorName}` : ""}`}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function DiscoverCompactTrackGrid({ tracks, actions }: { tracks: DiscoverTrackRecommendation[]; actions: DiscoverTrackActions }) {
  return (
    <div className="grid gap-x-6 gap-y-2 sm:gap-x-8 md:grid-cols-2 xl:grid-cols-3">
      {tracks.map((item) => (
        <div className="flex min-w-0 items-center gap-3 py-2 px-2.5 rounded-2xl transition duration-200 hover:bg-surface-hover group" key={providerTrackKey(item.candidate)}>
          <button
            aria-label={`播放《${item.candidate.title}》`}
            className="group/art relative h-11 w-11 min-w-[2.75rem] min-h-[2.75rem] max-w-[2.75rem] max-h-[2.75rem] shrink-0 overflow-hidden rounded-xl bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            disabled={actions.pending !== null}
            onClick={() => actions.onPlay(item.candidate)}
            type="button"
          >
            <Artwork alt="" className="h-full w-full object-cover block" src={item.candidate.artworkUrl} />
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover/art:opacity-100">
              <PlayIcon className="w-3.5 h-3.5" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground group-hover:text-accent transition-colors">{item.candidate.title}</p>
            <p className="truncate text-xs text-foreground-muted">{item.candidate.artist}{item.candidate.album ? ` · ${item.candidate.album}` : ""}</p>
          </div>
          <TrackMoreActions actions={actions} compact track={item.candidate} />
        </div>
      ))}
    </div>
  );
}

function DiscoverTrackRail({ tracks, actions }: { tracks: DiscoverTrackRecommendation[]; actions: DiscoverTrackActions }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {tracks.map((item) => (
        <DiscoverTrackCard actions={actions} key={providerTrackKey(item.candidate)} track={item.candidate} />
      ))}
    </div>
  );
}

function DiscoverTrackCard({ track, actions }: { track: Track; actions: DiscoverTrackActions }) {
  const preparing = actions.pending === `play:${track.provider}:${track.providerTrackId}` || actions.pending === `queue:${track.provider}:${track.providerTrackId}`;
  return (
    <article className="group relative flex w-full min-w-0 flex-col overflow-hidden rounded-2xl bg-surface/35 p-2 sm:p-2.5 text-left transition-all duration-200 hover:bg-surface-hover">
      <button
        aria-label={`播放《${track.title}》`}
        className="group/btn relative block aspect-square w-full overflow-hidden rounded-xl bg-surface-elevated text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        disabled={actions.pending !== null}
        onClick={() => actions.onPlay(track)}
        type="button"
      >
        <Artwork alt="" className="h-full w-full object-cover block transition duration-300 group-hover:scale-105" src={track.artworkUrl} />
        <span className="absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/25" />
        <span className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-[0_4px_16px_var(--accent-glow)] transition-all duration-200 group-hover:opacity-100 scale-95 group-hover:scale-100">
          <PlayIcon className="w-4 h-4" />
        </span>
      </button>
      <div className="mt-2.5 flex min-w-0 items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs sm:text-sm font-semibold text-foreground group-hover:text-accent transition-colors" title={track.title}>{track.title}</p>
          <p className="mt-0.5 truncate text-[11px] text-foreground-muted" title={track.artist}>{track.artist}</p>
        </div>
        <TrackMoreActions actions={actions} track={track} />
      </div>
      <p className="mt-1 truncate text-[10px] text-foreground-muted">{providerLabel(track.provider)}{preparing ? " · 准备中" : ""}</p>
    </article>
  );
}

function TrackMoreActions({ track, actions, compact = false }: { track: Track; actions: DiscoverTrackActions; compact?: boolean }) {
  const [menuAnchor, setMenuAnchor] = useState<AnchoredDialogAnchor | null>(null);
  const downloaded = actions.isDownloaded(track);
  const queued = actions.isQueued(track);
  const loading = actions.pending !== null;
  const menuItems: MobileTrackAction[] = [
    { id: "play", label: "播放", icon: "play", disabled: loading, onSelect: () => actions.onPlay(track) },
    { id: "radio", label: "开启单曲漫游", icon: "play", disabled: loading, onSelect: () => actions.onStartRadio(track) },
    { id: "queue", label: queued ? "已在队列中" : "加入队列", icon: "queue", disabled: loading || queued, onSelect: () => actions.onQueue(track) },
    { id: "download", label: downloaded ? "已下载" : "下载到本地", icon: "download", disabled: loading || downloaded, onSelect: () => actions.onDownload(track) },
    { id: "playlist", label: "加入歌单", icon: "plus", disabled: loading, onSelect: () => { if (menuAnchor) actions.onAddToPlaylist(track, menuAnchor); } },
    { id: "favorite", label: actions.isFavorite(track) ? "取消收藏" : "收藏歌曲", icon: "heart", disabled: actions.isFavoritePending(track), onSelect: () => actions.onToggleFavorite(track) },
    { id: "not-interested", label: "不再推荐这首", icon: "trash", destructive: true, disabled: loading, onSelect: () => actions.onFeedback(track, "not-interested") },
    { id: "exclude-profile", label: "不计入我的品味", icon: "move", disabled: loading, onSelect: () => actions.onFeedback(track, "exclude-from-profile") }
  ];
  return (
    <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
      {!compact ? (
        <div className="hidden sm:block">
          <FavoriteTrackButton isFavorite={actions.isFavorite(track)} onToggle={() => actions.onToggleFavorite(track)} pending={actions.isFavoritePending(track)} size="compact" track={track} />
        </div>
      ) : null}
      <Button aria-label={`打开《${track.title}》的更多操作`} className="h-7 w-7 rounded-full text-foreground-muted hover:text-foreground hover:bg-white/[0.06]" disabled={loading} onClick={(event) => setMenuAnchor(getAnchoredDialogAnchor(event.currentTarget))} size="icon" title="更多操作" type="button" variant="ghost">
        <MoreIcon />
      </Button>
      {menuAnchor ? (
        <MobileTrackActionsMenu anchor={menuAnchor} items={menuItems} onClose={() => setMenuAnchor(null)} subtitle={`${track.artist}${track.album ? ` · ${track.album}` : ""}`} title={track.title} />
      ) : null}
    </div>
  );
}

function PlaylistPicker({ track, anchor, options, loading, pending, onClose, onSelect }: { track: Track | null; anchor: AnchoredDialogAnchor | null; options: ProviderPlaylistPickerOption[]; loading: boolean; pending: string | null; onClose: () => void; onSelect: (option: ProviderPlaylistPickerOption) => Promise<void> }) {
  if (!track || !anchor) return null;
  return <ProviderPlaylistPickerDialog anchor={anchor} loading={loading} options={options} pending={pending !== null} subjectLabel={`《${track.title}》 · ${track.artist}`} onClose={onClose} onSelect={(option) => void onSelect(option)} />;
}

function Feedback({ statusMessage, errorMessage }: { statusMessage: string | null; errorMessage: string | null }) {
  return <>{statusMessage ? <p className="mt-5 rounded-2xl bg-surface/50 px-4 py-3 text-xs text-foreground" role="status">{statusMessage}</p> : null}{errorMessage ? <p className="mt-5 rounded-2xl bg-red-950/30 px-4 py-3 text-xs text-red-300" role="alert">{errorMessage}</p> : null}</>;
}

function DiscoverEmptyState({ title, description, actionHref, actionLabel, onAction }: { title: string; description: string; actionHref?: string; actionLabel: string; onAction?: () => void }) {
  return (
    <section className="mt-10 flex min-h-64 flex-col items-center justify-center rounded-3xl bg-surface/20 px-6 text-center">
      <DiscoverCompassIcon className="w-8 h-8 text-foreground-muted mb-2" />
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-sm text-xs text-foreground-muted leading-relaxed">{description}</p>
      {actionHref ? (
        <a className="mt-5 rounded-full bg-accent hover:bg-accent-hover px-5 py-2 text-xs font-semibold text-white transition-all shadow-[0_4px_16px_var(--accent-glow)]" href={actionHref}>
          {actionLabel}
        </a>
      ) : (
        <button className="mt-5 rounded-full bg-accent hover:bg-accent-hover px-5 py-2 text-xs font-semibold text-white transition-all shadow-[0_4px_16px_var(--accent-glow)]" onClick={onAction} type="button">
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
        <div className="animate-pulse" key={index}>
          <div className="aspect-square rounded-2xl bg-surface/35" />
          <div className="mt-3 h-3 w-4/5 rounded bg-surface/35" />
          <div className="mt-2 h-2 w-1/2 rounded bg-surface/35" />
        </div>
      ))}
    </div>
  );
}

function Artwork({ alt, src, className = "" }: { alt: string; src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const source = src ? getArtworkSourceUrl(src) : null;
  if (!source || failed) return <span aria-label={alt || undefined} className={`flex items-center justify-center bg-surface-elevated text-xl text-foreground-muted ${className}`}>♪</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className={`object-cover block ${className}`} loading="lazy" onError={() => setFailed(true)} src={source} />;
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

function buildCuratedPlaylistCards(data: ProfileProviderRecommendations): DiscoverPlaylistCard[] {
  const groups = [
    {
      id: "for-you",
      title: "新歌与精选",
      description: "根据听歌风格为你精选整理的代表作。",
      tracks: data.forYou
    },
    {
      id: "familiar-artists",
      title: "常听艺人精选",
      description: "常听歌手的延展与精选曲目。",
      tracks: data.familiarArtists
    },
    {
      id: "mood-discovery",
      title: "风味探索",
      description: "换个口味的探索歌曲推荐。",
      tracks: data.moodDiscovery
    }
  ];

  return groups.flatMap(({ id, title, description, tracks }) => {
    if (!tracks.length) return [];
    const firstTrack = tracks[0]!.candidate;
    return [{
      playlist: {
        provider: firstTrack.provider,
        providerPlaylistId: `music-room-curated:${id}`,
        title,
        description,
        tags: ["Music Room", "精选"],
        artworkUrl: firstTrack.artworkUrl ?? null,
        creatorName: "Music Room",
        trackCount: tracks.length
      },
      tracks: tracks.map((item) => item.candidate),
      score: Math.max(...tracks.map((item) => item.score)),
      reasons: ["精选推荐"]
    } satisfies DiscoverPlaylistCard];
  });
}

function providerLabel(provider: Provider) {
  return provider === "netease" ? "网易云音乐" : "QQ 音乐";
}

function uniqueRecommendations(items: DiscoverTrackRecommendation[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = providerTrackKey(item.candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "NETEASE_ACCOUNT_REQUIRED" || error.code === "QQMUSIC_ACCOUNT_REQUIRED") return "部分推荐需要先绑定对应音乐平台账号。";
    return error.message;
  }
  return error instanceof Error ? error.message : "内容加载失败，请稍后重试。";
}

function MoreIcon() { return <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 24 24" width="16"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>; }

function AppPageBackground() {
  return <div aria-hidden="true" className="workspace-page-background" />;
}
