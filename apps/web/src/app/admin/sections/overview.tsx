import type { AdminIncident, AdminOverview, AdminRoomSummary } from "@music-room/shared";
import {
  AuditPanel,
  Icon,
  IncidentPanel,
  Metric,
  PanelHeader,
  RoomRow,
  SystemHealth,
  type AuditRow
} from "../ui";

export function Overview({
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
