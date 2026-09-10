"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
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
    <main className="profile-page workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="workspace-page__inner workspace-page__inner--wide relative z-10 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(var(--room-mobile-bottom-inset)+2.5rem)] sm:pt-8 md:pt-10 md:pb-28">
        <PersonalOverview activeSession={activeSession} />

        {/* Segmented Tab Navigation */}
        <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md mb-6 overflow-x-auto hide-scrollbar touch-pan-x max-w-full">
          {tabList.map(({ id, label, icon: IconComp }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-150 ${
                  isActive
                    ? "bg-white/[0.12] text-white font-semibold shadow-sm"
                    : "text-foreground-muted hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <IconComp className="w-3.5 h-3.5 shrink-0" />
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
          <div className="rounded-2xl border border-white/[0.08] bg-surface/30 p-5 sm:p-6 backdrop-blur-xl">
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
