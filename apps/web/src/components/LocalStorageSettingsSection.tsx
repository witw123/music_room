"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  clearLocalAudioCache,
  chooseLocalAudioDirectory,
  getLocalAudioCacheStats,
  getLocalAudioStorageState,
  type LocalAudioStorageState
} from "@/features/upload/local-audio-storage";
import {
  getCachedLocalStorageData,
  setCachedLocalStorageData
} from "@/features/workspace/page-data-cache";

export function LocalStorageManagementCard() {
  const cachedData = getCachedLocalStorageData();
  const [state, setState] = useState<LocalAudioStorageState | null>(() => cachedData?.state ?? null);
  const [cacheBytes, setCacheBytes] = useState(() => cachedData?.cacheBytes ?? 0);
  const [cachedTrackCount, setCachedTrackCount] = useState(() => cachedData?.cachedTrackCount ?? 0);
  const [pendingAction, setPendingAction] = useState<"choose" | "clean" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pending = pendingAction !== null;

  const refresh = async () => {
    const [nextState, stats] = await Promise.all([
      getLocalAudioStorageState(),
      getLocalAudioCacheStats()
    ]);
    setState(nextState);
    setCachedTrackCount(stats.fileCount);
    setCacheBytes(stats.bytes);
    setCachedLocalStorageData({
      state: nextState,
      cachedTrackCount: stats.fileCount,
      cacheBytes: stats.bytes
    });
  };

  useEffect(() => {
    void refresh().catch(() => setMessage("无法读取本地目录状态。"));
  }, []);

  const choose = async () => {
    if (pending) return;
    setPendingAction("choose");
    setMessage(null);
    try {
      const name = await chooseLocalAudioDirectory();
      await refresh();
      setMessage(`本地歌曲保存位置已设置为“${name}”。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "选择本地目录失败，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const clean = async () => {
    if (pending) return;
    if (!window.confirm("确定清理全部缓存音频吗？已保存歌曲和本地歌单不会被删除。")) return;
    setPendingAction("clean");
    setMessage(null);
    try {
      const result = await clearLocalAudioCache();
      await refresh();
      setMessage(
        result.failedEntryCount > 0
          ? `已清理 ${result.deletedEntryCount} 个缓存音频，${result.failedEntryCount} 个缓存因目录权限未能清理。`
          : result.deletedEntryCount > 0
            ? `已清理 ${result.deletedEntryCount} 个缓存音频。`
          : "没有发现缓存音频。"
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清理缓存失败，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const savedCount = state?.savedFileHashes.length ?? 0;

  return (
    <section className="mt-8 border-b border-surface-border pb-5" data-testid="local-storage-management">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">本地存储</h2>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            管理下载歌曲、封面、歌词和浏览器缓存所在的位置。
          </p>
          <p className="mt-3 truncate text-xs text-foreground-muted" title={state?.directoryName ?? undefined}>
            {state?.directoryName ? `当前目录：${state.directoryName}` : "尚未选择 Music Room 根文件夹"}
          </p>
          <p className="mt-1 text-xs text-foreground-muted/75">
            {formatBytes(cacheBytes)} · {cachedTrackCount} 首缓存音频 · 已保存歌曲 {savedCount} 首
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {state?.supported ? (
            <Button
              data-testid="choose-local-folder-button"
              disabled={pending}
              onClick={() => void choose()}
              size="sm"
              type="button"
              variant="outline"
            >
              {pendingAction === "choose" ? "选择中…" : state.directoryName ? "更改保存目录" : "选择保存目录"}
            </Button>
          ) : null}
          <Button
            data-testid="clean-local-storage-button"
            disabled={pending}
            onClick={() => void clean()}
            size="sm"
            title="清理全部缓存音频，不删除已保存歌曲"
            type="button"
            variant="outline"
          >
            {pendingAction === "clean" ? "清理中…" : "清理缓存"}
          </Button>
        </div>
      </div>
      {state?.supported === false ? <p className="mt-3 text-xs text-amber-300">当前浏览器不支持选择本地文件夹，请使用 Chrome 或 Edge。</p> : null}
      {message ? <p className="mt-3 text-xs text-foreground-muted" role="status">{message}</p> : null}
    </section>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
