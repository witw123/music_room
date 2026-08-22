"use client";

import type { AuthSession } from "@music-room/shared";
import type { ReactNode } from "react";
import { SparklesIcon, MusicIcon } from "@/components/icons/DiscoverIcons";

export function PersonalOverview({
  activeSession,
  headerAction,
  onOpenColdStart
}: {
  activeSession: AuthSession;
  headerAction?: ReactNode;
  onOpenColdStart?: () => void;
}) {
  return (
    <section aria-labelledby="personal-overview-title" className="mb-6">
      <div className="relative overflow-hidden rounded-3xl border border-surface-border bg-surface/45 p-5 sm:p-7 shadow-[var(--surface-shadow)] backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          {/* Avatar and User Metadata */}
          <div className="flex items-center gap-4 sm:gap-5 min-w-0">
            <div
              aria-hidden="true"
              className="flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-full bg-accent text-xl sm:text-2xl font-bold text-white shadow-[0_8px_24px_var(--accent-glow)] border border-white/20"
            >
              {getInitials(activeSession.nickname)}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-accent/10 text-accent border border-accent/20">
                  <MusicIcon className="w-3 h-3" />
                  <span>音乐探索者</span>
                </span>
              </div>
              <h1
                className="truncate text-xl sm:text-2xl md:text-3xl font-bold text-foreground tracking-tight"
                id="personal-overview-title"
              >
                {activeSession.nickname}
              </h1>
              <p className="mt-0.5 truncate text-xs sm:text-sm text-foreground-muted font-mono">
                @{activeSession.username}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
            {onOpenColdStart && (
              <button
                type="button"
                onClick={onOpenColdStart}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-surface hover:bg-surface-hover text-foreground-muted hover:text-foreground border border-surface-border transition-all"
              >
                <SparklesIcon className="w-3.5 h-3.5 text-accent" />
                <span>偏好微调</span>
              </button>
            )}
            {headerAction ? <div>{headerAction}</div> : null}
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
