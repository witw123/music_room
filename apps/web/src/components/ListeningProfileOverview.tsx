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
  const activeTasteGroups = profile.tasteGroups.filter((group) => group.tags.length > 0);

  return (
    <div className="profile-content space-y-6 animate-in fade-in duration-300" aria-busy={refreshing}>
      {statusMessage && (
        <p className="text-xs text-foreground bg-[#141824]/80 border border-white/[0.08] px-4 py-2.5 rounded-2xl backdrop-blur-md">
          {statusMessage}
        </p>
      )}

      {/* 4-Metric Grid (Artistic Acoustic Glass Cells) */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4 sm:gap-4">
        <MetricCard
          label="累计聆听时长"
          value={formatDuration(profile.totalListenedMs)}
          icon={<HeadphonesIcon className="w-4 h-4 text-[#38bdf8]" />}
          glowColor="rgba(56, 189, 248, 0.15)"
          accentBorder="border-[#38bdf8]/20"
        />
        <MetricCard
          label="播放总次数"
          value={`${profile.totalPlayCount} 次`}
          icon={<PlayIcon className="w-4 h-4 text-[#f59e0b]" />}
          glowColor="rgba(245, 158, 11, 0.15)"
          accentBorder="border-[#f59e0b]/20"
        />
        <MetricCard
          label="探索曲目"
          value={`${profile.trackCount} 首`}
          icon={<MusicIcon className="w-4 h-4 text-[#c026d3]" />}
          glowColor="rgba(192, 38, 211, 0.15)"
          accentBorder="border-[#c026d3]/20"
        />
        <MetricCard
          label="探索艺人"
          value={`${profile.artistCount} 位`}
          icon={<LandmarkIcon className="w-4 h-4 text-[#10b981]" />}
          glowColor="rgba(16, 185, 129, 0.15)"
          accentBorder="border-[#10b981]/20"
        />
      </section>

      {/* Taste Dimensions (Musical Taste Constellation Matrix) */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#12141c]/90 to-[#0c0e15]/95 p-5 sm:p-7 shadow-[0_16px_36px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-accent/15 text-accent border border-accent/20">
              <SparklesIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground tracking-tight">音乐品味特征矩阵</h3>
              <p className="text-[11px] text-foreground-muted">基于全景声学画像提炼的多维流派与风格偏好</p>
            </div>
          </div>
          {onOpenColdStart && (
            <button
              type="button"
              onClick={onOpenColdStart}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-accent hover:text-white bg-accent/10 hover:bg-accent border border-accent/20 transition-all active:scale-95"
            >
              调整偏好
            </button>
          )}
        </div>

        {activeTasteGroups.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {activeTasteGroups.map((group) => (
              <div key={group.id} className="space-y-2.5 p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.04]">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold text-foreground-muted tracking-wider uppercase">{group.label}</h4>
                  <span className="text-[10px] text-foreground-muted/60">{group.tags.length} 项</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.tags.map((tag) => (
                    <span
                      key={`${group.id}:${tag.label}:${tag.source}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/[0.08] transition-all cursor-default"
                      title={`契合度: ${(tag.confidence * 100).toFixed(0)}%`}
                    >
                      <span>{tag.label}</span>
                      {tag.confidence >= 0.8 ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
                      ) : tag.confidence >= 0.6 ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-foreground-muted py-3">
            聆听或收藏歌曲后，系统会自动为你提炼曲风、年代与习惯特征。
          </p>
        )}
      </section>

      {/* Top 5 Tracks & Top 5 Artists / Source Distribution */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top 5 Tracks */}
        <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#12141c]/90 to-[#0c0e15]/95 p-5 sm:p-7 shadow-[0_16px_36px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-xl bg-accent/15 text-accent border border-accent/20">
              <BarChartIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground tracking-tight">最常播放歌曲 (Top 5)</h3>
              <p className="text-[11px] text-foreground-muted">陪伴你时间最长的心动单曲</p>
            </div>
          </div>

          <div className="space-y-1.5">
            {profile.topTracks.map((item, index) => {
              const itemKey = `${item.provider}:${item.providerTrackId}`;
              const isRadioRunning = activeRadioTrackKey === itemKey;
              const rankColor =
                index === 0
                  ? "text-amber-400 font-extrabold"
                  : index === 1
                  ? "text-slate-300 font-bold"
                  : index === 2
                  ? "text-amber-600 font-bold"
                  : "text-foreground-muted/80 font-medium";

              return (
                <div
                  key={itemKey}
                  className="flex items-center gap-3 py-2 px-3 rounded-2xl transition-all hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] group"
                >
                  <span className={`w-5 shrink-0 text-sm tabular-nums pl-0.5 ${rankColor}`}>
                    {index + 1}
                  </span>
                  <div className="relative h-11 w-11 min-w-[2.75rem] min-h-[2.75rem] max-w-[2.75rem] max-h-[2.75rem] shrink-0 overflow-hidden rounded-xl bg-surface-elevated shadow-sm border border-white/10">
                    <Artwork alt="" className="h-full w-full object-cover block" src={item.artworkUrl} />
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
                      className="p-1.5 rounded-full text-foreground-muted hover:text-white hover:bg-white/[0.12] transition-colors"
                      title="立即播放"
                    >
                      <PlayIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={isRadioRunning}
                      onClick={() => handleStartTrackRadio(item)}
                      className="p-1.5 rounded-full text-foreground-muted hover:text-accent hover:bg-accent/15 transition-colors"
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
          <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#12141c]/90 to-[#0c0e15]/95 p-5 sm:p-7 shadow-[0_16px_36px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1.5 rounded-xl bg-accent/15 text-accent border border-accent/20">
                <LandmarkIcon className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground tracking-tight">常听歌手 (Top 5)</h3>
                <p className="text-[11px] text-foreground-muted">探索深度最高的音乐创作者</p>
              </div>
            </div>

            <div className="space-y-1.5">
              {profile.topArtists.map((artist, index) => (
                <div
                  key={artist.name}
                  className="flex items-center gap-3 py-2 px-3 rounded-2xl transition-all hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06]"
                >
                  <span className="w-5 shrink-0 text-sm font-bold tabular-nums text-foreground-muted pl-0.5">
                    {index + 1}
                  </span>
                  <div className="flex h-9 w-9 min-w-[2.25rem] min-h-[2.25rem] max-w-[2.25rem] max-h-[2.25rem] shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-accent/30 to-sky-400/30 border border-white/10 text-xs font-bold text-white">
                    {artist.name.slice(0, 1)}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {artist.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-foreground-muted font-medium pr-2">
                    {artist.playCount} 次
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Multi-source Distribution */}
          {profile.sourceDistribution.length > 0 && totalSourceTime > 0 && (
            <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#12141c]/90 to-[#0c0e15]/95 p-5 sm:p-6 shadow-[0_16px_36px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
              <h4 className="text-xs font-semibold text-foreground-muted mb-3 uppercase tracking-wider">音源收听分布</h4>
              {/* Segmented Bar */}
              <div className="h-3 w-full rounded-full bg-white/[0.06] flex overflow-hidden p-0.5 gap-0.5 border border-white/[0.08]">
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

              {/* Legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3.5 text-xs text-foreground-muted">
                {profile.sourceDistribution.map((src) => {
                  const cfg = sourceConfig[src.source as keyof typeof sourceConfig] ?? {
                    label: src.source,
                    color: "bg-foreground-muted",
                    dot: "#94a3b8",
                    text: "text-foreground-muted"
                  };
                  const pct = ((src.listenedMs / totalSourceTime) * 100).toFixed(0);
                  return (
                    <div key={src.source} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${cfg.color} shadow-sm`} />
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
  icon,
  glowColor,
  accentBorder
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  glowColor?: string;
  accentBorder?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${accentBorder ?? "border-white/[0.08]"} bg-gradient-to-b from-[#12141c]/90 to-[#0c0e15]/95 p-4 sm:p-5 flex flex-col justify-between shadow-[0_12px_28px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition-all hover:-translate-y-0.5 group`}
      style={{
        boxShadow: glowColor ? `0 12px 28px rgba(0,0,0,0.4), inset 0 0 20px ${glowColor}` : undefined
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs font-semibold text-foreground-muted tracking-tight">{label}</span>
        <div className="p-1.5 rounded-xl bg-white/[0.06] border border-white/[0.08] group-hover:scale-110 transition-transform">
          {icon}
        </div>
      </div>
      <dd className="text-xl sm:text-2xl font-bold text-white tracking-tight tabular-nums truncate">
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4 sm:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-white/[0.04] border border-white/[0.06] animate-pulse" />
        ))}
      </div>
      <div className="h-44 rounded-3xl bg-white/[0.04] border border-white/[0.06] animate-pulse" />
    </div>
  );
}

function ProfileEmptyState({ onOpenColdStart }: { onOpenColdStart?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#12141c]/90 to-[#0c0e15]/95 text-center shadow-xl">
      <div className="p-3.5 rounded-2xl bg-accent/15 border border-accent/25 text-accent mb-4">
        <SparklesIcon className="w-8 h-8" />
      </div>
      <h3 className="text-lg font-bold text-foreground">开启你的个人音乐声学生态</h3>
      <p className="text-xs sm:text-sm text-foreground-muted max-w-sm mt-1.5 mb-6 leading-relaxed">
        在房间中收听、点歌或收藏曲目，系统将自动为你构建专属的音乐星系与多维品味特征。
      </p>
      {onOpenColdStart && (
        <button
          type="button"
          onClick={onOpenColdStart}
          className="px-6 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white font-semibold text-xs shadow-[0_4px_16px_var(--accent-glow)] transition-all active:scale-95"
        >
          即刻定制音乐偏好
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
