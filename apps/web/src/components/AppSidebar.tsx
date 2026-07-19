"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Route } from "next";
import type { AuthSession } from "@music-room/shared";
import {
  awayRoomChangeEvent,
  clearAwayRoomId,
  readAwayRoomId,
  storeAwayRoomId
} from "@/lib/away-room";

export type AppNavItemId = "home" | "search" | "playlists" | "profile";

type AppSidebarProps = {
  activeSession: AuthSession | null;
  activeItem?: AppNavItemId;
  hasBottomPlayer?: boolean;
  compactMobile?: boolean;
  keepHomeInRoom?: boolean;
  roomId?: string | null;
  onLogout?: () => void;
};

const navItems: Array<{ id: AppNavItemId; label: string; href: string; icon: IconName }> = [
  { id: "home", label: "首页", href: "/app", icon: "home" },
  { id: "search", label: "搜索", href: "/app/search", icon: "search" },
  { id: "playlists", label: "歌单", href: "/app/playlists", icon: "playlist" },
  { id: "profile", label: "个人中心", href: "/app/profile", icon: "profile" }
];

type IconName = "home" | "search" | "playlist" | "profile" | "logout";

export function AppSidebar({
  activeSession,
  activeItem,
  hasBottomPlayer = false,
  compactMobile = false,
  keepHomeInRoom = false,
  roomId = null,
  onLogout
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const currentItem = activeItem ?? resolveActiveItem(pathname);
  const [awayRoomId, setAwayRoomId] = useState<string | null>(null);
  const desktopBottomOffsetClass = hasBottomPlayer
    ? "md:bottom-[11.5rem] lg:bottom-[5.25rem]"
    : "md:bottom-0";

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

  function handleResumeAwayRoom() {
    if (!awayRoomId) return;
    clearAwayRoomId();
    setAwayRoomId(null);
    router.push(`/room/${awayRoomId}` as Route);
  }

  const showAwayRoomStatus = pathname?.startsWith("/app/") ?? false;

  return (
    <aside
      className={`relative z-40 mx-3 mb-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#070707]/95 text-foreground shadow-2xl backdrop-blur-2xl md:fixed md:top-0 md:left-0 md:right-auto md:mx-0 md:mb-0 md:w-60 md:rounded-none md:border-b-0 md:border-l-0 md:border-t-0 md:border-r ${desktopBottomOffsetClass}`}
      aria-label="主导航"
    >
      <div className={`flex items-center gap-3 border-b border-white/[0.07] md:flex-col md:items-stretch ${compactMobile ? "px-3 py-2.5" : "px-4 py-3"} md:px-4 md:py-5`}>
        <Link
          href="/app"
          className="flex min-w-0 items-center gap-3"
          aria-label="返回首页"
          onClick={(event) => {
            if (keepHomeInRoom) {
              event.preventDefault();
              return;
            }
            if (roomId) {
              storeAwayRoomId(roomId);
            }
          }}
        >
          <span className={`flex shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-[0_8px_30px_rgba(0,112,243,0.28)] ${compactMobile ? "h-8 w-8" : "h-9 w-9"} md:h-9 md:w-9`}>
            <NavIcon name="home" size={17} />
          </span>
          <span className="min-w-0 leading-none">
            <span className="block truncate text-sm font-bold tracking-tight text-white">Music Room</span>
            <span className="mt-1 block truncate text-[10px] text-white/[0.42]">实时协作听歌空间</span>
          </span>
        </Link>
        {onLogout ? (
          <span className="ml-auto md:hidden">
            <LogoutButton onLogout={onLogout} />
          </span>
        ) : null}
        <span className="ml-auto hidden text-[10px] font-bold uppercase tracking-[0.24em] text-white/[0.3] md:block md:pl-1 md:pt-7">
          Workspace
        </span>
      </div>

      <div className={`flex items-center md:flex-col md:items-stretch md:gap-5 md:p-4 ${compactMobile ? "gap-2 p-1.5" : "gap-3 p-2.5"}`}>
        <nav className="flex min-w-0 flex-1 items-center gap-1 md:flex-col md:items-stretch" aria-label="工作区">
          {navItems.map((item) => {
            const isActive = currentItem === item.id;
            const keepsHomeInRoom = keepHomeInRoom && item.id === "home";
            return (
              <Link
                key={item.id}
                href={item.href as Route}
                aria-current={isActive ? "page" : undefined}
                aria-disabled={keepsHomeInRoom || undefined}
                onClick={(event) => {
                  if (keepsHomeInRoom) {
                    event.preventDefault();
                    return;
                  }
                  if (roomId) {
                    storeAwayRoomId(roomId);
                  }
                }}
                className={`group flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl font-medium transition-[background-color,color,box-shadow] duration-200 sm:flex-row sm:gap-2 sm:px-2.5 sm:py-2.5 sm:text-xs md:flex-none md:justify-start md:gap-3 md:px-3 md:py-3 md:text-sm ${compactMobile ? "gap-0.5 px-0.5 py-1.5 text-[9px]" : "gap-1 px-1 py-2 text-[10px]"} ${
                  isActive
                    ? "bg-accent/15 text-white shadow-[inset_2px_0_0_#0070f3]"
                    : keepsHomeInRoom
                      ? "cursor-default text-white/[0.48]"
                      : "text-white/[0.48] hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <NavIcon name={item.icon} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {showAwayRoomStatus && awayRoomId ? (
          <div
            className="min-w-0 border-t border-amber-300/20 pt-3 md:mt-1"
            data-testid="away-room-sidebar-indicator"
          >
            <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2">
              <p className="truncate text-xs font-semibold text-amber-100">已暂离房间</p>
              <p className="mt-1 truncate text-[10px] text-amber-100/65">播放仍在同步</p>
              <button
                className="mt-2 w-full text-left text-xs font-medium text-amber-200 hover:text-amber-100"
                data-testid="resume-away-room"
                onClick={handleResumeAwayRoom}
                type="button"
              >
                返回房间
              </button>
            </div>
          </div>
        ) : null}

        {activeSession ? (
          <div className="hidden border-t border-white/[0.07] pt-4 md:block">
            <UserSummary activeSession={activeSession} onLogout={onLogout} />
          </div>
        ) : null}
      </div>

    </aside>
  );
}

function resolveActiveItem(pathname: string | null): AppNavItemId | null {
  if (pathname?.startsWith("/app/search")) {
    return "search";
  }
  if (pathname?.startsWith("/app/playlists")) {
    return "playlists";
  }
  if (pathname?.startsWith("/app/profile")) {
    return "profile";
  }
  if (pathname === "/app" || pathname === "/rooms") {
    return "home";
  }
  return null;
}

function UserSummary({
  activeSession,
  onLogout
}: {
  activeSession: AuthSession;
  onLogout?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-xs font-bold text-accent">
        {getInitial(activeSession.nickname)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-white/[0.82]">{activeSession.nickname}</p>
        <p className="truncate text-[10px] text-white/[0.35]">@{activeSession.username}</p>
      </div>
      {onLogout ? <LogoutButton onLogout={onLogout} /> : null}
    </div>
  );
}

function LogoutButton({ onLogout }: { onLogout: () => void }) {
  return (
    <button
      aria-label="退出登录"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/[0.35] transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onClick={onLogout}
      title="退出登录"
      type="button"
    >
      <NavIcon name="logout" size={16} />
    </button>
  );
}

function getInitial(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "M";
}

function NavIcon({ name, size = 18 }: { name: IconName; size?: number }) {
  const commonProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  if (name === "home") {
    return (
      <svg {...commonProps}>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9.5V21h14V9.5" />
        <path d="M9 21v-6h6v6" />
      </svg>
    );
  }

  if (name === "playlist") {
    return (
      <svg {...commonProps}>
        <path d="M4 5h11" />
        <path d="M4 10h11" />
        <path d="M4 15h7" />
        <path d="M16 15.5V6l5-1v9.5" />
        <circle cx="14" cy="18" r="2" />
        <circle cx="19" cy="16.5" r="2" />
      </svg>
    );
  }

  if (name === "search") {
    return (
      <svg {...commonProps}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
    );
  }

  if (name === "profile") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M21 3v18" />
    </svg>
  );
}
