"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LocalPlayerProvider } from "@/features/playback/local-player-context";
import { MusicRoomApp } from "@/components/music-room-app";
import { awayRoomChangeEvent, readAwayRoomId } from "@/lib/domain/away-room";
import { DesktopLyricsOverlay } from "@/components/DesktopLyricsOverlay";
import { DesktopLyricsProvider } from "@/features/playback/desktop-lyrics-context";
import { invokeTauri, isTauriRuntime } from "@/lib/desktop/tauri";

export function PersistentRoomRuntime({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const routeRoomId = resolveRoomRouteId(pathname);
  const [awayRoomId, setAwayRoomId] = useState<string | null>(null);

  useEffect(() => {
    // The desktop shell guarantees its storage root exists by default so
    // cached playback works on first launch without manual setup.
    if (isTauriRuntime()) {
      void invokeTauri("ensure_default_storage_root");
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
