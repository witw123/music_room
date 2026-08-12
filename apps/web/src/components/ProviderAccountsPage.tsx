"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { PersonalOverview } from "@/components/PersonalOverview";
import { FavoriteAlbumsPage } from "@/components/FavoriteAlbumsPage";
import { SettingsPage } from "@/components/SettingsPage";
import { Button } from "@/components/ui/button";

export function ProviderAccountsPage() {
  const router = useRouter();
  const redirectTo = "/app/profile";
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const [view, setView] = useState<"overview" | "favorites" | "settings">("overview");

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
      <div className="workspace-page__inner relative z-10 pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-12 md:pt-20">
        {view === "overview" ? (
          <>
            <div className="mb-5 flex justify-end sm:mb-7">
              <Button aria-label="打开设置" className="h-10 w-10" onClick={() => setView("settings")} size="icon" title="设置" type="button" variant="outline">
                <SettingsIcon />
              </Button>
            </div>
            <PersonalOverview activeSession={activeSession} onOpenFavorites={() => setView("favorites")} />
          </>
        ) : null}
        {view === "favorites" ? <FavoriteAlbumsPage embedded onBack={() => setView("overview")} /> : null}
        {view === "settings" ? <SettingsPage embedded onBack={() => setView("overview")} /> : null}
      </div>
    </main>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m12 3.5 1.3 1.8 2.2-.3.7 2 2 .7-.3 2.2 1.8 1.3-1.8 1.3.3 2.2-2 .7-.7 2-2.2-.3L12 21l-1.3-1.8-2.2.3-.7-2-2-.7.3-2.2L4.3 12l1.8-1.3-.3-2.2 2-.7.7-2 2.2.3L12 3.5Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function AppPageBackground() {
  return (
    <div aria-hidden="true" className="workspace-page-background" />
  );
}





















