"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { AuthSession, RoomSnapshot } from "@music-room/shared";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { getOnlineMemberCount } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

type TopBarProps = {
  activeSession?: AuthSession | null;
  roomSnapshot?: RoomSnapshot | null;
  onLogout?: () => void;
};

const navItems = [
  { key: "home", href: "/" as Route, label: "主页" },
  { key: "rooms", href: "/rooms" as Route, label: "音乐房", match: "/room/" }
];

export function TopBar({ activeSession, roomSnapshot = null, onLogout }: TopBarProps) {
  const pathname = usePathname();
  const { activeSession: storedSession } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const session = activeSession === undefined ? storedSession : activeSession;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-[#000000]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href={"/" as Route} className="flex items-center gap-3 transition-opacity hover:opacity-80">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent">
            <div className="h-3 w-3 rounded-full border-2 border-white" />
          </div>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-sm font-bold tracking-tight text-white">Music Room</span>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-1" aria-label="站点导航">
          {navItems.map((item) => {
            const isActive = item.match
              ? pathname.startsWith(item.match) || pathname === item.href
              : pathname === item.href;

            return (
              <Link
                key={item.key}
                href={item.href}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  isActive 
                    ? "text-white" 
                    : "text-white/50 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {!roomSnapshot && session ? (
            <div className="flex items-center gap-3 pl-4 border-l border-white/10">
              <span className="text-sm font-medium text-white">{session.nickname}</span>
              <Link href={"/rooms" as Route} className="text-sm text-white/50 hover:text-white transition-colors mr-1">
                工作台
              </Link>
              {onLogout ? (
                <Button variant="ghost" size="sm" onClick={onLogout} type="button" className="text-white/50 hover:text-white hover:bg-white/5">
                  退出
                </Button>
              ) : null}
            </div>
          ) : !roomSnapshot && !session ? (
            <Link href={"/auth?redirectTo=/rooms" as Route}>
              <Button size="sm" className="bg-white/10 text-white hover:bg-white/20 border-0">登录</Button>
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
