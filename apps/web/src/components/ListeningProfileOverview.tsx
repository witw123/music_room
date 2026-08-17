"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { AuthSession, PersonalizationProfileResponse } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { personalizationChangedEvent } from "@/features/personalization/use-personalization-reporter";

const sourceLabels = {
  netease: "网易云音乐",
  qqmusic: "QQ 音乐",
  local_upload: "本地"
} as const;

export function ListeningProfileOverview({ activeSession }: { activeSession: AuthSession }) {
  const pathname = usePathname();
  const [profile, setProfile] = useState<PersonalizationProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let request: Promise<void> | null = null;
    let refreshQueued = false;

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
          // Keep the last successful profile visible when a background refresh fails.
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
      if (pathname === "/app/profile") load();
    };

    setProfile(null);
    setLoading(pathname === "/app/profile");
    if (pathname === "/app/profile") load();
    window.addEventListener(personalizationChangedEvent, handleProfileChange);
    return () => {
      cancelled = true;
      request = null;
      window.removeEventListener(personalizationChangedEvent, handleProfileChange);
    };
  }, [activeSession.userId, pathname]);

  return (
    <section aria-busy={refreshing} className="mt-8 border-b border-surface-border py-6 sm:py-7">
      {loading && !profile ? <ProfileLoading /> : !profile || profile.totalPlayCount === 0 ? <ProfileEmpty /> : (
        <div className="mt-6">
          <dl className="grid grid-cols-2 border-y border-surface-border sm:grid-cols-4">
            <Metric label="累计聆听" value={formatDuration(profile.totalListenedMs)} />
            <Metric label="播放次数" value={String(profile.totalPlayCount)} />
            <Metric label="听过歌曲" value={String(profile.trackCount)} />
            <Metric label="听过歌手" value={String(profile.artistCount)} />
          </dl>

          <section className="py-6">
            <SectionTitle title="歌曲偏好" />
            {profile.tasteTags.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {profile.tasteTags.map((tag) => <span className="flex h-16 min-w-16 items-center justify-center rounded-full border border-accent/35 bg-accent/10 px-3 text-center text-xs font-medium text-accent" key={tag.label}>{tag.label}</span>)}
              </div>
            ) : <p className="mt-3 text-sm text-foreground-muted">继续收听，画像会逐步形成</p>}
          </section>

          <div className="grid gap-7 border-t border-surface-border pt-6 lg:grid-cols-2 lg:gap-10">
            <TrackList items={profile.topTracks} subtitle="最常播放" value={(item) => `${item.playCount} 次 · ${formatDuration(item.listenedMs)}`} />
            <TrackList items={profile.topTracks.slice().sort((left, right) => right.score - left.score)} subtitle="特别喜欢" value={(item) => item.reasons[0] ?? "长期偏好"} />
          </div>

          <div className="mt-7 grid gap-7 border-t border-surface-border pt-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-10">
            <section>
              <SectionTitle title="常听歌手" />
              <div className="mt-3 divide-y divide-surface-border">
                {profile.topArtists.map((artist, index) => (
                  <div className="flex min-w-0 items-center gap-3 py-3" key={artist.name}>
                    <span className="w-5 shrink-0 text-xs tabular-nums text-foreground-muted">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{artist.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-foreground-muted">{artist.playCount} 次</span>
                  </div>
                ))}
              </div>
            </section>
            <section>
              {profile.sourceDistribution.length > 0 ? <div>
                <SectionTitle title="聆听来源" />
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                  {profile.sourceDistribution.map((source) => <span className="text-xs text-foreground-muted" key={source.source}>{sourceLabels[source.source as keyof typeof sourceLabels] ?? source.source} <strong className="ml-1 font-medium text-foreground">{formatDuration(source.listenedMs)}</strong></span>)}
                </div>
              </div> : null}
            </section>
          </div>

        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-r border-surface-border px-3 py-4 first:pl-0 last:border-r-0 sm:px-5 sm:first:pl-0"><dd className="truncate text-lg font-semibold tabular-nums text-foreground sm:text-xl">{value}</dd><dt className="mt-1 text-xs text-foreground-muted">{label}</dt></div>;
}

function TrackList({ items, subtitle, value }: { items: PersonalizationProfileResponse["topTracks"]; subtitle: string; value: (item: PersonalizationProfileResponse["topTracks"][number]) => string }) {
  return <section><SectionTitle title={subtitle} /><div className="mt-3 divide-y divide-surface-border">{items.map((item, index) => <div className="flex min-w-0 items-center gap-3 py-3" key={`${item.provider}:${item.providerTrackId}`}><span className="w-5 shrink-0 text-xs tabular-nums text-foreground-muted">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{item.title}</p><p className="mt-0.5 truncate text-xs text-foreground-muted">{item.artist}</p></div><span className="shrink-0 text-right text-xs tabular-nums text-foreground-muted">{value(item)}</span></div>)}</div></section>;
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="text-sm font-semibold text-foreground">{title}</h3>;
}

function ProfileLoading() {
  return <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden border border-surface-border bg-surface-border sm:grid-cols-4"><div className="h-20 animate-pulse bg-surface" /><div className="h-20 animate-pulse bg-surface" /><div className="h-20 animate-pulse bg-surface" /><div className="h-20 animate-pulse bg-surface" /></div>;
}

function ProfileEmpty() {
  return <div className="mt-6 border-y border-dashed border-surface-border py-9 text-center"><p className="text-sm font-medium text-foreground-muted">从第一首完整播放开始</p></div>;
}

function formatDuration(value: number) {
  const minutes = Math.max(0, Math.floor(value / 60_000));
  if (minutes < 1) return "不足 1 分钟";
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}
