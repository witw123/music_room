"use client";

import { useState } from "react";
import type { AdminUserSummary } from "@music-room/shared";
import { ADMIN_CONFIRM_REASON, adminApi } from "@/lib/network/admin-api";
import { HealthText, UserCell, formatTime } from "../ui";

export function Users({ users, onRefresh }: { users: AdminUserSummary[]; onRefresh: () => Promise<void> }) {
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
