"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { AuthSession, PersonalizationProfileResponse, ProviderTrackCandidate } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { personalizationChangedEvent } from "@/features/personalization/use-personalization-reporter";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import { useFavoriteTracks, favoriteTrackToCandidate } from "@/features/favorites/use-favorite-tracks";
import {
  buildPlaybackStatusMessage,
  prepareTrackForImmediatePlayback,
  preloadProviderTracksInBackground,
  type BackgroundPreloadHandle
} from "@/features/playback/provider-playback-preparation";
import { toProviderTrackRecord } from "@/features/playlist/local-playlist";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import {
  PlayIcon,
  RadioIcon,
  MusicIcon,
  HeadphonesIcon,
  LandmarkIcon,
  BarChartIcon,
  SlidersIcon,
  HeartIcon
} from "@/components/icons/DiscoverIcons";

const sourceConfig = {
  netease: { label: "网易云音乐", color: "bg-[#fa233b]", dot: "#fa233b", text: "text-[#fa233b]" },
  qqmusic: { label: "QQ 音乐", color: "bg-[#10b981]", dot: "#10b981", text: "text-[#10b981]" },
  local_upload: { label: "本地音频", color: "bg-[#94a3b8]", dot: "#94a3b8", text: "text-[#94a3b8]" }
} as const;

export function ListeningProfileOverview({
  activeSession,
  onOpenColdStart
}: {
  activeSession: AuthSession;
  onOpenColdStart?: () => void;
}) {
  const pathname = usePathname();
  const player = useLocalPlayer();
  const { favoriteTracks } = useFavoriteTracks(activeSession.userId);
  const [profile, setProfile] = useState<PersonalizationProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeRadioTrackKey, setActiveRadioTrackKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showAllTopTracks, setShowAllTopTracks] = useState(false);
  const [showAllTopArtists, setShowAllTopArtists] = useState(false);

  const queuePreloadRef = useRef<BackgroundPreloadHandle | null>(null);

  useEffect(() => () => queuePreloadRef.current?.cancel(), []);

  useEffect(() => {
    let cancelled = false;
    let request: Promise<void> | null = null;
    let refreshQueued = false;
    let refreshTimer: number | null = null;

    const load = () => {
      if (cancelled) return;
      if (request) {
        refreshQueued = true;
        return;
      }

      setRefreshing(true);
      request = musicRoomApi.getPersonalizationProfile()
        .then((next) => {
          if (!cancelled) setProfile(next);
        })
        .catch(() => {
          // Keep the last successful profile visible
        })
        .finally(() => {
          request = null;
          if (cancelled) return;
          setLoading(false);
          setRefreshing(false);
          if (refreshQueued) {
            refreshQueued = false;
            load();
          }
        });
    };

    const handleProfileChange = () => {
      if (pathname !== "/app/profile" || refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        load();
      }, 450);
    };

    setProfile(null);
    setLoading(pathname === "/app/profile");
    if (pathname === "/app/profile") load();
    window.addEventListener(personalizationChangedEvent, handleProfileChange);
    return () => {
      cancelled = true;
      request = null;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener(personalizationChangedEvent, handleProfileChange);
    };
  }, [activeSession.userId, pathname]);

  const handlePlayTrack = async (candidate: ProviderTrackCandidate) => {
    try {
      const prepared = await prepareTrackForImmediatePlayback(candidate);
      await player.playTrack(prepared.record);
      setStatusMessage(buildPlaybackStatusMessage(candidate.title, prepared.source));
    } catch {
      setStatusMessage(`播放《${candidate.title}》失败`);
    }
  };

  const handleStartTrackRadio = async (candidate: ProviderTrackCandidate) => {
    const key = `${candidate.provider}:${candidate.providerTrackId}`;
    setActiveRadioTrackKey(key);
    try {
      const radioTracks = await musicRoomApi.getTrackRadio({ seedTrack: candidate, limit: 15 });
      const prepared = await prepareTrackForImmediatePlayback(candidate);
      await player.playTrack(prepared.record);
      const queuedTracks = radioTracks.slice(0, 10);
      for (const nextTrack of queuedTracks) {
        player.addToQueue(toProviderTrackRecord(nextTrack));
      }
      queuePreloadRef.current?.cancel();
      queuePreloadRef.current = preloadProviderTracksInBackground(queuedTracks, {
        concurrency: 2,
        onPrepared: (result) => player.updateQueueRecord(result.record),
        onSettled: (summary) => {
          if (!summary.cancelled && summary.failed > 0) {
            setStatusMessage(`${summary.failed} 首歌曲预加载失败，播放到对应歌曲时会自动跳过。`);
          }
        }
      });
      setStatusMessage(`已开启从《${candidate.title}》出发的单曲漫游`);
    } catch {
      queuePreloadRef.current?.cancel();
      setStatusMessage(`开启漫游失败，请稍后重试`);
    } finally {
      setActiveRadioTrackKey(null);
    }
  };

  const handlePlayAllFavorites = async () => {
    if (!favoriteTracks.length) return;
    const candidates = favoriteTracks.map(favoriteTrackToCandidate);
    const firstTrack = candidates[0];
    const remaining = candidates.slice(1);
    try {
      const prepared = await prepareTrackForImmediatePlayback(firstTrack);
      await player.playTrack(prepared.record);
      for (const track of remaining) {
        player.addToQueue(toProviderTrackRecord(track));
      }
      setStatusMessage(`正在播放我喜欢的音乐（共 ${candidates.length} 首）`);
    } catch {
      setStatusMessage("播放失败，请稍后重试");
    }
  };

  const handleTagClick = async (tagLabel: string) => {
    const seedTrack = profile?.topTracks[0] || profile?.recentTracks?.[0];
    if (seedTrack) {
      void handleStartTrackRadio(seedTrack);
      setStatusMessage(`已基于「${tagLabel}」偏好开启漫游电台`);
    } else if (onOpenColdStart) {
      onOpenColdStart();
    }
  };

  if (loading && !profile) {
    return <ProfileLoadingSkeleton />;
  }

  if (!profile || (profile.totalPlayCount === 0 && favoriteTracks.length === 0)) {
    return <ProfileEmptyState onOpenColdStart={onOpenColdStart} />;
  }

  const totalSourceTime = profile.sourceDistribution.reduce((acc, curr) => acc + curr.listenedMs, 0);
  const activeTasteGroups = profile.tasteGroups.filter((group) => group.tags.length > 0);
  const visibleTopTracks = showAllTopTracks ? profile.topTracks : profile.topTracks.slice(0, 5);
  const visibleTopArtists = showAllTopArtists ? profile.topArtists : profile.topArtists.slice(0, 5);
  const recentTracks = profile.recentTracks ?? [];

  return (
    <div className="profile-content space-y-4 sm:space-y-5 animate-in fade-in duration-300 pb-28 sm:pb-8 w-full max-w-full overflow-hidden" aria-busy={refreshing}>
      {statusMessage && (
        <p className="text-xs text-foreground bg-surface border border-surface-border px-3.5 py-2 rounded-xl">
          {statusMessage}
        </p>
      )}

      {/* Primary Assets Section: Liked Songs & Recently Played Quick Cards */}
      <section className="grid gap-3.5 sm:grid-cols-2">
        {/* Liked Songs Card */}
        <div className="rounded-xl border border-surface-border bg-surface/50 p-4 flex flex-col justify-between transition-colors hover:bg-surface/70">
          <div className="flex items-start gap-3.5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-500/20 text-red-500 shadow-xs">
              <HeartIcon className="h-6 w-6 fill-current" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm sm:text-base font-bold text-foreground tracking-tight">我喜欢的音乐</h3>
              <p className="mt-0.5 text-xs text-foreground-muted">
                {favoriteTracks.length > 0 ? `${favoriteTracks.length} 首已收藏歌曲` : "暂未收藏歌曲"}
              </p>
              <p className="mt-1 text-[11px] text-foreground-muted/70 truncate">
                {favoriteTracks.length > 0 ? `包含 ${favoriteTracks.slice(0, 2).map((track) => track.title).join("、")}${favoriteTracks.length > 2 ? " 等" : ""}` : "在各页面点击爱心即可收藏"}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-surface-border/40 pt-3">
            <span className="text-[11px] text-foreground-muted">
              {favoriteTracks.length > 0 ? "随心畅听你的专属收藏" : "探索歌曲发现好音乐"}
            </span>
            <button
              type="button"
              disabled={favoriteTracks.length === 0}
              onClick={() => void handlePlayAllFavorites()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-xs transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              <PlayIcon className="w-3 h-3" />
              <span>播放全部</span>
            </button>
          </div>
        </div>

        {/* Recently Played Summary Card */}
        <div className="rounded-xl border border-surface-border bg-surface/50 p-4 flex flex-col justify-between transition-colors hover:bg-surface/70">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-elevated text-foreground-muted">
                  <HeadphonesIcon className="w-3.5 h-3.5" />
                </span>
                <h3 className="text-sm sm:text-base font-bold text-foreground tracking-tight">最近收听</h3>
              </div>
              <span className="text-[11px] text-foreground-muted tabular-nums">
                {recentTracks.length > 0 ? `共 ${recentTracks.length} 首` : "暂无最近记录"}
              </span>
            </div>
            {recentTracks.length > 0 ? (
              <div className="space-y-1.5 mt-2">
                {recentTracks.slice(0, 2).map((track) => (
                  <div
                    key={`${track.provider}:${track.providerTrackId}`}
                    onClick={() => void handlePlayTrack(track)}
                    className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-surface-hover/60 transition-colors cursor-pointer group min-w-0"
                  >
                    <div className="h-8 w-8 shrink-0 rounded-md overflow-hidden bg-surface-elevated border border-surface-border/40">
                      <Artwork alt="" className="h-full w-full object-cover" src={track.artworkUrl} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground group-hover:text-accent transition-colors">
                        {track.title}
                      </p>
                      <p className="truncate text-[10px] text-foreground-muted">{track.artist}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handlePlayTrack(track);
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:text-foreground"
                      title="播放"
                    >
                      <PlayIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-foreground-muted py-3">在房间或电台收听歌曲后，这里会显示最近播放历史。</p>
            )}
          </div>
          {recentTracks.length > 2 && (
            <div className="mt-2 border-t border-surface-border/40 pt-2 flex items-center justify-between text-[11px] text-foreground-muted">
              <span>共记录 {recentTracks.length} 首近期常听歌曲</span>
            </div>
          )}
        </div>
      </section>

      {/* 4-Metric Statistics Grid */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3.5">
        <MetricCard
          label="累计收听时长"
          value={formatDuration(profile.totalListenedMs)}
          icon={<HeadphonesIcon className="w-4 h-4 text-sky-400" />}
        />
        <MetricCard
          label="播放总次数"
          value={`${profile.totalPlayCount} 次`}
          icon={<PlayIcon className="w-4 h-4 text-amber-400" />}
        />
        <MetricCard
          label="探索曲目"
          value={`${profile.trackCount} 首`}
          icon={<MusicIcon className="w-4 h-4 text-purple-400" />}
        />
        <MetricCard
          label="常听艺人"
          value={`${profile.artistCount} 位`}
          icon={<LandmarkIcon className="w-4 h-4 text-emerald-400" />}
        />
      </section>

      {/* Taste & Genres Section */}
      <section className="rounded-xl border border-surface-border bg-surface/40 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="p-1 rounded-lg bg-surface-elevated text-foreground-muted shrink-0">
              <SlidersIcon className="w-4 h-4 text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm sm:text-base font-bold text-foreground tracking-tight truncate">常听曲风与偏好</h3>
              <p className="text-xs text-foreground-muted truncate">根据你近期的收听与收藏记录统计，点击标签可开启专属漫游</p>
            </div>
          </div>
          {onOpenColdStart && (
            <button
              type="button"
              onClick={onOpenColdStart}
              className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium text-accent hover:text-white bg-accent/10 hover:bg-accent border border-accent/20 transition-all cursor-pointer"
            >
              调整偏好
            </button>
          )}
        </div>

        {activeTasteGroups.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeTasteGroups.map((group) => (
              <div key={group.id} className="space-y-2 p-3 rounded-xl bg-surface-elevated/30 border border-surface-border/40">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">{group.label}</h4>
                  <span className="text-[10px] text-foreground-muted/60">{group.tags.length} 项</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.tags.map((tag) => (
                    <button
                      key={`${group.id}:${tag.label}:${tag.source}`}
                      type="button"
                      onClick={() => void handleTagClick(tag.label)}
                      className="inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-surface hover:bg-surface-hover text-foreground border border-surface-border transition-all cursor-pointer overflow-hidden group"
                      title={`点击开启「${tag.label}」音乐漫游`}
                    >
                      <span className="truncate max-w-[130px] sm:max-w-[180px]">{tag.label}</span>
                      <RadioIcon className="w-3 h-3 text-foreground-muted group-hover:text-accent transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-foreground-muted py-2">
            在房间听歌或收藏歌曲后，系统会自动为你统计常听曲风与习惯偏好。
          </p>
        )}
      </section>

      {/* Top Tracks & Top Artists */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2 items-start w-full max-w-full overflow-hidden">
        {/* Top Tracks */}
        <section className="rounded-xl border border-surface-border bg-surface/40 p-3.5 sm:p-5 w-full max-w-full overflow-hidden">
          <div className="flex items-center justify-between gap-2 mb-3.5">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-lg bg-surface-elevated text-foreground-muted">
                <BarChartIcon className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-foreground tracking-tight">最常播放歌曲</h3>
                <p className="text-xs text-foreground-muted">收听频次最高的心动单曲</p>
              </div>
            </div>
            {profile.topTracks.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllTopTracks((prev) => !prev)}
                className="text-xs font-medium text-accent hover:underline cursor-pointer"
              >
                {showAllTopTracks ? "收起" : `展开 Top ${profile.topTracks.length}`}
              </button>
            )}
          </div>

          <div className="space-y-1">
            {visibleTopTracks.map((item, index) => {
              const itemKey = `${item.provider}:${item.providerTrackId}`;
              const isRadioRunning = activeRadioTrackKey === itemKey;
              const rankColor =
                index === 0
                  ? "text-amber-400 font-bold"
                  : index === 1
                  ? "text-slate-300 font-bold"
                  : index === 2
                  ? "text-amber-600 font-bold"
                  : "text-foreground-muted font-medium";

              return (
                <div
                  key={itemKey}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg transition-colors hover:bg-surface-hover/60 group w-full min-w-0 overflow-hidden"
                >
                  <span className={`w-4 shrink-0 text-xs tabular-nums text-center ${rankColor}`}>
                    {index + 1}
                  </span>
                  <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-surface-elevated border border-surface-border/40">
                    <Artwork alt="" className="h-full w-full object-cover block" src={item.artworkUrl} />
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <p className="truncate text-xs sm:text-sm font-semibold text-foreground group-hover:text-accent transition-colors" title={item.title}>
                      {item.title}
                    </p>
                    <p className="truncate text-[10px] sm:text-xs text-foreground-muted" title={`${item.artist}${item.album ? ` · ${item.album}` : ""}`}>
                      {item.artist}{item.album ? ` · ${item.album}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0 whitespace-nowrap">
                    <span className="block text-xs font-semibold tabular-nums text-foreground">
                      {item.playCount} 次
                    </span>
                    <span className="hidden sm:block text-[10px] tabular-nums text-foreground-muted">
                      {formatDuration(item.listenedMs)}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePlayTrack(item)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors cursor-pointer"
                      title="立即播放"
                    >
                      <PlayIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={isRadioRunning}
                      onClick={() => handleStartTrackRadio(item)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                      title="开启单曲漫游"
                    >
                      <RadioIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Top Artists & Source Distribution */}
        <div className="space-y-4 sm:space-y-5 w-full max-w-full overflow-hidden">
          {/* Top Artists */}
          <section className="rounded-xl border border-surface-border bg-surface/40 p-3.5 sm:p-5 w-full max-w-full overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-3.5">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-lg bg-surface-elevated text-foreground-muted">
                  <LandmarkIcon className="w-4 h-4 text-accent" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-foreground tracking-tight">常听歌手</h3>
                  <p className="text-xs text-foreground-muted">收听深度最高的音乐艺人</p>
                </div>
              </div>
              {profile.topArtists.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllTopArtists((prev) => !prev)}
                  className="text-xs font-medium text-accent hover:underline cursor-pointer"
                >
                  {showAllTopArtists ? "收起" : `展开 Top ${profile.topArtists.length}`}
                </button>
              )}
            </div>

            <div className="space-y-1">
              {visibleTopArtists.map((artist, index) => (
                <div
                  key={artist.name}
                  className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg transition-colors hover:bg-surface-hover/60 min-w-0 overflow-hidden"
                >
                  <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-foreground-muted text-center">
                    {index + 1}
                  </span>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-elevated border border-surface-border/40 text-xs font-bold text-foreground">
                    {artist.name.slice(0, 1)}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-xs sm:text-sm font-semibold text-foreground" title={artist.name}>
                    {artist.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-foreground-muted font-medium whitespace-nowrap pr-1">
                    {artist.playCount} 次
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Multi-source Distribution */}
          {profile.sourceDistribution.length > 0 && totalSourceTime > 0 && (
            <section className="rounded-xl border border-surface-border bg-surface/40 p-3.5 sm:p-5 w-full max-w-full overflow-hidden">
              <h4 className="text-xs font-semibold text-foreground-muted mb-3 uppercase tracking-wider">音源收听分布</h4>
              <div className="h-2.5 w-full rounded-full bg-surface-elevated flex overflow-hidden p-0.5 gap-0.5 border border-surface-border/40">
                {profile.sourceDistribution.map((src) => {
                  const cfg = sourceConfig[src.source as keyof typeof sourceConfig] ?? {
                    label: src.source,
                    color: "bg-foreground-muted",
                    dot: "#94a3b8",
                    text: "text-foreground-muted"
                  };
                  const pct = Math.max(3, (src.listenedMs / totalSourceTime) * 100);
                  return (
                    <div
                      key={src.source}
                      style={{ width: `${pct}%` }}
                      className={`h-full rounded-full ${cfg.color} transition-all`}
                      title={`${cfg.label}: ${pct.toFixed(1)}%`}
                    />
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs text-foreground-muted">
                {profile.sourceDistribution.map((src) => {
                  const cfg = sourceConfig[src.source as keyof typeof sourceConfig] ?? {
                    label: src.source,
                    color: "bg-foreground-muted",
                    dot: "#94a3b8",
                    text: "text-foreground-muted"
                  };
                  const pct = ((src.listenedMs / totalSourceTime) * 100).toFixed(0);
                  return (
                    <div key={src.source} className="flex items-center gap-1.5 min-w-0 truncate">
                      <span className={`w-2 h-2 rounded-full ${cfg.color} shrink-0`} />
                      <span className="truncate">{cfg.label}</span>
                      <span className="font-semibold text-foreground shrink-0">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface/50 p-3 sm:p-3.5 transition-colors hover:bg-surface/70 flex flex-col justify-between min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-1.5 mb-1.5 min-w-0">
        <span className="text-xs font-medium text-foreground-muted truncate">{label}</span>
        <div className="p-1 rounded-md bg-surface-elevated text-foreground-muted shrink-0">
          {icon}
        </div>
      </div>
      <dd className="text-base sm:text-xl font-bold text-foreground tracking-tight tabular-nums truncate">
        {value}
      </dd>
    </div>
  );
}

function Artwork({ alt, src, className = "" }: { alt: string; src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const source = src ? getArtworkSourceUrl(src) : null;
  if (!source || failed) {
    return (
      <span aria-label={alt || undefined} className={`flex items-center justify-center bg-surface-elevated text-xs text-foreground-muted ${className}`}>
        ♪
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className={`object-cover ${className}`} loading="lazy" onError={() => setFailed(true)} src={source} />;
}

function ProfileLoadingSkeleton() {
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 rounded-xl bg-surface/40 border border-surface-border animate-pulse" />
        ))}
      </div>
      <div className="h-36 rounded-xl bg-surface/40 border border-surface-border animate-pulse" />
    </div>
  );
}

function ProfileEmptyState({ onOpenColdStart }: { onOpenColdStart?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 rounded-xl border border-surface-border bg-surface/30 text-center">
      <div className="p-3 rounded-xl bg-surface-elevated border border-surface-border text-foreground-muted mb-3.5">
        <MusicIcon className="w-6 h-6 text-accent" />
      </div>
      <h3 className="text-base font-bold text-foreground">记录你的听歌足迹</h3>
      <p className="text-xs sm:text-sm text-foreground-muted max-w-sm mt-1 mb-5 leading-relaxed">
        在房间听歌、收藏歌曲或在电台收听后，这里会自动生成你的收听偏好与常听歌手。
      </p>
      {onOpenColdStart && (
        <button
          type="button"
          onClick={onOpenColdStart}
          className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium text-xs shadow-xs transition-all active:scale-95 cursor-pointer"
        >
          挑选常听曲风与场景
        </button>
      )}
    </div>
  );
}

function formatDuration(durationMs: number) {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  if (totalMinutes < 60) {
    return `${totalMinutes} 分钟`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}
