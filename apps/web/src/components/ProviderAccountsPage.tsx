"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { musicRoomApi } from "@/lib/music-room-api";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import {
  chooseLocalAudioDirectory,
  getLocalAudioStorageState,
  type LocalAudioStorageState
} from "@/features/upload/local-audio-storage";

const NeteaseSourcePanel = dynamic(
  () => import("@/components/room/NeteaseSourcePanel").then((mod) => mod.NeteaseSourcePanel),
  { loading: () => <PanelLoading label="正在加载网易云账号管理…" /> }
);

const QqMusicSourcePanel = dynamic(
  () => import("@/components/room/QqMusicSourcePanel").then((mod) => mod.QqMusicSourcePanel),
  { loading: () => <PanelLoading label="正在加载 QQ 音乐账号管理…" /> }
);

export function ProviderAccountsPage() {
  const router = useRouter();
  const redirectTo = "/app/profile";
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo });
  const { activeSession, hydrated, clearIdentity } = useSessionIdentity({
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
    <main className="relative min-h-screen overflow-hidden bg-black pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <AppSidebar activeItem="profile" activeSession={activeSession} onLogout={async () => {
        try {
          await musicRoomApi.logout();
        } catch {
          // Clear local identity below even if the server is unavailable.
        }
        clearIdentity();
        router.replace(authEntryHref as Route);
      }} />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-4 pb-10 pt-10 sm:px-6 sm:pt-12 md:mx-0 md:max-w-[1400px] md:px-8 md:pt-28">
        <div className="max-w-2xl">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-accent">Profile</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">个人中心</h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-foreground-muted sm:text-base">
            管理网易云音乐和 QQ 音乐账号。绑定后即可在搜索页访问歌曲、歌词、歌单和专辑数据。
          </p>
        </div>

        <section className="mt-8 grid min-w-0 gap-4 sm:mt-10 lg:grid-cols-2">
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
        <LocalStorageLocationCard />
      </div>
    </main>
  );
}

function LocalStorageLocationCard() {
  const [state, setState] = useState<LocalAudioStorageState | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    setState(await getLocalAudioStorageState());
  };

  useEffect(() => {
    void refresh().catch(() => setMessage("无法读取本地目录状态。"));
  }, []);

  const choose = async () => {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const name = await chooseLocalAudioDirectory();
      await refresh();
      setMessage(`本地歌曲保存位置已设置为“${name}”。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "选择本地目录失败，请重试。");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">本地歌曲保存位置</h2>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            下载歌曲、缓存歌曲和保存歌曲会统一显示在“我的歌单”的本地歌单中。
          </p>
          <p className="mt-2 truncate text-xs text-foreground-muted/80">
            {state?.directoryName ? `当前目录：${state.directoryName}` : "尚未选择本地目录"}
          </p>
        </div>
        <Button disabled={pending || state?.supported === false} onClick={() => void choose()} size="sm" type="button">
          {pending ? "选择中…" : state?.directoryName ? "更改保存位置" : "选择保存位置"}
        </Button>
      </div>
      {state?.supported === false ? <p className="mt-3 text-xs text-amber-300">当前浏览器不支持选择本地文件夹，请使用 Chrome 或 Edge。</p> : null}
      {message ? <p className="mt-3 text-xs text-foreground-muted" role="status">{message}</p> : null}
    </section>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="animate-fade-in rounded-xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">
      {label}
    </div>
  );
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
