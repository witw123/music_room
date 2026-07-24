"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Route } from "next";
import type { AuthSession } from "@music-room/shared";
import { storeAwayRoomId } from "@/lib/away-room";
import {
  applyAppTheme,
  appSettingsChangeEvent,
  getAppSettings,
  resolveAppTheme,
  updateAppSettings,
  type ThemePreference
} from "@/features/settings/settings-store";

export type AppNavItemId = "home" | "discover" | "search" | "playlists" | "favorites" | "profile" | "settings";

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
  { id: "discover", label: "发现", href: "/app/discover", icon: "discover" },
  { id: "playlists", label: "歌单", href: "/app/playlists", icon: "playlist" },
  { id: "favorites", label: "收藏", href: "/app/favorites", icon: "favorite" },
  { id: "profile", label: "我的", href: "/app/profile", icon: "profile" },
  { id: "settings", label: "设置", href: "/app/settings", icon: "settings" }
];

type IconName =
  | "home"
  | "discover"
  | "search"
  | "playlist"
  | "favorite"
  | "profile"
  | "settings"
  | "sun"
  | "collapse"
  | "expand";

export function AppSidebar({
  activeSession,
  activeItem,
  hasBottomPlayer = false,
  compactMobile = false,
  keepHomeInRoom = false,
  roomId = null
}: AppSidebarProps) {
  const pathname = usePathname();
  const currentItem = activeItem ?? resolveActiveItem(pathname);
  const [collapsed, setCollapsed] = useState(true);
  const [themePreference, setThemePreference] = useState<ThemePreference>("dark");
  const desktopBottomOffsetClass = hasBottomPlayer
    ? "md:bottom-[11.5rem] lg:bottom-[4.5rem]"
    : "md:bottom-0";

  useEffect(() => {
    let themeMediaQuery: MediaQueryList | null = null;
    const syncTheme = () => {
      const preference = getAppSettings().theme;
      setThemePreference(preference);
      applyAppTheme(preference);
    };
    const syncSidebarState = () => {
      const settings = getAppSettings();
      setCollapsed(settings.layout.sidebarCollapsed);
      setThemePreference(settings.theme);
      // Keep the shared content offset aligned with the persisted setting. The
      // sidebar can briefly coexist with another route's instance during a
      // client transition, so it must not publish its own initial state here.
      document.documentElement.dataset.sidebarCollapsed = String(settings.layout.sidebarCollapsed);
      document.documentElement.dataset.reduceMotion = String(settings.layout.reduceMotion);
      applyAppTheme(settings.theme);
      themeMediaQuery?.removeEventListener("change", syncTheme);
      themeMediaQuery = null;
      if (settings.theme === "system" && typeof window.matchMedia === "function") {
        themeMediaQuery = window.matchMedia("(prefers-color-scheme: light)");
        themeMediaQuery.addEventListener("change", syncTheme);
      }
    };
    syncSidebarState();
    window.addEventListener(appSettingsChangeEvent, syncSidebarState);
    window.addEventListener("storage", syncSidebarState);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, syncSidebarState);
      window.removeEventListener("storage", syncSidebarState);
      themeMediaQuery?.removeEventListener("change", syncTheme);
    };
  }, []);

  function handleThemeToggle() {
    const resolvedTheme = resolveAppTheme(themePreference);
    const nextTheme = resolvedTheme === "light" ? "dark" : "light";
    startThemeTransition(nextTheme);
  }

  const themeActionLabel = resolveAppTheme(themePreference) === "light" ? "深色模式" : "浅色模式";
  const footerControlSizeClass = collapsed
    ? "h-10 w-10 shrink-0 rounded-lg px-0"
    : "w-full rounded-xl px-3 py-3 text-sm";

  return (
    <aside
      className={`app-sidebar relative z-40 mx-3 mb-3 overflow-hidden rounded-2xl border border-[var(--sidebar-border)] bg-[var(--sidebar-background)] pt-[env(safe-area-inset-top)] text-foreground shadow-2xl backdrop-blur-2xl md:flex md:flex-col md:fixed md:top-0 md:left-0 md:right-auto md:mx-0 md:mb-0 md:rounded-none md:border-b-0 md:border-l-0 md:border-t-0 md:border-r md:pt-0 ${desktopBottomOffsetClass}`}
      data-custom-layout-item="sidebar"
      aria-label="主导航"
    >
      <div className={`flex items-center gap-3 border-b border-[var(--sidebar-divider)] md:flex-col md:items-stretch ${compactMobile ? "px-3 py-2.5" : "px-4 py-3"} md:px-2 md:py-3`}>
        <Link
          href="/app"
          className={`flex min-w-0 items-center gap-3 ${collapsed ? "md:justify-center" : ""}`}
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
          <span className={`flex shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-[0_8px_30px_var(--accent-glow)] ${compactMobile ? "h-8 w-8" : "h-9 w-9"} md:h-9 md:w-9`}>
            <NavIcon name="home" size={17} />
          </span>
          <span className={`min-w-0 leading-none ${collapsed ? "md:hidden" : ""}`}>
            <span className="block truncate text-sm font-bold text-[var(--sidebar-foreground)]">Music Room</span>
            <span className="mt-1 block truncate text-[10px] text-[var(--sidebar-secondary)]">实时协作听歌空间</span>
          </span>
        </Link>
      </div>

      <div className={`flex min-h-0 flex-1 items-center md:flex-col md:items-stretch md:gap-3 md:p-2 ${compactMobile ? "gap-2 p-1.5" : "gap-3 p-2.5"}`}>
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 md:min-h-0 md:flex-col md:items-stretch md:overflow-y-auto" aria-label="工作区">
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
                title={collapsed ? item.label : undefined}
                className={`app-sidebar__nav-item group flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-lg font-medium transition-[background-color,color,box-shadow] duration-200 sm:flex-row sm:gap-2 sm:px-2.5 sm:py-2.5 sm:text-xs md:flex-none md:justify-start md:gap-3 md:px-3 md:py-3 md:text-sm ${compactMobile ? "gap-0.5 px-0.5 py-1.5 text-[9px]" : "gap-1 px-1 py-2 text-[10px]"} ${
                  isActive
                    ? "app-sidebar__nav-item--active"
                    : keepsHomeInRoom
                      ? "cursor-default opacity-60"
                      : ""
                } ${collapsed ? "md:justify-center md:px-2" : ""}`}
              >
                <NavIcon name={item.icon} />
                <span className={`truncate ${collapsed ? "md:hidden" : ""}`}>{item.label}</span>
              </Link>
            );
          })}

        </nav>

        {activeSession && !collapsed ? (
          <div className={`hidden border-t border-[var(--sidebar-divider)] pt-4 md:block ${collapsed ? "md:px-0" : ""}`}>
            <UserSummary activeSession={activeSession} />
          </div>
        ) : null}

        <div className={`app-sidebar__footer hidden flex-col border-t md:flex ${collapsed ? "md:items-center md:gap-3 md:px-0 md:pb-1 md:pt-4" : "md:items-stretch md:gap-1 md:px-0 md:pb-1 md:pt-3"}`}>
          <button
            aria-label={`切换到${themeActionLabel}`}
            className={`app-sidebar__footer-control app-sidebar__theme group flex min-w-0 items-center justify-center gap-3 font-medium transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${footerControlSizeClass}`}
            onClick={handleThemeToggle}
            title={themeActionLabel}
            type="button"
          >
            <NavIcon name="sun" size={19} />
            <span className={collapsed ? "md:hidden" : "truncate"}>{themeActionLabel}</span>
          </button>
          <button
            aria-label={collapsed ? "展开侧边栏" : "收纳侧边栏"}
            aria-expanded={!collapsed}
            className={`app-sidebar__footer-control group flex min-w-0 items-center justify-center gap-3 font-medium transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${footerControlSizeClass} ${collapsed ? "md:justify-center" : "md:justify-start"}`}
            onClick={() => updateAppSettings({ layout: { sidebarCollapsed: !collapsed } })}
            title={collapsed ? "展开侧边栏" : "收纳侧边栏"}
            type="button"
          >
            <NavIcon name={collapsed ? "expand" : "collapse"} size={20} />
            <span className={collapsed ? "md:hidden" : "truncate"}>收起</span>
          </button>
        </div>
      </div>

    </aside>
  );
}

function startThemeTransition(nextTheme: ThemePreference) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const reduceMotion = root.dataset.reduceMotion === "true" || (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const toggle = document.querySelector<HTMLButtonElement>(".app-sidebar__theme");
  const toggleRect = toggle?.getBoundingClientRect();

  if (!reduceMotion) {
    const originX = toggleRect ? toggleRect.left + toggleRect.width / 2 : window.innerWidth / 2;
    const originY = toggleRect ? toggleRect.top + toggleRect.height / 2 : window.innerHeight / 2;
    root.style.setProperty("--theme-transition-x", `${originX}px`);
    root.style.setProperty("--theme-transition-y", `${originY}px`);
  }

  const viewTransitionDocument = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  };

  if (!reduceMotion && typeof viewTransitionDocument.startViewTransition === "function") {
    const transition = viewTransitionDocument.startViewTransition(() => {
      applyAppTheme(nextTheme);
      updateAppSettings({ theme: nextTheme });
    });
    void transition.finished.finally(() => clearThemeTransitionStyles(root));
    return;
  }

  if (!reduceMotion) root.classList.add("theme-transitioning");
  updateAppSettings({ theme: nextTheme });
  if (!reduceMotion) {
    window.setTimeout(() => clearThemeTransitionStyles(root), 360);
  }
}

function clearThemeTransitionStyles(root: HTMLElement) {
  root.classList.remove("theme-transitioning");
  root.style.removeProperty("--theme-transition-x");
  root.style.removeProperty("--theme-transition-y");
}

function resolveActiveItem(pathname: string | null): AppNavItemId | null {
  if (pathname?.startsWith("/app/discover")) {
    return "discover";
  }
  if (pathname?.startsWith("/app/search")) {
    return "discover";
  }
  if (pathname?.startsWith("/app/playlists")) {
    return "playlists";
  }
  if (pathname?.startsWith("/app/favorites")) {
    return "favorites";
  }
  if (pathname?.startsWith("/app/profile")) {
    return "profile";
  }
  if (pathname?.startsWith("/app/settings")) {
    return "settings";
  }
  if (pathname === "/app" || pathname === "/rooms") {
    return "home";
  }
  return null;
}

function UserSummary({ activeSession }: { activeSession: AuthSession }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-xs font-bold text-accent">
        {getInitial(activeSession.nickname)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-[var(--sidebar-foreground)]">{activeSession.nickname}</p>
        <p className="truncate text-[10px] text-[var(--sidebar-secondary)]">@{activeSession.username}</p>
      </div>
    </div>
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

  if (name === "discover") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z" />
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

  if (name === "favorite") {
    return (
      <svg {...commonProps}>
        <path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg {...commonProps}>
        <path d="m12 3.5 1.3 1.8 2.2-.3.7 2 2 .7-.3 2.2 1.8 1.3-1.8 1.3.3 2.2-2 .7-.7 2-2.2-.3L12 21l-1.3-1.8-2.2.3-.7-2-2-.7.3-2.2L4.3 12l1.8-1.3-.3-2.2 2-.7.7-2 2.2.3L12 3.5Z" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    );
  }

  if (name === "collapse") {
    return (
      <svg {...commonProps}>
        <path d="m13 6-6 6 6 6" />
        <path d="m19 6-6 6 6 6" />
      </svg>
    );
  }

  if (name === "expand") {
    return (
      <svg {...commonProps}>
        <path d="m11 6 6 6-6 6" />
        <path d="m5 6 6 6-6 6" />
      </svg>
    );
  }

  if (name === "sun") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" />
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
