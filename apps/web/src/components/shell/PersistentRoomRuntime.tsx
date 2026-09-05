"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LocalPlayerProvider } from "@/features/playback/local-player-context";
import { MusicRoomApp } from "@/components/music-room-app";
import { awayRoomChangeEvent, readAwayRoomId } from "@/lib/domain/away-room";
import { DesktopLyricsOverlay } from "@/components/desktop-lyrics";
import { DesktopLyricsProvider } from "@/features/playback/desktop-lyrics-context";

import { isCapacitorRuntime } from "@/lib/desktop/tauri";
import { requestNotificationPermission } from "@/features/playback/system-notifications";
import { useAppUpdate } from "@/features/update/use-app-update";
import { UpdatePromptDialog } from "@/components/update/UpdatePromptDialog";

export function PersistentRoomRuntime({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLyricsWindow =
    pathname === "/desktop-lyrics" ||
    (typeof window !== "undefined" && window.location.search.includes("window=desktop-lyrics"));
  const routeRoomId = isLyricsWindow ? null : resolveRoomRouteId(pathname);
  const [awayRoomId, setAwayRoomId] = useState<string | null>(null);

  useEffect(() => {
    if (isCapacitorRuntime()) {
      void requestNotificationPermission();
    }
  }, []);

  useEffect(() => {
    if (isLyricsWindow) return;
    const syncAwayRoom = () => setAwayRoomId(readAwayRoomId());
    syncAwayRoom();
    window.addEventListener(awayRoomChangeEvent, syncAwayRoom);
    window.addEventListener("storage", syncAwayRoom);
    return () => {
      window.removeEventListener(awayRoomChangeEvent, syncAwayRoom);
      window.removeEventListener("storage", syncAwayRoom);
    };
  }, [isLyricsWindow]);

  const runtimeRoomId = isLyricsWindow ? null : (routeRoomId ?? awayRoomId);
  const { result: updateResult, isPromptOpen: isUpdatePromptOpen, dismissPrompt: dismissUpdatePrompt } = useAppUpdate({
    autoCheck: !isLyricsWindow
  });

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
      <UpdatePromptDialog
        onDismiss={dismissUpdatePrompt}
        open={isUpdatePromptOpen}
        result={updateResult}
      />
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
