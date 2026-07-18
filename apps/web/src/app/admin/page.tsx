"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AdminIncident, AdminOverview, AdminRoomSummary, AdminSession, AdminUserSummary } from "@music-room/shared";
import { adminApi, AdminApiError, ADMIN_CONFIRM_REASON } from "@/lib/admin-api";
import styles from "./admin.module.css";

type Tab = "overview" | "rooms" | "users" | "incidents" | "audit" | "system";
type AuditRow = { id: string; action: string; targetType: string; targetId: string | null; reason: string | null; result: string; createdAt: string };

const tabs: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "overview", label: "系统总览", icon: "grid" },
  { id: "rooms", label: "房间监测", icon: "radio" },
  { id: "users", label: "用户目录", icon: "users" },
  { id: "incidents", label: "异常事件", icon: "alert" },
  { id: "audit", label: "管理审计", icon: "file" },
  { id: "system", label: "系统依赖", icon: "server" }
];

type IconName = "grid" | "radio" | "users" | "alert" | "file" | "server" | "refresh" | "logout" | "arrow";

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    radio: <><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.7 4.7a10.3 10.3 0 0 0 0 14.6M19.3 4.7a10.3 10.3 0 0 1 0 14.6" /></>,
    users: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" /><circle cx="9.5" cy="7" r="3.5" /><path d="M17 11a3.5 3.5 0 1 0-1-6.8M21 20v-1.5a4 4 0 0 0-3-3.87" /></>,
    alert: <><path d="m12 3 9 17H3L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
    server: <><rect x="3" y="3" width="18" height="7" rx="1" /><rect x="3" y="14" width="18" height="7" rx="1" /><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" /></>,
    refresh: <><path d="M20 11a8.1 8.1 0 0 0-14.8-3L3 11" /><path d="M3 5v6h6M4 13a8.1 8.1 0 0 0 14.8 3L21 13" /><path d="M21 19v-6h-6" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M21 19V5a2 2 0 0 0-2-2h-6" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [rooms, setRooms] = useState<AdminRoomSummary[]>([]);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [incidents, setIncidents] = useState<AdminIncident[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadingRef = useRef(false);
  const queuedRef = useRef(false);
  const latestLoadRef = useRef<(() => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    if (loadingRef.current) { queuedRef.current = true; return; }
    loadingRef.current = true;
    setRefreshing(true);
    try {
      setError("");
      const current = session ?? await adminApi.session();
      setSession(current);
      const [overviewData, roomData, userData, incidentData, auditData] = await Promise.all([
        adminApi.overview(), adminApi.rooms(query), adminApi.users(query), adminApi.incidents(), adminApi.audit()
      ]);
      setOverview(overviewData);
      setRooms(roomData.data);
      setUsers(userData.data);
      setIncidents(incidentData.data);
      setAudit(auditData.data);
      setLastUpdatedAt(overviewData.generatedAt);
    } catch (cause) {
      if (cause instanceof AdminApiError && (cause.status === 401 || cause.status === 403)) { window.location.assign("/admin/login"); return; }
      setError(cause instanceof Error ? cause.message : "管理数据加载失败。");
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
      if (queuedRef.current) { queuedRef.current = false; void latestLoadRef.current?.(); }
    }
  }, [query, session]);

  latestLoadRef.current = load;
  useEffect(() => {
    void load();
    const refreshIfVisible = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refreshIfVisible, tab === "overview" ? 5000 : 10000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshIfVisible); document.removeEventListener("visibilitychange", refreshIfVisible); };
  }, [load, tab]);

  async function logout() {
    await adminApi.logout().catch(() => undefined);
    window.sessionStorage.removeItem("music-room-admin-csrf");
    window.location.assign("/admin/login");
  }

  const activeTab = tabs.find((item) => item.id === tab) ?? tabs[0];
  const incidentCount = overview?.openIncidents ?? incidents.filter((item) => item.status === "OPEN").length;

  return <div className={styles.shell}>
    <div className={styles.appFrame}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}><div className={styles.brandMark}>MR</div><div><div className={styles.brandName}>音乐房间</div><div className={styles.brandSub}>管理控制台</div></div></div>
        <div className={styles.navLabel}>运维中心</div>
        <nav className={styles.nav} aria-label="管理台导航">
          {tabs.map((item) => <button key={item.id} className={`${styles.navButton} ${tab === item.id ? styles.navButtonActive : ""}`} onClick={() => setTab(item.id)}><span className={styles.navIcon}><Icon name={item.icon} size={15} /></span><span className={styles.navText}>{item.label}</span>{item.id === "incidents" && incidentCount > 0 ? <span className={styles.navCount}>{incidentCount}</span> : null}</button>)}
        </nav>
        <div className={styles.sidebarFooter}><div className={styles.operator}><span className={styles.operatorDot} /><div><div className={styles.operatorName}>{session?.nickname ?? "管理员"}</div><div className={styles.operatorRole}>管理员</div></div></div></div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}><div className={styles.crumb}>音乐房间 <span aria-hidden="true">/</span> <strong>{activeTab.label}</strong></div><div className={styles.topActions}><span className={styles.liveState}><span className={styles.liveDot} />实时数据</span><button className={styles.topButton} onClick={() => void load()} disabled={refreshing}><Icon name="refresh" size={13} />{refreshing ? "刷新中" : "刷新"}</button><button className={styles.topButton} onClick={() => void logout()}><Icon name="logout" size={13} />退出</button></div></header>
        <main className={styles.content}>
          <div className={styles.pageHeader}><div><div className={styles.eyebrow}>运维中心 / {activeTab.label}</div><h1 className={styles.title}>{activeTab.label}</h1><p className={styles.subtitle}>{refreshing ? "正在同步最新状态" : lastUpdatedAt ? `最近采样 ${new Date(lastUpdatedAt).toLocaleTimeString()}` : "等待首次采样"}</p></div>{tab === "rooms" || tab === "users" ? <div className={styles.headerTools}><input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "rooms" ? "搜索房间码" : "搜索用户名或昵称"} aria-label="搜索" /></div> : null}</div>
          {error ? <div className={styles.error}>{error}<button onClick={() => void load()}>重新尝试</button></div> : null}
          {tab === "overview" ? <Overview overview={overview} rooms={rooms} incidents={incidents} audit={audit} onRooms={() => setTab("rooms")} /> : tab === "rooms" ? <Rooms rooms={rooms} onRefresh={load} /> : tab === "users" ? <Users users={users} onRefresh={load} /> : tab === "incidents" ? <Incidents rows={incidents} /> : tab === "audit" ? <Audit rows={audit} /> : <System overview={overview} />}
        </main>
      </div>
    </div>
  </div>;
}

function Overview({ overview, rooms, incidents, audit, onRooms }: { overview: AdminOverview | null; rooms: AdminRoomSummary[]; incidents: AdminIncident[]; audit: AuditRow[]; onRooms: () => void }) {
  const activeRooms = rooms.filter((room) => room.onlineMemberCount > 0).slice(0, 6);
  return <>
    <section className={styles.metricGrid} aria-label="关键指标">
      <Metric label="在线用户" value={overview?.users.online ?? 0} meta={`注册用户 ${overview?.users.total ?? 0} 人`} color="var(--admin-blue)" width={`${Math.min(100, Math.max(10, ((overview?.users.online ?? 0) / Math.max(1, overview?.users.total ?? 1)) * 100))}%`} />
      <Metric label="活跃房间" value={overview?.rooms.active ?? 0} meta={`房间总数 ${overview?.rooms.total ?? 0}`} color="var(--admin-green)" width={`${Math.min(100, Math.max(10, ((overview?.rooms.active ?? 0) / Math.max(1, overview?.rooms.total ?? 1)) * 100))}%`} />
      <Metric label="正在播放" value={overview?.playback.active ?? 0} meta={`已暂停 ${overview?.playback.paused ?? 0}`} color="var(--admin-amber)" width={`${Math.min(100, Math.max(10, ((overview?.playback.active ?? 0) / Math.max(1, overview?.rooms.total ?? 1)) * 100))}%`} />
      <Metric label="未处理异常" value={overview?.openIncidents ?? 0} meta={overview?.rooms.critical ? `严重房间 ${overview.rooms.critical} 个` : "暂无严重房间"} color="var(--admin-red)" width={`${overview?.openIncidents ? 72 : 14}%`} />
    </section>
    <section className={styles.sectionGrid}>
      <div className={styles.panel}><PanelHeader title="活跃房间" hint={`显示 ${activeRooms.length} 个`} action={<button className={styles.panelLink} onClick={onRooms}>查看全部 <Icon name="arrow" size={12} /></button>} /><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>房间</th><th>健康度</th><th>成员</th><th>播放</th><th>更新时间</th></tr></thead><tbody>{activeRooms.length ? activeRooms.map((room) => <RoomRow key={room.id} room={room} />) : <tr><td colSpan={5}><div className={styles.empty}>最近采样中暂无活跃房间。</div></td></tr>}</tbody></table></div></div>
      <SystemHealth overview={overview} />
    </section>
    <section className={styles.sectionGridBottom}><IncidentPanel rows={incidents.slice(0, 4)} /><AuditPanel rows={audit.slice(0, 4)} /></section>
  </>;
}

function Metric({ label, value, meta, color, width }: { label: string; value: number; meta: string; color: string; width: string }) { return <div className={styles.metric} style={{ "--metric-color": color, "--metric-width": width } as CSSProperties}><div className={styles.metricLabel}>{label}</div><div className={styles.metricRow}><strong className={styles.metricValue}>{value}</strong><span className={styles.metricMeta}>{meta}</span></div><div className={styles.metricLine}><span /></div></div>; }
function PanelHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) { return <div className={styles.panelHeader}><div><div className={styles.panelTitle}>{title}</div>{hint ? <div className={styles.panelHint}>{hint}</div> : null}</div>{action}</div>; }
function RoomCell({ room }: { room: AdminRoomSummary }) { const healthClass = room.health === "critical" ? styles.roomSignalCritical : room.health === "degraded" ? styles.roomSignalDegraded : ""; return <div className={styles.roomCell}><span className={`${styles.roomSignal} ${healthClass}`} /><a className={`${styles.linkButton} ${styles.roomCodeLink}`} href={`/admin/rooms/${encodeURIComponent(room.id)}`}>{room.joinCode}</a></div>; }
function RoomRow({ room }: { room: AdminRoomSummary }) { return <tr><td><RoomCell room={room} /></td><td><HealthText value={room.health} /></td><td className={styles.mono}>{room.onlineMemberCount}/{room.memberCount}</td><td className={styles.mono}>{translatePlayback(room.playbackStatus)}</td><td className={styles.mono}>{formatTime(room.updatedAt)}</td></tr>; }

function SystemHealth({ overview }: { overview: AdminOverview | null }) { return <div className={styles.panel}><PanelHeader title="系统健康" hint="依赖状态" /><div className={styles.healthList}><HealthRow label="PostgreSQL 数据库" value={overview?.dependencies.prisma === "up" ? "正常" : "降级"} width={overview?.dependencies.prisma === "up" ? "98%" : "38%"} color={overview?.dependencies.prisma === "up" ? "var(--admin-green)" : "var(--admin-red)"} /><HealthRow label="Redis / 在线状态" value={overview?.dependencies.redis === "up" ? "正常" : "降级"} width={overview?.dependencies.redis === "up" ? "94%" : "30%"} color={overview?.dependencies.redis === "up" ? "var(--admin-green)" : "var(--admin-red)"} /><HealthRow label="应用实例" value={`${overview?.instances ?? 0} 个实例上报`} width={overview?.instances ? "88%" : "25%"} color="var(--admin-blue)" /></div><p className={styles.systemNote}>数据来自控制台心跳与最近一次 Redis 在线状态采样。</p></div>; }
function HealthRow({ label, value, width, color }: { label: string; value: string; width: string; color: string }) { return <div className={styles.healthRow} style={{ "--health-width": width, "--health-color": color } as CSSProperties}><span className={styles.healthLabel}>{label}</span><span className={styles.healthValue}>{value}</span><div className={styles.healthBar}><span /></div></div>; }
function IncidentPanel({ rows }: { rows: AdminIncident[] }) { return <div className={styles.panel}><PanelHeader title="异常队列" hint={rows.length ? `最近 ${rows.length} 条` : "暂无异常"} /><div className={styles.incidentList}>{rows.length ? rows.map((row) => <div className={styles.incidentItem} key={row.id}><span className={`${styles.incidentDot} ${row.severity === "CRITICAL" ? styles.incidentDotCritical : ""}`} /><div><div className={styles.incidentType}>{row.type}</div><div className={styles.incidentScope}>{translateScope(row.scopeType)}：{row.scopeId ?? "全局"}</div></div><span className={styles.incidentTime}>{formatTime(row.lastSeenAt)}</span></div>) : <div className={styles.empty}>暂无未处理异常。</div>}</div></div>; }
function AuditPanel({ rows }: { rows: AuditRow[] }) { return <div className={styles.panel}><PanelHeader title="最近管理活动" hint="审计记录" /><div className={styles.auditList}>{rows.length ? rows.map((row) => <div className={styles.auditItem} key={row.id}><span className={styles.auditTime}>{formatTime(row.createdAt)}</span><div><div className={styles.auditAction}>{translateAction(row.action)}</div><div className={styles.auditTarget}>{translateScope(row.targetType)}：{row.targetId ?? "-"} · {translateResult(row.result)}</div></div></div>) : <div className={styles.empty}>暂无管理活动。</div>}</div></div>; }

function Rooms({ rooms, onRefresh }: { rooms: AdminRoomSummary[]; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<"terminate" | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const allSelected = rooms.length > 0 && rooms.every((room) => selected.has(room.id));

  function toggleRoom(roomId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId); else next.add(roomId);
      return next;
    });
    setBatchMessage("");
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rooms.map((room) => room.id)));
    setBatchMessage("");
  }

  async function runBatch() {
    const targets = rooms.filter((room) => selected.has(room.id));
    if (!targets.length || batchBusy) return;
    setBatchBusy(true);
    setBatchMessage("");
    const results = await Promise.allSettled(targets.map((room) => adminApi.terminateRoom(room.id, room.joinCode, ADMIN_CONFIRM_REASON)));
    const failed = results.filter((result) => result.status === "rejected").length;
    setBatchBusy(false);
    setBatchAction(null);
    setSelected(new Set());
    setBatchMessage(failed ? `已处理 ${targets.length - failed} 个房间，${failed} 个失败，请查看详情重试。` : `已结束 ${targets.length} 个房间。`);
    await onRefresh();
  }

  function openRoom(roomId: string) { window.location.assign(`/admin/rooms/${encodeURIComponent(roomId)}`); }

  return <>
    <div className={styles.toolbar}><div><div className={styles.toolbarTitle}>房间目录</div><div className={styles.toolbarMeta}>点击任意一行进入详情，查看状态并执行控制</div></div><span className={styles.toolbarMeta}>{rooms.length} 条结果</span></div>
    {selected.size ? <div className={styles.batchBar}><span>已选 {selected.size} 个房间</span><div className={styles.actionRow}><button className={styles.secondaryButton} onClick={() => setSelected(new Set())}>清空选择</button><button className={styles.dangerButton} onClick={() => setBatchAction("terminate")}>结束选中房间</button></div></div> : null}
    {batchAction ? <div className={styles.confirmPanel}><div><strong>确认结束选中的 {selected.size} 个房间</strong><p className={styles.controlHint}>操作会永久清理房间状态、队列和在线成员的房间资产。</p></div><div className={styles.actionRow}><button className={styles.secondaryButton} onClick={() => setBatchAction(null)} disabled={batchBusy}>取消</button><button className={styles.dangerButton} onClick={() => void runBatch()} disabled={batchBusy}>{batchBusy ? "处理中..." : "确认结束"}</button></div></div> : null}
    {batchMessage ? <div className={styles.batchMessage} role="status">{batchMessage}</div> : null}
    <div className={`${styles.panel} ${styles.fullPanel}`}><div className={styles.tableWrap}><table className={`${styles.table} ${styles.directoryTable}`}><thead><tr><th className={styles.selectionCell}><input className={styles.selectBox} type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选房间" /></th><th>房间</th><th>健康度</th><th>成员</th><th>播放</th><th>可见性</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{rooms.map((room) => <tr className={styles.clickableRow} key={room.id} onClick={() => openRoom(room.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRoom(room.id); } }} role="link" tabIndex={0}><td className={styles.selectionCell} onClick={(event) => event.stopPropagation()}><input className={styles.selectBox} type="checkbox" checked={selected.has(room.id)} onChange={() => toggleRoom(room.id)} aria-label={`选择房间 ${room.joinCode}`} /></td><td><div className={styles.roomCell}><span className={`${styles.roomSignal} ${room.health === "critical" ? styles.roomSignalCritical : room.health === "degraded" ? styles.roomSignalDegraded : ""}`} /><div><div className={`${styles.roomId} ${styles.directoryPrimary}`}>{room.joinCode}</div><div className={styles.roomJoin}>{room.name || "未命名房间"} · 房主 {room.hostNickname || room.hostId}</div></div></div></td><td><HealthText value={room.health} /></td><td className={styles.mono}>{room.onlineMemberCount}/{room.memberCount}</td><td><div className={styles.directoryPlayback}>{translatePlayback(room.playbackStatus)}<span>{room.currentTrackTitle || "未播放"}</span></div></td><td className={styles.mono}>{room.visibility === "private" ? "私密" : "公开"}</td><td className={styles.mono}>{formatTime(room.updatedAt)}</td><td><button className={styles.tableAction} onClick={(event) => { event.stopPropagation(); openRoom(room.id); }}>详情</button></td></tr>)}{rooms.length ? null : <tr><td colSpan={8}><div className={styles.empty}>没有符合筛选条件的房间。</div></td></tr>}</tbody></table></div></div>
  </>;
}

function UserCell({ user }: { user: AdminUserSummary }) { return <div className={styles.roomCell}><span className={styles.userAvatar}>{user.nickname.slice(0, 1).toUpperCase()}</span><div><div className={`${styles.linkButton} ${styles.directoryPrimary}`}>{user.nickname}</div><div className={styles.roomJoin}>{user.username}</div></div></div>; }
function Users({ users, onRefresh }: { users: AdminUserSummary[]; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<"disable" | "enable" | "revoke" | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const manageable = users.filter((user) => user.role !== "ADMIN");
  const selectedUsers = manageable.filter((user) => selected.has(user.id));
  const allSelected = manageable.length > 0 && manageable.every((user) => selected.has(user.id));

  function toggleUser(userId: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(userId)) next.delete(userId); else next.add(userId); return next; });
    setBatchMessage("");
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(manageable.map((user) => user.id)));
    setBatchMessage("");
  }

  async function runBatch() {
    if (!selectedUsers.length || !batchAction || batchBusy) return;
    const targets = batchAction === "disable" ? selectedUsers.filter((user) => user.status === "ACTIVE") : batchAction === "enable" ? selectedUsers.filter((user) => user.status === "DISABLED") : selectedUsers;
    if (!targets.length) { setBatchAction(null); return; }
    setBatchBusy(true);
    setBatchMessage("");
    const results = await Promise.allSettled(targets.map((user) => batchAction === "revoke" ? adminApi.revokeSessions(user.id, ADMIN_CONFIRM_REASON) : adminApi.setUserStatus(user.id, batchAction === "disable" ? "DISABLED" : "ACTIVE", ADMIN_CONFIRM_REASON)));
    const failed = results.filter((result) => result.status === "rejected").length;
    setBatchBusy(false);
    setBatchAction(null);
    setSelected(new Set());
    setBatchMessage(failed ? `已处理 ${targets.length - failed} 个用户，${failed} 个失败，请查看详情重试。` : `已完成 ${targets.length} 个用户操作。`);
    await onRefresh();
  }

  function openUser(userId: string) { window.location.assign(`/admin/users/${encodeURIComponent(userId)}`); }
  return <>
    <div className={styles.toolbar}><div><div className={styles.toolbarTitle}>用户目录</div><div className={styles.toolbarMeta}>点击任意一行进入详情，管理员账号不可批量修改</div></div><span className={styles.toolbarMeta}>{users.length} 条结果</span></div>
    {selectedUsers.length ? <div className={styles.batchBar}><span>已选 {selectedUsers.length} 个普通用户</span><div className={styles.actionRow}><button className={styles.secondaryButton} onClick={() => setSelected(new Set())}>清空选择</button><button className={styles.secondaryButton} onClick={() => setBatchAction("enable")} disabled={!selectedUsers.some((user) => user.status === "DISABLED")}>启用选中</button><button className={styles.dangerButton} onClick={() => setBatchAction("disable")} disabled={!selectedUsers.some((user) => user.status === "ACTIVE")}>禁用选中</button><button className={styles.secondaryButton} onClick={() => setBatchAction("revoke")}>撤销选中会话</button></div></div> : null}
    {batchAction ? <div className={styles.confirmPanel}><div><strong>确认{batchAction === "disable" ? "禁用" : batchAction === "enable" ? "启用" : "撤销会话"}选中的 {selectedUsers.length} 个用户</strong><p className={styles.controlHint}>{batchAction === "disable" ? "禁用会立即撤销普通会话并断开实时连接。" : batchAction === "enable" ? "启用后不会恢复旧会话，用户需要重新登录。" : "撤销后账号状态不变，用户需要重新登录。"}</p></div><div className={styles.actionRow}><button className={styles.secondaryButton} onClick={() => setBatchAction(null)} disabled={batchBusy}>取消</button><button className={batchAction === "disable" ? styles.dangerButton : styles.secondaryButton} onClick={() => void runBatch()} disabled={batchBusy}>{batchBusy ? "处理中..." : "确认操作"}</button></div></div> : null}
    {batchMessage ? <div className={styles.batchMessage} role="status">{batchMessage}</div> : null}
    <div className={`${styles.panel} ${styles.fullPanel}`}><div className={styles.tableWrap}><table className={`${styles.table} ${styles.directoryTable}`}><thead><tr><th className={styles.selectionCell}><input className={styles.selectBox} type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选普通用户" /></th><th>用户</th><th>状态</th><th>角色</th><th>在线房间</th><th>有效会话</th><th>最近登录</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr className={styles.clickableRow} key={user.id} onClick={() => openUser(user.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openUser(user.id); } }} role="link" tabIndex={0}><td className={styles.selectionCell} onClick={(event) => event.stopPropagation()}><input className={styles.selectBox} type="checkbox" disabled={user.role === "ADMIN"} checked={selected.has(user.id)} onChange={() => toggleUser(user.id)} aria-label={`选择用户 ${user.nickname}`} /></td><td><UserCell user={user} /></td><td><HealthText value={user.status.toLowerCase()} /></td><td className={styles.mono}>{user.role === "ADMIN" ? "管理员" : "普通用户"}</td><td className={styles.mono}>{user.onlineRoomCount}</td><td className={styles.mono}>{user.activeSessionCount}</td><td className={styles.mono}>{user.lastLoginAt ? formatTime(user.lastLoginAt) : "未登录"}</td><td><button className={styles.tableAction} onClick={(event) => { event.stopPropagation(); openUser(user.id); }}>详情</button></td></tr>)}{users.length ? null : <tr><td colSpan={8}><div className={styles.empty}>没有符合筛选条件的用户。</div></td></tr>}</tbody></table></div></div>
  </>;
}
function Incidents({ rows }: { rows: AdminIncident[] }) { return <><div className={styles.toolbar}><div><div className={styles.toolbarTitle}>异常队列</div><div className={styles.toolbarMeta}>未处理与已恢复的异常</div></div><span className={styles.toolbarMeta}>{rows.length} 条结果</span></div><div className={`${styles.panel} ${styles.fullPanel}`}><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>级别</th><th>类型</th><th>范围</th><th>状态</th><th>最近发现</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id}><td><HealthText value={row.severity.toLowerCase()} /></td><td className={styles.mono}>{row.type}</td><td className={styles.mono}>{translateScope(row.scopeType)}：{row.scopeId ?? "全局"}</td><td><HealthText value={row.status.toLowerCase()} /></td><td className={styles.mono}>{formatTime(row.lastSeenAt)}</td></tr>) : <tr><td colSpan={5}><div className={styles.empty}>暂无异常记录。</div></td></tr>}</tbody></table></div></div></>; }
function Audit({ rows }: { rows: AuditRow[] }) { return <><div className={styles.toolbar}><div><div className={styles.toolbarTitle}>管理审计</div><div className={styles.toolbarMeta}>操作历史与执行结果</div></div><span className={styles.toolbarMeta}>{rows.length} 条结果</span></div><div className={`${styles.panel} ${styles.fullPanel}`}><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>时间</th><th>动作</th><th>目标</th><th>结果</th><th>原因</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id}><td className={styles.mono}>{formatTime(row.createdAt)}</td><td className={styles.mono}>{translateAction(row.action)}</td><td className={styles.mono}>{translateScope(row.targetType)}：{row.targetId ?? "-"}</td><td><HealthText value={row.result.toLowerCase()} /></td><td className={styles.mono}>{row.reason ?? "-"}</td></tr>) : <tr><td colSpan={5}><div className={styles.empty}>暂无审计记录。</div></td></tr>}</tbody></table></div></div></>; }
function System({ overview }: { overview: AdminOverview | null }) { return <><div className={styles.toolbar}><div><div className={styles.toolbarTitle}>系统依赖</div><div className={styles.toolbarMeta}>运行状态与实例心跳</div></div></div><div className={`${styles.sectionGrid} ${styles.fullPanel}`}><SystemHealth overview={overview} /><div className={styles.panel}><PanelHeader title="运行快照" hint="当前管理控制台" /><div className={styles.healthList}><HealthRow label="Redis 模式" value={overview?.dependencies.redisMode ? translateRedisMode(overview.dependencies.redisMode) : "未知"} width="78%" color="var(--admin-blue)" /><HealthRow label="房间健康度" value={`${overview?.rooms.healthy ?? 0} 个健康房间`} width={`${overview?.rooms.total ? Math.round((overview.rooms.healthy / overview.rooms.total) * 100) : 10}%`} color="var(--admin-green)" /><HealthRow label="诊断状态" value={`${overview?.rooms.unknown ?? 0} 个未知`} width={`${overview?.rooms.total ? Math.round(((overview.rooms.total - overview.rooms.unknown) / overview.rooms.total) * 100) : 10}%`} color="var(--admin-amber)" /></div></div></div></>; }
function HealthText({ value }: { value: string }) { const normalized = value.toLowerCase(); const className = normalized.includes("critical") || normalized.includes("disabled") || normalized.includes("failed") ? styles.statusTextRed : normalized.includes("degraded") || normalized.includes("open") || normalized.includes("reconnecting") ? styles.statusTextAmber : normalized.includes("unknown") || normalized.includes("offline") || normalized.includes("recovered") ? styles.statusTextMuted : styles.statusText; return <span className={className}><span aria-hidden="true">●</span>{translateStatus(value)}</span>; }
function translateStatus(value: string) { const labels: Record<string, string> = { active: "正常", healthy: "健康", degraded: "降级", critical: "严重", disabled: "已禁用", failed: "失败", open: "未处理", recovered: "已恢复", unknown: "未知", offline: "离线", online: "在线", reconnecting: "重连中", succeeded: "成功", pending: "处理中" }; return labels[value.toLowerCase()] ?? value; }
function translatePlayback(value: string) { const labels: Record<string, string> = { playing: "播放中", paused: "已暂停", stopped: "已停止", idle: "空闲", conflict: "冲突" }; return labels[value.toLowerCase()] ?? value; }
function translateScope(value: string) { const labels: Record<string, string> = { room: "房间", user: "用户", system: "系统", global: "全局" }; return labels[value.toLowerCase()] ?? value; }
function translateAction(value: string) { const labels: Record<string, string> = { terminate_room: "结束房间", disable_user: "禁用用户", enable_user: "启用用户", revoke_sessions: "撤销会话", login: "登录", logout: "退出登录" }; return labels[value.toLowerCase()] ?? value; }
function translateResult(value: string) { return translateStatus(value); }
function translateRedisMode(value: string) { const labels: Record<string, string> = { pubsub: "发布订阅", polling: "轮询", degraded: "降级", unknown: "未知" }; return labels[value.toLowerCase()] ?? value; }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
