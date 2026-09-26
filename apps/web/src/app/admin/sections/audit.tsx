import { HealthText, formatTime, translateAction, translateScope, type AuditRow } from "../ui";

export function Audit({ rows }: { rows: AuditRow[] }) {
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
