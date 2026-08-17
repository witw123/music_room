"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { listeningProfileChangedEvent } from "@/features/recommendations/listening-profile/use-listening-profile-reporter";
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

type Provider = "netease" | "qqmusic";
type Track = ProviderTrackCandidate;
type DiscoverData = ProfileProviderRecommendations & { seedCount: number };
type Detail = { summary: ProviderPlaylistSummary; value: ProviderPlaylistDetail };

const enabledProviders: Provider[] = [
  ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
  ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : [])
];

const profileRefreshIntervalMs = 90_000;

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
  const requestVersionRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const excludedCandidateKeysRef = useRef<Set<string>>(new Set());
  const lastProfileRefreshAtRef = useRef(0);
  const profileRefreshTimerRef = useRef<number | null>(null);

  const excludedCandidateKeys = useMemo(() => {
    const keys = new Set<string>();
    const sourceRef = player.currentTrack?.sourceRef;
    if (sourceRef) keys.add(`${sourceRef.provider}:${sourceRef.trackId}`);
    for (const item of player.queue) {
      const key = candidateKeyFromLocalTrackId(item.trackId);
      if (key) keys.add(key);
    }
    return keys;
  }, [player.currentTrack?.sourceRef, player.queue]);

  useEffect(() => {
    excludedCandidateKeysRef.current = excludedCandidateKeys;
  }, [excludedCandidateKeys]);

  const load = useCallback(async () => {
    if (!activeSession) return;
    const version = ++requestVersionRef.current;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setLoading(true);
    setErrorMessage(null);

    try {
      const context = await musicRoomApi.getListeningProfileDiscoverContext();
      const recommendations = await getProfileProviderRecommendations({
        userId: activeSession.userId,
        context,
        enabledProviders,
        excludedCandidateKeys: excludedCandidateKeysRef.current,
        signal: controller.signal
      });
      if (controller.signal.aborted || requestVersionRef.current !== version) return;
      setData({ ...recommendations, seedCount: context.seedTracks.length });
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
    window.addEventListener(listeningProfileChangedEvent, onProfileChanged);
    return () => {
      requestVersionRef.current += 1;
      requestAbortRef.current?.abort();
      if (profileRefreshTimerRef.current !== null) window.clearTimeout(profileRefreshTimerRef.current);
      profileRefreshTimerRef.current = null;
      window.removeEventListener(listeningProfileChangedEvent, onProfileChanged);
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

  async function openPlaylist(summary: ProviderPlaylistSummary) {
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
          tags: ["network", `network:${key}`],
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
    onToggleFavorite: (track) => void toggleFavoriteTrack(track)
      .then(() => setStatusMessage(`已${isFavoriteTrack(track) ? "取消收藏" : "收藏"}《${track.title}》。`))
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : "更新歌曲收藏失败。"))
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

  const hero = data?.forYou[0] ?? null;
  const heroSide = data?.forYou.slice(1, 3) ?? [];
  const forYou = data?.forYou.slice(hero ? 1 : 0) ?? [];
  const hasContent = Boolean(hero || data?.familiarArtists.length || data?.playlists.length);
  const noProfile = Boolean(data && data.seedCount === 0);
  const noAccounts = Boolean(data && data.providers.length === 0);

  return (
    <main className="workspace-page overflow-y-auto md:pl-60 lg:pb-28">
      <div className="workspace-page__inner workspace-page__inner--wide pb-10 pt-5 sm:pt-8 md:pt-10">
        <ProviderSearchPage embedded inlineSearch />

        {loading && !data ? <DiscoverSkeleton /> : null}
        {!loading && noAccounts ? <DiscoverEmptyState title="连接音乐平台后开始发现" description="绑定网易云音乐或 QQ 音乐后，发现页会从你的听歌画像召回新的歌曲和歌单。" actionHref="/app/settings" actionLabel="前往绑定" /> : null}
        {!loading && !noAccounts && noProfile ? <DiscoverEmptyState title="先播放几首歌" description="播放或收藏歌曲后，这里会根据真实聆听记录推荐更多来自网易云音乐和 QQ 音乐的新内容。" actionHref="/app/search" actionLabel="去搜索" /> : null}
        {!loading && !noAccounts && !noProfile && !hasContent ? <DiscoverEmptyState title="这次没有找到新内容" description="可以稍后刷新，或继续聆听几首歌曲来扩展推荐线索。" actionLabel="重新加载" onAction={() => void load()} /> : null}

        {hero ? (
          <section className="mt-7 grid gap-3 lg:grid-cols-[minmax(0,1.72fr)_minmax(260px,0.72fr)]">
            <HeroTrackCard actions={trackActions} track={hero} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {heroSide.map((item) => <CompactHeroTrackCard actions={trackActions} key={providerTrackKey(item.candidate)} track={item} />)}
            </div>
          </section>
        ) : null}

        {forYou.length ? <DiscoverSection title="为你推荐"><DiscoverTrackRail actions={trackActions} tracks={forYou} /></DiscoverSection> : null}
        {data?.familiarArtists.length ? <DiscoverSection title="熟悉艺人的新歌"><DiscoverTrackRail actions={trackActions} tracks={data.familiarArtists} /></DiscoverSection> : null}
        {data?.playlists.length ? <DiscoverSection title="为你挑选的歌单"><DiscoverPlaylistWall items={data.playlists} loadingKey={detailLoading} onOpen={openPlaylist} /></DiscoverSection> : null}
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
  onToggleFavorite: (track: Track) => void;
};

function DiscoverSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-10"><h2 className="text-xl font-semibold text-foreground">{title}</h2><div className="mt-4">{children}</div></section>;
}

function HeroTrackCard({ track, actions }: { track: DiscoverTrackRecommendation; actions: DiscoverTrackActions }) {
  const candidate = track.candidate;
  return (
    <article className="group relative min-h-[330px] overflow-hidden rounded-lg border border-surface-border bg-surface sm:min-h-[390px]">
      <Artwork alt={candidate.title} className="absolute inset-0 h-full w-full opacity-70 transition duration-300 group-hover:scale-[1.015]" src={candidate.artworkUrl} />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/10" />
      <div className="relative flex h-full min-h-[330px] flex-col justify-end p-5 sm:min-h-[390px] sm:p-7">
        <span className="text-xs font-medium text-white/65">为你准备 · {providerLabel(candidate.provider)}</span>
        <h2 className="mt-2 line-clamp-2 max-w-xl text-3xl font-bold leading-tight text-white sm:text-4xl">{candidate.title}</h2>
        <p className="mt-2 truncate text-sm text-white/70">{candidate.artist}{candidate.album ? ` · ${candidate.album}` : ""}</p>
        <div className="mt-5 flex items-center gap-2">
          <Button className="rounded-full px-5" onClick={() => actions.onPlay(candidate)} type="button"><PlayIcon />播放</Button>
          <TrackMoreActions actions={actions} compact track={candidate} />
        </div>
      </div>
    </article>
  );
}

function CompactHeroTrackCard({ track, actions }: { track: DiscoverTrackRecommendation; actions: DiscoverTrackActions }) {
  const candidate = track.candidate;
  return <article className="flex min-w-0 items-center gap-4 rounded-lg border border-surface-border bg-surface p-3 transition hover:bg-surface-hover"><Artwork alt={candidate.title} className="h-20 w-20 shrink-0 rounded-md" src={candidate.artworkUrl} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{candidate.title}</p><p className="mt-1 truncate text-xs text-foreground-muted">{candidate.artist}</p><p className="mt-2 text-[11px] text-foreground-muted">{providerLabel(candidate.provider)}</p></div><Button aria-label={`播放《${candidate.title}》`} className="h-9 w-9 rounded-full" disabled={actions.pending !== null} onClick={() => actions.onPlay(candidate)} size="icon" title="播放" type="button"><PlayIcon /></Button></article>;
}

function DiscoverTrackRail({ tracks, actions }: { tracks: DiscoverTrackRecommendation[]; actions: DiscoverTrackActions }) {
  return <div className="hide-scrollbar flex snap-x gap-3 overflow-x-auto pb-2">{tracks.map((item) => <DiscoverTrackCard actions={actions} key={providerTrackKey(item.candidate)} track={item.candidate} />)}</div>;
}

function DiscoverTrackCard({ track, actions }: { track: Track; actions: DiscoverTrackActions }) {
  const preparing = actions.pending === `play:${track.provider}:${track.providerTrackId}` || actions.pending === `queue:${track.provider}:${track.providerTrackId}`;
  return (
    <article className="w-[176px] shrink-0 snap-start sm:w-[194px]">
      <button aria-label={`播放《${track.title}》`} className="group relative block aspect-square w-full overflow-hidden rounded-lg border border-surface-border bg-surface text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" disabled={actions.pending !== null} onClick={() => actions.onPlay(track)} type="button">
        <Artwork alt="" className="h-full w-full transition duration-200 group-hover:scale-[1.025]" src={track.artworkUrl} />
        <span className="absolute inset-0 bg-black/0 transition group-hover:bg-black/20" />
        <span className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-lg transition group-hover:opacity-100"><PlayIcon /></span>
      </button>
      <div className="mt-3 flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{track.title}</p><p className="mt-1 truncate text-xs text-foreground-muted">{track.artist}</p></div><TrackMoreActions actions={actions} track={track} /></div>
      <p className="mt-1 truncate text-[11px] text-foreground-muted">{providerLabel(track.provider)}{preparing ? " · 准备中" : ""}</p>
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
    { id: "queue", label: queued ? "已在队列中" : "加入队列", icon: "queue", disabled: loading || queued, onSelect: () => actions.onQueue(track) },
    { id: "download", label: downloaded ? "已下载" : "下载到本地", icon: "download", disabled: loading || downloaded, onSelect: () => actions.onDownload(track) },
    { id: "playlist", label: "加入歌单", icon: "plus", disabled: loading, onSelect: () => { if (menuAnchor) actions.onAddToPlaylist(track, menuAnchor); } },
    { id: "favorite", label: actions.isFavorite(track) ? "取消收藏" : "收藏歌曲", icon: "heart", disabled: actions.isFavoritePending(track), onSelect: () => actions.onToggleFavorite(track) }
  ];
  return <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>{!compact ? <div className="hidden sm:block"><FavoriteTrackButton isFavorite={actions.isFavorite(track)} onToggle={() => actions.onToggleFavorite(track)} pending={actions.isFavoritePending(track)} size="compact" track={track} /></div> : null}<Button aria-label={`打开《${track.title}》的更多操作`} className="h-8 w-8 rounded-full" disabled={loading} onClick={(event) => setMenuAnchor(getAnchoredDialogAnchor(event.currentTarget))} size="icon" title="更多操作" type="button" variant="ghost"><MoreIcon /></Button>{menuAnchor ? <MobileTrackActionsMenu anchor={menuAnchor} items={menuItems} onClose={() => setMenuAnchor(null)} subtitle={`${track.artist}${track.album ? ` · ${track.album}` : ""}`} title={track.title} /> : null}</div>;
}

function DiscoverPlaylistWall({ items, onOpen, loadingKey }: { items: DiscoverPlaylistRecommendation[]; onOpen: (playlist: ProviderPlaylistSummary) => Promise<void>; loadingKey: string | null }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">{items.map(({ playlist }) => { const loading = loadingKey === `playlist:${playlist.provider}:${playlist.providerPlaylistId}`; return <button className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" disabled={loading} key={providerPlaylistKey(playlist.provider, playlist.providerPlaylistId)} onClick={() => void onOpen(playlist)} type="button"><Artwork alt={playlist.title} className="aspect-square w-full rounded-lg border border-surface-border transition duration-200 hover:brightness-110" src={playlist.artworkUrl} /><p className="mt-3 line-clamp-2 text-sm font-medium leading-5 text-foreground">{playlist.title}</p><p className="mt-1 truncate text-xs text-foreground-muted">{providerLabel(playlist.provider)}{playlist.creatorName ? ` · ${playlist.creatorName}` : ""}</p></button>; })}</div>;
}

function PlaylistPicker({ track, anchor, options, loading, pending, onClose, onSelect }: { track: Track | null; anchor: AnchoredDialogAnchor | null; options: ProviderPlaylistPickerOption[]; loading: boolean; pending: string | null; onClose: () => void; onSelect: (option: ProviderPlaylistPickerOption) => Promise<void> }) {
  if (!track || !anchor) return null;
  return <ProviderPlaylistPickerDialog anchor={anchor} loading={loading} options={options} pending={pending !== null} subjectLabel={`《${track.title}》 · ${track.artist}`} onClose={onClose} onSelect={(option) => void onSelect(option)} />;
}

function Feedback({ statusMessage, errorMessage }: { statusMessage: string | null; errorMessage: string | null }) {
  return <>{statusMessage ? <p className="mt-5 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-xs text-emerald-200" role="status">{statusMessage}</p> : null}{errorMessage ? <p className="mt-5 rounded-lg border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-xs text-red-200" role="alert">{errorMessage}</p> : null}</>;
}

function DiscoverEmptyState({ title, description, actionHref, actionLabel, onAction }: { title: string; description: string; actionHref?: string; actionLabel: string; onAction?: () => void }) {
  return <section className="mt-10 flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-surface-border px-6 text-center"><CompassIcon /><h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-foreground-muted">{description}</p>{actionHref ? <a className="mt-5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent-hover active:scale-[0.97]" href={actionHref}>{actionLabel}</a> : <button className="mt-5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent-hover active:scale-[0.97]" onClick={onAction} type="button">{actionLabel}</button>}</section>;
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

function candidateKeyFromLocalTrackId(trackId: string) {
  const match = /^provider:(netease|qqmusic):(.+)$/.exec(trackId);
  return match ? `${match[1]}:${match[2]}` : null;
}

function providerTrackKey(track: Pick<Track, "provider" | "providerTrackId">) {
  return `${track.provider}:${track.providerTrackId}`;
}

function providerPlaylistKey(provider: Provider, playlistId: string) {
  return `${provider}:${playlistId}`;
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

function PlayIcon() { return <svg aria-hidden="true" fill="currentColor" height="15" viewBox="0 0 24 24" width="15"><path d="M8 5v14l11-7z" /></svg>; }
function MoreIcon() { return <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>; }
function CompassIcon() { return <svg aria-hidden="true" fill="none" height="28" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24" width="28"><circle cx="12" cy="12" r="8.5" /><path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z" /></svg>; }
