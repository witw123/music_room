"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { Button } from "@/components/ui/button";
import {
  cleanupLocalAudioCacheFiles,
  chooseLocalAudioDirectory,
  getLocalAudioStorageState,
  type LocalAudioStorageState
} from "@/features/upload/local-audio-storage";
import { cleanupOrphanedLocalAudioStorage, listCachedLibraryTrackSummaries } from "@/lib/indexeddb";
import { LocalPlaylistsOverview } from "@/components/LocalPlaylistsOverview";
import { NeteaseSourcePanel } from "@/components/room/NeteaseSourcePanel";
import { QqMusicSourcePanel } from "@/components/room/QqMusicSourcePanel";
import {
  getCachedLocalStorageData,
  setCachedLocalStorageData
} from "@/features/workspace/page-data-cache";

export function ProviderAccountsPage() {
  const router = useRouter();
  const redirectTo = "/app/profile";
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });

  useEffect(() => {
    if (hydrated && !activeSession) {
      router.replace(authEntryHref as Route);
    }
  }, [activeSession, authEntryHref, hydrated, router]);

  if (!hydrated || !activeSession) {
    return <div className="min-h-screen bg-black" />;
  }

  return (
    <main className="relative h-screen min-h-screen overflow-y-auto hide-scrollbar bg-black pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-4 pb-10 pt-6 sm:px-6 sm:pt-12 md:mx-0 md:max-w-[1400px] md:px-8 md:pt-28">
        <section className="grid min-w-0 gap-4 lg:grid-cols-2">
          {process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? (
            <NeteaseSourcePanel activeSession={activeSession} mode="account" />
          ) : null}
          {process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? (
            <QqMusicSourcePanel activeSession={activeSession} mode="account" />
          ) : null}
          {process.env.NEXT_PUBLIC_NETEASE_ENABLED !== "true" && process.env.NEXT_PUBLIC_QQMUSIC_ENABLED !== "true" ? (
            <div className="rounded-xl border border-surface-border bg-surface/40 p-6 text-sm text-foreground-muted">
              当前没有启用第三方音乐平台。
            </div>
          ) : null}
        </section>
        <LocalStorageManagementCard />
        <LocalPlaylistsOverview />
      </div>
    </main>
  );
}

function LocalStorageManagementCard() {
  const cachedData = getCachedLocalStorageData();
  const [state, setState] = useState<LocalAudioStorageState | null>(() => cachedData?.state ?? null);
  const [usageBytes, setUsageBytes] = useState<number | null>(() => cachedData?.usageBytes ?? null);
  const [cachedTrackCount, setCachedTrackCount] = useState(() => cachedData?.cachedTrackCount ?? 0);
  const [pendingAction, setPendingAction] = useState<"choose" | "clean" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pending = pendingAction !== null;

  const refresh = async () => {
    const [nextState, summaries, estimate] = await Promise.all([
      getLocalAudioStorageState(),
      listCachedLibraryTrackSummaries(),
      typeof navigator !== "undefined" && navigator.storage
        ? navigator.storage.estimate()
        : Promise.resolve(null)
    ]);
    setState(nextState);
    setCachedTrackCount(summaries.length);
    setUsageBytes(estimate?.usage ?? null);
    setCachedLocalStorageData({
      state: nextState,
      cachedTrackCount: summaries.length,
      usageBytes: estimate?.usage ?? null
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
    setPendingAction("clean");
    setMessage(null);
    try {
      const summaries = await listCachedLibraryTrackSummaries();
      const result = await cleanupOrphanedLocalAudioStorage({
        preserveTrackIds: summaries.flatMap((summary) => summary.sourceTrackIds)
      });
      const deletedCacheFiles = await cleanupLocalAudioCacheFiles();
      await refresh();
      setMessage(
        result.deletedCacheCount > 0 || result.deletedAssetCount > 0 || deletedCacheFiles > 0
          ? `已清理 ${result.deletedCacheCount + deletedCacheFiles} 个缓存文件和 ${result.deletedAssetCount} 个播放资产。`
          : "没有发现可清理的无效存储。"
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清理无效存储失败，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const mergedCount = state
    ? new Set([...state.cachedFileHashes, ...state.savedFileHashes]).size
    : null;

  return (
    <section className="mt-8 border-b border-surface-border pb-5" data-testid="local-storage-management">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">本地音乐</h2>
          <p className="mt-1 truncate text-xs text-foreground-muted" title={state?.directoryName ?? undefined}>
            本地目录 {formatBytes(usageBytes)} · {cachedTrackCount} 首记录
          </p>
          <p className="mt-1 truncate text-xs text-foreground-muted/80">
            {state?.directoryName
              ? `Music Room：${state.directoryName} · 已合并 ${mergedCount ?? 0} 首`
              : state?.supported
                ? "尚未选择 Music Room 根文件夹"
                : "当前浏览器保存时将使用下载"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {state?.supported ? (
            <Button
              data-testid="choose-local-folder-button"
              disabled={pending}
              onClick={() => void choose()}
              size="sm"
              type="button"
              variant="outline"
            >
              {pendingAction === "choose" ? "选择中…" : state.directoryName ? "更改根文件夹" : "选择根文件夹"}
            </Button>
          ) : null}
          <Button
            data-testid="clean-local-storage-button"
            disabled={pending}
            onClick={() => void clean()}
            size="sm"
            title="清理无效的本机音频数据"
            type="button"
            variant="outline"
          >
            {pendingAction === "clean" ? "清理中…" : "清理无效存储"}
          </Button>
        </div>
      </div>
      {state?.supported === false ? <p className="mt-3 text-xs text-amber-300">当前浏览器不支持选择本地文件夹，请使用 Chrome 或 Edge。</p> : null}
      {message ? <p className="mt-3 text-xs text-foreground-muted" role="status">{message}</p> : null}
    </section>
  );
}

function formatBytes(value: number | null) {
  if (value === null) return "不可用";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function AppPageBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-black">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      <div className="absolute left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-fuchsia-600/10 blur-[150px]" />
    </div>
  );
}
