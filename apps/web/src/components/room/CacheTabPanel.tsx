"use client";

import { memo, useMemo, useTransition } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/music-room-ui";
import type { AvailabilityEntry } from "./MeshStatusPanel";
import type { CachedLibraryTrack } from "@/features/upload/audio-utils";
import type { ManualCacheTask } from "@/features/upload/use-track-uploads";

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
  const [isPending, startTransition] = useTransition();
  const availabilityByTrackId = useMemo(
    () => new Map(availabilitySummary.map((entry) => [entry.track.id, entry] as const)),
    [availabilitySummary]
  );
  const cacheLibraryByHash = useMemo(
    () => new Map(cacheLibraryTracks.map((track) => [track.fileHash, track] as const)),
    [cacheLibraryTracks]
  );
  const downloadableTracks = useMemo(
    () =>
      tracks.filter((track) => {
        if (track.ownerSessionId === activeSession?.userId) {
          return false;
        }
        return true;
      }),
    [activeSession?.userId, tracks]
  );

  return (
    <div className="animate-fade-in flex w-full flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">当前房间可缓存歌曲</h3>
          <p className="mt-1 text-xs text-foreground-muted">
            这里只展示其他成员上传的房间歌曲。点击下载后会通过当前分片链路缓存到你的个人缓存库。
          </p>
        </div>

        {downloadableTracks.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {downloadableTracks.map((track) => {
              const cachedLibraryTrack = cacheLibraryByHash.get(track.fileHash) ?? null;
              const task = manualCacheTasks[track.id] ?? null;
              const availability = availabilityByTrackId.get(track.id) ?? null;
              const progressLabel =
                availability && availability.totalChunks > 0
                  ? `${availability.localChunkCount}/${availability.totalChunks}`
                  : "0/0";
              const progressPercent =
                availability && availability.totalChunks > 0
                  ? Math.min(
                      100,
                      Math.round((availability.localChunkCount / availability.totalChunks) * 100)
                    )
                  : 0;
              const statusLabel = cachedLibraryTrack
                ? "已缓存"
                : task?.status === "assembling"
                  ? "组装中"
                  : task?.status === "paused"
                    ? "已暂停"
                  : task?.status === "downloading" || task?.status === "queued"
                    ? "下载中"
                    : task?.status === "failed"
                      ? "下载失败"
                      : "可下载";

              return (
                <article
                  key={track.id}
                  className="flex flex-col gap-4 rounded-2xl border border-surface-border bg-surface p-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="truncate text-sm font-semibold text-foreground">{track.title}</h4>
                        <p className="mt-1 truncate text-xs text-foreground-muted">
                          {track.ownerNickname} 上传  {formatDuration(track.durationMs)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          cachedLibraryTrack
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : task?.status === "failed"
                              ? "border-red-500/30 bg-red-500/10 text-red-300"
                              : "border-surface-border bg-background/50 text-foreground-muted"
                        }`}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/6">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          cachedLibraryTrack ? "bg-emerald-400" : "bg-accent"
                        }`}
                        style={{ width: `${cachedLibraryTrack ? 100 : progressPercent}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-foreground-muted">
                      {cachedLibraryTrack
                        ? "这首歌已经进入你的个人缓存库。"
                        : task?.status === "paused"
                          ? `已暂停下载，当前缓存进度：${progressLabel}`
                        : task?.status === "failed"
                          ? task.errorMessage ?? "分片下载失败，可重新尝试。"
                          : `当前缓存进度：${progressLabel}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                    {task?.status === "queued" || task?.status === "downloading" ? (
                      <Button
                        variant="ghost"
                        className="h-10 px-4"
                        onClick={() => onPauseManualCacheDownload(track.id)}
                        type="button"
                      >
                        暂停
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      className="h-10 px-4"
                      disabled={!!cachedLibraryTrack || task?.status === "assembling"}
                      onClick={() => startTransition(() => void onStartManualCacheDownload(track.id))}
                      type="button"
                    >
                      {cachedLibraryTrack
                        ? "已缓存"
                        : task?.status === "paused"
                          ? "继续下载"
                          : task?.status === "downloading" || task?.status === "queued"
                            ? "下载中"
                            : "下载到缓存库"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">
            当前房间没有其他成员上传的歌曲，暂时没有可缓存条目。
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">我的缓存库</h3>
          <p className="mt-1 text-xs text-foreground-muted">
            这里是当前设备的个人缓存库。你可以把缓存歌曲显式添加到当前房间曲库、导出到本地，或删除缓存。
          </p>
        </div>

        {cacheLibraryTracks.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {cacheLibraryTracks.map((track) => (
              <article
                key={track.fileHash}
                className="flex flex-col gap-4 rounded-2xl border border-surface-border bg-surface p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <h4 className="truncate text-sm font-semibold text-foreground">{track.title}</h4>
                  <p className="truncate text-xs text-foreground-muted">
                    {track.lastOwnerNickname ?? "未知上传者"}  {formatDuration(track.durationMs)}
                  </p>
                  <p className="text-[10px] text-foreground-muted">
                    缓存时间：{new Date(track.cachedAt).toLocaleString("zh-CN", { hour12: false })}
                  </p>
                  <p className="text-[10px] text-foreground-muted">
                    来源房间数：{track.sourceRoomIds.length}  关联曲目数：{track.sourceTrackIds.length}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                  <Button
                    variant="outline"
                    className="h-10 px-4"
                    onClick={() => startTransition(() => void onAddCachedLibraryTrackToLibrary(track.fileHash))}
                    type="button"
                  >
                    添加到曲库
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 px-4"
                    onClick={() => startTransition(() => void onExportCachedLibraryTrack(track.fileHash))}
                    type="button"
                  >
                    保存到本地
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-10 px-4 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => startTransition(() => void onDeleteCachedLibraryTrack(track.fileHash))}
                    type="button"
                  >
                    删除缓存
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">
            你的缓存库还是空的。先在上方下载房间歌曲，完成后会出现在这里。
          </div>
        )}
      </section>

      {isPending ? (
        <div className="animate-fade-in fixed left-1/2 top-24 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-surface-border bg-surface px-4 py-1.5 shadow-lg backdrop-blur-md">
          <div className="h-2 w-2 animate-ping rounded-full bg-accent" />
          <span className="text-xs text-foreground">处理中...</span>
        </div>
      ) : null}
    </div>
  );
}

export const CacheTabPanel = memo(CacheTabPanelBase);
