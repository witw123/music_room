"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AuthSession, RoomSnapshot } from "@music-room/shared";
import { musicRoomApi, type RoomActivitySummary, type RoomInteractionStats } from "@/lib/network/music-room-api";
import { getOnlineMemberCount } from "@/lib/domain/music-room-ui";

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
    <div className="mt-7 grid gap-7">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">我创建的房间</h2>
          <Link className="text-xs text-accent hover:text-accent/80" href="/app">房间大厅</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(showAllOwned ? ownedRooms : ownedRooms.slice(0, 5)).map((snapshot) => <OwnedRoomCard key={snapshot.room.id} snapshot={snapshot} />)}
          {ownedRooms.length === 0 ? <EmptyState text="还没有创建房间" /> : null}
        </div>
        {ownedRooms.length > 5 ? <button className="mt-4 text-sm font-medium text-accent transition hover:text-accent/80" onClick={() => setShowAllOwned((current) => !current)} type="button">{showAllOwned ? "收起" : `查看全部 ${ownedRooms.length} 个房间`}</button> : null}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">最近参与</h2>
        <div className="grid gap-2">
          {(showAllRecent ? recentRooms : recentRooms.slice(0, 5)).map((room) => (
            <Link className="flex items-center justify-between gap-3 border-b border-surface-border py-3 text-sm transition hover:text-accent" href={`/room/${room.roomId}`} key={room.roomId}>
              <span className="min-w-0"><span className="block truncate text-foreground">{room.roomName}</span><span className="mt-1 block text-[11px] text-foreground-muted">{roomTypeLabel[room.roomType]}</span></span>
              <span className="shrink-0 text-xs text-foreground-muted">{room.isActive ? "正在房间中" : formatDuration(room.durationMs)}</span>
            </Link>
          ))}
          {recentRooms.length === 0 ? <EmptyState text="还没有参与记录" /> : null}
        </div>
        {recentRooms.length > 5 ? <button className="mt-4 text-sm font-medium text-accent transition hover:text-accent/80" onClick={() => setShowAllRecent((current) => !current)} type="button">{showAllRecent ? "收起" : `查看全部 ${recentRooms.length} 条记录`}</button> : null}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">互动统计</h2>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="发出点赞" value={stats?.sentLikes ?? 0} />
          <Stat label="发出鼓掌" value={stats?.sentApplause ?? 0} />
          <Stat label="收到互动" value={stats?.receivedReactions ?? 0} />
        </div>
      </section>
    </div>
  );
}

function OwnedRoomCard({ snapshot }: { snapshot: RoomSnapshot }) {
  const room = snapshot.room;
  return (
    <Link className="border border-surface-border bg-surface/45 p-4 transition hover:border-accent/60 hover:bg-surface-hover" href={`/room/${room.id}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-foreground">{room.name ?? "未命名房间"}</span>
        <span className="shrink-0 text-[11px] text-foreground-muted">{roomTypeLabel[room.roomType ?? "interactive"]}</span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-foreground-muted">
        <span>{getOnlineMemberCount(room.members)} 人在线</span>
        <span>{room.playback.status === "playing" ? "播放中" : "已暂停"}</span>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="border border-surface-border bg-surface/45 p-3"><span className="block text-xl font-semibold text-foreground">{value}</span><span className="mt-1 block text-xs text-foreground-muted">{label}</span></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="border border-dashed border-surface-border px-4 py-7 text-center text-sm text-foreground-muted">{text}</div>;
}

function formatDuration(durationMs: number) {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  return totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)} 小时 ${totalMinutes % 60} 分钟` : `${totalMinutes} 分钟`;
}
