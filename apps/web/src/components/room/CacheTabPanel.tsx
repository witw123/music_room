"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/music-room-ui";
import type { AvailabilityEntry } from "./MeshStatusPanel";
import type { CachedLibraryTrack } from "@/features/upload/audio-utils";
import type { ManualCacheTask } from "@/features/upload/manual-cache-task-store";
import {
  deriveRoomCacheRow,
  filterRoomCacheRows,
  formatCachedAt,
  formatCacheSize,
  isCachedTrackInRoomLibrary,
  type RoomCacheAction,
  type RoomCacheFilter,
  type RoomCacheRow
} from "./cache-tab-view-model";

type CacheTabPanelProps = {
  tracks: TrackMeta[];
  availabilitySummary: AvailabilityEntry[];
  activeSession: AuthSession | null;
  cacheLibraryTracks: CachedLibraryTrack[];
  manualCacheTasks: Record<string, ManualCacheTask>;
  onStartManualCacheDownload: (trackId: string) => Promise<void>;
  onPauseManualCacheDownload: (trackId: string) => void;
  onAddCachedLibraryTrackToLibrary: (fileHash: string) => Promise<void>;
  onExportCachedLibraryTrack: (fileHash: string) => Promise<void>;
  onDeleteCachedLibraryTrack: (fileHash: string) => Promise<void>;
};

const roomFilters: Array<{ value: RoomCacheFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "下载中" },
  { value: "available", label: "可缓存" },
  { value: "completed", label: "已完成" }
];

const statusToneClass: Record<RoomCacheRow["status"]["tone"], string> = {
  neutral: "border-surface-border bg-background/60 text-foreground-muted",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  danger: "border-red-500/25 bg-red-500/10 text-red-300"
};

const actionLabels: Record<RoomCacheAction, string> = {
  download: "下载",
  pause: "暂停",
  resume: "继续",
  retry: "重试"
};

function CacheTabPanelBase({
  tracks,
  availabilitySummary,
  activeSession,
  cacheLibraryTracks,
  manualCacheTasks,
  onStartManualCacheDownload,
  onPauseManualCacheDownload,
  onAddCachedLibraryTrackToLibrary,
  onExportCachedLibraryTrack,
  onDeleteCachedLibraryTrack
}: CacheTabPanelProps) {
  const [roomFilter, setRoomFilter] = useState<RoomCacheFilter>("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [pendingActionKeys, setPendingActionKeys] = useState<Set<string>>(() => new Set());
  const pendingActionKeysRef = useRef(new Set<string>());

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    if (pendingActionKeysRef.current.has(key)) {
      return;
    }
    pendingActionKeysRef.current.add(key);
    setPendingActionKeys(new Set(pendingActionKeysRef.current));
    try {
      await action();
    } finally {
      pendingActionKeysRef.current.delete(key);
      setPendingActionKeys(new Set(pendingActionKeysRef.current));
    }
  }, []);

  const availabilityByTrackId = useMemo(
    () => new Map(availabilitySummary.map((entry) => [entry.track.id, entry] as const)),
    [availabilitySummary]
  );
  const cacheLibraryByHash = useMemo(
    () => new Map(cacheLibraryTracks.map((track) => [track.fileHash, track] as const)),
    [cacheLibraryTracks]
  );
  const roomRows = useMemo(
    () => tracks
      .filter((track) => track.ownerSessionId !== activeSession?.userId)
      .map((track) => {
        const availability = availabilityByTrackId.get(track.id);
        return deriveRoomCacheRow({
          track,
          task: manualCacheTasks[track.id] ?? null,
          cachedTrack: cacheLibraryByHash.get(track.fileHash) ?? null,
          remotePeerCount: availability?.remotePeerCount ?? 0,
          availableTotalChunks: availability?.totalChunks ?? 0
        });
      }),
    [activeSession?.userId, availabilityByTrackId, cacheLibraryByHash, manualCacheTasks, tracks]
  );
  const visibleRoomRows = useMemo(
    () => filterRoomCacheRows(roomRows, roomFilter),
    [roomFilter, roomRows]
  );
  const visibleLibraryTracks = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) {
      return cacheLibraryTracks;
    }
    return cacheLibraryTracks.filter((track) =>
      [track.title, track.artist, track.lastOwnerNickname]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("zh-CN").includes(query))
    );
  }, [cacheLibraryTracks, libraryQuery]);

  const totalCacheSize = useMemo(
    () => cacheLibraryTracks.reduce((total, track) => total + Math.max(0, track.sizeBytes), 0),
    [cacheLibraryTracks]
  );
  const activeTaskCount = roomRows.filter((row) =>
    row.status.key === "downloading" || row.status.key === "assembling" || row.status.key === "finalizing"
  ).length;
  const filterCounts = useMemo(
    () => ({
      all: roomRows.length,
      active: roomRows.filter((row) => row.category === "active").length,
      available: roomRows.filter((row) => row.category === "available").length,
      completed: roomRows.filter((row) => row.category === "completed").length
    }),
    [roomRows]
  );

  const handleRoomAction = useCallback((row: RoomCacheRow) => {
    if (!row.action || row.actionDisabled) {
      return;
    }
    if (row.action === "pause") {
      onPauseManualCacheDownload(row.track.id);
      return;
    }
    void runAction(`room:${row.track.id}`, () => onStartManualCacheDownload(row.track.id));
  }, [onPauseManualCacheDownload, onStartManualCacheDownload, runAction]);

  return (
    <div className="animate-fade-in flex w-full flex-col gap-10">
      <header className="border-b border-surface-border pb-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">本机缓存</h2>
            <p className="mt-1 text-xs text-foreground-muted">管理房间歌曲的无损下载与本机文件。</p>
          </div>
          <dl className="grid grid-cols-3 gap-5 sm:gap-8">
            <CacheMetric label="已缓存" value={`${cacheLibraryTracks.length} 首`} />
            <CacheMetric label="占用空间" value={formatCacheSize(totalCacheSize)} />
            <CacheMetric label="进行中" value={`${activeTaskCount} 项`} />
          </dl>
        </div>
      </header>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">房间歌曲</h3>
            <p className="mt-1 text-xs text-foreground-muted">从在线成员下载完整无损文件。</p>
          </div>
          <div className="inline-flex w-full overflow-x-auto rounded-lg border border-surface-border bg-background/40 p-1 sm:w-auto">
            {roomFilters.map((filter) => (
              <button
                key={filter.value}
                aria-pressed={roomFilter === filter.value}
                className={`min-w-max flex-1 rounded-md px-3 py-1.5 text-xs transition-colors sm:flex-none ${
                  roomFilter === filter.value
                    ? "bg-white/10 text-foreground"
                    : "text-foreground-muted hover:text-foreground"
                }`}
                onClick={() => setRoomFilter(filter.value)}
                type="button"
              >
                {filter.label} <span className="ml-1 text-[10px] opacity-65">{filterCounts[filter.value]}</span>
              </button>
            ))}
          </div>
        </div>

        {visibleRoomRows.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-surface-border bg-surface/40">
            {visibleRoomRows.map((row) => {
              const pending = pendingActionKeys.has(`room:${row.track.id}`);
              return (
                <div
                  key={row.track.id}
                  className="grid gap-3 border-b border-surface-border px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(220px,1fr)_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h4 className="truncate text-sm font-medium text-foreground">{row.track.title}</h4>
                      <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] ${statusToneClass[row.status.tone]}`}>
                        {row.status.label}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-foreground-muted">
                      {row.track.artist || row.track.ownerNickname} · {row.track.ownerNickname} · {formatDuration(row.track.durationMs)}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3 text-[11px] text-foreground-muted">
                      <span className="truncate">{row.detail}</span>
                      <span className="shrink-0">
                        {row.status.key === "downloading"
                          ? `${row.progress.label} · ${row.speedLabel}`
                          : row.progress.label}
                      </span>
                    </div>
                    <div
                      aria-label={`${row.track.title} 缓存进度`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={row.progress.percent}
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/6"
                      role="progressbar"
                    >
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${
                          row.status.key === "cached" ? "bg-emerald-400" : "bg-accent"
                        }`}
                        style={{ width: `${row.progress.percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex min-h-9 items-center justify-end">
                    {row.action ? (
                      <Button
                        variant={row.action === "pause" ? "ghost" : "outline"}
                        className="h-9 min-w-20 px-3"
                        disabled={row.actionDisabled || pending}
                        onClick={() => handleRoomAction(row)}
                        type="button"
                      >
                        {pending ? "处理中" : actionLabels[row.action]}
                      </Button>
                    ) : row.status.key === "waiting" ? (
                      <span className="text-xs text-foreground-muted">等待成员上线</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState>
            {roomRows.length === 0 ? "当前没有其他成员的歌曲。" : "当前筛选条件下没有歌曲。"}
          </EmptyState>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">本机文件</h3>
            <p className="mt-1 text-xs text-foreground-muted">添加到房间曲库、导出或删除完整缓存。</p>
          </div>
          <input
            aria-label="搜索本机缓存"
            className="h-9 w-full rounded-lg border border-surface-border bg-[#0d0d10] px-3 text-xs text-foreground [color-scheme:dark] outline-none transition-colors placeholder:text-foreground-muted/70 focus:border-accent sm:w-64"
            onChange={(event) => setLibraryQuery(event.target.value)}
            placeholder="搜索歌名、艺术家或上传者"
            type="search"
            value={libraryQuery}
          />
        </div>

        {visibleLibraryTracks.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-surface-border bg-surface/40">
            {visibleLibraryTracks.map((track) => {
              const addedToRoom = isCachedTrackInRoomLibrary({
                fileHash: track.fileHash,
                activeSessionUserId: activeSession?.userId,
                tracks
              });
              const addKey = `add:${track.fileHash}`;
              const exportKey = `export:${track.fileHash}`;
              const deleteKey = `delete:${track.fileHash}`;
              const pendingAdd = pendingActionKeys.has(addKey);
              const pendingExport = pendingActionKeys.has(exportKey);
              const pendingDelete = pendingActionKeys.has(deleteKey);
              const rowPending = pendingAdd || pendingExport || pendingDelete;

              return (
                <div
                  key={track.fileHash}
                  className="grid gap-3 border-b border-surface-border px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h4 className="truncate text-sm font-medium text-foreground">{track.title}</h4>
                      {addedToRoom ? (
                        <span className="shrink-0 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                          已在曲库
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-foreground-muted">
                      {track.artist || track.lastOwnerNickname || "未知艺术家"} · {formatDuration(track.durationMs)} · {formatCacheSize(track.sizeBytes)}
                    </p>
                    <p className="mt-1 text-[10px] text-foreground-muted">缓存于 {formatCachedAt(track.cachedAt)}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <Button
                      variant="outline"
                      className="h-9 px-3"
                      disabled={addedToRoom || rowPending}
                      onClick={() => void runAction(addKey, () => onAddCachedLibraryTrackToLibrary(track.fileHash))}
                      type="button"
                    >
                      {addedToRoom ? "已在曲库" : pendingAdd ? "添加中" : "添加到曲库"}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-9 px-3"
                      disabled={rowPending}
                      onClick={() => void runAction(exportKey, () => onExportCachedLibraryTrack(track.fileHash))}
                      type="button"
                    >
                      {pendingExport ? "导出中" : "导出"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-9 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={rowPending}
                      onClick={() =>
                        void runAction(deleteKey, () => onDeleteCachedLibraryTrack(track.fileHash))
                      }
                      type="button"
                    >
                      {pendingDelete ? "删除中" : "删除"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState>
            {cacheLibraryTracks.length === 0 ? "本机还没有完整缓存。" : "没有匹配的本机缓存。"}
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function CacheMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] text-foreground-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed border-surface-border px-5 py-10 text-center text-sm text-foreground-muted">
      {children}
    </div>
  );
}

export const CacheTabPanel = memo(CacheTabPanelBase);
