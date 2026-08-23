"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { PersonalOverview } from "@/components/PersonalOverview";
import { ListeningProfileOverview } from "@/components/ListeningProfileOverview";
import { RoomCenterOverview } from "@/components/RoomCenterOverview";
import { TasteExclusionsManager } from "@/components/discovery/TasteExclusionsManager";
import { TasteColdStartDialog } from "@/components/discovery/TasteColdStartDialog";
import { SettingsPage } from "@/components/SettingsPage";
import {
  BarChartIcon,
  ShieldCheckIcon,
  RadioIcon,
  SettingsIcon
} from "@/components/icons/DiscoverIcons";

type ProfileTab = "taste" | "exclusions" | "rooms" | "settings";

const tabList: Array<{ id: ProfileTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "taste", label: "听歌画像", icon: BarChartIcon },
  { id: "exclusions", label: "偏好与屏蔽", icon: ShieldCheckIcon },
  { id: "rooms", label: "房间足迹", icon: RadioIcon },
  { id: "settings", label: "平台与设置", icon: SettingsIcon }
];

export function ProviderAccountsPage() {
  const router = useRouter();
  const redirectTo = "/app/profile";
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const [activeTab, setActiveTab] = useState<ProfileTab>("taste");
  const [showColdStartDialog, setShowColdStartDialog] = useState(false);

  useEffect(() => {
    if (hydrated && !activeSession) {
      router.replace(authEntryHref as Route);
    }
  }, [activeSession, authEntryHref, hydrated, router]);

  if (!hydrated || !activeSession) {
    return <div className="min-h-[100dvh] bg-background" />;
  }

  return (
    <main className="workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="workspace-page__inner relative z-10 pt-[calc(1rem+env(safe-area-inset-top))] pb-12 sm:pt-8 md:pt-12">
        {/* Borderless Profile Hero Card */}
        <PersonalOverview activeSession={activeSession} />

        {/* Borderless Segmented Control Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-surface/35 backdrop-blur-xl mb-6 overflow-x-auto scrollbar-none w-fit max-w-full">
          {tabList.map(({ id, label, icon: IconComp }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)] font-semibold"
                    : "text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
                }`}
              >
                <IconComp className="w-3.5 h-3.5" />
                <span>{label}</span>
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
          <div className="bg-surface/35 p-5 sm:p-7 rounded-3xl backdrop-blur-xl">
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
