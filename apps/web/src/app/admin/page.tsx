"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AdminIncident, AdminOverview, AdminRoomSummary, AdminSession, AdminUserSummary } from "@music-room/shared";
import { adminApi, AdminApiError, ADMIN_CONFIRM_REASON } from "@/lib/network/admin-api";

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

function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    radio: (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.7 4.7a10.3 10.3 0 0 0 0 14.6M19.3 4.7a10.3 10.3 0 0 1 0 14.6" />
      </>
    ),
    users: (
      <>
        <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" />
        <circle cx="9.5" cy="7" r="3.5" />
        <path d="M17 11a3.5 3.5 0 1 0-1-6.8M21 20v-1.5a4 4 0 0 0-3-3.87" />
      </>
    ),
    alert: (
      <>
        <path d="m12 3 9 17H3L12 3Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" />
      </>
    ),
    server: (
      <>
        <rect x="3" y="3" width="18" height="7" rx="1" />
        <rect x="3" y="14" width="18" height="7" rx="1" />
        <path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8.1 8.1 0 0 0-14.8-3L3 11" />
        <path d="M3 5v6h6M4 13a8.1 8.1 0 0 0 14.8 3L21 13" />
        <path d="M21 19v-6h-6" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5M15 12H3" />
        <path d="M21 19V5a2 2 0 0 0-2-2h-6" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    )
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  );
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
    if (loadingRef.current) {
      queuedRef.current = true;
      return;
    }
    loadingRef.current = true;
    setRefreshing(true);
    try {
      setError("");
      const current = session ?? (await adminApi.session());
      setSession(current);
      const [overviewData, roomData, userData, incidentData, auditData] = await Promise.all([
        adminApi.overview(),
        adminApi.rooms(query),
        adminApi.users(query),
        adminApi.incidents(),
        adminApi.audit()
      ]);
      setOverview(overviewData);
      setRooms(roomData.data);
      setUsers(userData.data);
      setIncidents(incidentData.data);
      setAudit(auditData.data);
      setLastUpdatedAt(overviewData.generatedAt);
    } catch (cause) {
      if (cause instanceof AdminApiError && (cause.status === 401 || cause.status === 403)) {
        window.location.assign("/admin/login");
        return;
      }
      setError(cause instanceof Error ? cause.message : "管理数据加载失败。");
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
      if (queuedRef.current) {
        queuedRef.current = false;
        void latestLoadRef.current?.();
      }
    }
  }, [query, session]);

  latestLoadRef.current = load;
  useEffect(() => {
    void load();
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refreshIfVisible, tab === "overview" ? 5000 : 10000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load, tab]);

  async function logout() {
    await adminApi.logout().catch(() => undefined);
    window.sessionStorage.removeItem("music-room-admin-csrf");
    window.location.assign("/admin/login");
  }

  const activeTab = tabs.find((item) => item.id === tab) ?? tabs[0];
  const incidentCount = overview?.openIncidents ?? incidents.filter((item) => item.status === "OPEN").length;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* 侧边导航栏 */}
      <aside className="w-56 border-r border-surface-border bg-surface/30 backdrop-blur-sm flex flex-col shrink-0">
        <div className="h-14 border-b border-surface-border px-4 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-[var(--accent,#3b82f6)] text-white font-mono font-bold text-xs flex items-center justify-center shrink-0">
            MR
          </div>
          <div className="min-w-0 leading-tight">
            <div className="text-xs font-semibold tracking-tight truncate">音乐房间</div>
            <div className="text-[10px] text-foreground-muted truncate">管理控制台</div>
          </div>
        </div>

        <div className="px-3 pt-4 pb-1 text-[10px] font-mono uppercase tracking-wider text-foreground-muted">运维中心</div>

        <nav className="p-2 space-y-1 flex-1" aria-label="管理台导航">
          {tabs.map((item) => {
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                  isActive
                    ? "bg-surface-border/60 text-foreground font-medium"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface-border/30"
                }`}
                onClick={() => setTab(item.id)}
              >
                <Icon name={item.icon} size={15} className="shrink-0" />
                <span className="truncate">{item.label}</span>
                {item.id === "incidents" && incidentCount > 0 ? (
                  <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                    {incidentCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* 底部操作员信息 */}
        <div className="p-3 border-t border-surface-border bg-surface/50">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-xs font-medium text-foreground truncate">{session?.nickname ?? "管理员"}</div>
              <div className="text-[10px] text-foreground-muted truncate">管理员权限</div>
            </div>
          </div>
        </div>
      </aside>

      {/* 主界面区域 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* 顶部工具条 */}
        <header className="h-12 border-b border-surface-border px-6 flex items-center justify-between bg-surface/50 backdrop-blur-sm sticky top-0 z-20 shrink-0">
          <div className="text-xs text-foreground-muted flex items-center gap-1.5">
            <span>音乐房间</span>
            <span aria-hidden="true">/</span>
            <strong className="text-foreground font-medium">{activeTab.label}</strong>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-foreground-muted bg-surface-border/20 border border-surface-border/50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>实时采样</span>
            </div>
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-surface-border/40 disabled:opacity-50"
              onClick={() => void load()}
              disabled={refreshing}
            >
              <Icon name="refresh" size={13} className={refreshing ? "animate-spin" : ""} />
              <span>{refreshing ? "刷新中" : "刷新"}</span>
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground transition-colors hover:bg-surface-border/40"
              onClick={() => void logout()}
            >
              <Icon name="logout" size={13} />
              <span>退出</span>
            </button>
          </div>
        </header>

        {/* 内容容器 */}
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
          {/* 页面标题 & 搜索栏 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono text-foreground-muted uppercase tracking-wider">
                运维中心 / {activeTab.label}
              </div>
              <h1 className="text-lg font-semibold tracking-tight mt-0.5">{activeTab.label}</h1>
              <p className="text-xs text-foreground-muted mt-0.5">
                {refreshing
                  ? "正在同步最新状态..."
                  : lastUpdatedAt
                  ? `最近采样 ${new Date(lastUpdatedAt).toLocaleTimeString()}`
                  : "等待首次采样"}
              </p>
            </div>

            {tab === "rooms" || tab === "users" ? (
              <div className="shrink-0">
                <input
                  className="h-8 rounded-md border border-surface-border bg-surface px-2.5 text-xs text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-[var(--accent,#3b82f6)] w-56 transition-all"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={tab === "rooms" ? "搜索房间码" : "搜索用户名或昵称"}
                  aria-label="搜索"
                />
              </div>
            ) : null}
          </div>

          {/* 错误提示 */}
          {error ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3.5 text-xs text-red-400 flex items-center justify-between">
              <span>{error}</span>
              <button
                className="underline hover:no-underline font-medium ml-4 text-foreground"
                onClick={() => void load()}
              >
                重新尝试
              </button>
            </div>
          ) : null}

          {/* 各 Tab 内容 */}
          {tab === "overview" ? (
            <Overview
              overview={overview}
              rooms={rooms}
              incidents={incidents}
              audit={audit}
              onRooms={() => setTab("rooms")}
            />
          ) : tab === "rooms" ? (
            <Rooms rooms={rooms} onRefresh={load} />
          ) : tab === "users" ? (
            <Users users={users} onRefresh={load} />
          ) : tab === "incidents" ? (
            <Incidents rows={incidents} onRefresh={load} />
          ) : tab === "audit" ? (
            <Audit rows={audit} />
          ) : (
            <System overview={overview} />
          )}
        </main>
      </div>
    </div>
  );
}

function Overview({
  overview,
  rooms,
  incidents,
  audit,
  onRooms
}: {
  overview: AdminOverview | null;
  rooms: AdminRoomSummary[];
  incidents: AdminIncident[];
  audit: AuditRow[];
  onRooms: () => void;
}) {
  const activeRooms = rooms.filter((room) => room.onlineMemberCount > 0).slice(0, 6);

  return (
    <div className="space-y-6">
      {/* 4 项核心指标 */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="关键指标">
        <Metric
          label="在线用户"
          value={overview?.users.online ?? 0}
          meta={`注册用户 ${overview?.users.total ?? 0} 人`}
          color="#3b82f6"
          width={`${Math.min(100, Math.max(10, ((overview?.users.online ?? 0) / Math.max(1, overview?.users.total ?? 1)) * 100))}%`}
        />
        <Metric
          label="活跃房间"
          value={overview?.rooms.active ?? 0}
          meta={`房间总数 ${overview?.rooms.total ?? 0}`}
          color="#10b981"
          width={`${Math.min(100, Math.max(10, ((overview?.rooms.active ?? 0) / Math.max(1, overview?.rooms.total ?? 1)) * 100))}%`}
        />
        <Metric
          label="正在播放"
          value={overview?.playback.active ?? 0}
          meta={`已暂停 ${overview?.playback.paused ?? 0}`}
          color="#f59e0b"
          width={`${Math.min(100, Math.max(10, ((overview?.playback.active ?? 0) / Math.max(1, overview?.rooms.total ?? 1)) * 100))}%`}
        />
        <Metric
          label="未处理异常"
          value={overview?.openIncidents ?? 0}
          meta={overview?.rooms.critical ? `严重房间 ${overview.rooms.critical} 个` : "暂无严重房间"}
          color="#ef4444"
          width={`${overview?.openIncidents ? 72 : 14}%`}
        />
      </section>

      {/* 活跃房间 & 系统健康 */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-lg border border-surface-border bg-surface flex flex-col">
          <PanelHeader
            title="活跃房间"
            hint={`显示 ${activeRooms.length} 个`}
            action={
              <button
                className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground transition-colors"
                onClick={onRooms}
              >
                <span>查看全部</span>
                <Icon name="arrow" size={12} />
              </button>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-surface-border bg-surface-border/20 text-foreground-muted">
                  <th className="py-2.5 px-3 font-medium">房间</th>
                  <th className="py-2.5 px-3 font-medium">健康度</th>
                  <th className="py-2.5 px-3 font-medium">成员</th>
                  <th className="py-2.5 px-3 font-medium">播放</th>
                  <th className="py-2.5 px-3 font-medium">更新时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/60">
                {activeRooms.length ? (
                  activeRooms.map((room) => <RoomRow key={room.id} room={room} />)
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-foreground-muted">
                      最近采样中暂无活跃房间。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-surface-border bg-surface">
          <SystemHealth overview={overview} />
        </div>
      </section>

      {/* 异常队列 & 管理审计 */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <IncidentPanel rows={incidents.slice(0, 4)} />
        <AuditPanel rows={audit.slice(0, 4)} />
      </section>
    </div>
  );
}

function Metric({ label, value, meta, color, width }: { label: string; value: number; meta: string; color: string; width: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3.5 flex flex-col gap-1.5">
      <div className="text-[11px] font-mono uppercase text-foreground-muted">{label}</div>
      <div className="flex items-baseline justify-between">
        <strong className="text-lg font-semibold tracking-tight">{value}</strong>
        <span className="text-[11px] text-foreground-muted">{meta}</span>
      </div>
      <div className="h-1 w-full bg-surface-border/40 rounded-full overflow-hidden mt-1">
        <div className="h-full rounded-full transition-all duration-300" style={{ width, backgroundColor: color }} />
      </div>
    </div>
  );
}

function PanelHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="p-3.5 border-b border-surface-border flex items-center justify-between">
      <div className="flex items-baseline gap-2">
        <div className="text-xs font-semibold text-foreground tracking-tight">{title}</div>
        {hint ? <div className="text-[11px] text-foreground-muted">{hint}</div> : null}
      </div>
      {action}
    </div>
  );
}

function RoomCell({ room }: { room: AdminRoomSummary }) {
  const signalColor =
    room.health === "critical"
      ? "bg-red-500"
      : room.health === "degraded"
      ? "bg-amber-500"
      : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${signalColor}`} />
      <a
        className="font-mono font-medium hover:underline text-foreground"
        href={`/admin/rooms/${encodeURIComponent(room.id)}`}
      >
        {room.joinCode}
      </a>
    </div>
  );
}

function RoomRow({ room }: { room: AdminRoomSummary }) {
  return (
    <tr className="hover:bg-surface-border/10 transition-colors">
      <td className="py-2 px-3">
        <RoomCell room={room} />
      </td>
      <td className="py-2 px-3">
        <HealthText value={room.health} />
      </td>
      <td className="py-2 px-3 font-mono text-foreground-muted">
        {room.onlineMemberCount}/{room.memberCount}
      </td>
      <td className="py-2 px-3 font-mono text-foreground-muted">
        {translatePlayback(room.playbackStatus)}
      </td>
      <td className="py-2 px-3 font-mono text-foreground-muted">
        {formatTime(room.updatedAt)}
      </td>
    </tr>
  );
}

function SystemHealth({ overview }: { overview: AdminOverview | null }) {
  return (
    <div>
      <PanelHeader title="系统健康" hint="依赖状态" />
      <div className="p-3.5 space-y-3">
        <HealthRow
          label="PostgreSQL 数据库"
          value={overview?.dependencies.prisma === "up" ? "正常" : "降级"}
          width={overview?.dependencies.prisma === "up" ? "98%" : "38%"}
          color={overview?.dependencies.prisma === "up" ? "#10b981" : "#ef4444"}
        />
        <HealthRow
          label="Redis / 在线状态"
          value={overview?.dependencies.redis === "up" ? "正常" : "降级"}
          width={overview?.dependencies.redis === "up" ? "94%" : "30%"}
          color={overview?.dependencies.redis === "up" ? "#10b981" : "#ef4444"}
        />
        <HealthRow
          label="应用实例"
          value={`${overview?.instances ?? 0} 个实例上报`}
          width={overview?.instances ? "88%" : "25%"}
          color="#3b82f6"
        />
      </div>
      <p className="px-3.5 pb-3 text-[11px] text-foreground-muted border-t border-surface-border/40 pt-2.5">
        数据来自控制台心跳与最近一次 Redis 在线状态采样。
      </p>
    </div>
  );
}

function HealthRow({ label, value, width, color }: { label: string; value: string; width: string; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground-muted">{label}</span>
        <span className="font-medium text-foreground">{value}</span>
      </div>
      <div className="h-1 w-full bg-surface-border/40 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width, backgroundColor: color }} />
      </div>
    </div>
  );
}

function IncidentPanel({ rows }: { rows: AdminIncident[] }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface flex flex-col">
      <PanelHeader title="异常队列" hint={rows.length ? `最近 ${rows.length} 条` : "暂无异常"} />
      <div className="divide-y divide-surface-border/60">
        {rows.length ? (
          rows.map((row) => (
            <div key={row.id} className="p-3 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    row.severity === "CRITICAL" ? "bg-red-500" : "bg-amber-500"
                  }`}
                />
                <div className="truncate">
                  <div className="font-medium text-foreground truncate">{row.type}</div>
                  <div className="text-[11px] text-foreground-muted truncate">
                    {translateScope(row.scopeType)}：{row.scopeId ?? "全局"}
                  </div>
                </div>
              </div>
              <span className="font-mono text-[11px] text-foreground-muted shrink-0">
                {formatTime(row.lastSeenAt)}
              </span>
            </div>
          ))
        ) : (
          <div className="p-6 text-center text-xs text-foreground-muted">暂无未处理异常。</div>
        )}
      </div>
    </div>
  );
}

function AuditPanel({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface flex flex-col">
      <PanelHeader title="最近管理活动" hint="审计记录" />
      <div className="divide-y divide-surface-border/60">
        {rows.length ? (
          rows.map((row) => (
            <div key={row.id} className="p-3 flex items-center justify-between gap-3 text-xs">
              <div className="truncate">
                <div className="font-medium text-foreground">{translateAction(row.action)}</div>
                <div className="text-[11px] text-foreground-muted truncate">
                  {translateScope(row.targetType)}：{row.targetId ?? "-"} · {translateResult(row.result)}
                </div>
              </div>
              <span className="font-mono text-[11px] text-foreground-muted shrink-0">
                {formatTime(row.createdAt)}
              </span>
            </div>
          ))
        ) : (
          <div className="p-6 text-center text-xs text-foreground-muted">暂无管理活动。</div>
        )}
      </div>
    </div>
  );
}

function Rooms({ rooms, onRefresh }: { rooms: AdminRoomSummary[]; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<"terminate" | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const allSelected = rooms.length > 0 && rooms.every((room) => selected.has(room.id));

  function toggleRoom(roomId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
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
    const results = await Promise.allSettled(
      targets.map((room) => adminApi.terminateRoom(room.id, room.joinCode, ADMIN_CONFIRM_REASON))
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    setBatchBusy(false);
    setBatchAction(null);
    setSelected(new Set());
    setBatchMessage(
      failed
        ? `已处理 ${targets.length - failed} 个房间，${failed} 个失败，请查看详情重试。`
        : `已结束 ${targets.length} 个房间。`
    );
    await onRefresh();
  }

  function openRoom(roomId: string) {
    window.location.assign(`/admin/rooms/${encodeURIComponent(roomId)}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold text-foreground">房间目录</h2>
          <p className="text-[11px] text-foreground-muted">点击任意一行进入详情，查看状态并执行控制</p>
        </div>
        <span className="text-[11px] font-mono text-foreground-muted">{rooms.length} 条结果</span>
      </div>

      {selected.size ? (
        <div className="rounded-lg border border-surface-border bg-surface p-3 flex items-center justify-between text-xs">
          <span className="text-foreground font-medium">已选 {selected.size} 个房间</span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-surface-border bg-surface px-2.5 py-1 text-xs hover:bg-surface-border/40 transition-colors"
              onClick={() => setSelected(new Set())}
            >
              清空选择
            </button>
            <button
              className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
              onClick={() => setBatchAction("terminate")}
            >
              结束选中房间
            </button>
          </div>
        </div>
      ) : null}

      {batchAction ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 flex items-center justify-between gap-4 text-xs">
          <div>
            <strong className="text-red-400">确认结束选中的 {selected.size} 个房间</strong>
            <p className="text-[11px] text-red-400/80 mt-0.5">操作会永久清理房间状态、队列和在线成员的房间资产。</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="rounded-md border border-surface-border bg-surface px-2.5 py-1 text-xs hover:bg-surface-border/40 transition-colors"
              onClick={() => setBatchAction(null)}
              disabled={batchBusy}
            >
              取消
            </button>
            <button
              className="rounded-md bg-red-500 text-white px-2.5 py-1 text-xs hover:bg-red-600 transition-colors disabled:opacity-50"
              onClick={() => void runBatch()}
              disabled={batchBusy}
            >
              {batchBusy ? "处理中..." : "确认结束"}
            </button>
          </div>
        </div>
      ) : null}

      {batchMessage ? (
        <div className="rounded-lg border border-surface-border bg-surface-border/20 p-2.5 text-xs text-foreground" role="status">
          {batchMessage}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-surface-border bg-surface-border/20 text-foreground-muted">
              <th className="py-2.5 px-3 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="全选房间"
                  className="rounded border-surface-border bg-surface text-[var(--accent,#3b82f6)] focus:ring-0 focus:ring-offset-0"
                />
              </th>
              <th className="py-2.5 px-3 font-medium">房间</th>
              <th className="py-2.5 px-3 font-medium">健康度</th>
              <th className="py-2.5 px-3 font-medium">成员</th>
              <th className="py-2.5 px-3 font-medium">播放</th>
              <th className="py-2.5 px-3 font-medium">可见性</th>
              <th className="py-2.5 px-3 font-medium">更新时间</th>
              <th className="py-2.5 px-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border/60">
            {rooms.map((room) => {
              const signalColor =
                room.health === "critical"
                  ? "bg-red-500"
                  : room.health === "degraded"
                  ? "bg-amber-500"
                  : "bg-emerald-500";
              return (
                <tr
                  key={room.id}
                  onClick={() => openRoom(room.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openRoom(room.id);
                    }
                  }}
                  role="link"
                  tabIndex={0}
                  className="cursor-pointer hover:bg-surface-border/15 transition-colors"
                >
                  <td
                    className="py-2 px-3 w-8"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(room.id)}
                      onChange={() => toggleRoom(room.id)}
                      aria-label={`选择房间 ${room.joinCode}`}
                      className="rounded border-surface-border bg-surface text-[var(--accent,#3b82f6)] focus:ring-0 focus:ring-offset-0"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${signalColor}`} />
                      <div>
                        <div className="font-mono font-medium text-foreground">{room.joinCode}</div>
                        <div className="text-[11px] text-foreground-muted">
                          {room.name || "未命名房间"} · 房主 {room.hostNickname || room.hostId}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <HealthText value={room.health} />
                  </td>
                  <td className="py-2 px-3 font-mono text-foreground-muted">
                    {room.onlineMemberCount}/{room.memberCount}
                  </td>
                  <td className="py-2 px-3">
                    <div className="text-foreground">{translatePlayback(room.playbackStatus)}</div>
                    <div className="text-[11px] text-foreground-muted truncate max-w-[140px]">
                      {room.currentTrackTitle || "未播放"}
                    </div>
                  </td>
                  <td className="py-2 px-3 font-mono text-foreground-muted">
                    {room.visibility === "private" ? "私密" : "公开"}
                  </td>
                  <td className="py-2 px-3 font-mono text-foreground-muted">
                    {formatTime(room.updatedAt)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      className="rounded border border-surface-border bg-surface px-2 py-0.5 text-xs text-foreground hover:bg-surface-border/40 transition-colors"
                      onClick={(event) => {
                        event.stopPropagation();
                        openRoom(room.id);
                      }}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rooms.length ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-xs text-foreground-muted">
                  没有符合筛选条件的房间。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserCell({ user }: { user: AdminUserSummary }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 h-6 rounded-full bg-surface-border/50 text-foreground text-[10px] font-medium flex items-center justify-center shrink-0">
        {user.nickname.slice(0, 1).toUpperCase()}
      </span>
      <div>
        <div className="font-medium text-foreground">{user.nickname}</div>
        <div className="text-[11px] font-mono text-foreground-muted">{user.username}</div>
      </div>
    </div>
  );
}

function Users({ users, onRefresh }: { users: AdminUserSummary[]; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<"disable" | "enable" | "revoke" | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const manageable = users.filter((user) => user.role !== "ADMIN");
  const selectedUsers = manageable.filter((user) => selected.has(user.id));
  const allSelected = manageable.length > 0 && manageable.every((user) => selected.has(user.id));

  function toggleUser(userId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
    setBatchMessage("");
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(manageable.map((user) => user.id)));
    setBatchMessage("");
  }

  async function runBatch() {
    if (!selectedUsers.length || !batchAction || batchBusy) return;
    const targets =
      batchAction === "disable"
        ? selectedUsers.filter((user) => user.status === "ACTIVE")
        : batchAction === "enable"
        ? selectedUsers.filter((user) => user.status === "DISABLED")
        : selectedUsers;
    if (!targets.length) {
      setBatchAction(null);
      return;
    }
    setBatchBusy(true);
    setBatchMessage("");
    const results = await Promise.allSettled(
      targets.map((user) =>
        batchAction === "revoke"
          ? adminApi.revokeSessions(user.id, ADMIN_CONFIRM_REASON)
          : adminApi.setUserStatus(
              user.id,
              batchAction === "disable" ? "DISABLED" : "ACTIVE",
              ADMIN_CONFIRM_REASON
            )
      )
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    setBatchBusy(false);
    setBatchAction(null);
    setSelected(new Set());
    setBatchMessage(
      failed
        ? `已处理 ${targets.length - failed} 个用户，${failed} 个失败，请查看详情重试。`
        : `已完成 ${targets.length} 个用户操作。`
    );
    await onRefresh();
  }

  function openUser(userId: string) {
    window.location.assign(`/admin/users/${encodeURIComponent(userId)}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold text-foreground">用户目录</h2>
          <p className="text-[11px] text-foreground-muted">点击任意一行进入详情，管理员账号不可批量修改</p>
        </div>
        <span className="text-[11px] font-mono text-foreground-muted">{users.length} 条结果</span>
      </div>

      {selectedUsers.length ? (
        <div className="rounded-lg border border-surface-border bg-surface p-3 flex items-center justify-between text-xs">
          <span className="text-foreground font-medium">已选 {selectedUsers.length} 个普通用户</span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-surface-border bg-surface px-2.5 py-1 text-xs hover:bg-surface-border/40 transition-colors"
              onClick={() => setSelected(new Set())}
            >
              清空选择
            </button>
            <button
              className="rounded-md border border-surface-border bg-surface px-2.5 py-1 text-xs hover:bg-surface-border/40 transition-colors disabled:opacity-50"
              onClick={() => setBatchAction("enable")}
              disabled={!selectedUsers.some((user) => user.status === "DISABLED")}
            >
              启用选中
            </button>
            <button
              className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              onClick={() => setBatchAction("disable")}
              disabled={!selectedUsers.some((user) => user.status === "ACTIVE")}
            >
              禁用选中
            </button>
            <button
              className="rounded-md border border-surface-border bg-surface px-2.5 py-1 text-xs hover:bg-surface-border/40 transition-colors"
              onClick={() => setBatchAction("revoke")}
            >
              撤销选中会话
            </button>
          </div>
        </div>
      ) : null}

      {batchAction ? (
        <div className="rounded-lg border border-surface-border bg-surface p-3.5 flex items-center justify-between gap-4 text-xs">
          <div>
            <strong className="text-foreground">
              确认{batchAction === "disable" ? "禁用" : batchAction === "enable" ? "启用" : "撤销会话"}选中的{" "}
              {selectedUsers.length} 个用户
            </strong>
            <p className="text-[11px] text-foreground-muted mt-0.5">
              {batchAction === "disable"
                ? "禁用会立即撤销普通会话并断开实时连接。"
                : batchAction === "enable"
                ? "启用后不会恢复旧会话，用户需要重新登录。"
                : "撤销后账号状态不变，用户需要重新登录。"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="rounded-md border border-surface-border bg-surface px-2.5 py-1 text-xs hover:bg-surface-border/40 transition-colors"
              onClick={() => setBatchAction(null)}
              disabled={batchBusy}
            >
              取消
            </button>
            <button
              className={`rounded-md px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                batchAction === "disable"
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-[var(--accent,#3b82f6)] text-white hover:opacity-90"
              }`}
              onClick={() => void runBatch()}
              disabled={batchBusy}
            >
              {batchBusy ? "处理中..." : "确认操作"}
            </button>
          </div>
        </div>
      ) : null}

      {batchMessage ? (
        <div className="rounded-lg border border-surface-border bg-surface-border/20 p-2.5 text-xs text-foreground" role="status">
          {batchMessage}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-surface-border bg-surface-border/20 text-foreground-muted">
              <th className="py-2.5 px-3 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="全选普通用户"
                  className="rounded border-surface-border bg-surface text-[var(--accent,#3b82f6)] focus:ring-0 focus:ring-offset-0"
                />
              </th>
              <th className="py-2.5 px-3 font-medium">用户</th>
              <th className="py-2.5 px-3 font-medium">状态</th>
              <th className="py-2.5 px-3 font-medium">角色</th>
              <th className="py-2.5 px-3 font-medium">在线房间</th>
              <th className="py-2.5 px-3 font-medium">有效会话</th>
              <th className="py-2.5 px-3 font-medium">最近登录</th>
              <th className="py-2.5 px-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border/60">
            {users.map((user) => (
              <tr
                key={user.id}
                onClick={() => openUser(user.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openUser(user.id);
                  }
                }}
                role="link"
                tabIndex={0}
                className="cursor-pointer hover:bg-surface-border/15 transition-colors"
              >
                <td
                  className="py-2 px-3 w-8"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    disabled={user.role === "ADMIN"}
                    checked={selected.has(user.id)}
                    onChange={() => toggleUser(user.id)}
                    aria-label={`选择用户 ${user.nickname}`}
                    className="rounded border-surface-border bg-surface text-[var(--accent,#3b82f6)] focus:ring-0 focus:ring-offset-0 disabled:opacity-30"
                  />
                </td>
                <td className="py-2 px-3">
                  <UserCell user={user} />
                </td>
                <td className="py-2 px-3">
                  <HealthText value={user.status.toLowerCase()} />
                </td>
                <td className="py-2 px-3 font-mono text-foreground-muted">
                  {user.role === "ADMIN" ? "管理员" : "普通用户"}
                </td>
                <td className="py-2 px-3 font-mono text-foreground-muted">{user.onlineRoomCount}</td>
                <td className="py-2 px-3 font-mono text-foreground-muted">{user.activeSessionCount}</td>
                <td className="py-2 px-3 font-mono text-foreground-muted">
                  {user.lastLoginAt ? formatTime(user.lastLoginAt) : "未登录"}
                </td>
                <td className="py-2 px-3 text-right">
                  <button
                    className="rounded border border-surface-border bg-surface px-2 py-0.5 text-xs text-foreground hover:bg-surface-border/40 transition-colors"
                    onClick={(event) => {
                      event.stopPropagation();
                      openUser(user.id);
                    }}
                  >
                    详情
                  </button>
                </td>
              </tr>
            ))}
            {!users.length ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-xs text-foreground-muted">
                  没有符合筛选条件的用户。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Incidents({ rows, onRefresh }: { rows: AdminIncident[]; onRefresh: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const openCount = rows.filter((r) => r.status === "OPEN").length;

  async function resolveOne(id: string) {
    if (busyId || allBusy) return;
    setBusyId(id);
    setActionMessage("");
    try {
      await adminApi.resolveIncident(id, ADMIN_CONFIRM_REASON);
      setActionMessage("异常事件已标记为已解决。");
      await onRefresh();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "标记解决失败。");
    } finally {
      setBusyId(null);
    }
  }

  async function resolveAll() {
    if (busyId || allBusy || openCount === 0) return;
    setAllBusy(true);
    setActionMessage("");
    try {
      const res = await adminApi.resolveAllIncidents(ADMIN_CONFIRM_REASON);
      setActionMessage(`已将 ${res.count} 个未处理异常全部标记为已解决。`);
      await onRefresh();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "批量解决失败。");
    } finally {
      setAllBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold text-foreground">异常队列</h2>
          <p className="text-[11px] text-foreground-muted">系统监测与故障闭环处置</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-foreground-muted">{rows.length} 条结果（未处理 {openCount}）</span>
          {openCount > 0 ? (
            <button
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              onClick={() => void resolveAll()}
              disabled={allBusy}
            >
              {allBusy ? "处理中..." : "全部标为已解决"}
            </button>
          ) : null}
        </div>
      </div>

      {actionMessage ? (
        <div className="rounded-lg border border-surface-border bg-surface-border/20 p-2.5 text-xs text-foreground" role="status">
          {actionMessage}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-surface-border bg-surface-border/20 text-foreground-muted">
              <th className="py-2.5 px-3 font-medium">级别</th>
              <th className="py-2.5 px-3 font-medium">类型</th>
              <th className="py-2.5 px-3 font-medium">范围</th>
              <th className="py-2.5 px-3 font-medium">状态</th>
              <th className="py-2.5 px-3 font-medium">最近发现</th>
              <th className="py-2.5 px-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border/60">
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-border/10 transition-colors">
                  <td className="py-2 px-3">
                    <HealthText value={row.severity.toLowerCase()} />
                  </td>
                  <td className="py-2 px-3 font-mono text-foreground">{row.type}</td>
                  <td className="py-2 px-3 font-mono text-foreground-muted">
                    {translateScope(row.scopeType)}：{row.scopeId ?? "全局"}
                  </td>
                  <td className="py-2 px-3">
                    <HealthText value={row.status.toLowerCase()} />
                  </td>
                  <td className="py-2 px-3 font-mono text-foreground-muted">
                    {formatTime(row.lastSeenAt)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {row.status === "OPEN" ? (
                      <button
                        className="rounded border border-surface-border bg-surface px-2 py-0.5 text-xs text-foreground hover:bg-surface-border/40 transition-colors disabled:opacity-50"
                        onClick={() => void resolveOne(row.id)}
                        disabled={busyId === row.id}
                      >
                        {busyId === row.id ? "处理中..." : "标为已解决"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-foreground-muted">已闭环</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-foreground-muted">
                  暂无异常记录。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Audit({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold text-foreground">管理审计</h2>
          <p className="text-[11px] text-foreground-muted">操作历史与执行结果记录</p>
        </div>
        <span className="text-[11px] font-mono text-foreground-muted">{rows.length} 条结果</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-surface-border bg-surface-border/20 text-foreground-muted">
              <th className="py-2.5 px-3 font-medium">时间</th>
              <th className="py-2.5 px-3 font-medium">动作</th>
              <th className="py-2.5 px-3 font-medium">目标</th>
              <th className="py-2.5 px-3 font-medium">结果</th>
              <th className="py-2.5 px-3 font-medium">原因</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border/60">
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-border/10 transition-colors">
                  <td className="py-2 px-3 font-mono text-foreground-muted">{formatTime(row.createdAt)}</td>
                  <td className="py-2 px-3 font-medium text-foreground">{translateAction(row.action)}</td>
                  <td className="py-2 px-3 font-mono text-foreground-muted">
                    {translateScope(row.targetType)}：{row.targetId ?? "-"}
                  </td>
                  <td className="py-2 px-3">
                    <HealthText value={row.result.toLowerCase()} />
                  </td>
                  <td className="py-2 px-3 text-foreground-muted">{row.reason ?? "-"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-foreground-muted">
                  暂无审计记录。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function System({ overview }: { overview: AdminOverview | null }) {
  const [providers, setProviders] = useState<import("@music-room/shared").AdminProviderHealth[]>([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const checkProviders = useCallback(async () => {
    setChecking(true);
    setError("");
    try {
      const res = await adminApi.providerHealth();
      setProviders(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "检测音源健康度失败。");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkProviders();
  }, [checkProviders]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold text-foreground">系统依赖与服务诊断</h2>
          <p className="text-[11px] text-foreground-muted">基础设施状态与外部音源连通性</p>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface px-2.5 py-1 text-xs hover:bg-surface-border/40 transition-colors disabled:opacity-50"
          onClick={() => void checkProviders()}
          disabled={checking}
        >
          <Icon name="refresh" size={12} className={checking ? "animate-spin" : ""} />
          <span>{checking ? "探测中..." : "探测音源连通性"}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-surface-border bg-surface">
          <SystemHealth overview={overview} />
        </div>

        <div className="rounded-lg border border-surface-border bg-surface">
          <PanelHeader title="运行快照" hint="当前管理控制台" />
          <div className="p-3.5 space-y-3">
            <HealthRow
              label="Redis 模式"
              value={overview?.dependencies.redisMode ? translateRedisMode(overview.dependencies.redisMode) : "未知"}
              width="78%"
              color="#3b82f6"
            />
            <HealthRow
              label="房间健康度"
              value={`${overview?.rooms.healthy ?? 0} 个健康房间`}
              width={`${overview?.rooms.total ? Math.round((overview.rooms.healthy / overview.rooms.total) * 100) : 10}%`}
              color="#10b981"
            />
            <HealthRow
              label="诊断状态"
              value={`${overview?.rooms.unknown ?? 0} 个未知`}
              width={`${overview?.rooms.total ? Math.round(((overview.rooms.total - overview.rooms.unknown) / overview.rooms.total) * 100) : 10}%`}
              color="#f59e0b"
            />
          </div>
        </div>
      </div>

      {/* 外部音源健康看板 */}
      <div className="rounded-lg border border-surface-border bg-surface">
        <PanelHeader
          title="外部聚合音源服务状态"
          hint="Bilibili / 网易云音乐 / QQ音乐 实时连通性探测"
        />
        {error ? (
          <div className="p-3 text-xs text-red-400 bg-red-500/10 border-b border-surface-border">{error}</div>
        ) : null}
        <div className="divide-y divide-surface-border/60">
          {providers.length ? (
            providers.map((item) => (
              <div key={item.provider} className="p-3.5 flex items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      item.status === "healthy"
                        ? "bg-emerald-500"
                        : item.status === "degraded"
                        ? "bg-amber-500"
                        : "bg-red-500"
                    }`}
                  />
                  <div>
                    <div className="font-medium text-foreground">{item.name}</div>
                    <div className="text-[11px] text-foreground-muted mt-0.5">{item.message ?? "就绪"}</div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-right shrink-0">
                  <div>
                    <div className="text-[11px] text-foreground-muted">凭据状态</div>
                    <div className="font-mono text-xs">
                      {item.hasCredentials ? (
                        <span className="text-emerald-400">已配置 Cookie</span>
                      ) : (
                        <span className="text-foreground-muted">访客模式</span>
                      )}
                    </div>
                  </div>

                  <div className="min-w-[70px]">
                    <div className="text-[11px] text-foreground-muted">响应时延</div>
                    <div className="font-mono text-xs text-foreground">
                      {item.latencyMs !== null ? `${item.latencyMs} ms` : "-"}
                    </div>
                  </div>

                  <div className="min-w-[60px]">
                    <div className="text-[11px] text-foreground-muted">状态</div>
                    <HealthText value={item.status} />
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="p-6 text-center text-xs text-foreground-muted">
              {checking ? "正在探测音源连通性..." : "暂无探测数据，点击右上角探测。"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HealthText({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  let dotColor = "bg-emerald-500";
  let textColor = "text-foreground";

  if (normalized.includes("critical") || normalized.includes("disabled") || normalized.includes("failed")) {
    dotColor = "bg-red-500";
    textColor = "text-red-400";
  } else if (
    normalized.includes("degraded") ||
    normalized.includes("open") ||
    normalized.includes("reconnecting")
  ) {
    dotColor = "bg-amber-500";
    textColor = "text-amber-400";
  } else if (
    normalized.includes("unknown") ||
    normalized.includes("offline") ||
    normalized.includes("recovered")
  ) {
    dotColor = "bg-zinc-500";
    textColor = "text-foreground-muted";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${textColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} aria-hidden="true" />
      <span>{translateStatus(value)}</span>
    </span>
  );
}

function translateStatus(value: string) {
  const labels: Record<string, string> = {
    active: "正常",
    healthy: "健康",
    degraded: "降级",
    critical: "严重",
    disabled: "已禁用",
    failed: "失败",
    open: "未处理",
    recovered: "已恢复",
    unknown: "未知",
    offline: "离线",
    online: "在线",
    reconnecting: "重连中",
    succeeded: "成功",
    pending: "处理中"
  };
  return labels[value.toLowerCase()] ?? value;
}

function translatePlayback(value: string) {
  const labels: Record<string, string> = {
    playing: "播放中",
    paused: "已暂停",
    stopped: "已停止",
    idle: "空闲",
    conflict: "冲突"
  };
  return labels[value.toLowerCase()] ?? value;
}

function translateScope(value: string) {
  const labels: Record<string, string> = {
    room: "房间",
    user: "用户",
    system: "系统",
    global: "全局"
  };
  return labels[value.toLowerCase()] ?? value;
}

function translateAction(value: string) {
  const labels: Record<string, string> = {
    terminate_room: "结束房间",
    disable_user: "禁用用户",
    enable_user: "启用用户",
    revoke_sessions: "撤销会话",
    login: "登录",
    logout: "退出登录"
  };
  return labels[value.toLowerCase()] ?? value;
}

function translateResult(value: string) {
  return translateStatus(value);
}

function translateRedisMode(value: string) {
  const labels: Record<string, string> = {
    pubsub: "发布订阅",
    polling: "轮询",
    degraded: "降级",
    unknown: "未知"
  };
  return labels[value.toLowerCase()] ?? value;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
