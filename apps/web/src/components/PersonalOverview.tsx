"use client";

import type { AuthSession } from "@music-room/shared";
import { useEffect, useState } from "react";
import {
  musicRoomApi,
  type PlaybackHistoryStats,
  type RoomActivitySummary
} from "@/lib/network/music-room-api";

const activityRefreshIntervalMs = 60_000;

export function PersonalOverview({ activeSession }: { activeSession: AuthSession }) {
  const [recentRooms, setRecentRooms] = useState<RoomActivitySummary[]>([]);
  const [playbackStats, setPlaybackStats] = useState<PlaybackHistoryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadActivity() {
      const [rooms, stats] = await Promise.all([
        musicRoomApi.getRoomActivity().catch(() => []),
        musicRoomApi.getPlaybackHistoryStats().catch(() => null)
      ]);

      if (cancelled) {
        return;
      }

      setRecentRooms(rooms);
      setPlaybackStats(stats);
      setIsLoading(false);
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
              <p className="mt-1 text-xs text-foreground-muted">只统计实际在房间内的累计时长</p>
            </div>
            {isLoading ? <span className="text-xs text-foreground-muted">加载中</span> : null}
          </div>

          <div className="mt-4 divide-y divide-surface-border border-y border-surface-border">
            {recentRooms.slice(0, 3).map((room) => {
              return (
                <div className="flex min-w-0 items-center justify-between gap-4 py-3" key={room.roomId}>
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-medium text-foreground">
                      {room.roomName || "未命名房间"}
                    </strong>
                    <span className="mt-1 block truncate text-xs text-foreground-muted">
                      房间码 {room.joinCode}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <strong className="block text-sm font-medium tabular-nums text-foreground">
                      {formatActivityDuration(room.durationMs)}
                    </strong>
                    <span className="mt-1 block text-xs text-foreground-muted">
                      {room.isActive ? "当前加入时长" : "累计加入时长"}
                    </span>
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
              <p className="mt-1 text-xs text-foreground-muted">近 {playbackStats?.rangeDays ?? 30} 天 · 按听歌时长排序</p>
            </div>
          </div>
          <div className="mt-4 border-y border-surface-border">
            {playbackStats?.topTracks.map((track, index) => (
              <div
                className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-surface-border py-3 last:border-b-0"
                key={`${track.provider}:${track.providerTrackId}`}
              >
                <span className="text-center text-sm font-semibold tabular-nums text-accent">{index + 1}</span>
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-medium text-foreground">{track.title}</strong>
                  <span className="mt-1 block truncate text-xs text-foreground-muted">
                    {track.artist}{track.album ? ` · ${track.album}` : ""}
                  </span>
                </div>
                <span className="text-right text-xs font-medium tabular-nums text-foreground-muted">
                  {formatActivityDuration(track.listenedMs)}
                </span>
              </div>
            ))}
            {isLoading ? <p className="py-5 text-sm text-foreground-muted">加载中</p> : null}
            {!isLoading && (!playbackStats || playbackStats.topTracks.length === 0) ? (
              <p className="py-5 text-sm text-foreground-muted">最近还没有听歌记录</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
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
