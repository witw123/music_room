"use client";

import { useState } from "react";
import type { AdminRoomSummary } from "@music-room/shared";
import { ADMIN_CONFIRM_REASON, adminApi } from "@/lib/network/admin-api";
import { HealthText, formatTime, translatePlayback } from "../ui";

export function Rooms({ rooms, onRefresh }: { rooms: AdminRoomSummary[]; onRefresh: () => Promise<void> }) {
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
