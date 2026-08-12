"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { LocalPlaylistsOverview } from "@/components/LocalPlaylistsOverview";\nimport { PersonalOverview } from "@/components/PersonalOverview";\nimport { FavoriteAlbumsPage } from "@/components/FavoriteAlbumsPage";\nimport { SettingsPage } from "@/components/SettingsPage";

export function ProviderAccountsPage() {
  const router = useRouter();
  const redirectTo = "/app/profile";
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });

  useEffect(() => {
    if (hydrated && !activeSession) {
      router.replace(authEntryHref as Route);
    }
  }, [activeSession, authEntryHref, hydrated, router]);

  if (!hydrated || !activeSession) {
    return <div className="min-h-[100dvh] bg-background" />;
  }

  return (
    <main className="workspace-page relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <AppPageBackground />
      <div className="workspace-page__inner relative z-10 pt-\[calc\(1rem\+env\(safe-area-inset-top\)\)\] sm:pt-12 md:pt-20">\n        <div className="flex justify-end mb-6">\n          <Button\n            onClick={() => router.push("/app/profile#settings")}\n            variant="outline"\n            size="sm"\n            className="hidden md:flex items-center gap-2 text-sm"\n          >\n            设置\n          </Button>\n        </div>
        <PersonalOverview activeSession={activeSession} />
        <div className="mt-8">\n          <LocalPlaylistsOverview />\n        </div>\n        <div className="mt-8">\n          <FavoriteAlbumsPage />\n        </div>
      </div>
    </main>
  );
}

function AppPageBackground() {
  return (
    <div aria-hidden="true" className="workspace-page-background" />
  );
}





