"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { LocalPlaylistsOverview } from "@/components/LocalPlaylistsOverview";
import { LocalStorageManagementCard } from "@/components/LocalStorageSettingsSection";
import { NeteaseSourcePanel } from "@/components/room/NeteaseSourcePanel";
import { QqMusicSourcePanel } from "@/components/room/QqMusicSourcePanel";

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

function AppPageBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-black">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      <div className="absolute left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-fuchsia-600/10 blur-[150px]" />
    </div>
  );
}
