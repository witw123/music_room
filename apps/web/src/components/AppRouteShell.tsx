"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { AppPersistentPlayer } from "@/components/AppPersistentPlayer";
import { AppSidebar } from "@/components/AppSidebar";
import { MusicRoomApp } from "@/components/music-room-app";
import { LocalPlayerProvider } from "@/features/playback/local-player-context";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { awayRoomChangeEvent, readAwayRoomId } from "@/lib/away-room";
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
  const [awayRoomId, setAwayRoomId] = useState<string | null>(null);

  useEffect(() => {
    const syncAwayRoom = () => setAwayRoomId(readAwayRoomId());
    syncAwayRoom();
    window.addEventListener(awayRoomChangeEvent, syncAwayRoom);
    window.addEventListener("storage", syncAwayRoom);
    return () => {
      window.removeEventListener(awayRoomChangeEvent, syncAwayRoom);
      window.removeEventListener("storage", syncAwayRoom);
    };
  }, []);

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
          hasBottomPlayer={Boolean(awayRoomId)}
          onLogout={handleLogout}
        />
        <div key={pathname} className="app-route-transition">
          {children}
        </div>
        {awayRoomId ? (
          <MusicRoomApp
            backgroundOnly
            initialRoomId={awayRoomId}
            workspaceOnly
          />
        ) : (
          <AppPersistentPlayer />
        )}
      </div>
    </LocalPlayerProvider>
  );
}
