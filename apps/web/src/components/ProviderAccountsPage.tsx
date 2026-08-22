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
import { Button } from "@/components/ui/button";
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
    return <div className="min-h-[100dvh] bg-[#0a0a0c]" />;
  }

  return (
    <main className="workspace-page hide-scrollbar relative overflow-y-auto selection:bg-[#fa233b]/30 selection:text-white md:pl-60 lg:pb-28 bg-[#0a0a0c]">
      <div className="workspace-page__inner relative z-10 pt-[calc(1rem+env(safe-area-inset-top))] pb-12 sm:pt-10 md:pt-14">
        {/* Apple Music Profile Hero Card */}
        <PersonalOverview
          activeSession={activeSession}
          onOpenColdStart={() => setShowColdStartDialog(true)}
          headerAction={
            <Button
              aria-label="打开设置"
              className="h-10 w-10 rounded-2xl border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.1] text-neutral-300 hover:text-white"
              onClick={() => setActiveTab("settings")}
              size="icon"
              title="设置"
              type="button"
              variant="outline"
            >
              <SettingsIcon className="w-4 h-4" />
            </Button>
          }
        />

        {/* Apple Music Segmented Control Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-full bg-[#1c1c1e]/90 border border-white/[0.08] mb-6 overflow-x-auto scrollbar-none w-fit max-w-full">
          {tabList.map(({ id, label, icon: IconComp }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-white/[0.16] text-white shadow-sm"
                    : "text-neutral-400 hover:text-white hover:bg-white/[0.05]"
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
          <div className="rounded-2xl border border-white/[0.08] bg-[#1c1c1e]/80 p-5 sm:p-7 backdrop-blur-md">
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
