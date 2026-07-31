"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  clearLocalOtherFiles,
  clearLocalAudioCache,
  clearSavedLocalAudio,
  chooseLocalAudioDirectory,
  getLocalAudioStorageStats,
  getLocalAudioStorageState,
  type LocalAudioStorageState
} from "@/features/library/local-audio-storage";
import {
  getCachedLocalStorageData,
  setCachedLocalStorageData
} from "@/features/workspace/page-data-cache";

export function LocalStorageManagementCard() {
  const cachedData = getCachedLocalStorageData();
  const [state, setState] = useState<LocalAudioStorageState | null>(() => cachedData?.state ?? null);
  const [cacheBytes, setCacheBytes] = useState(() => cachedData?.cacheBytes ?? 0);
  const [cachedTrackCount, setCachedTrackCount] = useState(() => cachedData?.cachedTrackCount ?? 0);
  const [savedBytes, setSavedBytes] = useState(() => cachedData?.savedBytes ?? 0);
  const [savedTrackCount, setSavedTrackCount] = useState(() => cachedData?.savedTrackCount ?? cachedData?.state.savedFileHashes.length ?? 0);
  const [otherBytes, setOtherBytes] = useState(() => cachedData?.otherBytes ?? 0);
  const [otherFileCount, setOtherFileCount] = useState(() => cachedData?.otherFileCount ?? 0);
  const [pendingAction, setPendingAction] = useState<"choose" | "clean-cache" | "clean-saved" | "clean-other" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pending = pendingAction !== null;

  const refresh = async () => {
    const [nextState, stats] = await Promise.all([
      getLocalAudioStorageState(),
      getLocalAudioStorageStats()
    ]);
    setState(nextState);
    setCachedTrackCount(stats.cache.fileCount);
    setCacheBytes(stats.cache.bytes);
    setSavedTrackCount(stats.saved.fileCount);
    setSavedBytes(stats.saved.bytes);
    setOtherFileCount(stats.other.fileCount);
    setOtherBytes(stats.other.bytes);
    setCachedLocalStorageData({
      state: nextState,
      cachedTrackCount: stats.cache.fileCount,
      cacheBytes: stats.cache.bytes,
      savedTrackCount: stats.saved.fileCount,
      savedBytes: stats.saved.bytes,
      otherFileCount: stats.other.fileCount,
      otherBytes: stats.other.bytes
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

  const cleanCache = async () => {
    if (pending) return;
    if (!window.confirm("确定清理全部缓存音频吗？已保存歌曲和本地歌单不会被删除。")) return;
    setPendingAction("clean-cache");
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

  const cleanSaved = async () => {
    if (pending) return;
    if (!window.confirm("确定清理已保存的本地歌曲吗？选择目录中的原始文件不会被删除。")) return;
    setPendingAction("clean-saved");
    setMessage(null);
    try {
      const result = await clearSavedLocalAudio();
      await refresh();
      setMessage(
        result.failedEntryCount > 0
          ? `已清理 ${result.deletedEntryCount} 首本地歌曲，${result.failedEntryCount} 首因目录权限未能清理。`
          : result.skippedExternalCount > 0
            ? `已清理 ${result.deletedEntryCount} 首本地歌曲，跳过 ${result.skippedExternalCount} 首目录原文件。`
            : result.deletedEntryCount > 0
              ? `已清理 ${result.deletedEntryCount} 首本地歌曲。`
              : "没有发现可清理的本地歌曲。"
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清理本地歌曲失败，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const cleanOther = async () => {
    if (pending) return;
    if (!window.confirm("确定清理封面、歌词和其他辅助文件吗？本地歌曲和歌单不会被删除。")) return;
    setPendingAction("clean-other");
    setMessage(null);
    try {
      const result = await clearLocalOtherFiles();
      await refresh();
      setMessage(
        result.failedEntryCount > 0
          ? `已清理 ${result.deletedEntryCount} 个其他文件，${result.failedEntryCount} 个文件未能清理。`
          : result.deletedEntryCount > 0
            ? `已清理 ${result.deletedEntryCount} 个其他文件。`
            : "没有发现可清理的其他文件。"
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清理其他文件失败，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

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
        </div>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <StorageSection
          dataTestId="local-storage-cache"
          description="浏览器播放缓存和本地缓存音频"
          disabled={pending}
          label="播放缓存"
          onClean={() => void cleanCache()}
          pending={pendingAction === "clean-cache"}
          summary={`${formatBytes(cacheBytes)} · ${cachedTrackCount} 首音频`}
          actionLabel="清理缓存"
        />
        <StorageSection
          dataTestId="local-storage-saved"
          description="已保存到 Music Room 目录的本地歌曲"
          disabled={pending}
          label="本地歌曲"
          onClean={() => void cleanSaved()}
          pending={pendingAction === "clean-saved"}
          summary={`${formatBytes(savedBytes)} · ${savedTrackCount} 首歌曲`}
          actionLabel="清理本地歌曲"
        />
        <StorageSection
          dataTestId="local-storage-other"
          description="封面、歌词和其他辅助文件"
          disabled={pending}
          label="其他文件"
          onClean={() => void cleanOther()}
          pending={pendingAction === "clean-other"}
          summary={`${formatBytes(otherBytes)} · ${otherFileCount} 个文件`}
          actionLabel="清理其他文件"
        />
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

function StorageSection({
  actionLabel,
  dataTestId,
  description,
  disabled,
  label,
  onClean,
  pending,
  summary
}: {
  actionLabel: string;
  dataTestId: string;
  description: string;
  disabled: boolean;
  label: string;
  onClean: () => void;
  pending: boolean;
  summary: string;
}) {
  return (
    <div className="flex min-h-36 flex-col justify-between rounded-xl border border-surface-border bg-surface/30 p-4" data-testid={dataTestId}>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <p className="mt-1 text-xs leading-5 text-foreground-muted">{description}</p>
        <p className="mt-3 text-sm font-medium tabular-nums text-foreground">{summary}</p>
      </div>
      <Button
        className="mt-4 w-fit"
        disabled={disabled}
        onClick={onClean}
        size="sm"
        type="button"
        variant="outline"
      >
        {pending ? "清理中…" : actionLabel}
      </Button>
    </div>
  );
}
