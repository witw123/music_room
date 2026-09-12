"use client";

import type { AuthSession } from "@music-room/shared";

export function PersonalOverview({
  activeSession
}: {
  activeSession: AuthSession;
}) {
  return (
    <section aria-labelledby="personal-overview-title" className="mb-3.5 sm:mb-5">
      <div className="relative overflow-hidden rounded-xl border border-surface-border bg-surface/40 p-3 sm:p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* Clean Avatar with online indicator */}
            <div className="relative shrink-0 flex items-center justify-center">
              <div
                aria-hidden="true"
                className="relative flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-sm sm:text-base font-semibold text-foreground border border-surface-border shadow-sm"
              >
                {getInitials(activeSession.nickname)}
                <span className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-surface" />
              </div>
            </div>

            {/* User Metadata */}
            <div className="min-w-0 flex-1">
              <h1
                className="truncate text-base sm:text-lg font-semibold text-foreground tracking-tight"
                id="personal-overview-title"
              >
                {activeSession.nickname}
              </h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-foreground-muted">
                <span className="font-mono text-[11px]">@{activeSession.username}</span>
                <span className="text-foreground-muted/40">·</span>
                <span className="px-1.5 py-0.2 rounded bg-surface border border-surface-border text-[10px] font-medium text-foreground-muted">
                  在线
                </span>
              </div>
            </div>
          </div>
        </div>
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
