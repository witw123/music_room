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
  hasProviderTrackPlaybackCache,
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
import { isLocalPlaylistMirror } from "@/features/playlist/local-playlist-database";
import {
  ensureLocalAudioDirectoryWriteAccess,
  normalizeLocalAudioMimeType,
  saveAudioFileToLocalDirectory
} from "@/features/library/local-audio-storage";

import {
  SparklesIcon,
  RadioIcon,
  CompassIcon as DiscoverCompassIcon,
  SlidersIcon,
  UsersIcon,
  MicIcon,
  VolumeIcon,
  ZapIcon,
  SakuraIcon,
  LaptopIcon,
  MoonIcon,
  LandmarkIcon
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
    const handlePlaybackCacheChange = (event: Event) => {
      const fileHashes = new Set((event as CustomEvent<{ fileHashes?: string[] }>).detail?.fileHashes ?? []);
      setPlaybackTracks((current) => current.filter((track) => !fileHashes.has(track.fileHash ?? "")));
    };
    window.addEventListener(providerPlaybackCacheChangedEvent, handlePlaybackCacheChange);
    return () => window.removeEventListener(providerPlaybackCacheChangedEvent, handlePlaybackCacheChange);
  }, []);

  async function openPlaylist(card: DiscoverPlaylistCard) {
    const summary = card.playlist;
    if (card.tracks) {
      setDetail({
        summary,
        value: {
          ...summary,
          tracks: card.tracks
        }
      });
      return;
    }

    const key = `playlist:${summary.provider}:${summary.providerPlaylistId}`;
    setDetailLoading(key);
    setErrorMessage(null);
    try {
      const value = summary.provider === "netease"
        ? await musicRoomApi.getNeteasePlaylist(summary.providerPlaylistId)
        : await musicRoomApi.getQqMusicPlaylist(summary.providerPlaylistId);
      setDetail({ summary, value });
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
    if (queuedTrack?.fileHash && player.queue.some((item) => item.trackId === trackId) && await hasProviderTrackPlaybackCache(queuedTrack.fileHash)) return queuedTrack;
    if (queuedTrack) setPlaybackTracks((current) => current.filter((item) => item.id !== queuedTrack.id));
    const record = await cacheProviderTrackForPlayback(track);
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
      setStatusMessage(`正在播放《${track.title}》。`);
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

  async function startTrackRadio(seedTrack: Track) {
    const key = `radio:${seedTrack.provider}:${seedTrack.providerTrackId}`;
    if (pending) return;
    setPending(key);
    setErrorMessage(null);
    try {
      setStatusMessage(`正在从《${seedTrack.title}》探索生成相似漫游曲目...`);
      const radioTracks = await musicRoomApi.getTrackRadio({
        seedTrack: {
          provider: seedTrack.provider,
          providerTrackId: seedTrack.providerTrackId,
          access: seedTrack.access,
          quality: seedTrack.quality,
          title: seedTrack.title,
          artist: seedTrack.artist,
          album: seedTrack.album,
          durationMs: seedTrack.durationMs,
          artworkUrl: seedTrack.artworkUrl,
          providerTags: seedTrack.tags
        },
        limit: 15
      });
      if (radioTracks.length === 0) {
        setStatusMessage(`已播放《${seedTrack.title}》，未找到更多相似曲目。`);
        await playProviderTrack(seedTrack);
        return;
      }
      // Play seed track and queue up the radio tracks
      const seedRecord = await cacheTrackForPlayback(seedTrack);
      await player.playTrack(seedRecord);
      for (const radioTrack of radioTracks.slice(0, 10)) {
        void cacheTrackForPlayback(radioTrack).then((rec) => player.addToQueue(rec)).catch(() => undefined);
      }
      setStatusMessage(`已开启从《${seedTrack.title}》出发的单曲漫游，已载入 ${radioTracks.length + 1} 首风格连贯曲目。`);
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
      setStatusMessage(`已开始播放今日心动雷达，已载入 ${Math.min(15, tracks.length)} 首专属曲目。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "播放今日雷达失败，请稍后重试。");
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
      const saved = await saveAudioFileToLocalDirectory({
        file: response.blob,
        fileHash,
        title: resolvedTrack.title,
        mimeType,
        track: {
          artist: resolvedTrack.artist,
          album: resolvedTrack.album,
          artworkUrl: resolvedTrack.artworkUrl,
          lyrics: lyricPayload?.wordSyncedLyric ?? lyricPayload?.plainLyric ?? null,
          translatedLyrics: lyricPayload?.translatedLyric ?? null,
          romanizedLyrics: lyricPayload?.romanizedLyric ?? null,
          provider: resolvedTrack.provider,
          providerTrackId: resolvedTrack.providerTrackId,
          durationMs: resolvedTrack.durationMs,
          sizeBytes: response.blob.size
        }
      });
      const record: LocalPlaylistTrackRecord = {
        ...toProviderTrackRecord(resolvedTrack, existing),
        artworkUrl: saved.artworkUrl ?? resolvedTrack.artworkUrl,
        fileHash,
        fileName: saved.fileName,
        sizeBytes: response.blob.size,
        mimeType,
        lyrics: lyricPayload?.wordSyncedLyric ?? lyricPayload?.plainLyric ?? null,
        translatedLyrics: lyricPayload?.translatedLyric ?? null,
        romanizedLyrics: lyricPayload?.romanizedLyric ?? null,
        ...(loudness ? { loudness } : {}),
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
      setPlaylistPickerOptions(playlists
        .filter((item) => !isLocalPlaylistMirror(item))
        .map((playlist) => ({ kind: "network" as const, playlist })));
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
    isDownloaded: (track) => localTracks.some((item) => item.id === localPlaylistTrackId(track) && item.availableOffline),
    isQueued: (track) => player.queue.some((item) => item.trackId === localPlaylistTrackId(track)),
    onPlay: (track) => void playProviderTrack(track),
    onQueue: (track) => void queueProviderTrack(track),
    onDownload: (track) => void downloadProviderTrack(track),
    onAddToPlaylist: (track, anchor) => void openPlaylistPicker(track, anchor),
    onStartRadio: (track) => void startTrackRadio(track),
    onToggleFavorite: (track) => void toggleFavoriteTrack(track)
      .then(() => setStatusMessage(`已${isFavoriteTrack(track) ? "取消收藏" : "收藏"}《${track.title}》。`))
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : "更新歌曲收藏失败。")),
    onFeedback: (track, action) => void musicRoomApi.recordPersonalizationFeedback({
      action,
      target: { kind: "track", key: providerTrackKey(track), label: `${track.title} · ${track.artist}` }
    }).then(() => {
      setData((current) => current ? {
        ...current,
        forYou: current.forYou.filter((item) => providerTrackKey(item.candidate) !== providerTrackKey(track)),
        familiarArtists: current.familiarArtists.filter((item) => providerTrackKey(item.candidate) !== providerTrackKey(track)),
        moodDiscovery: current.moodDiscovery.filter((item) => providerTrackKey(item.candidate) !== providerTrackKey(track)),
        deepCuts: current.deepCuts.filter((item) => providerTrackKey(item.candidate) !== providerTrackKey(track))
      } : current);
      setStatusMessage(action === "not-interested" ? "不会再推荐这首歌曲。" : "这首歌曲不会再影响你的品味画像。");
    }).catch((error) => setErrorMessage(error instanceof Error ? error.message : "反馈保存失败。"))
  };

  if (!hydrated || !activeSession) return <div className="min-h-[100dvh] bg-background" />;

  if (detail) {
    return (
      <main className="workspace-page overflow-y-auto md:pl-60 lg:pb-28">
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

  // Filter recommendations based on activeFilterId
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
    <main className="workspace-page overflow-y-auto md:pl-60 lg:pb-28">
      <div className="workspace-page__inner workspace-page__inner--wide pb-10 pt-5 sm:pt-8 md:pt-10">
        <ProviderSearchPage embedded inlineSearch />

        <div className="mt-4 mb-6 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {genreFilterPills.map((pill) => {
            const IconComp = pill.icon;
            const active = activeFilterId === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setActiveFilterId(pill.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  active
                    ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-md shadow-cyan-500/20 scale-105"
                    : "bg-surface/[0.2] hover:bg-white/[0.08] text-foreground-muted hover:text-foreground border border-white/[0.06]"
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-cyan-300/80 hover:text-cyan-200 bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-500/20 ml-auto shrink-0 transition-colors"
            title="定制你的品味画像"
          >
            <SlidersIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">调整偏好</span>
          </button>
        </div>

        {loading && !data ? <DiscoverSkeleton /> : null}

        {data?.dailyRadar && data.dailyRadar.tracks.length > 0 && activeFilterId === "all" ? (
          <section className="relative mb-8 overflow-hidden rounded-3xl border border-cyan-500/25 bg-gradient-to-r from-slate-900/90 via-slate-900/80 to-slate-950/90 p-5 sm:p-7 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl">
            <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-500/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl" />
            
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  <SparklesIcon className="w-3.5 h-3.5" />
                  <span>Music Room 今日心动雷达 · {data.dailyRadar.date}</span>
                </div>
                <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight">
                  {data.dailyRadar.title}
                </h1>
                <p className="text-xs sm:text-sm text-slate-300/80 max-w-xl">
                  {data.dailyRadar.subtitle}
                </p>
                {data.dailyRadar.summaryGenres.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {data.dailyRadar.summaryGenres.map((g) => (
                      <span key={g} className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white/[0.06] text-slate-300 border border-white/[0.08]">
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
                  className="rounded-2xl px-5 sm:px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white font-bold shadow-lg shadow-cyan-500/25 transition-all active:scale-95"
                >
                  <PlayIcon />
                  <span className="ml-2">一键播放今日雷达</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowColdStartDialog(true)}
                  className="rounded-2xl border-white/[0.15] bg-white/[0.05] hover:bg-white/[0.1] text-slate-200"
                  title="调整品味偏好"
                >
                  <SlidersIcon className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {data?.liveRooms && data.liveRooms.length > 0 ? (
          <DiscoverSection title="正在热播的房间 (Live in Rooms)" icon={<RadioIcon className="w-5 h-5 text-cyan-400 mr-2 inline-block" />}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.liveRooms.map((room) => (
                <a
                  key={room.roomId}
                  href={`/app/rooms/${room.roomId}`}
                  className="group relative flex items-center gap-3.5 p-3 rounded-2xl border border-white/[0.08] bg-surface/[0.15] hover:border-cyan-500/40 hover:bg-white/[0.05] transition-all"
                >
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface border border-white/[0.08]">
                    <Artwork alt="" className="h-full w-full object-cover" src={room.currentTrack?.artworkUrl ?? null} />
                    <span className="absolute top-1 left-1 flex h-2.5 w-2.5 items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-foreground group-hover:text-cyan-300 transition-colors">
                        {room.roomTitle}
                      </span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 shrink-0">
                        <UsersIcon className="w-2.5 h-2.5" />
                        {room.listenerCount} 人在听
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-foreground-muted">
                      {room.currentTrack ? `正在播: ${room.currentTrack.title} · ${room.currentTrack.artist}` : "正在广播精选歌单"}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </DiscoverSection>
        ) : null}

        {!loading && noAccounts ? <DiscoverEmptyState title="连接音乐平台后开始发现" description="绑定网易云音乐或 QQ 音乐后，发现页会从你的听歌画像召回新的歌曲和歌单。" actionHref="/app/settings" actionLabel="前往绑定" /> : null}
        {!loading && !noAccounts && noProfile ? <DiscoverEmptyState title="先播放几首歌或开启音乐雷达" description="播放或收藏歌曲后，这里会根据真实聆听记录推荐更多内容，你也可以直接定制品味。" actionLabel="3 秒定制音乐雷达" onAction={() => setShowColdStartDialog(true)} /> : null}
        {!loading && !noAccounts && !noProfile && !hasContent ? <DiscoverEmptyState title="这次没有找到新内容" description="可以稍后刷新，或继续聆听几首歌曲来扩展推荐线索。" actionLabel="重新加载" onAction={() => void load()} /> : null}

        {filteredPlaylists.length ? (
          <DiscoverSection title={activeFilterId === "all" ? "推荐歌单" : `${activeFilter?.label ?? ""}风格歌单`}>
            <DiscoverPlaylistRail items={filteredPlaylists} loadingKey={detailLoading} onOpen={openPlaylist} />
          </DiscoverSection>
        ) : null}

        {filteredForYou.length ? (
          <DiscoverSection title={activeFilterId === "all" ? "为你准备 (For You)" : `${activeFilter?.label ?? ""}精选推荐`}>
            <DiscoverTrackRail actions={trackActions} tracks={filteredForYou} />
          </DiscoverSection>
        ) : null}

        {filteredDeepCuts.length ? (
          <DiscoverSection title="沿着喜好深度探索 (Deep Cuts)">
            <DiscoverTrackRail actions={trackActions} tracks={filteredDeepCuts} />
          </DiscoverSection>
        ) : null}

        {filteredFamiliar.length && activeFilterId === "all" ? (
          <DiscoverSection title="常听艺人的延展 (Familiar Artists)">
            <DiscoverTrackRail actions={trackActions} tracks={filteredFamiliar} />
          </DiscoverSection>
        ) : null}

        {compactRecommendations.length && activeFilterId === "all" ? (
          <DiscoverSection title="红心与相似精选">
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
    <section className="mt-8 sm:mt-12">
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
            className="group flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-surface/[0.15] p-2 sm:p-2.5 text-left transition duration-200 hover:border-cyan-500/40 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            disabled={loading}
            key={providerPlaylistKey(playlist.provider, playlist.providerPlaylistId)}
            onClick={() => void onOpen(item)}
            type="button"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-surface">
              <Artwork
                alt={playlist.title}
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                src={playlist.artworkUrl}
              />
              <span className="absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/20" />
              <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-cyan-500 to-violet-600 text-white opacity-0 shadow-lg transition duration-200 group-hover:opacity-100">
                {loading ? <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <PlayIcon />}
              </span>
            </div>
            <p className="mt-2.5 line-clamp-2 text-xs sm:text-sm font-semibold leading-tight text-foreground group-hover:text-cyan-300 transition-colors" title={playlist.title}>
              {playlist.title}
            </p>
            <p className="mt-1 truncate text-[11px] text-foreground-muted" title={playlist.creatorName ?? ""}>
              {playlist.providerPlaylistId.startsWith("music-room-curated:")
                ? "Music Room 推荐"
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
        <div className="flex min-w-0 items-center gap-3 py-2 px-2.5 rounded-xl transition duration-200 hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06]" key={providerTrackKey(item.candidate)}>
          <button
            aria-label={`播放《${item.candidate.title}》`}
            className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            disabled={actions.pending !== null}
            onClick={() => actions.onPlay(item.candidate)}
            type="button"
          >
            <Artwork alt="" className="h-full w-full object-cover" src={item.candidate.artworkUrl} />
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
              <PlayIcon />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{item.candidate.title}</p>
            <p className="truncate text-xs text-foreground-muted">{item.candidate.artist}{item.candidate.album ? ` · ${item.candidate.album}` : ""}</p>
            {item.reasons.length > 0 && (
              <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-medium bg-cyan-500/10 text-cyan-300/90 truncate max-w-full">
                {item.reasons[0]}
              </span>
            )}
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
        <DiscoverTrackCard actions={actions} key={providerTrackKey(item.candidate)} track={item.candidate} reason={item.reasons[0]} />
      ))}
    </div>
  );
}

function DiscoverTrackCard({ track, actions, reason }: { track: Track; actions: DiscoverTrackActions; reason?: string }) {
  const preparing = actions.pending === `play:${track.provider}:${track.providerTrackId}` || actions.pending === `queue:${track.provider}:${track.providerTrackId}`;
  return (
    <article className="group relative flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-surface/[0.15] p-2 sm:p-2.5 text-left transition duration-200 hover:border-cyan-500/40 hover:bg-white/[0.05]">
      <button
        aria-label={`播放《${track.title}》`}
        className="group/btn relative block aspect-square w-full overflow-hidden rounded-xl bg-surface text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        disabled={actions.pending !== null}
        onClick={() => actions.onPlay(track)}
        type="button"
      >
        <Artwork alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" src={track.artworkUrl} />
        <span className="absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/20" />
        <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-cyan-500 to-violet-600 text-white opacity-0 shadow-lg transition duration-200 group-hover:opacity-100">
          <PlayIcon />
        </span>
      </button>
      <div className="mt-2.5 flex min-w-0 items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs sm:text-sm font-semibold text-foreground group-hover:text-cyan-300 transition-colors" title={track.title}>{track.title}</p>
          <p className="mt-0.5 truncate text-[11px] text-foreground-muted" title={track.artist}>{track.artist}</p>
          {reason && (
            <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/10 text-cyan-300/90 border border-cyan-500/20 truncate max-w-full">
              {reason}
            </span>
          )}
        </div>
        <TrackMoreActions actions={actions} track={track} />
      </div>
      <p className="mt-1 truncate text-[10px] text-foreground-muted/70">{providerLabel(track.provider)}{preparing ? " · 准备中" : ""}</p>
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
      <Button aria-label={`打开《${track.title}》的更多操作`} className="h-8 w-8 rounded-full" disabled={loading} onClick={(event) => setMenuAnchor(getAnchoredDialogAnchor(event.currentTarget))} size="icon" title="更多操作" type="button" variant="ghost">
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
  return <>{statusMessage ? <p className="mt-5 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-xs text-emerald-200" role="status">{statusMessage}</p> : null}{errorMessage ? <p className="mt-5 rounded-lg border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-xs text-red-200" role="alert">{errorMessage}</p> : null}</>;
}

function DiscoverEmptyState({ title, description, actionHref, actionLabel, onAction }: { title: string; description: string; actionHref?: string; actionLabel: string; onAction?: () => void }) {
  return <section className="mt-10 flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-surface-border px-6 text-center"><DiscoverCompassIcon className="w-8 h-8 text-foreground-muted" /><h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-foreground-muted">{description}</p>{actionHref ? <a className="mt-5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent-hover active:scale-[0.97]" href={actionHref}>{actionLabel}</a> : <button className="mt-5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent-hover active:scale-[0.97]" onClick={onAction} type="button">{actionLabel}</button>}</section>;
}

function DiscoverSkeleton() {
  return <div aria-label="正在加载个性化发现内容" className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div className="animate-pulse" key={index}><div className="aspect-square rounded-lg bg-surface" /><div className="mt-3 h-3 w-4/5 rounded bg-surface" /><div className="mt-2 h-2 w-1/2 rounded bg-surface" /></div>)}</div>;
}

function Artwork({ alt, src, className = "" }: { alt: string; src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const source = src ? getArtworkSourceUrl(src) : null;
  if (!source || failed) return <span aria-label={alt || undefined} className={`flex items-center justify-center bg-accent/15 text-2xl text-accent/70 ${className}`}>♪</span>;
  // Provider artwork URLs are external and intentionally bypass Next image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className={`object-cover ${className}`} loading="lazy" onError={() => setFailed(true)} src={source} />;
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
      title: "为你准备",
      description: "根据你的听歌偏好整理的推荐歌曲。",
      tracks: data.forYou
    },
    {
      id: "familiar-artists",
      title: "熟悉艺人的延展",
      description: "从常听艺人延展出的歌曲集合。",
      tracks: data.familiarArtists
    },
    {
      id: "mood-discovery",
      title: "换个口味",
      description: "为你保留一点新鲜感的探索歌曲。",
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
        tags: ["Music Room", "个性化推荐"],
        artworkUrl: firstTrack.artworkUrl ?? null,
        creatorName: "Music Room",
        trackCount: tracks.length
      },
      tracks: tracks.map((item) => item.candidate),
      score: Math.max(...tracks.map((item) => item.score)),
      reasons: ["来自你的个性化推荐"]
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

function PlayIcon() { return <svg aria-hidden="true" fill="currentColor" height="15" viewBox="0 0 24 24" width="15"><path d="M8 5v14l11-7z" /></svg>; }
function MoreIcon() { return <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>; }

