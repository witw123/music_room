"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { adminApi, AdminApiError, type AdminUserDetail } from "@/lib/admin-api";
import styles from "../../admin.module.css";

export default function AdminUserDetailPage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [action, setAction] = useState<"status" | "revoke" | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    try {
      setError("");
      setUser(await adminApi.user(params.userId));
    } catch (cause) {
      if (cause instanceof AdminApiError && (cause.status === 401 || cause.status === 403)) router.replace("/admin/login");
      else setError(cause instanceof Error ? cause.message : "加载用户数据失败。");
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, [params.userId, router]);

  useEffect(() => {
    void load();
    const refreshIfVisible = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refreshIfVisible, 10000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load]);

  async function confirmAction() {
    if (!user || !action || actionBusy) return;
    setActionError("");
    if (reason.trim().length < 8) {
      setActionError("操作原因至少需要 8 个字符。");
      return;
    }
    setActionBusy(true);
    try {
      if (action === "status") {
        await adminApi.setUserStatus(user.id, user.status === "ACTIVE" ? "DISABLED" : "ACTIVE", reason.trim());
      } else {
        await adminApi.revokeSessions(user.id, reason.trim());
      }
      setAction(null);
      setReason("");
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "管理操作失败，请刷新后重试。");
    } finally {
      setActionBusy(false);
    }
  }

  if (error) return <main className={styles.shell}><div className={styles.content}><div className={styles.error}>{error}<button onClick={() => void load()}>重新尝试</button></div></div></main>;
  if (!user) return <main className={styles.shell}><div className={styles.content}><div className={styles.empty}>正在加载用户详情...</div></div></main>;

  const isAdmin = user.role === "ADMIN";
  const actionLabel = action === "status" ? (user.status === "ACTIVE" ? "禁用账号" : "启用账号") : "撤销全部会话";
  return <main className={styles.shell}><div className={styles.main}>
    <header className={styles.topbar}><button className={styles.topButton} onClick={() => router.back()}>← 返回用户目录</button><div className={styles.topActions}><span className={styles.liveState}><span className={styles.liveDot} />{refreshing ? "同步中" : "实时数据"}</span><button className={styles.topButton} onClick={() => void load()} disabled={refreshing}>刷新</button></div></header>
    <div className={styles.content}>
      <div className={styles.pageHeader}><div><div className={styles.eyebrow}>用户目录 / 详情</div><h1 className={styles.title}>{user.nickname}</h1><p className={styles.subtitle}>{user.username} · 用户 ID {user.id}</p></div></div>
      <section className={styles.metricGrid}><Metric label="账号状态" value={user.status === "ACTIVE" ? "正常" : "已禁用"} /><Metric label="有效会话" value={String(user.sessions.length)} /><Metric label="当前房间" value={String(user.rooms.length)} /><Metric label="账号角色" value={user.role === "ADMIN" ? "管理员" : "普通用户"} /></section>

      <section className={`${styles.panel} ${styles.fullPanel}`}>
        <PanelHeader title="账号控制" hint={isAdmin ? "管理员账号不可由面板修改" : "操作会立即同步到所有实例"} />
        <div className={styles.controlBody}>
          {isAdmin ? <p className={styles.controlHint}>管理员角色和管理员账号状态只能通过服务端 CLI 管理。</p> : action ? <div className={styles.confirmPanel}>
            <div><strong>确认{actionLabel}</strong><p className={styles.controlHint}>{action === "status" ? (user.status === "ACTIVE" ? "禁用后会撤销该用户的全部普通会话并断开实时连接。" : "启用后不会恢复旧会话，用户需要重新登录。") : "撤销后该用户需要重新登录，账号状态不会改变。"}</p></div>
            <label className={styles.detailLabel}>操作原因<input className={styles.detailInput} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="至少 8 个字符" /></label>
            {actionError ? <p className={styles.inlineError}>{actionError}</p> : null}
            <div className={styles.actionRow}><button className={styles.secondaryButton} onClick={() => { setAction(null); setActionError(""); }} disabled={actionBusy}>取消</button><button className={styles.dangerButton} onClick={() => void confirmAction()} disabled={actionBusy}>{actionBusy ? "处理中..." : `确认${actionLabel}`}</button></div>
          </div> : <div className={styles.controlRow}><div><strong>账号操作</strong><p className={styles.controlHint}>每次操作只需在此处确认一次，不使用浏览器弹窗。</p></div><div className={styles.actionRow}><button className={user.status === "ACTIVE" ? styles.dangerButton : styles.secondaryButton} onClick={() => { setAction("status"); setReason(""); setActionError(""); }}>{user.status === "ACTIVE" ? "禁用账号" : "启用账号"}</button><button className={styles.secondaryButton} onClick={() => { setAction("revoke"); setReason(""); setActionError(""); }}>撤销全部会话</button></div></div>}
        </div>
      </section>

      <section className={styles.detailGrid}><InfoPanel title="账号信息"><DetailRow label="用户 ID" value={user.id} mono /><DetailRow label="用户名" value={user.username} mono /><DetailRow label="昵称" value={user.nickname} /><DetailRow label="状态" value={user.status === "ACTIVE" ? "正常" : "已禁用"} /><DetailRow label="注册时间" value={formatDateTime(user.createdAt)} /><DetailRow label="最近登录" value={formatDateTime(user.lastLoginAt)} /><DetailRow label="禁用时间" value={formatDateTime(user.disabledAt)} /><DetailRow label="禁用原因" value={user.disabledReason ?? "-"} /></InfoPanel><InfoPanel title="当前房间"><DataList rows={user.rooms} empty="当前没有加入任何房间。" render={(room) => <><a className={`${styles.linkButton} ${styles.roomCodeLink}`} href={`/admin/rooms/${encodeURIComponent(room.id)}`}>{room.joinCode}</a><span>{room.name || "未命名房间"} · {room.role === "host" ? "房主" : "成员"}</span></>} /></InfoPanel></section>
      <DataPanel title="有效会话" hint={`${user.sessions.length} 个`}><table className={styles.table}><thead><tr><th>会话 ID</th><th>创建时间</th><th>过期时间</th></tr></thead><tbody>{user.sessions.length ? user.sessions.map((session) => <tr key={session.id}><td className={styles.mono}>{session.id}</td><td className={styles.mono}>{formatDateTime(session.createdAt)}</td><td className={styles.mono}>{formatDateTime(session.expiresAt)}</td></tr>) : <tr><td colSpan={3}><div className={styles.empty}>没有有效普通会话。</div></td></tr>}</tbody></table></DataPanel>
      <DataPanel title="相关审计" hint={`${user.audits.length} 条`}><table className={styles.table}><thead><tr><th>时间</th><th>动作</th><th>结果</th><th>原因</th></tr></thead><tbody>{user.audits.length ? user.audits.map((audit) => <tr key={audit.id}><td className={styles.mono}>{formatDateTime(audit.createdAt)}</td><td className={styles.mono}>{translateAction(audit.action)}</td><td>{audit.result === "SUCCEEDED" ? "成功" : audit.result}</td><td className={styles.mono}>{audit.reason ?? "-"}</td></tr>) : <tr><td colSpan={4}><div className={styles.empty}>暂无相关审计记录。</div></td></tr>}</tbody></table></DataPanel>
    </div>
  </div></main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className={styles.metric}><div className={styles.metricLabel}>{label}</div><div className={styles.metricRow}><strong className={styles.metricValue}>{value}</strong></div></div>; }
function PanelHeader({ title, hint }: { title: string; hint?: string }) { return <div className={styles.panelHeader}><div><div className={styles.panelTitle}>{title}</div>{hint ? <div className={styles.panelHint}>{hint}</div> : null}</div></div>; }
function InfoPanel({ title, children }: { title: string; children: ReactNode }) { return <section className={styles.panel}><PanelHeader title={title} /><div className={styles.detailList}>{children}</div></section>; }
function DataPanel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) { return <section className={`${styles.panel} ${styles.fullPanel}`}><PanelHeader title={title} hint={hint} /><div className={styles.tableWrap}>{children}</div></section>; }
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className={styles.detailRow}><span className={styles.detailLabel}>{label}</span><span className={mono ? styles.mono : styles.detailValue}>{value}</span></div>; }
function DataList({ rows, empty, render }: { rows: Array<Record<string, string>>; empty: string; render: (row: Record<string, string>) => ReactNode }) { return rows.length ? <div className={styles.dataList}>{rows.map((row) => <div className={styles.dataListItem} key={row.id}>{render(row)}</div>)}</div> : <div className={styles.empty}>{empty}</div>; }
function formatDateTime(value: string | null | undefined) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(); }
function translateAction(value: string) { const labels: Record<string, string> = { "user.disable": "禁用账号", "user.enable": "启用账号", "user.sessions.revoke": "撤销会话" }; return labels[value] ?? value; }
