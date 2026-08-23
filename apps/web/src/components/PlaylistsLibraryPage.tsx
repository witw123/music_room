"use client";

import { useState } from "react";
import { FavoriteAlbumsPage } from "@/components/FavoriteAlbumsPage";
import { PlaylistsWorkspacePage } from "@/components/PlaylistsWorkspacePage";
import { MusicIcon, RadioIcon, HeartIcon } from "@/components/icons/DiscoverIcons";

type PlaylistLibraryTab = "local" | "network" | "favorites";

const tabs: Array<{ id: PlaylistLibraryTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "local", label: "本地歌单", icon: MusicIcon },
  { id: "network", label: "网络歌单", icon: RadioIcon },
  { id: "favorites", label: "我的收藏", icon: HeartIcon }
];

export function PlaylistsLibraryPage() {
  const [activeTab, setActiveTab] = useState<PlaylistLibraryTab>("local");

  return (
    <main className="workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <div aria-hidden="true" className="workspace-page-background" />
      <div className="workspace-page__inner relative z-10 pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-6 md:pt-10">
        {/* Artistic Segmented Control Navigation */}
        <header className="flex justify-center mb-6">
          <div
            aria-label="歌单分类"
            className="flex items-center gap-1 rounded-2xl border border-white/[0.06] p-1.5 bg-[#10121a]/80 backdrop-blur-2xl shadow-lg"
            role="tablist"
          >
            {tabs.map(({ id, label, icon: IconComp }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  aria-selected={isActive}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-150 ${
                    isActive
                      ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)] font-semibold scale-[1.02]"
                      : "text-foreground-muted hover:text-white hover:bg-white/[0.06]"
                  }`}
                  onClick={() => setActiveTab(id)}
                  role="tab"
                  type="button"
                >
                  <IconComp className="w-4 h-4" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </header>

        {activeTab === "local" ? <PlaylistsWorkspacePage embedded playlistView="local" /> : null}
        {activeTab === "network" ? <PlaylistsWorkspacePage embedded playlistView="network" /> : null}
        {activeTab === "favorites" ? <FavoriteAlbumsPage embedded fixedHeight={false} showTitle={false} /> : null}
      </div>
    </main>
  );
}
