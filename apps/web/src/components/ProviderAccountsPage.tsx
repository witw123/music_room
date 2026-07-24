"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { LocalPlaylistsOverview } from "@/components/LocalPlaylistsOverview";

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
    return <div className="min-h-[100dvh] bg-background" />;
  }

  return (
    <main className="workspace-page relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="workspace-page__inner relative z-10 pt-6 sm:pt-12 md:pt-20">
        <header className="workspace-page__header">
          <div className="workspace-page__heading">
            <p className="workspace-page__eyebrow">Library</p>
            <h1 className="workspace-page__title">我的</h1>
            <p className="workspace-page__description">管理本地歌单和音乐内容。</p>
          </div>
        </header>
        <div className="mt-8">
          <LocalPlaylistsOverview />
        </div>
      </div>
    </main>
  );
}

function AppPageBackground() {
  return (
    <div aria-hidden="true" className="workspace-page-background" />
  );
}
