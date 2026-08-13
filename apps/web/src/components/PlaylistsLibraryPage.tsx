"use client";

import { useState } from "react";
import { FavoriteAlbumsPage } from "@/components/FavoriteAlbumsPage";
import { PlaylistsWorkspacePage } from "@/components/PlaylistsWorkspacePage";

type PlaylistLibraryTab = "local" | "network" | "favorites";

const tabs: Array<{ id: PlaylistLibraryTab; label: string }> = [
  { id: "local", label: "本地歌单" },
  { id: "network", label: "网络歌单" },
  { id: "favorites", label: "我的收藏" }
];

export function PlaylistsLibraryPage() {
  const [activeTab, setActiveTab] = useState<PlaylistLibraryTab>("local");

  return (
    <main className="workspace-page hide-scrollbar relative overflow-y-auto selection:bg-accent/30 selection:text-white md:pl-60 lg:pb-28">
      <div aria-hidden="true" className="workspace-page-background" />
      <div className="workspace-page__inner relative z-10 pt-[calc(2.5rem+env(safe-area-inset-top))] sm:pt-12 md:pt-20">
        <header className="flex justify-center">
          <div aria-label="歌单分类" className="workspace-segmented" role="tablist">
            {tabs.map((tab) => (
              <button
                aria-selected={activeTab === tab.id}
                className="workspace-segmented__item"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        {activeTab === "local" ? <PlaylistsWorkspacePage embedded playlistView="local" /> : null}
        {activeTab === "network" ? <PlaylistsWorkspacePage embedded playlistView="network" /> : null}
        {activeTab === "favorites" ? <FavoriteAlbumsPage embedded fixedHeight={false} showTitle={false} /> : null}
      </div>
    </main>
  );
}
