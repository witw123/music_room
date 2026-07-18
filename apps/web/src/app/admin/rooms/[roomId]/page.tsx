"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { adminApi, AdminApiError, ADMIN_CONFIRM_REASON, type AdminRoomDetail } from "@/lib/admin-api";
import styles from "../../admin.module.css";

type RoomMember = { id?: string; nickname?: string; peerId?: string | null; presenceState?: string; role?: string; joinedAt?: string };
type JsonRecord = Record<string, unknown>;

export default function AdminRoomDetailPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<AdminRoomDetail | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [action, setAction] = useState<"terminate" | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
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
      else setError(cause instanceof Error ? cause.message : "加载房间监测数据失败。");
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
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load]);

  async function confirmTerminate() {
    if (!room || actionBusy) return;
    setActionError("");
    setActionBusy(true);
    try {
      await adminApi.terminateRoom(room.id, room.joinCode, ADMIN_CONFIRM_REASON);
      router.replace("/admin");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "结束房间失败，请刷新后重试。");
    } finally {
      setActionBusy(false);
    }
  }

  if (error) return <main className={styles.shell}><div className={styles.content}><div className={styles.error}>{error}<button onClick={() => void load()}>重新尝试</button></div></div></main>;
  if (!room) return <main className={styles.shell}><div className={styles.content}><div className={styles.empty}>正在加载房间监测数据...</div></div></main>;

  const members = asRecords(room.members) as RoomMember[];
  const tracks = asRecords(room.tracks);
  const queue = asRecords(room.queue);
  const playback = asRecord(room.playback);
  const currentTrackId = stringValue(playback.currentTrackId);
  const currentTrackTitle = room.currentTrackTitle ?? stringValue(tracks.find((track) => track.id === currentTrackId)?.title) ?? "未播放";

  return <main className={styles.shell}><div className={styles.main}>
    <header className={styles.topbar}>
      <button className={styles.topButton} onClick={() => router.back()}>← 返回房间监测</button>
      <div className={styles.topActions}><span className={styles.liveState}><span className={styles.liveDot} />{refreshing ? "同步中" : "实时数据"}</span><button className={styles.topButton} onClick={() => void load()} disabled={refreshing}>刷新</button></div>
    </header>
    <div className={styles.content}>
      <div className={styles.pageHeader}><div><div className={styles.eyebrow}>房间监测 / 详情</div><h1 className={`${styles.title} ${styles.codeTitle}`}>{room.joinCode}</h1><p className={styles.subtitle}>{room.name ?? "未命名房间"} · 每 3 秒采样一次在线状态</p></div></div>
      <section className={styles.metricGrid}><Metric label="健康度" value={translateStatus(room.health)} /><Metric label="在线成员" value={`${room.onlineMemberCount}/${room.memberCount}`} /><Metric label="诊断覆盖" value={`${room.telemetryCoverage?.reported ?? 0}/${room.telemetryCoverage?.total ?? 0}`} /><Metric label="播放状态" value={translatePlayback(room.playbackStatus)} /></section>

      <section className={`${styles.panel} ${styles.fullPanel}`}>
        <PanelHeader title="房间控制" hint="永久结束后不可恢复" />
        <div className={styles.controlBody}>
          {action === "terminate" ? <div className={styles.confirmPanel}>
            <div><strong>确认永久结束此房间</strong><p className={styles.controlHint}>结束后会删除房间状态、播放队列，并通知在线成员退出。</p></div>
            <p className={styles.confirmTarget}>目标房间：<span className={styles.mono}>{room.joinCode}</span> · {room.name ?? "未命名房间"}</p>
            {actionError ? <p className={styles.inlineError}>{actionError}</p> : null}
            <div className={styles.actionRow}><button className={styles.secondaryButton} onClick={() => { setAction(null); setActionError(""); }} disabled={actionBusy}>取消</button><button className={styles.dangerButton} onClick={() => void confirmTerminate()} disabled={actionBusy}>{actionBusy ? "处理中..." : "确认结束房间"}</button></div>
          </div> : <div className={styles.controlRow}><div><strong>结束房间</strong><p className={styles.controlHint}>仅在需要永久清理房间和客户端资产时使用。</p></div><button className={styles.dangerButton} onClick={() => { setAction("terminate"); setActionError(""); }}>结束房间</button></div>}
        </div>
      </section>

      <section className={styles.detailGrid}>
        <InfoPanel title="房间信息"><DetailRow label="房间码" value={room.joinCode} mono /><DetailRow label="房间 ID" value={room.id} mono /><DetailRow label="房间名称" value={room.name ?? "未命名房间"} /><DetailRow label="房间描述" value={room.description ?? "-"} /><DetailRow label="可见性" value={room.visibility === "private" ? "私密" : "公开"} /><DetailRow label="房主" value={room.hostNickname ?? room.hostId} /><DetailRow label="创建时间" value={formatDateTime(room.createdAt)} /><DetailRow label="更新时间" value={formatDateTime(room.updatedAt)} /></InfoPanel>
        <InfoPanel title="播放状态"><DetailRow label="状态" value={translatePlayback(room.playbackStatus)} /><DetailRow label="当前曲目" value={currentTrackTitle} /><DetailRow label="曲目 ID" value={currentTrackId ?? "-"} mono /><DetailRow label="播放位置" value={`${numberValue(playback.positionMs) ?? 0} ms`} mono /><DetailRow label="播放源" value={stringValue(playback.sourceSessionId) ?? "-"} mono /><DetailRow label="播放版本" value={stringValue(playback.playbackRevision) ?? "-"} mono /></InfoPanel>
      </section>

      <DataPanel title="成员诊断" hint="在线状态、Peer 和加入时间"><table className={styles.table}><thead><tr><th>成员</th><th>状态</th><th>Peer</th><th>角色</th><th>加入时间</th></tr></thead><tbody>{members.length ? members.map((member, index) => <tr key={member.id ?? index}><td><div className={styles.roomId}>{member.nickname ?? member.id ?? "未知"}</div><div className={styles.roomJoin}>{member.id ?? "-"}</div></td><td><State value={member.presenceState ?? "offline"} /></td><td className={styles.mono}>{member.peerId ?? "-"}</td><td className={styles.mono}>{member.role === "host" ? "房主" : "成员"}</td><td className={styles.mono}>{formatDateTime(member.joinedAt)}</td></tr>) : <tr><td colSpan={5}><div className={styles.empty}>暂无成员数据。</div></td></tr>}</tbody></table></DataPanel>
      <section className={styles.detailGrid}><DataPanel title="播放队列" hint={`${queue.length} 项`}><DataList rows={queue} empty="当前没有排队曲目。" render={(item, index) => <><span className={styles.listIndex}>{index + 1}</span><div><strong>{stringValue(item.title) ?? stringValue(item.trackId) ?? "未知曲目"}</strong><span>{stringValue(item.requestedBy) ?? "未知成员"}</span></div></>} /></DataPanel><DataPanel title="房间曲库" hint={`${tracks.length} 首`}><DataList rows={tracks} empty="当前没有曲目。" render={(item) => <><div><strong>{stringValue(item.title) ?? "未命名曲目"}</strong><span>{stringValue(item.artist) ?? "未知艺术家"}</span></div><span className={styles.mono}>{stringValue(item.fileHash)?.slice(0, 8) ?? "-"}</span></>} /></DataPanel></section>
    </div>
  </div></main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className={styles.metric}><div className={styles.metricLabel}>{label}</div><div className={styles.metricRow}><strong className={styles.metricValue}>{value}</strong></div></div>; }
function PanelHeader({ title, hint }: { title: string; hint?: string }) { return <div className={styles.panelHeader}><div><div className={styles.panelTitle}>{title}</div>{hint ? <div className={styles.panelHint}>{hint}</div> : null}</div></div>; }
function InfoPanel({ title, children }: { title: string; children: ReactNode }) { return <section className={styles.panel}><PanelHeader title={title} /><div className={styles.detailList}>{children}</div></section>; }
function DataPanel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) { return <section className={`${styles.panel} ${styles.fullPanel}`}><PanelHeader title={title} hint={hint} /><div className={styles.tableWrap}>{children}</div></section>; }
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className={styles.detailRow}><span className={styles.detailLabel}>{label}</span><span className={mono ? styles.mono : styles.detailValue}>{value}</span></div>; }
function DataList({ rows, empty, render }: { rows: JsonRecord[]; empty: string; render: (row: JsonRecord, index: number) => ReactNode }) { return rows.length ? <div className={styles.dataList}>{rows.map((row, index) => <div className={styles.dataListItem} key={stringValue(row.id) ?? `${index}`}>{render(row, index)}</div>)}</div> : <div className={styles.empty}>{empty}</div>; }
function State({ value }: { value: string }) { const normalized = value.toLowerCase(); const className = normalized === "online" ? styles.statusText : normalized === "reconnecting" ? styles.statusTextAmber : styles.statusTextMuted; const labels: Record<string, string> = { online: "在线", offline: "离线", reconnecting: "重连中" }; return <span className={className}><span aria-hidden="true">●</span>{labels[normalized] ?? value}</span>; }
function asRecord(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function asRecords(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.map(asRecord) : []; }
function stringValue(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value) : null; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function formatDateTime(value: unknown) { if (typeof value !== "string") return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(); }
function translateStatus(value: string) { const labels: Record<string, string> = { active: "正常", healthy: "健康", degraded: "降级", critical: "严重", unknown: "未知", offline: "离线", online: "在线", reconnecting: "重连中" }; return labels[value.toLowerCase()] ?? value; }
function translatePlayback(value: string) { const labels: Record<string, string> = { playing: "播放中", paused: "已暂停", stopped: "已停止", idle: "空闲", conflict: "冲突" }; return labels[value.toLowerCase()] ?? value; }
