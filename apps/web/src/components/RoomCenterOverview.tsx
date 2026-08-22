"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AuthSession, RoomSnapshot } from "@music-room/shared";
import { musicRoomApi, type RoomActivitySummary, type RoomInteractionStats } from "@/lib/network/music-room-api";
import { getOnlineMemberCount } from "@/lib/domain/music-room-ui";
import {
  UsersIcon,
  HeartIcon,
  ActivityIcon,
  SparklesIcon,
  ExternalLinkIcon
} from "@/components/icons/DiscoverIcons";

const roomTypeLabel = {
  interactive: "多人互动房",
  request: "点歌房",
  radio: "自由电台"
} as const;

export function RoomCenterOverview({ activeSession }: { activeSession: AuthSession }) {
  const [ownedRooms, setOwnedRooms] = useState<RoomSnapshot[]>([]);
  const [recentRooms, setRecentRooms] = useState<RoomActivitySummary[]>([]);
  const [stats, setStats] = useState<RoomInteractionStats | null>(null);
  const [showAllOwned, setShowAllOwned] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      musicRoomApi.listOwnedRooms(),
      musicRoomApi.getRoomActivity(),
      musicRoomApi.getRoomInteractionStats()
    ]).then(([owned, recent, nextStats]) => {
      if (cancelled) return;
      setOwnedRooms(owned);
      setRecentRooms(recent);
      setStats(nextStats);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeSession.userId]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Interaction Stats */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#1c1c1e]/80 p-5 sm:p-6 backdrop-blur-md">
        <h3 className="text-base font-bold text-white mb-4">房间互动成就</h3>
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <StatCard
            label="发出点赞"
            value={stats?.sentLikes ?? 0}
            icon={<HeartIcon className="w-4 h-4 text-[#fa233b]" />}
          />
          <StatCard
            label="发出鼓掌"
            value={stats?.sentApplause ?? 0}
            icon={<SparklesIcon className="w-4 h-4 text-[#fa233b]" />}
          />
          <StatCard
            label="收到互动"
            value={stats?.receivedReactions ?? 0}
            icon={<ActivityIcon className="w-4 h-4 text-[#fa233b]" />}
          />
        </div>
      </section>

      {/* Owned Rooms */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#1c1c1e]/80 p-5 sm:p-6 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-white">我创建的房间</h3>
          <Link
            className="text-xs font-semibold text-[#fa233b] hover:text-[#fc3c44] inline-flex items-center gap-1 transition-colors"
            href="/app"
          >
            <span>探索房间大厅</span>
            <ExternalLinkIcon className="w-3 h-3" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(showAllOwned ? ownedRooms : ownedRooms.slice(0, 6)).map((snapshot) => (
            <OwnedRoomCard key={snapshot.room.id} snapshot={snapshot} />
          ))}
          {ownedRooms.length === 0 ? (
            <div className="col-span-full py-8 text-center rounded-xl border border-dashed border-white/[0.06] text-neutral-500 text-xs">
              还没有创建房间
            </div>
          ) : null}
        </div>

        {ownedRooms.length > 6 ? (
          <button
            className="mt-4 text-xs font-semibold text-[#fa233b] hover:text-[#fc3c44] transition-colors"
            onClick={() => setShowAllOwned((current) => !current)}
            type="button"
          >
            {showAllOwned ? "收起" : `查看全部 ${ownedRooms.length} 个房间`}
          </button>
        ) : null}
      </section>

      {/* Recent Rooms */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#1c1c1e]/80 p-5 sm:p-6 backdrop-blur-md">
        <h3 className="text-base font-bold text-white mb-4">最近参与</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(showAllRecent ? recentRooms : recentRooms.slice(0, 6)).map((room) => (
            <RecentRoomCard key={room.roomId} room={room} />
          ))}
          {recentRooms.length === 0 ? (
            <div className="col-span-full py-8 text-center rounded-xl border border-dashed border-white/[0.06] text-neutral-500 text-xs">
              还没有参与记录
            </div>
          ) : null}
        </div>

        {recentRooms.length > 6 ? (
          <button
            className="mt-4 text-xs font-semibold text-[#fa233b] hover:text-[#fc3c44] transition-colors"
            onClick={() => setShowAllRecent((current) => !current)}
            type="button"
          >
            {showAllRecent ? "收起" : `查看全部 ${recentRooms.length} 条记录`}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function OwnedRoomCard({ snapshot }: { snapshot: RoomSnapshot }) {
  const room = snapshot.room;
  const onlineCount = getOnlineMemberCount(room.members);
  return (
    <Link
      className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-all hover:bg-white/[0.06] hover:border-white/[0.12]"
      href={`/room/${room.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-semibold text-sm text-white group-hover:text-[#fa233b] transition-colors">
          {room.name ?? "未命名房间"}
        </span>
        <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-neutral-400 border border-white/[0.06]">
          {roomTypeLabel[room.roomType]}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-neutral-400">
        <span className="inline-flex items-center gap-1">
          <UsersIcon className="w-3 h-3 text-[#fa233b]" />
          <span>{onlineCount} 人在线</span>
        </span>
        <span className="text-neutral-500 font-mono text-[11px]">
          {room.playback.status === "playing" ? "▶ 播放中" : "已暂停"}
        </span>
      </div>
    </Link>
  );
}

function RecentRoomCard({ room }: { room: RoomActivitySummary }) {
  return (
    <Link
      className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-all hover:bg-white/[0.06] hover:border-white/[0.12]"
      href={`/room/${room.roomId}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-semibold text-sm text-white group-hover:text-[#fa233b] transition-colors">
          {room.roomName}
        </span>
        <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-neutral-400 border border-white/[0.06]">
          {roomTypeLabel[room.roomType]}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-400">
        <span>{room.isActive ? "正在房间中" : "最近参与"}</span>
        <span className="shrink-0 font-mono text-[11px] text-neutral-500">{formatDuration(room.durationMs)}</span>
      </div>
    </Link>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 sm:p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-neutral-400">{label}</span>
        {icon}
      </div>
      <span className="block text-xl sm:text-2xl font-black text-white tabular-nums tracking-tight">
        {value}
      </span>
    </div>
  );
}

function formatDuration(durationMs: number) {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  return totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)} 小时 ${totalMinutes % 60} 分钟` : `${totalMinutes} 分钟`;
}
