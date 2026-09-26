"use client";

import { useState } from "react";
import type { AdminIncident } from "@music-room/shared";
import { ADMIN_CONFIRM_REASON, adminApi } from "@/lib/network/admin-api";
import { HealthText, formatTime, translateScope } from "../ui";

export function Incidents({ rows, onRefresh }: { rows: AdminIncident[]; onRefresh: () => Promise<void> }) {
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
