"use client";

import Link from "next/link";
import type { Route } from "next";
import type { AuthSession } from "@music-room/shared";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";
import { Button } from "@/components/ui/button";

type TopBarProps = {
  activeSession?: AuthSession | null;
  onLogout?: () => void;
};

export function TopBar({ activeSession, onLogout }: TopBarProps) {
  const clientPlatform = getClientPlatformFromBrowser();
  const { activeSession: storedSession } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const session = activeSession === undefined ? storedSession : activeSession;
  const authEntryHref = buildWorkspaceAuthHref({ clientPlatform }) as Route;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-[#000000]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 min-w-0 items-center gap-3 md:h-16">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-accent shadow-[0_8px_30px_rgba(0,112,243,0.28)]">
            <div className="h-3 w-3 rounded-full border-2 border-white" />
          </div>
          <div className="min-w-0 leading-none">
            <span className="block truncate text-sm font-bold tracking-tight text-white">Music Room</span>
            <span className="hidden text-[11px] text-white/45 sm:block">实时协作听歌空间</span>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {session ? (
            onLogout ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onLogout}
                type="button"
                className="text-white/55 hover:bg-white/5 hover:text-white"
              >
                退出
              </Button>
            ) : null
          ) : (
            <Link href={authEntryHref}>
              <Button size="sm" className="border-0 bg-white/10 text-white hover:bg-white/20">
                登录 / 注册
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
