"use client";

import { useState, type FormEvent } from "react";
import type { SystemAnnouncement } from "@music-room/shared";
import { adminApi } from "@/lib/network/admin-api";
import { Icon, formatDateTime } from "../ui";

export function Announcements({
  announcements,
  onRefresh
}: {
  announcements: SystemAnnouncement[];
  onRefresh: () => Promise<void>;
}) {
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  function openCreate() {
    setModalMode("create");
    setEditingId(null);
    setTitle("");
    setContent("");
    setIsActive(true);
    setActionError("");
    setActionSuccess("");
  }

  function openEdit(item: SystemAnnouncement) {
    setModalMode("edit");
    setEditingId(item.id);
    setTitle(item.title);
    setContent(item.content);
    setIsActive(item.isActive);
    setActionError("");
    setActionSuccess("");
  }

  function closeModal() {
    setModalMode(null);
    setEditingId(null);
    setActionError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setActionError("请输入通知标题");
      return;
    }
    if (!content.trim()) {
      setActionError("请输入通知内容");
      return;
    }

    setSubmitting(true);
    setActionError("");
    try {
      if (modalMode === "create") {
        await adminApi.createAnnouncement({
          title: title.trim(),
          content: content.trim(),
          isActive
        });
        setActionSuccess("通知发布成功");
      } else if (modalMode === "edit" && editingId) {
        await adminApi.updateAnnouncement(editingId, {
          title: title.trim(),
          content: content.trim(),
          isActive
        });
        setActionSuccess("通知更新成功");
      }
      closeModal();
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(item: SystemAnnouncement) {
    try {
      setActionError("");
      await adminApi.updateAnnouncement(item.id, { isActive: !item.isActive });
      setActionSuccess(`已${!item.isActive ? "启用" : "停用"}通知: ${item.title}`);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "状态切换失败");
    }
  }

  async function handleDelete(id: string) {
    try {
      setActionError("");
      await adminApi.deleteAnnouncement(id);
      setDeleteConfirmId(null);
      setActionSuccess("通知已删除");
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "删除失败");
    }
  }

  const activeCount = announcements.filter((a) => a.isActive).length;

  return (
    <div className="space-y-4">
      {/* 顶部操作与统计 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface p-4 rounded-lg border border-surface-border">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">系统通知管理</h2>
          <p className="text-xs text-foreground-muted mt-0.5">
            共 {announcements.length} 条通知，其中 {activeCount} 条正在前台展示中。
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent,#3b82f6)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity self-start sm:self-auto cursor-pointer"
        >
          <Icon name="plus" size={13} />
          <span>发布新通知</span>
        </button>
      </div>

      {actionSuccess ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-400 flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button onClick={() => setActionSuccess("")} className="text-foreground-muted hover:text-foreground">×</button>
        </div>
      ) : null}

      {actionError ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-400 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError("")} className="text-foreground-muted hover:text-foreground">×</button>
        </div>
      ) : null}

      {/* 创建 / 编辑模态弹窗 */}
      {modalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl border border-surface-border bg-surface p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <h3 className="text-sm font-semibold text-foreground">
                {modalMode === "create" ? "发布新系统通知" : "编辑系统通知"}
              </h3>
              <button
                onClick={closeModal}
                className="rounded p-1 text-foreground-muted hover:text-foreground hover:bg-surface-border/40"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  通知标题 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  maxLength={200}
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：【功能更新】现已支持B站音频解析与导入"
                  className="w-full rounded-md border border-surface-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent,#3b82f6)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  通知内容（支持多行） <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={5}
                  maxLength={5000}
                  required
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="请输入通知详细内容，换行段落将在前台完整展示..."
                  className="w-full rounded-md border border-surface-border bg-background p-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent,#3b82f6)] resize-y font-sans leading-relaxed"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="announcement-active-toggle"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-surface-border bg-background text-[var(--accent,#3b82f6)] focus:ring-0 cursor-pointer"
                />
                <label htmlFor="announcement-active-toggle" className="text-xs text-foreground select-none cursor-pointer">
                  立即启用（发布后前台首页可见）
                </label>
              </div>

              {actionError ? (
                <p className="text-xs text-red-400">{actionError}</p>
              ) : null}

              <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="rounded-md border border-surface-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-border/40 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-[var(--accent,#3b82f6)] px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {submitting ? "保存中..." : modalMode === "create" ? "确认发布" : "保存修改"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* 删除确认弹窗 */}
      {deleteConfirmId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-surface-border bg-surface p-4 shadow-2xl space-y-3">
            <h3 className="text-sm font-semibold text-foreground">确认删除此通知？</h3>
            <p className="text-xs text-foreground-muted">
              删除后通知将无法恢复，前台也将立即移除该通知。
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-md border border-surface-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-border/40"
              >
                取消
              </button>
              <button
                onClick={() => void handleDelete(deleteConfirmId)}
                className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 通知列表表格 */}
      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-surface-border bg-surface-border/20 text-foreground-muted">
              <th className="py-2.5 px-3 font-medium">标题</th>
              <th className="py-2.5 px-3 font-medium">内容预览</th>
              <th className="py-2.5 px-3 font-medium w-24">状态</th>
              <th className="py-2.5 px-3 font-medium w-36">发布时间</th>
              <th className="py-2.5 px-3 font-medium w-40 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border/60">
            {announcements.length ? (
              announcements.map((item) => (
                <tr key={item.id} className="hover:bg-surface-border/10 transition-colors">
                  <td className="py-3 px-3 font-medium text-foreground max-w-xs truncate">
                    {item.title}
                  </td>
                  <td className="py-3 px-3 text-foreground-muted max-w-md truncate">
                    {item.content}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        item.isActive
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-surface-border/40 text-foreground-muted border border-surface-border"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${item.isActive ? "bg-emerald-400" : "bg-foreground-muted/60"}`} />
                      {item.isActive ? "已启用" : "已停用"}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-[11px] text-foreground-muted whitespace-nowrap">
                    {formatDateTime(item.createdAt)}
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap space-x-1.5">
                    <button
                      onClick={() => void toggleActive(item)}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                        item.isActive
                          ? "text-amber-400 hover:bg-amber-400/10"
                          : "text-emerald-400 hover:bg-emerald-400/10"
                      }`}
                    >
                      {item.isActive ? "停用" : "启用"}
                    </button>
                    <button
                      onClick={() => openEdit(item)}
                      className="px-2 py-1 rounded text-[11px] text-foreground-muted hover:text-foreground hover:bg-surface-border/40 transition-colors"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(item.id)}
                      className="px-2 py-1 rounded text-[11px] text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-foreground-muted">
                  暂无系统通知，点击上方“发布新通知”创建第一条通知。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
