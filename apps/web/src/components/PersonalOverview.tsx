"use client";

import type { AuthSession } from "@music-room/shared";
import type { ReactNode } from "react";

export function PersonalOverview({
  activeSession,
  headerAction
}: {
  activeSession: AuthSession;
  headerAction?: ReactNode;
}) {
  return (
    <section aria-labelledby="personal-overview-title" className="pb-7 sm:pb-8">
      <div className="flex min-w-0 items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          <div
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold text-white shadow-[0_8px_24px_var(--accent-glow)] sm:h-16 sm:w-16 sm:text-xl"
          >
            {getInitials(activeSession.nickname)}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-accent">Music Room 用户</p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-normal text-foreground" id="personal-overview-title">
              {activeSession.nickname}
            </h1>
            <p className="mt-1 truncate text-sm text-foreground-muted">@{activeSession.username}</p>
          </div>
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>

    </section>
  );
}

function getInitials(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "M";
  }
  const characters = Array.from(normalized);
  return characters.length > 1 ? `${characters[0]}${characters[characters.length - 1]}` : characters[0];
}
