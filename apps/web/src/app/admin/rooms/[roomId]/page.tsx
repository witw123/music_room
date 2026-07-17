"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { adminApi, AdminApiError } from "@/lib/admin-api";
type RoomDetail = { id: string; health: string; onlineMemberCount: number; memberCount: number; playbackStatus: string; members: unknown };

export default function AdminRoomDetailPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { adminApi.room(params.roomId).then(setRoom).catch((cause) => { if (cause instanceof AdminApiError && cause.status === 401) router.replace("/admin/login"); else setError(cause instanceof Error ? cause.message : "加载失败"); }); }, [params.roomId, router]);
  if (error) return <main className="min-h-screen bg-[#07080b] p-8 text-red-200">{error}</main>;
  if (!room) return <main className="min-h-screen bg-[#07080b] p-8 text-white">加载中...</main>;
  return <main className="min-h-screen bg-[#07080b] p-4 text-white sm:p-8"><button onClick={() => router.back()} className="text-sm text-[#60a5fa] underline">返回房间列表</button><h1 className="mt-6 text-2xl font-semibold">房间 {room.id}</h1><div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="border border-white/10 p-4">健康：{room.health}</div><div className="border border-white/10 p-4">成员：{room.onlineMemberCount}/{room.memberCount}</div><div className="border border-white/10 p-4">播放：{room.playbackStatus}</div></div><section className="mt-6 border border-white/10 p-4"><h2 className="text-sm text-white/60">成员诊断</h2><pre className="mt-3 overflow-auto text-xs text-white/60">{JSON.stringify(room.members, null, 2)}</pre></section></main>;
}
