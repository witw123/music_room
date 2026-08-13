"use client";

import { memo, useState } from "react";
import type {
  AuthSession,
  NeteaseTrackCandidate,
  Playlist,
  QqMusicTrackCandidate,
  TrackMeta
} from "@music-room/shared";
import type { CachedLibraryTrack } from "@/features/library/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import { PlaylistPanel } from "./PlaylistPanel";
import { LocalPlaylistPanel } from "./LocalPlaylistPanel";
import { FavoriteAlbumsPanel } from "./FavoriteAlbumsPanel";
import { RoomProviderTrackSearch } from "./RoomProviderTrackSearch";

type LocalStorageTabPanelProps = {
  tracks: TrackMeta[];
  playlists: Playlist[];
  activeSession: AuthSession | null;
  canManageLibrary: boolean;
  localStorageSummary: LocalStorageSummary;
  onCleanLocalStorage: () => Promise<void>;
  onRefreshLocalStorage: () => Promise<void>;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onImportNeteaseTracks: (tracks: NeteaseTrackCandidate[]) => Promise<void>;
  onImportQqMusicTracks: (tracks: QqMusicTrackCandidate[]) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onUpdatePlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
};

function LocalStorageTabPanelBase({
  tracks,
  playlists,
  activeSession,
  canManageLibrary,
  localStorageSummary,
  onImportCachedTrack,
  onSavePlaylistFromQueue,
  onLoadPlaylistIntoRoom,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onImportNeteaseTracks,
  onImportQqMusicTracks,
  onUpdatePlaylistTitle,
  onUpdatePlaylistTracks,
  onDeletePlaylist
}: LocalStorageTabPanelProps) {
  const [pendingCachedImport, setPendingCachedImport] = useState<string | null>(null);
  const [playlistTab, setPlaylistTab] = useState<"local" | "network" | "favorites">("local");

  const handleImportCachedTrack = async (track: CachedLibraryTrack) => {
    if (pendingCachedImport || !canManageLibrary) return;
    setPendingCachedImport(track.fileHash);
    try {
      await onImportCachedTrack(track);
    } finally {
      setPendingCachedImport(null);
    }
  };

  return (
    <div className="animate-fade-in flex w-full flex-col gap-5">
      <div className="flex w-full max-w-xl gap-1 rounded-xl border border-surface-border bg-surface/40 p-1" role="tablist" aria-label="歌单类型">
        <button
          aria-selected={playlistTab === "local"}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${playlistTab === "local" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
          onClick={() => setPlaylistTab("local")}
          role="tab"
          type="button"
        >
          本地歌单
        </button>
        <button
          aria-selected={playlistTab === "network"}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${playlistTab === "network" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
          onClick={() => setPlaylistTab("network")}
          role="tab"
          type="button"
        >
          网络歌单
        </button>
        <button
          aria-selected={playlistTab === "favorites"}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${playlistTab === "favorites" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
          onClick={() => setPlaylistTab("favorites")}
          role="tab"
          type="button"
        >
          我的收藏
        </button>
      </div>
      {playlistTab === "local" ? <section className="flex flex-col gap-3" data-testid="local-playlist-section">
      <LocalPlaylistPanel
          canManageLibrary={canManageLibrary}
          localPlaylists={localStorageSummary.localPlaylists}
          localTracks={localStorageSummary.localPlaylistTracks}
          roomTracks={tracks}
          localFolderName={localStorageSummary.localFolderName}
          onImportCachedTrack={handleImportCachedTrack}
          pendingCachedImport={pendingCachedImport}
        />
      </section> : null}
      {playlistTab === "network" ? <section className="flex flex-col gap-3" data-testid="network-playlist-section">
        <RoomProviderTrackSearch
          roomTracks={tracks}
          mode="import"
          canManageLibrary={canManageLibrary}
          onImportNeteaseTrack={onImportNeteaseTrack}
          onImportQqMusicTrack={onImportQqMusicTrack}
          testId="network-playlist-search"
        />
        <PlaylistPanel
          activeSession={activeSession}
          canManageLibrary={canManageLibrary}
          canCreatePlaylist={!!activeSession}
          onDeletePlaylist={onDeletePlaylist}
          onLoadPlaylistIntoRoom={onLoadPlaylistIntoRoom}
          onImportNeteaseTrack={onImportNeteaseTrack}
          onImportQqMusicTrack={onImportQqMusicTrack}
          onImportNeteaseTracks={onImportNeteaseTracks}
          onImportQqMusicTracks={onImportQqMusicTracks}
          onSavePlaylistFromQueue={onSavePlaylistFromQueue}
          onUpdatePlaylistTitle={onUpdatePlaylistTitle}
          onUpdatePlaylistTracks={onUpdatePlaylistTracks}
          playlists={playlists}
          tracks={tracks}
        />
      </section> : null}
      {playlistTab === "favorites" ? <section className="flex flex-col gap-3" data-testid="favorite-albums-section">
        <FavoriteAlbumsPanel
          activeSession={activeSession}
          canManageLibrary={canManageLibrary}
          onImportNeteaseTrack={onImportNeteaseTrack}
          onImportQqMusicTrack={onImportQqMusicTrack}
          roomTracks={tracks}
        />
      </section> : null}
    </div>
  );
}

export const LocalStorageTabPanel = memo(LocalStorageTabPanelBase);
