"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { PersonalOverview } from "./PersonalOverview";
import { ListeningProfileOverview } from "./ListeningProfileOverview";
import { RoomCenterOverview } from "@/components/room-home";
import { TasteExclusionsManager } from "@/components/discovery/TasteExclusionsManager";
import { TasteColdStartDialog } from "@/components/discovery/TasteColdStartDialog";
import { SettingsPage } from "./SettingsPage";
import {
  BarChartIcon,
  ShieldCheckIcon,
  RadioIcon,
  SettingsIcon
} from "@/components/icons/DiscoverIcons";

type ProfileTab = "taste" | "exclusions" | "rooms" | "settings";

const tabList: Array<{
  id: ProfileTab;
  label: string;
  mobileLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "taste", label: "听歌画像", mobileLabel: "听歌画像", icon: BarChartIcon },
  { id: "exclusions", label: "偏好与屏蔽", mobileLabel: "偏好屏蔽", icon: ShieldCheckIcon },
  { id: "rooms", label: "房间足迹", mobileLabel: "房间足迹", icon: RadioIcon },
  { id: "settings", label: "平台与设置", mobileLabel: "平台设置", icon: SettingsIcon }
];

export function ProviderAccountsPage() {
  const router = useRouter();
  const redirectTo = "/app/profile";
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo });
  const { activeSession, clearIdentity, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const [activeTab, setActiveTab] = useState<ProfileTab>("taste");
  const [showColdStartDialog, setShowColdStartDialog] = useState(false);

  async function handleLogout() {
    try {
      await musicRoomApi.logout();
    } catch {
      // Clear the local session even when the server cannot be reached.
    }
    clearIdentity();
    router.replace(authEntryHref as Route);
  }

  if (!hydrated) {
    return <div className="min-h-[100dvh] bg-background" />;
  }

  if (!activeSession) {
    return (
      <main className="profile-page workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
        <AppPageBackground />
        <div className="workspace-page__inner workspace-page__inner--wide relative z-10 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(var(--room-mobile-bottom-inset)+2rem)] sm:pt-6 md:pt-8 md:pb-24">
          <section className="mb-6 rounded-2xl border border-white/[0.08] bg-surface/40 p-6 backdrop-blur-xl text-center flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-foreground-muted mb-4">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <circle cx="12" cy="8" r="4" strokeWidth="1.8" />
                <path d="M4.5 21a7.5 7.5 0 0 1 15 0" strokeWidth="1.8" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-foreground mb-1">访客模式</h2>
            <p className="text-xs text-foreground-muted max-w-sm mb-5 leading-relaxed">
              登录账号后可同步音乐平台歌单、记录听歌画像并在房间中自由互动点歌。
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push(authEntryHref as Route)}
                className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                立即登录 / 注册
              </button>
              <button
                type="button"
                onClick={() => router.push("/app" as Route)}
                className="px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.05] hover:bg-white/[0.10] text-foreground-muted hover:text-foreground text-xs font-medium transition-all cursor-pointer"
              >
                返回房间大厅
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="profile-page workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="workspace-page__inner workspace-page__inner--wide relative z-10 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(var(--room-mobile-bottom-inset)+2rem)] sm:pt-6 md:pt-8 md:pb-24">
        <PersonalOverview activeSession={activeSession} onLogout={handleLogout} />

        {/* Ergonomic Responsive Segmented Tab Navigation */}
        <div className="grid grid-cols-4 sm:inline-flex items-center gap-1 p-1 rounded-xl border border-surface-border bg-surface/50 mb-4 sm:mb-5 w-full sm:w-auto">
          {tabList.map(({ id, label, mobileLabel, icon: IconComp }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex sm:inline-flex items-center justify-center gap-1 sm:gap-1.5 px-1 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap transition-all duration-150 ${
                  isActive
                    ? "bg-accent/15 text-accent font-semibold shadow-xs"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface-hover"
                }`}
              >
                <IconComp className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{mobileLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === "taste" && (
          <ListeningProfileOverview
            activeSession={activeSession}
            onOpenColdStart={() => setShowColdStartDialog(true)}
          />
        )}

        {activeTab === "exclusions" && (
          <TasteExclusionsManager
            onOpenColdStart={() => setShowColdStartDialog(true)}
          />
        )}

        {activeTab === "rooms" && (
          <RoomCenterOverview activeSession={activeSession} />
        )}

        {activeTab === "settings" && (
          <div className="rounded-xl border border-surface-border bg-surface/40 p-3.5 sm:p-5">
            <SettingsPage embedded onBack={() => setActiveTab("taste")} />
          </div>
        )}
      </div>

      {/* Taste Cold Start Dialog */}
      <TasteColdStartDialog
        isOpen={showColdStartDialog}
        onClose={() => setShowColdStartDialog(false)}
        onCompleted={() => {
          // Profile updates automatically via personalizationChangedEvent
        }}
      />
    </main>
  );
}

function AppPageBackground() {
  return <div aria-hidden="true" className="workspace-page-background" />;
}
