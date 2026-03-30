"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { GuestSession, RoomSnapshot } from "@music-room/shared";
import { getOnlineMemberCount } from "@/lib/music-room-ui";

type TopBarProps = {
  activeSession?: GuestSession | null;
  roomSnapshot?: RoomSnapshot | null;
};

const navItems = [
  { href: "/" as Route, label: "产品" },
  { href: "/rooms" as Route, label: "房间主页" },
  { href: "/rooms" as Route, label: "房间页", match: "/room/" }
];

export function TopBar({ activeSession = null, roomSnapshot = null }: TopBarProps) {
  const pathname = usePathname();

  return (
    <header className="site-nav">
      <div className="site-nav__inner">
        <Link href="/" className="site-nav__brand">
          <span className="site-nav__brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="site-nav__brand-copy">
            <strong>音乐房间</strong>
            <em>Local music, synced listening</em>
          </span>
        </Link>

        <nav className="site-nav__tabs" aria-label="站点导航">
          {navItems.map((item) => {
            const isActive = item.match
              ? pathname.startsWith(item.match)
              : pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`site-nav__tab${isActive ? " is-active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="site-nav__meta">
          {roomSnapshot ? (
            <div className="site-nav__room">
              <span className="site-nav__room-chip">房间码 {roomSnapshot.room.joinCode}</span>
              <span className="site-nav__room-chip subtle">
                {getOnlineMemberCount(roomSnapshot.room.members)} 人在线
              </span>
            </div>
          ) : null}

          {activeSession?.nickname ? (
            <span className="site-nav__identity">{activeSession.nickname}</span>
          ) : (
            <Link href={"/rooms" as Route} className="site-nav__cta">
              进入房间
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
