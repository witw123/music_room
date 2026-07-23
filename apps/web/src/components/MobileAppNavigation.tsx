"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type MobileNavItem = {
  id: "home" | "discover" | "search" | "playlists" | "favorites" | "profile";
  label: string;
  href: Route;
};

const items: MobileNavItem[] = [
  { id: "home", label: "首页", href: "/app" },
  { id: "discover", label: "发现", href: "/app/discover" as Route },
  { id: "search", label: "搜索", href: "/app/search" },
  { id: "playlists", label: "歌单", href: "/app/playlists" },
  { id: "favorites", label: "收藏", href: "/app/favorites" },
  { id: "profile", label: "我的", href: "/app/profile" }
];

export function MobileAppNavigation({ onNavigateAway }: { onNavigateAway?: () => void }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<Route | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <nav className="mobile-app-navigation fixed inset-x-0 bottom-0 z-[55] h-[calc(4.5rem+env(safe-area-inset-bottom))] md:hidden" aria-label="主导航">
      <div className="grid h-full grid-cols-6 items-start px-2 pb-[env(safe-area-inset-bottom)] pt-1">
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
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function isActivePath(pathname: string | null, href: Route) {
  if (href === "/app") {
    return pathname === "/app" || pathname === "/rooms";
  }
  return pathname?.startsWith(href) ?? false;
}
