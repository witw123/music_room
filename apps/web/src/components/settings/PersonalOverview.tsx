"use client";

import type { AuthSession } from "@music-room/shared";

export function PersonalOverview({
  activeSession
}: {
  activeSession: AuthSession;
}) {
  return (
    <section aria-labelledby="personal-overview-title" className="mb-6">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-surface/30 p-5 sm:p-6 shadow-sm backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 min-w-0">
          <div className="flex items-center gap-4 min-w-0">
            {/* Clean Avatar with online indicator */}
            <div className="relative shrink-0 flex items-center justify-center">
              <div
                aria-hidden="true"
                className="relative flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-surface-elevated text-lg sm:text-xl font-bold text-foreground border border-white/10 shadow-sm"
              >
                {getInitials(activeSession.nickname)}
                <span className="absolute bottom-1 right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#12141c]" />
              </div>
            </div>

            {/* User Metadata */}
            <div className="min-w-0 flex-1">
              <h1
                className="truncate text-xl sm:text-2xl font-bold text-foreground tracking-tight"
                id="personal-overview-title"
              >
                {activeSession.nickname}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                <span className="font-mono">@{activeSession.username}</span>
                <span className="text-white/20">·</span>
                <span className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[11px] font-medium text-foreground-muted">
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
