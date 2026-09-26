"use client";

import type { ReactNode } from "react";
import type { AdminIncident, AdminOverview, AdminRoomSummary, AdminUserSummary } from "@music-room/shared";

export type AuditRow = { id: string; action: string; targetType: string; targetId: string | null; reason: string | null; result: string; createdAt: string };

export type IconName = "grid" | "radio" | "users" | "alert" | "file" | "server" | "refresh" | "logout" | "arrow" | "bell" | "plus";

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
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
    ),
    bell: (
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
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

export function Metric({ label, value, meta, color, width }: { label: string; value: number; meta: string; color: string; width: string }) {
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

export function PanelHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
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

export function RoomCell({ room }: { room: AdminRoomSummary }) {
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

export function RoomRow({ room }: { room: AdminRoomSummary }) {
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

export function SystemHealth({ overview }: { overview: AdminOverview | null }) {
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

export function HealthRow({ label, value, width, color }: { label: string; value: string; width: string; color: string }) {
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

export function IncidentPanel({ rows }: { rows: AdminIncident[] }) {
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

export function AuditPanel({ rows }: { rows: AuditRow[] }) {
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

export function UserCell({ user }: { user: AdminUserSummary }) {
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

export function HealthText({ value }: { value: string }) {
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

export function translateStatus(value: string) {
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

export function translatePlayback(value: string) {
  const labels: Record<string, string> = {
    playing: "播放中",
    paused: "已暂停",
    stopped: "已停止",
    idle: "空闲",
    conflict: "冲突"
  };
  return labels[value.toLowerCase()] ?? value;
}

export function translateScope(value: string) {
  const labels: Record<string, string> = {
    room: "房间",
    user: "用户",
    system: "系统",
    global: "全局"
  };
  return labels[value.toLowerCase()] ?? value;
}

export function translateAction(value: string) {
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

export function translateResult(value: string) {
  return translateStatus(value);
}

export function translateRedisMode(value: string) {
  const labels: Record<string, string> = {
    pubsub: "发布订阅",
    polling: "轮询",
    degraded: "降级",
    unknown: "未知"
  };
  return labels[value.toLowerCase()] ?? value;
}

export function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : `${date.toLocaleDateString("zh-CN")} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
}
