"use client";

import type { AuthSession } from "@music-room/shared";
import { MusicIcon, SparklesIcon } from "@/components/icons/DiscoverIcons";

export function PersonalOverview({
  activeSession
}: {
  activeSession: AuthSession;
}) {
  return (
    <section aria-labelledby="personal-overview-title" className="mb-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#12141c]/90 via-[#0d0f17]/95 to-[#090a0f] p-5 sm:p-7 shadow-[0_16px_36px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
        {/* Subtle Ambient Cosmic Glow in Background */}
        <div className="absolute -top-12 -right-12 w-64 h-64 rounded-full bg-[radial-gradient(circle,#0070f318_0%,#38bdf808_50%,transparent_70%)] blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 left-1/4 w-48 h-48 rounded-full bg-[radial-gradient(circle,#a855f714_0%,transparent_65%)] blur-xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 min-w-0">
          <div className="flex items-center gap-4 sm:gap-5 min-w-0">
            {/* Avatar with Acoustic Aura Rings */}
            <div className="relative shrink-0 flex items-center justify-center">
              {/* Outer Acoustic Pulse Ring */}
              <div className="absolute -inset-1.5 rounded-full border border-accent/25 animate-pulse opacity-75" />
              <div className="absolute -inset-3 rounded-full border border-accent/10" />

              {/* Main Avatar Core */}
              <div
                aria-hidden="true"
                className="relative flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#0051ba] via-accent to-[#38bdf8] text-xl sm:text-2xl font-bold text-white shadow-[0_8px_24px_var(--accent-glow)] border border-white/20"
              >
                {getInitials(activeSession.nickname)}
                {/* Online Status Beacon Indicator */}
                <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#0d0f17] shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              </div>
            </div>

            {/* User Metadata & Explorer Badge */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-accent/15 text-accent border border-accent/20">
                  <MusicIcon className="w-3 h-3" />
                  <span>音乐探索者</span>
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground-muted">
                  <SparklesIcon className="w-3 h-3 text-amber-400/80" />
                  <span>星系共鸣已就绪</span>
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

          {/* Quick Listening Atmosphere Chip */}
          <div className="hidden lg:flex flex-col items-end gap-1 shrink-0 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] backdrop-blur-md">
            <span className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wider">个人声学生态</span>
            <span className="text-xs font-medium text-foreground">实时同步云端画像 · 多源融合</span>
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
