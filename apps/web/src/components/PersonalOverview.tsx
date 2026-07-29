"use client";

import type { AuthSession, RoomSnapshot } from "@music-room/shared";
import { useEffect, useState } from "react";
import { getMemberDurationMs } from "@/components/room/member-data";
import { musicRoomApi, type PlaybackHistoryStats } from "@/lib/music-room-api";

const activityRefreshIntervalMs = 60_000;

export function PersonalOverview({ activeSession }: { activeSession: AuthSession }) {
  const [recentRooms, setRecentRooms] = useState<RoomSnapshot[]>([]);
  const [playbackStats, setPlaybackStats] = useState<PlaybackHistoryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadActivity() {
      const [rooms, stats] = await Promise.all([
        musicRoomApi.getRecentRooms().catch(() => []),
        musicRoomApi.getPlaybackHistoryStats().catch(() => null)
      ]);

      if (cancelled) {
        return;
      }

      setRecentRooms(rooms);
      setPlaybackStats(stats);
      setIsLoading(false);
      setNow(Date.now());
    }

    void loadActivity();
    const refreshId = window.setInterval(() => {
      void loadActivity();
    }, activityRefreshIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
    };
  }, [activeSession.userId]);

  useEffect(() => {
    const clockId = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(clockId);
  }, []);

  return (
    <section aria-labelledby="personal-overview-title" className="border-b border-surface-border pb-9">
      <div className="flex min-w-0 items-center gap-4">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold text-white shadow-[0_8px_24px_var(--accent-glow)] sm:h-16 sm:w-16 sm:text-xl"
        >
          {getInitials(activeSession.nickname)}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-accent">Music Room 用户</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-normal text-foreground" id="personal-overview-title">
            {activeSession.nickname}
          </h1>
          <p className="mt-1 truncate text-sm text-foreground-muted">@{activeSession.username}</p>
        </div>
      </div>

      <div className="mt-9 grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)] lg:gap-12">
        <div className="min-w-0">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">最近加入的房间</h2>
              <p className="mt-1 text-xs text-foreground-muted">每次重新加入都会重新开始计时</p>
            </div>
            {isLoading ? <span className="text-xs text-foreground-muted">加载中</span> : null}
          </div>

          <div className="mt-4 divide-y divide-surface-border border-y border-surface-border">
            {recentRooms.slice(0, 3).map((room) => {
              const member = room.room.members.find((item) => item.id === activeSession.userId);
              const durationMs = member ? getMemberDurationMs(member, now) : 0;
              return (
                <div className="flex min-w-0 items-center justify-between gap-4 py-3" key={room.room.id}>
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-medium text-foreground">
                      {room.room.name || "未命名房间"}
                    </strong>
                    <span className="mt-1 block truncate text-xs text-foreground-muted">
                      房间码 {room.room.joinCode}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <strong className="block text-sm font-medium tabular-nums text-foreground">
                      {formatActivityDuration(durationMs)}
                    </strong>
                    <span className="mt-1 block text-xs text-foreground-muted">加入时长</span>
                  </div>
                </div>
              );
            })}
            {!isLoading && recentRooms.length === 0 ? (
              <p className="py-5 text-sm text-foreground-muted">最近还没有加入过房间</p>
            ) : null}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">最近听歌</h2>
              <p className="mt-1 text-xs text-foreground-muted">近 {playbackStats?.rangeDays ?? 30} 天</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 border-y border-surface-border">
            <ActivityStat
              label="听歌时长"
              value={playbackStats ? formatActivityDuration(playbackStats.listenedMs) : isLoading ? "加载中" : "—"}
            />
            <ActivityStat
              label="听过歌曲"
              value={playbackStats ? `${playbackStats.trackCount} 首` : isLoading ? "加载中" : "—"}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ActivityStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-0 py-4 first:pr-4 last:border-l last:border-surface-border last:pl-4">
      <strong className="block truncate text-lg font-semibold tabular-nums text-foreground sm:text-xl">{value}</strong>
      <span className="mt-1 block truncate text-xs text-foreground-muted">{label}</span>
    </div>
  );
}

function formatActivityDuration(durationMs: number) {
  const totalMinutes = Math.floor(Math.max(0, durationMs) / 60_000);
  if (totalMinutes < 1) {
    return "不到 1 分钟";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  }
  return `${minutes} 分钟`;
}

function getInitials(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "M";
  }
  const characters = Array.from(normalized);
  return characters.length > 1 ? `${characters[0]}${characters[characters.length - 1]}` : characters[0];
}
