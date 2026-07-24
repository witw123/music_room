"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { AppPersistentPlayer } from "@/components/AppPersistentPlayer";
import { AppSidebar } from "@/components/AppSidebar";
import { AwayRoomReturnButton } from "@/components/AwayRoomReturnButton";
import { MobileAppNavigation } from "@/components/MobileAppNavigation";
import { LocalPlayerProvider } from "@/features/playback/local-player-context";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { awayRoomChangeEvent, clearAwayRoomId, readAwayRoomId, requestAwayRoomResume } from "@/lib/away-room";
import { musicRoomApi } from "@/lib/music-room-api";
import { useCustomLayoutRuntime } from "@/features/settings/use-custom-layout-runtime";

export function AppRouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  useCustomLayoutRuntime(pathname);
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
    clearAwayRoomId();
    clearIdentity();
    router.replace(authEntryHref as Route);
  }

  function handleResumeAwayRoom() {
    if (!awayRoomId) return;
    requestAwayRoomResume(awayRoomId);
    router.push(`/room/${awayRoomId}` as Route);
  }

  return (
    <LocalPlayerProvider>
      <div className="min-h-[100dvh] overflow-x-hidden bg-background">
        <div className="hidden md:contents">
          <AppSidebar
            activeSession={activeSession}
            hasBottomPlayer
            onLogout={handleLogout}
          />
        </div>
        {awayRoomId ? <AwayRoomReturnButton onClick={handleResumeAwayRoom} /> : null}
        <PersistentAppRouteViews pathname={pathname}>{children}</PersistentAppRouteViews>
        {awayRoomId ? null : <AppPersistentPlayer />}
        <MobileAppNavigation />
      </div>
    </LocalPlayerProvider>
  );
}

/** Keep visited workspace pages mounted so route changes do not reset their data state. */
function PersistentAppRouteViews({
  pathname,
  children
}: {
  pathname: string | null;
  children: ReactNode;
}) {
  const routeKey = pathname || "/app";
  const routeCache = useRef(new Map<string, ReactNode>());
  const visibleRoute = useRef<string | null>(null);
  const lastChildren = useRef<ReactNode | undefined>(undefined);

  const cachedPage = routeCache.current.get(routeKey);
  if (routeCache.current.has(routeKey)) {
    // A cached route can be shown immediately while Next resolves its new RSC payload.
    visibleRoute.current = routeKey;
    lastChildren.current = cachedPage;
  } else if (children !== null && children !== undefined && children !== lastChildren.current) {
    // Pathname can update before children during a client transition. Do not cache the
    // previous route under the new key; wait for the new page node to arrive.
    routeCache.current.set(routeKey, children);
    visibleRoute.current = routeKey;
    lastChildren.current = children;
  }

  return (
    <div className="contents">
      {[...routeCache.current.entries()].map(([cachedRoute, page]) => {
        const isVisible = cachedRoute === visibleRoute.current;
        return (
          <div
            aria-hidden={!isVisible}
            className={isVisible ? "mobile-app-route-view custom-layout-content-region md:contents" : "hidden"}
            key={cachedRoute}
          >
            {page}
          </div>
        );
      })}
    </div>
  );
}
