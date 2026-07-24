"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type MobileNavIconName = "home" | "discover" | "playlist" | "favorite" | "profile" | "settings";

type MobileNavItem = {
  id: "home" | "discover" | "playlists" | "favorites" | "profile" | "settings";
  label: string;
  href: Route;
  icon: MobileNavIconName;
};

const items: MobileNavItem[] = [
  { id: "home", label: "首页", href: "/app", icon: "home" },
  { id: "discover", label: "发现", href: "/app/discover" as Route, icon: "discover" },
  { id: "playlists", label: "歌单", href: "/app/playlists", icon: "playlist" },
  { id: "favorites", label: "收藏", href: "/app/favorites", icon: "favorite" },
  { id: "profile", label: "我的", href: "/app/profile", icon: "profile" },
  { id: "settings", label: "设置", href: "/app/settings", icon: "settings" }
];

export function MobileAppNavigation({ onNavigateAway }: { onNavigateAway?: () => void }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<Route | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <nav className="mobile-app-navigation fixed inset-x-0 bottom-0 z-[70] isolate h-[calc(4.5rem+env(safe-area-inset-bottom))] md:hidden" data-custom-layout-item="mobile-navigation" aria-label="主导航">
      <div className="grid h-full grid-cols-6 items-stretch px-1.5 pb-[env(safe-area-inset-bottom)] pt-1">
        {items.map((item) => {
          const active = pendingHref === item.href || isActivePath(pathname, item.href);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`mobile-app-navigation__item ${active ? "mobile-app-navigation__item--active" : ""}`}
              href={item.href}
              key={item.id}
              onClick={onNavigateAway}
              onPointerDown={() => setPendingHref(item.href)}
            >
              <MobileNavIcon name={item.icon} />
              <span className="mobile-app-navigation__label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function MobileNavIcon({ name }: { name: MobileNavIconName }) {
  const commonProps = {
    width: 20,
    height: 20,
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
      <svg {...commonProps} className="mobile-app-navigation__icon">
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9.5V21h14V9.5" />
        <path d="M9 21v-6h6v6" />
      </svg>
    );
  }

  if (name === "discover") {
    return (
      <svg {...commonProps} className="mobile-app-navigation__icon">
        <circle cx="12" cy="12" r="8.5" />
        <path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z" />
      </svg>
    );
  }

  if (name === "playlist") {
    return (
      <svg {...commonProps} className="mobile-app-navigation__icon">
        <path d="M4 5h11" />
        <path d="M4 10h11" />
        <path d="M4 15h7" />
        <path d="M16 15.5V6l5-1v9.5" />
        <circle cx="14" cy="18" r="2" />
        <circle cx="19" cy="16.5" r="2" />
      </svg>
    );
  }

  if (name === "favorite") {
    return (
      <svg {...commonProps} className="mobile-app-navigation__icon">
        <path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" />
      </svg>
    );
  }

  if (name === "profile") {
    return (
      <svg {...commonProps} className="mobile-app-navigation__icon">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </svg>
    );
  }

  return (
    <svg {...commonProps} className="mobile-app-navigation__icon">
      <path d="m12 3.5 1.3 1.8 2.2-.3.7 2 2 .7-.3 2.2 1.8 1.3-1.8 1.3.3 2.2-2 .7-.7 2-2.2-.3L12 21l-1.3-1.8-2.2.3-.7-2-2-.7.3-2.2L4.3 12l1.8-1.3-.3-2.2 2-.7.7-2 2.2.3L12 3.5Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function isActivePath(pathname: string | null, href: Route) {
  if (href === "/app") {
    return pathname === "/app" || pathname === "/rooms";
  }
  return pathname?.startsWith(href) ?? false;
}
