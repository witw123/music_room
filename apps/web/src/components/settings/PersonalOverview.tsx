"use client";

import type { AuthSession } from "@music-room/shared";

export function PersonalOverview({
  activeSession,
  onLogout
}: {
  activeSession: AuthSession;
  onLogout?: () => void;
}) {
  return (
    <section aria-labelledby="personal-overview-title" className="mb-3.5 sm:mb-5">
      <div className="relative overflow-hidden rounded-xl border border-surface-border bg-surface/40 p-3 sm:p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2.5 sm:gap-4 min-w-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 overflow-hidden">
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
            <div className="min-w-0 flex-1 overflow-hidden">
              <h1
                className="truncate text-base sm:text-lg font-semibold text-foreground tracking-tight"
                id="personal-overview-title"
                title={activeSession.nickname}
              >
                {activeSession.nickname}
              </h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-foreground-muted">
                <span className="font-mono text-[11px] truncate max-w-[130px] sm:max-w-none" title={`@${activeSession.username}`}>
                  @{activeSession.username}
                </span>
                <span className="text-foreground-muted/40">·</span>
                <span className="px-1.5 py-0.2 rounded bg-surface border border-surface-border text-[10px] font-medium text-foreground-muted shrink-0">
                  在线
                </span>
              </div>
            </div>
          </div>

          {/* Logout button placed on the right of avatar/user info */}
          {onLogout ? (
            <button
              aria-label="退出登录"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground-muted hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 transition-all active:scale-95 cursor-pointer"
              data-testid="profile-logout-button"
              onClick={onLogout}
              title="退出登录"
              type="button"
            >
              <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" height="14" viewBox="0 0 24 24" width="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>退出</span>
            </button>
          ) : null}
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
