"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { AppPersistentPlayer } from "@/components/AppPersistentPlayer";
import { AppSidebar } from "@/components/AppSidebar";
import { LocalPlayerProvider } from "@/features/playback/local-player-context";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { musicRoomApi } from "@/lib/music-room-api";

export function AppRouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const authEntryHref = buildWorkspaceAuthHref({
    redirectTo: pathname || "/app"
  });
  const { activeSession, hydrated, clearIdentity } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });

  useEffect(() => {
    if (hydrated && !activeSession) {
      router.replace(authEntryHref as Route);
    }
  }, [activeSession, authEntryHref, hydrated, router]);

  async function handleLogout() {
    try {
      await musicRoomApi.logout();
    } catch {
      // Clear the local identity even if the server is unavailable.
    }
    clearIdentity();
    router.replace(authEntryHref as Route);
  }

  return (
    <LocalPlayerProvider>
      <div className="min-h-screen bg-black">
        <AppSidebar
          activeSession={activeSession}
          hasBottomPlayer
          onLogout={handleLogout}
        />
        <div key={pathname} className="app-route-transition">
          {children}
        </div>
        <AppPersistentPlayer />
      </div>
    </LocalPlayerProvider>
  );
}
