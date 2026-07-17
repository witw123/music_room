"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import styles from "../../admin.module.css";

type RoomMember = { id?: string; nickname?: string; peerId?: string | null; presenceState?: string; role?: string };
type RoomDetail = { id: string; joinCode?: string; health: string; onlineMemberCount: number; memberCount: number; playbackStatus: string; telemetryCoverage?: { reported: number; total: number }; members: unknown };

export default function AdminRoomDetailPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const loadingRef = useRef(false);
  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    try {
      setError("");
      setRoom(await adminApi.room(params.roomId));
    } catch (cause) {
      if (cause instanceof AdminApiError && (cause.status === 401 || cause.status === 403)) router.replace("/admin/login");
      else setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, [params.roomId, router]);

  useEffect(() => {
    void load();
    const refreshIfVisible = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refreshIfVisible, 3000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshIfVisible); document.removeEventListener("visibilitychange", refreshIfVisible); };
  }, [load]);

  if (error) return <main className={styles.shell}><div className={styles.content}><div className={styles.error}>{error}<button onClick={() => void load()}>重新尝试</button></div></div></main>;
  if (!room) return <main className={styles.shell}><div className={styles.content}><div className={styles.empty}>正在加载房间监测数据...</div></div></main>;
  const members = Array.isArray(room.members) ? room.members as RoomMember[] : [];
  return <main className={styles.shell}><div className={styles.main}>
    <header className={styles.topbar}><button className={styles.topButton} onClick={() => router.back()}>← 返回房间列表</button><div className={styles.topActions}><span className={styles.liveState}><span className={styles.liveDot} />{refreshing ? "同步中" : "实时数据"}</span><button className={styles.topButton} onClick={() => void load()} disabled={refreshing}>刷新</button></div></header>
    <div className={styles.content}>
      <div className={styles.pageHeader}><div><div className={styles.eyebrow}>房间 / 详情</div><h1 className={styles.title}>{room.id}</h1><p className={styles.subtitle}>房间码：{room.joinCode ?? "-"} · 每 3 秒采样一次在线状态</p></div></div>
      <section className={styles.metricGrid}><Metric label="健康度" value={translateStatus(room.health)} /><Metric label="在线成员" value={`${room.onlineMemberCount}/${room.memberCount}`} /><Metric label="诊断覆盖" value={`${room.telemetryCoverage?.reported ?? 0}/${room.telemetryCoverage?.total ?? 0}`} /><Metric label="播放状态" value={translatePlayback(room.playbackStatus)} /></section>
      <section className={`${styles.panel} ${styles.fullPanel}`}><div className={styles.panelHeader}><div><div className={styles.panelTitle}>成员诊断</div><div className={styles.panelHint}>Redis 在线状态 + 客户端报告</div></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>成员</th><th>状态</th><th>对等端</th><th>角色</th></tr></thead><tbody>{members.length ? members.map((member) => <tr key={member.id}><td><div className={styles.roomId}>{member.nickname ?? member.id ?? "未知"}</div><div className={styles.roomJoin}>{member.id ?? "-"}</div></td><td><State value={member.presenceState ?? "offline"} /></td><td className={styles.mono}>{member.peerId ?? "-"}</td><td className={styles.mono}>{member.role === "owner" ? "房主" : "成员"}</td></tr>) : <tr><td colSpan={4}><div className={styles.empty}>暂无成员数据。</div></td></tr>}</tbody></table></div></section>
    </div>
  </div></main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className={styles.metric}><div className={styles.metricLabel}>{label}</div><div className={styles.metricRow}><strong className={styles.metricValue}>{value}</strong></div></div>; }
function State({ value }: { value: string }) { const normalized = value.toLowerCase(); const className = normalized === "online" ? styles.statusText : normalized === "reconnecting" ? styles.statusTextAmber : styles.statusTextMuted; const labels: Record<string, string> = { online: "在线", offline: "离线", reconnecting: "重连中" }; return <span className={className}><span aria-hidden="true">●</span>{labels[normalized] ?? value}</span>; }
function translateStatus(value: string) { const labels: Record<string, string> = { active: "正常", healthy: "健康", degraded: "降级", critical: "严重", unknown: "未知", offline: "离线", online: "在线", reconnecting: "重连中" }; return labels[value.toLowerCase()] ?? value; }
function translatePlayback(value: string) { const labels: Record<string, string> = { playing: "播放中", paused: "已暂停", stopped: "已停止", idle: "空闲", conflict: "冲突" }; return labels[value.toLowerCase()] ?? value; }
