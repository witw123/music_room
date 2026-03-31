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
  { key: "rooms", href: "/rooms" as Route, label: "音乐室", match: "/room/" }
];

export function TopBar({ activeSession, roomSnapshot = null, onLogout }: TopBarProps) {
  const pathname = usePathname();
  const { activeSession: storedSession } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const session = activeSession === undefined ? storedSession : activeSession;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-[#000000]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] flex-col px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between md:h-16">
          <Link href={"/" as Route} className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-80">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-accent shadow-[0_8px_30px_rgba(0,112,243,0.28)]">
              <div className="h-3 w-3 rounded-full border-2 border-white" />
            </div>
            <div className="min-w-0 leading-none">
              <span className="block truncate text-sm font-bold tracking-tight text-white">Music Room</span>
              <span className="hidden text-[11px] text-white/45 sm:block">实时协作听歌空间</span>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="站点导航">
            {navItems.map((item) => {
              const isActive = item.match
                ? pathname.startsWith(item.match) || pathname === item.href
                : pathname === item.href;

              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    isActive ? "bg-white/8 text-white" : "text-white/50 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {roomSnapshot ? (
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/65">
                <span>{getOnlineMemberCount(roomSnapshot.room.members)} 人在线</span>
                <span className="text-white/20">·</span>
                <span>{roomSnapshot.room.visibility === "public" ? "公开房间" : "私密房间"}</span>
              </div>
            ) : session ? (
              <>
                <div className="hidden items-center gap-2 border-l border-white/10 pl-4 sm:flex">
                  <span className="max-w-[120px] truncate text-sm font-medium text-white">
                    {session.nickname}
                  </span>
                </div>
                <Link href={"/rooms" as Route} className="hidden sm:block">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-white/70 hover:bg-white/5 hover:text-white"
                  >
                    进入音乐室
                  </Button>
                </Link>
                {onLogout ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onLogout}
                    type="button"
                    className="text-white/55 hover:bg-white/5 hover:text-white"
                  >
                    退出
                  </Button>
                ) : null}
              </>
            ) : (
              <Link href={"/auth?redirectTo=/rooms" as Route}>
                <Button size="sm" className="border-0 bg-white/10 text-white hover:bg-white/20">
                  登录 / 注册
                </Button>
              </Link>
            )}
          </div>
        </div>

        <nav className="-mx-1 flex items-center gap-2 overflow-x-auto pb-3 md:hidden" aria-label="移动端导航">
          {navItems.map((item) => {
            const isActive = item.match
              ? pathname.startsWith(item.match) || pathname === item.href
              : pathname === item.href;

            return (
              <Link
                key={item.key}
                href={item.href}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "border-accent/40 bg-accent/15 text-white"
                    : "border-white/10 bg-white/5 text-white/55"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          {session && !roomSnapshot ? (
            <span className="ml-auto shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60">
              {session.nickname}
            </span>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
