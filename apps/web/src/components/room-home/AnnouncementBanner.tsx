"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SystemAnnouncement } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { Button } from "@/components/ui/button";
import { RoomDialog } from "./RoomDialog";

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

function formatAnnouncementTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("zh-CN")} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<SystemAnnouncement | null>(null);

  // Sync collapsed state with localStorage on active announcements change
  useEffect(() => {
    if (!announcements.length) return;
    const dismissed = readDismissedIds();
    // If all active announcements were previously dismissed by user, start collapsed
    const allDismissed = announcements.every((item) => dismissed.has(item.id));
    setIsCollapsed(allDismissed);
  }, [announcements]);

  // Make sure currentIndex stays in bounds
  useEffect(() => {
    if (currentIndex >= announcements.length) {
      setCurrentIndex(0);
    }
  }, [announcements.length, currentIndex]);

  // Auto-cycle ticker every 4.5 seconds when expanded and not hovered
  useEffect(() => {
    if (isCollapsed || isPaused || announcements.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % announcements.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [announcements.length, isCollapsed, isPaused]);

  const currentAnnouncement = announcements[currentIndex];

  function handleDismiss() {
    const dismissed = readDismissedIds();
    announcements.forEach((item) => dismissed.add(item.id));
    writeDismissedIds(dismissed);
    setIsCollapsed(true);
  }

  function handlePrev() {
    setCurrentIndex((prev) => (prev - 1 + announcements.length) % announcements.length);
  }

  function handleNext() {
    setCurrentIndex((prev) => (prev + 1) % announcements.length);
  }

  const modalIndex = useMemo(() => {
    if (!selectedAnnouncement) return -1;
    return announcements.findIndex((item) => item.id === selectedAnnouncement.id);
  }, [announcements, selectedAnnouncement]);

  function handleModalPrev() {
    if (modalIndex <= 0) {
      setSelectedAnnouncement(announcements[announcements.length - 1]);
    } else {
      setSelectedAnnouncement(announcements[modalIndex - 1]);
    }
  }

  function handleModalNext() {
    if (modalIndex >= announcements.length - 1) {
      setSelectedAnnouncement(announcements[0]);
    } else {
      setSelectedAnnouncement(announcements[modalIndex + 1]);
    }
  }

  if (!announcements.length) {
    return null;
  }

  return (
    <>
      {isCollapsed ? (
        /* 收缩态：在右侧展示紧凑药丸徽标，支持重新展开或直接查看详情 */
        <div className="flex w-full justify-end animate-fade-in">
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface/80 hover:bg-surface px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground transition-all duration-200 cursor-pointer shadow-xs active:scale-95"
            title="点击重新展开系统公告"
          >
            <svg
              aria-hidden="true"
              className="text-accent shrink-0"
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
            <span>系统公告</span>
            {announcements.length > 1 ? (
              <span className="inline-flex items-center justify-center rounded-full bg-accent/15 px-1.5 py-0.2 text-[10px] font-mono text-accent">
                {announcements.length}
              </span>
            ) : null}
          </button>
        </div>
      ) : (
        /* 展开态：主流横条样式，自动轮播播放，可点击看详情，右侧关闭收缩 */
        <aside
          aria-label="系统通知"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          className="group relative flex w-full items-center justify-between gap-2.5 overflow-hidden rounded-xl border border-surface-border/80 bg-surface/85 px-3 py-1.5 text-xs text-foreground backdrop-blur-md shadow-xs transition-all duration-200 hover:border-surface-border animate-fade-in"
        >
          {/* 左侧图标与标牌 */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex h-5 items-center gap-1 rounded bg-accent/15 px-1.5 text-[10px] font-medium text-accent select-none">
              <svg
                aria-hidden="true"
                width="12"
                height="12"
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
              <span>通知</span>
            </span>
          </div>

          {/* 中间自动轮播跑马灯文字 */}
          <div className="relative flex-1 min-w-0 overflow-hidden h-5 flex items-center">
            {currentAnnouncement ? (
              <button
                type="button"
                onClick={() => setSelectedAnnouncement(currentAnnouncement)}
                className="inline-flex items-center gap-1.5 truncate text-left text-foreground hover:text-accent transition-colors cursor-pointer group/title max-w-full"
                title="点击查看通知详情"
              >
                <span className="truncate font-medium">{currentAnnouncement.title}</span>
                <span className="text-[11px] text-foreground-muted group-hover/title:text-accent group-hover/title:underline shrink-0">
                  查看详情 →
                </span>
              </button>
            ) : null}
          </div>

          {/* 右侧控制与关闭收缩按钮 */}
          <div className="flex items-center gap-1.5 shrink-0 text-foreground-muted">
            {announcements.length > 1 ? (
              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-foreground-muted mr-0.5 select-none">
                  {currentIndex + 1}/{announcements.length}
                </span>
                <button
                  type="button"
                  aria-label="上一条通知"
                  onClick={handlePrev}
                  className="rounded p-0.5 hover:bg-white/10 hover:text-foreground transition-colors cursor-pointer"
                  title="上一条"
                >
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="下一条通知"
                  onClick={handleNext}
                  className="rounded p-0.5 hover:bg-white/10 hover:text-foreground transition-colors cursor-pointer"
                  title="下一条"
                >
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            ) : null}

            <div className="h-3 w-px bg-surface-border" />

            <button
              type="button"
              aria-label="关闭并收起通知"
              onClick={handleDismiss}
              className="rounded p-1 text-foreground-muted hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer"
              title="收起到右侧"
            >
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </aside>
      )}

      {/* 详情弹窗 */}
      {selectedAnnouncement ? (
        <RoomDialog
          title={selectedAnnouncement.title}
          description={`发布于 ${formatAnnouncementTime(selectedAnnouncement.createdAt)}`}
          onClose={() => setSelectedAnnouncement(null)}
        >
          <div className="flex flex-col gap-4">
            <div className="max-h-[min(50vh,360px)] overflow-y-auto rounded-xl border border-surface-border bg-background/50 p-4 text-xs leading-relaxed text-foreground whitespace-pre-wrap font-sans">
              {selectedAnnouncement.content}
            </div>

            {announcements.length > 1 ? (
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleModalPrev}
                    className="text-xs h-7 px-2"
                  >
                    上一条
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleModalNext}
                    className="text-xs h-7 px-2"
                  >
                    下一条
                  </Button>
                </div>
                <span className="text-[11px] text-foreground-muted font-mono">
                  {modalIndex + 1} / {announcements.length}
                </span>
              </div>
            ) : null}

            <div className="flex justify-end pt-2">
              <Button
                onClick={() => setSelectedAnnouncement(null)}
                size="sm"
                className="rounded-xl px-4 text-xs"
              >
                知道了
              </Button>
            </div>
          </div>
        </RoomDialog>
      ) : null}
    </>
  );
}
