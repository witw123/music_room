"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LocalPlayerProvider } from "@/features/playback/local-player-context";
import { MusicRoomApp } from "@/components/music-room-app";
import { awayRoomChangeEvent, readAwayRoomId } from "@/lib/domain/away-room";
import { DesktopLyricsOverlay } from "@/components/desktop-lyrics";
import { DesktopLyricsProvider } from "@/features/playback/desktop-lyrics-context";
import { ShellBackButton } from "./ShellBackButton";

import { isCapacitorRuntime } from "@/lib/desktop/tauri";
import { requestNotificationPermission } from "@/features/playback/system-notifications";
import { useAppUpdate } from "@/features/update/use-app-update";
import { UpdatePromptDialog } from "@/components/update/UpdatePromptDialog";
import { AppPersistentPlayer } from "@/components/bottom-player/AppPersistentPlayer";
import { resolvePlaybackOwnership } from "@/features/playback/playback-ownership";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { WorkspaceQueryProvider } from "@/features/workspace/workspace-query-provider";

export function PersistentRoomRuntime({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLyricsWindow =
    pathname === "/desktop-lyrics" ||
    (typeof window !== "undefined" && window.location.search.includes("window=desktop-lyrics"));
  const [awayRoomId, setAwayRoomId] = useState<string | null>(null);
  const { activeSession } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });

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

  const { owner, routeRoomId, runtimeRoomId } = resolvePlaybackOwnership(
    pathname, awayRoomId, isLyricsWindow
  );
  const { result: updateResult, isPromptOpen: isUpdatePromptOpen, dismissPrompt: dismissUpdatePrompt } = useAppUpdate({
    autoCheck: !isLyricsWindow
  });

  return (
    <DesktopLyricsProvider activeSource={owner}>
      <WorkspaceQueryProvider key={activeSession?.userId ?? "anonymous"}>
        <LocalPlayerProvider active={owner === "local"}>
          {children}
          {owner === "local" ? <AppPersistentPlayer /> : null}
          {runtimeRoomId ? (
            <MusicRoomApp
              backgroundOnly={!routeRoomId}
              initialRoomId={runtimeRoomId}
              workspaceOnly
            />
          ) : null}
        </LocalPlayerProvider>
      </WorkspaceQueryProvider>
      <DesktopLyricsOverlay />
      <ShellBackButton />
      <UpdatePromptDialog
        onDismiss={dismissUpdatePrompt}
        open={isUpdatePromptOpen}
        result={updateResult}
      />
    </DesktopLyricsProvider>
  );
}
