"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { AuthSession, PersonalizationProfileResponse, ProviderTrackCandidate } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { personalizationChangedEvent } from "@/features/personalization/use-personalization-reporter";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import { toProviderTrackRecord } from "@/features/playlist/local-playlist";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";
import {
  PlayIcon,
  RadioIcon,
  MusicIcon,
  HeadphonesIcon,
  LandmarkIcon,
  SparklesIcon,
  BarChartIcon
} from "@/components/icons/DiscoverIcons";

const sourceConfig = {
  netease: { label: "网易云音乐", color: "bg-[#fa233b]", text: "text-[#fa233b]" },
  qqmusic: { label: "QQ 音乐", color: "bg-[#10b981]", text: "text-[#10b981]" },
  local_upload: { label: "本地音频", color: "bg-[#a1a1aa]", text: "text-[#a1a1aa]" }
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
  const [profile, setProfile] = useState<PersonalizationProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeRadioTrackKey, setActiveRadioTrackKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
      const record = toProviderTrackRecord(candidate);
      await player.playTrack(record);
      setStatusMessage(`正在播放《${candidate.title}》`);
    } catch {
      setStatusMessage(`播放《${candidate.title}》失败`);
    }
  };

  const handleStartTrackRadio = async (candidate: ProviderTrackCandidate) => {
    const key = `${candidate.provider}:${candidate.providerTrackId}`;
    setActiveRadioTrackKey(key);
    try {
      const radioTracks = await musicRoomApi.getTrackRadio({ seedTrack: candidate, limit: 15 });
      const seedRecord = toProviderTrackRecord(candidate);
      await player.playTrack(seedRecord);
      for (const nextTrack of radioTracks.slice(0, 10)) {
        player.addToQueue(toProviderTrackRecord(nextTrack));
      }
      setStatusMessage(`已开启从《${candidate.title}》出发的单曲漫游`);
    } catch {
      setStatusMessage(`开启漫游失败，请稍后重试`);
    } finally {
      setActiveRadioTrackKey(null);
    }
  };

  if (loading && !profile) {
    return <ProfileLoadingSkeleton />;
  }

  if (!profile || profile.totalPlayCount === 0) {
    return <ProfileEmptyState onOpenColdStart={onOpenColdStart} />;
  }

  const totalSourceTime = profile.sourceDistribution.reduce((acc, curr) => acc + curr.listenedMs, 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300" aria-busy={refreshing}>
      {statusMessage && (
        <p className="text-xs text-foreground bg-surface border border-surface-border px-3.5 py-2 rounded-xl">
          {statusMessage}
        </p>
      )}

      {/* 4-Metric Grid */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <MetricCard
          label="累计聆听时长"
          value={formatDuration(profile.totalListenedMs)}
          icon={<HeadphonesIcon className="w-4 h-4 text-accent" />}
        />
        <MetricCard
          label="播放总次数"
          value={`${profile.totalPlayCount} 次`}
          icon={<PlayIcon className="w-4 h-4 text-accent" />}
        />
        <MetricCard
          label="听过歌曲"
          value={`${profile.trackCount} 首`}
          icon={<MusicIcon className="w-4 h-4 text-accent" />}
        />
        <MetricCard
          label="探索艺人"
          value={`${profile.artistCount} 位`}
          icon={<LandmarkIcon className="w-4 h-4 text-accent" />}
        />
      </section>

      {/* Taste Dimensions */}
      <section className="rounded-2xl border border-surface-border bg-surface/45 p-5 sm:p-6 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <SparklesIcon className="w-4 h-4 text-accent" />
            <h3 className="text-base font-bold text-foreground tracking-tight">音乐品味特征矩阵</h3>
          </div>
          {onOpenColdStart && (
            <button
              type="button"
              onClick={onOpenColdStart}
              className="text-xs font-semibold text-accent hover:text-accent-hover transition-colors"
            >
              调整品味偏好
            </button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {profile.tasteGroups.map((group) => (
            <div key={group.id} className="rounded-xl border border-surface-border/60 bg-surface/30 p-3.5">
              <h4 className="text-xs font-semibold text-foreground-muted mb-2">{group.label}</h4>
              {group.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {group.tags.map((tag) => (
                    <span
                      key={`${group.id}:${tag.label}:${tag.source}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-surface text-foreground border border-surface-border"
                      title={`契合度: ${(tag.confidence * 100).toFixed(0)}%`}
                    >
                      <span>{tag.label}</span>
                      {tag.confidence >= 0.8 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-foreground-muted">正在形成专属特征...</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Top 5 Tracks & Top 5 Artists */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top 5 Tracks */}
        <section className="rounded-2xl border border-surface-border bg-surface/45 p-5 sm:p-6 backdrop-blur-md">
          <div className="flex items-center gap-2 mb-4">
            <BarChartIcon className="w-4 h-4 text-accent" />
            <h3 className="text-base font-bold text-foreground tracking-tight">最常播放歌曲 (Top 5)</h3>
          </div>

          <div className="divide-y divide-surface-border/60">
            {profile.topTracks.map((item, index) => {
              const itemKey = `${item.provider}:${item.providerTrackId}`;
              const isRadioRunning = activeRadioTrackKey === itemKey;
              return (
                <div key={itemKey} className="flex items-center gap-3 py-3 group">
                  <span className="w-5 shrink-0 text-base font-bold tabular-nums text-foreground-muted group-hover:text-accent transition-colors">
                    {index + 1}
                  </span>
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-surface border border-surface-border">
                    <Artwork alt="" className="h-full w-full object-cover" src={item.artworkUrl} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground group-hover:text-accent transition-colors">
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-foreground-muted">
                      {item.artist}{item.album ? ` · ${item.album}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="block text-xs font-semibold tabular-nums text-foreground">
                      {item.playCount} 次
                    </span>
                    <span className="block text-[10px] tabular-nums text-foreground-muted">
                      {formatDuration(item.listenedMs)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 pl-1">
                    <button
                      type="button"
                      onClick={() => handlePlayTrack(item)}
                      className="p-1.5 rounded-full text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                      title="立即播放"
                    >
                      <PlayIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={isRadioRunning}
                      onClick={() => handleStartTrackRadio(item)}
                      className="p-1.5 rounded-full text-foreground-muted hover:text-accent hover:bg-surface-hover transition-colors"
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

        {/* Top 5 Artists & Multi-source Bar */}
        <div className="space-y-6">
          {/* Top 5 Artists */}
          <section className="rounded-2xl border border-surface-border bg-surface/45 p-5 sm:p-6 backdrop-blur-md">
            <div className="flex items-center gap-2 mb-4">
              <LandmarkIcon className="w-4 h-4 text-accent" />
              <h3 className="text-base font-bold text-foreground tracking-tight">常听歌手 (Top 5)</h3>
            </div>

            <div className="divide-y divide-surface-border/60">
              {profile.topArtists.map((artist, index) => (
                <div key={artist.name} className="flex items-center gap-3 py-3">
                  <span className="w-5 shrink-0 text-base font-bold tabular-nums text-foreground-muted">
                    {index + 1}
                  </span>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-xs font-bold text-foreground border border-surface-border">
                    {artist.name.slice(0, 1)}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {artist.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-foreground-muted font-medium">
                    {artist.playCount} 次
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Multi-source Distribution */}
          {profile.sourceDistribution.length > 0 && totalSourceTime > 0 && (
            <section className="rounded-2xl border border-surface-border bg-surface/45 p-5 backdrop-blur-md">
              <h4 className="text-xs font-semibold text-foreground-muted mb-3">音源收听分布</h4>
              {/* Segmented Bar */}
              <div className="h-3 w-full rounded-full bg-surface-hover flex overflow-hidden p-0.5 gap-0.5">
                {profile.sourceDistribution.map((src) => {
                  const cfg = sourceConfig[src.source as keyof typeof sourceConfig] ?? {
                    label: src.source,
                    color: "bg-foreground-muted",
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

              {/* Legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs text-foreground-muted">
                {profile.sourceDistribution.map((src) => {
                  const cfg = sourceConfig[src.source as keyof typeof sourceConfig] ?? {
                    label: src.source,
                    color: "bg-foreground-muted",
                    text: "text-foreground-muted"
                  };
                  const pct = ((src.listenedMs / totalSourceTime) * 100).toFixed(0);
                  return (
                    <div key={src.source} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${cfg.color}`} />
                      <span>{cfg.label}</span>
                      <span className="font-semibold text-foreground">{pct}%</span>
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
    <div className="rounded-2xl border border-surface-border bg-surface/45 p-4 sm:p-5 flex flex-col justify-between backdrop-blur-md">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs font-semibold text-foreground-muted">{label}</span>
        {icon}
      </div>
      <dd className="text-xl sm:text-2xl font-bold text-foreground tracking-tight tabular-nums truncate">
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
      <span aria-label={alt || undefined} className={`flex items-center justify-center bg-surface text-xs text-foreground-muted ${className}`}>
        ♪
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className={`object-cover ${className}`} loading="lazy" onError={() => setFailed(true)} src={source} />;
}

function ProfileLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-surface animate-pulse" />
        ))}
      </div>
      <div className="h-44 rounded-2xl bg-surface animate-pulse" />
    </div>
  );
}

function ProfileEmptyState({ onOpenColdStart }: { onOpenColdStart?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 rounded-3xl border border-dashed border-surface-border bg-surface/30 text-center">
      <SparklesIcon className="w-10 h-10 text-accent mb-3" />
      <h3 className="text-base font-bold text-foreground">开始探索你的音乐画像</h3>
      <p className="text-xs sm:text-sm text-foreground-muted max-w-sm mt-1 mb-5">
        在 Music Room 播放或收藏歌曲，或通过 3 秒偏好设置快速定制你的专属推荐。
      </p>
      {onOpenColdStart && (
        <button
          type="button"
          onClick={onOpenColdStart}
          className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white font-semibold text-xs shadow-[0_4px_16px_var(--accent-glow)] transition-all"
        >
          3 秒定制音乐偏好
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
