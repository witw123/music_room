"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LocalPlayerProvider } from "@/features/playback/local-player-context";
import { MusicRoomApp } from "@/components/music-room-app";
import { awayRoomChangeEvent, readAwayRoomId } from "@/lib/domain/away-room";
import { DesktopLyricsOverlay } from "@/components/DesktopLyricsOverlay";
import { DesktopLyricsProvider } from "@/features/playback/desktop-lyrics-context";

import { isCapacitorRuntime } from "@/lib/desktop/tauri";
import { requestNotificationPermission } from "@/features/playback/system-notifications";

export function PersistentRoomRuntime({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const routeRoomId = resolveRoomRouteId(pathname);
  const [awayRoomId, setAwayRoomId] = useState<string | null>(null);

  useEffect(() => {
    if (isCapacitorRuntime()) {
      void requestNotificationPermission();
    }
  }, []);

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

  const runtimeRoomId = routeRoomId ?? awayRoomId;

  return (
    <DesktopLyricsProvider>
      {children}
      {runtimeRoomId ? (
        <LocalPlayerProvider>
          <MusicRoomApp
            backgroundOnly={!routeRoomId}
            initialRoomId={runtimeRoomId}
            workspaceOnly
          />
        </LocalPlayerProvider>
      ) : null}
      <DesktopLyricsOverlay />
    </DesktopLyricsProvider>
  );
}

function resolveRoomRouteId(pathname: string | null) {
  const match = pathname?.match(/^\/room\/([^/]+)$/);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
