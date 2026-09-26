"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminOverview } from "@music-room/shared";
import { adminApi } from "@/lib/network/admin-api";
import { HealthRow, HealthText, Icon, PanelHeader, SystemHealth, translateRedisMode } from "../ui";

export function System({ overview }: { overview: AdminOverview | null }) {
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
