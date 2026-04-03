"use client";

import { memo, useState } from "react";
import type { AuthSession } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { clearMusicRoomLocalCache } from "@/lib/local-cache";

type TopBarProps = {
  activeSession: AuthSession | null;
  onLogout?: () => void;
};

function TopBarBase({ activeSession, onLogout }: TopBarProps) {
  const [isClearingCache, setIsClearingCache] = useState(false);

  async function handleClearLocalCache() {
    if (isClearingCache) {
      return;
    }

    setIsClearingCache(true);

    try {
      await clearMusicRoomLocalCache();
    } finally {
      window.location.reload();
    }
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-[#000000]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
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
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearLocalCache}
            type="button"
            disabled={isClearingCache}
            className="px-2 text-white/55 hover:bg-white/5 hover:text-white sm:px-3"
          >
            <span className="sm:hidden">{isClearingCache ? "清理中..." : "清缓存"}</span>
            <span className="hidden sm:inline">
              {isClearingCache ? "清理中..." : "清除本地缓存"}
            </span>
          </Button>

          {activeSession && onLogout ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onLogout}
              type="button"
              className="px-2 text-white/55 hover:bg-white/5 hover:text-white sm:px-3"
            >
              退出
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export const TopBar = memo(TopBarBase);
