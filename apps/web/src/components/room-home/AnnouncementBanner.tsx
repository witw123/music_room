"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type { SystemAnnouncement } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { Button } from "@/components/ui/button";

const DISMISSED_STORAGE_KEY = "music-room-dismissed-announcements";

function readDismissedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeDismissedIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Format relative time (e.g. 17天前, 3小时前, 刚刚) as shown in Image 2
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (Number.isNaN(diffMs)) return "";
  if (diffMs < 0) return "刚刚";
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes}分钟前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}天前`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}个月前`;
  return `${Math.floor(diffDays / 365)}年前`;
}

/**
 * Format exact datetime for detail view (e.g. 2026-09-05 14:30)
 */
function formatExactTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function AnnouncementBanner() {
  const announcementsQuery = useQuery({
    queryKey: ["system-announcements", "active"],
    queryFn: ({ signal }) => musicRoomApi.getActiveAnnouncements(signal),
    staleTime: 30_000,
    refetchInterval: 30_000
  });

  const rawAnnouncements = announcementsQuery.data?.data;
  const announcements = useMemo(() => rawAnnouncements ?? [], [rawAnnouncements]);
  const [isDismissed, setIsDismissed] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<SystemAnnouncement | null>(null);

  // Sync dismissed state when active announcements change
  useEffect(() => {
    if (!announcements.length) {
      setIsDismissed(true);
      return;
    }
    const dismissed = readDismissedIds();
    // If all current announcements have already been dismissed, stay in default icon state
    const allDismissed = announcements.every((item) => dismissed.has(item.id));
    setIsDismissed(allDismissed);
  }, [announcements]);

  // Construct text for marquee loop (title: content)
  const marqueeText = useMemo(() => {
    if (!announcements.length) return "";
    return announcements
      .map((item) => {
        const cleanContent = item.content.replace(/\r?\n+/g, " ").trim();
        return `${item.title}：${cleanContent}`;
      })
      .join("        ✦        ");
  }, [announcements]);

  // Dynamic animation duration based on character length
  const marqueeDuration = useMemo(() => {
    const len = marqueeText.length;
    return Math.max(16, Math.min(60, Math.round(len * 0.35)));
  }, [marqueeText]);

  function handleDismissMarquee() {
    const dismissed = readDismissedIds();
    announcements.forEach((item) => dismissed.add(item.id));
    writeDismissedIds(dismissed);
    setIsDismissed(true);
  }

  function handleOpenModal(item?: SystemAnnouncement) {
    setSelectedAnnouncement(item ?? null);
    setIsModalOpen(true);
  }

  const hasUnread = useMemo(() => {
    if (!announcements.length) return false;
    const dismissed = readDismissedIds();
    return announcements.some((item) => !dismissed.has(item.id));
  }, [announcements]);

  return (
    <>
      {isDismissed || !announcements.length ? (
        /* 默认状态：仅显示通知图标，不显示“公告 查看详情 →” */
        <div className="flex w-full justify-end animate-fade-in">
          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-surface-border bg-surface text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors shadow-xs cursor-pointer active:scale-95"
            title="系统公告"
            aria-label="查看系统公告"
          >
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {hasUnread ? (
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
            ) : null}
          </button>
        </div>
      ) : (
        /* 发布通知时：从右向左循环滚动显示内容文字，点击内容后展开图2的界面 */
        <aside
          aria-label="系统通知"
          className="group relative flex w-full items-center justify-between gap-2.5 overflow-hidden rounded-xl border border-surface-border bg-surface px-3 py-1.5 text-xs text-foreground shadow-xs animate-fade-in"
        >
          {/* 左侧通知图标标牌 */}
          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="flex items-center gap-1.5 shrink-0 text-accent hover:opacity-80 transition-opacity cursor-pointer select-none"
            title="查看所有公告"
          >
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span className="font-semibold text-xs">通知</span>
          </button>

          {/* 中间跑马灯：从右向左循环滚动显示内容文字 */}
          <div
            onClick={() => handleOpenModal(announcements[0])}
            className="relative flex-1 min-w-0 overflow-hidden h-5 flex items-center cursor-pointer select-none"
            title="点击查看公告详情"
          >
            <div
              className="announcement-marquee flex items-center whitespace-nowrap group-hover:[animation-play-state:paused]"
              style={{ animationDuration: `${marqueeDuration}s` }}
            >
              <span className="inline-block pr-12 text-xs font-normal text-foreground/90">
                {marqueeText}
              </span>
              <span aria-hidden="true" className="inline-block pr-12 text-xs font-normal text-foreground/90">
                {marqueeText}
              </span>
            </div>
          </div>

          {/* 右侧关闭按钮：收起通知为默认图标 */}
          <button
            type="button"
            onClick={handleDismissMarquee}
            className="rounded p-1 text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors shrink-0 cursor-pointer"
            title="收起通知"
            aria-label="收起通知"
          >
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </aside>
      )}

      {/* 图2 界面：公告列表与详情弹窗（参考内容结构，采用收敛克制原生系统样式） */}
      {isModalOpen ? (
        <AnnouncementDialogModal
          announcements={announcements}
          selectedAnnouncement={selectedAnnouncement}
          onSelectAnnouncement={setSelectedAnnouncement}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedAnnouncement(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Announcement Center Modal Dialog (Reference structure from Image 2)
 */
function AnnouncementDialogModal({
  announcements,
  selectedAnnouncement,
  onSelectAnnouncement,
  onClose
}: {
  announcements: SystemAnnouncement[];
  selectedAnnouncement: SystemAnnouncement | null;
  onSelectAnnouncement: (item: SystemAnnouncement | null) => void;
  onClose: () => void;
}) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.body : null
  );

  useEffect(() => {
    if (!portalRoot && typeof document !== "undefined") {
      setPortalRoot(document.body);
    }
  }, [portalRoot]);

  // Handle ESC key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (selectedAnnouncement) {
          onSelectAnnouncement(null);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onSelectAnnouncement, selectedAnnouncement]);

  if (!portalRoot) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overscroll-contain animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        aria-modal="true"
        role="dialog"
        aria-label="系统公告"
        className="relative flex flex-col w-full max-w-md max-h-[min(82vh,600px)] rounded-2xl border border-surface-border bg-background-secondary p-5 sm:p-6 shadow-2xl text-foreground overflow-hidden"
      >
        {/* Modal Header: Bell icon + Title "公告" + Close button (×) */}
        <div className="flex items-center justify-between pb-4 border-b border-surface-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent shrink-0">
              <svg
                aria-hidden="true"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
            </div>
            <h3 className="text-base font-bold tracking-tight text-foreground">
              公告
            </h3>
            {announcements.length > 0 ? (
              <span className="font-mono text-xs text-foreground-muted">
                ({announcements.length})
              </span>
            ) : null}
          </div>

          <button
            type="button"
            aria-label="关闭弹窗"
            onClick={onClose}
            className="rounded-lg p-1.5 text-foreground-muted hover:text-foreground hover:bg-surface transition-colors cursor-pointer"
          >
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Body: List View (Image 2) or Detail View */}
        <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar pt-2">
          {selectedAnnouncement ? (
            /* 详情视图：展示单条公告完整内容与发布时间 */
            <div className="py-2 flex flex-col gap-3 animate-fade-in">
              <button
                type="button"
                onClick={() => onSelectAnnouncement(null)}
                className="inline-flex items-center gap-1.5 text-xs text-foreground-muted hover:text-foreground transition-colors cursor-pointer select-none self-start"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>返回公告列表</span>
              </button>

              <div>
                <h4 className="text-base font-bold text-foreground tracking-tight leading-snug">
                  {selectedAnnouncement.title}
                </h4>
                <p className="mt-1 text-xs text-foreground-muted">
                  发布于 {formatRelativeTime(selectedAnnouncement.createdAt)} · {formatExactTime(selectedAnnouncement.createdAt)}
                </p>
              </div>

              <div className="rounded-xl border border-surface-border bg-surface/40 p-4 text-xs sm:text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed max-h-[46vh] overflow-y-auto hide-scrollbar font-sans select-text">
                {selectedAnnouncement.content}
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => onSelectAnnouncement(null)}
                  className="rounded-xl px-4 text-xs h-8"
                >
                  返回列表
                </Button>
              </div>
            </div>
          ) : (
            /* 列表视图（对应图2结构）：圆点/图标 + 标题 + 相对时间 + 右箭头 */
            <div className="py-1">
              {!announcements.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface border border-surface-border text-foreground-muted/60 mb-2.5">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                    </svg>
                  </div>
                  <p className="text-xs text-foreground-muted">暂无系统公告</p>
                </div>
              ) : (
                <div className="divide-y divide-surface-border/50">
                  {announcements.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectAnnouncement(item)}
                      className="group flex w-full items-center justify-between gap-3 px-2 py-3 text-left transition-colors hover:bg-surface-hover/70 rounded-xl cursor-pointer"
                    >
                      {/* 左侧圆形图标与信息 */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface border border-surface-border text-foreground-muted group-hover:text-accent group-hover:border-accent/40 transition-colors">
                          <svg
                            aria-hidden="true"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="9" />
                            <polyline points="9 12 11 14 15 10" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-sm font-medium text-foreground group-hover:text-accent transition-colors">
                            {item.title}
                          </h4>
                          <p className="text-[11px] text-foreground-muted mt-0.5">
                            {formatRelativeTime(item.createdAt)}
                          </p>
                        </div>
                      </div>

                      {/* 右侧箭头 */}
                      <svg
                        className="h-4 w-4 text-foreground-muted/40 group-hover:text-foreground-muted shrink-0 transition-transform group-hover:translate-x-0.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    portalRoot
  );
}
