"use client";

import { memo, useCallback, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import type {
  AuthSession,
  NeteaseTrackCandidate,
  Playlist,
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomMemberPermissions,
  RoomMediaConnectionState,
  RoomMember,
  RoomSnapshot,
  QqMusicTrackCandidate,
  TrackMeta,
  UpdateRoomRequest
} from "@music-room/shared";
import { RoomStage } from "./RoomStage";
import type { CachedLibraryTrack, UploadedTrack } from "@/features/upload/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import type { RoomSocket } from "@/lib/ws-client";
import type { LocalMemberPanelState } from "./MembersPanel";
import { resolveCurrentSourcePeerId } from "./hooks/use-room-page-derived";

type TabId = "library" | "local" | "members";

type RoomDashboardViewProps = {
  roomSnapshot: RoomSnapshot;
  currentTrack: TrackMeta | null;
  currentTrackDuration: number;
  isPlaying: boolean;
  activeSession: AuthSession | null;
  host: RoomMember | undefined;
  canControlPlayback: boolean;
  canDeleteRoom: boolean;
  canDisbandRoom: boolean;
  currentSourceOwnerNickname: string | null;
  uploadedTracks: Record<string, UploadedTrack>;
  localStorageSummary: LocalStorageSummary;
  playlists: Playlist[];
  onCleanLocalStorage: () => Promise<void>;
  onRefreshLocalStorage: () => Promise<void>;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  onSaveTrackToLocal: (track: TrackMeta) => Promise<void>;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onUpdatePlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  onUpdateRoom: (input: UpdateRoomRequest) => Promise<boolean>;
  onUpdateMemberPermissions: (memberId: string, permissions: RoomMemberPermissions) => Promise<boolean>;
  onRemoveMember: (memberId: string) => Promise<boolean>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
  connectedPeersCount: number;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  peerRecentEvents: PeerRecentEvent[];
  localMemberState: LocalMemberPanelState | null;
  iceConfigSource: string;
  iceConfigStatus: string;
  onCopyJoinCode: () => Promise<void>;
  onAwayRoom: () => void;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<unknown>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
  socket: RoomSocket | null;
  onTabChange?: (tab: TabId) => void;
  onDiagnosticsVisibilityChange?: (open: boolean) => void;
  isLyricsOpen: boolean;
  onToggleLyrics: () => void;
};

const tabLabels: Record<TabId, string> = {
  library: "曲库",
  local: "我的歌单",
  members: "成员"
};

const tabIds: TabId[] = ["library", "local", "members"];

const LibraryTabPanel = dynamic(
  () => import("./LibraryTabPanel").then((mod) => mod.LibraryTabPanel),
  {
    loading: () => (
      <div className="animate-fade-in rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">
        正在加载曲库…
      </div>
    )
  }
);

const LocalStorageTabPanel = dynamic(
  () => import("./LocalStorageTabPanel").then((mod) => mod.LocalStorageTabPanel),
  {
    loading: () => (
      <div className="animate-fade-in rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">
        正在加载我的歌单…
      </div>
    )
  }
);

const MembersTabPanel = dynamic(
  () => import("./MembersTabPanel").then((mod) => mod.MembersTabPanel),
  {
    loading: () => (
      <div className="animate-fade-in rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">
        正在加载成员视图…
      </div>
    )
  }
);

function RoomDashboardViewBase({
  roomSnapshot,
  currentTrack,
  currentTrackDuration,
  isPlaying,
  activeSession,
  host,
  canControlPlayback,
  canDeleteRoom,
  canDisbandRoom,
  currentSourceOwnerNickname,
  uploadedTracks,
  localStorageSummary,
  playlists,
  onCleanLocalStorage,
  onRefreshLocalStorage,
  onImportCachedTrack,
  onSaveTrackToLocal,
  onSavePlaylistFromQueue,
  onLoadPlaylistIntoRoom,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onUpdatePlaylistTitle,
  onUpdatePlaylistTracks,
  onUpdateRoom,
  onUpdateMemberPermissions,
  onRemoveMember,
  onDeletePlaylist,
  connectedPeersCount: _connectedPeersCount,
  mediaConnectionState,
  mediaConnectedPeersCount,
  peerDiagnostics,
  peerRecentEvents,
  localMemberState,
  iceConfigSource,
  iceConfigStatus,
  onCopyJoinCode,
  onAwayRoom,
  onLeaveRoom,
  onDeleteRoom,
  onFilesSelected,
  onAddToQueue,
  onDeleteTrack,
  onPlayTrack,
  socket,
  onTabChange,
  onDiagnosticsVisibilityChange,
  isLyricsOpen,
  onToggleLyrics
}: RoomDashboardViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("library");
  const currentSourcePeerId = resolveCurrentSourcePeerId(roomSnapshot, roomSnapshot.room.playback);

  const handleTabChange = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      if (tab !== "members") {
        onDiagnosticsVisibilityChange?.(false);
      }
      onTabChange?.(tab);
    },
    [onDiagnosticsVisibilityChange, onTabChange]
  );
  const handleTabKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, tab: TabId) => {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const nextTab = tabIds[(tabIds.indexOf(tab) + direction + tabIds.length) % tabIds.length];
    handleTabChange(nextTab);
    document.getElementById(`room-tab-${nextTab}`)?.focus();
  }, [handleTabChange]);

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto overscroll-contain lg:grid lg:h-full lg:overflow-hidden lg:grid-cols-[minmax(0,1.12fr)_minmax(21rem,0.88fr)] lg:gap-0">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {isPlaying ? (
          <div className="absolute left-1/2 top-24 h-[58vw] w-[58vw] -translate-x-1/2 rounded-full bg-accent/6 blur-[110px] sm:h-[46vw] sm:w-[46vw] lg:left-[28%] lg:top-1/4" />
        ) : null}
      </div>

      {/* ══════ LEFT: Immersive Stage ══════ */}
      <div className="relative z-40 flex h-auto w-full min-w-0 shrink-0 flex-col lg:z-10 lg:h-full lg:max-h-none lg:min-h-0 lg:min-w-0 lg:overflow-hidden">

        {/* Vinyl + Track Info */}
        <div className="flex h-auto min-h-0 flex-1 flex-col lg:h-full lg:flex-[2] lg:min-h-0">
          <RoomStage
            roomSnapshot={roomSnapshot}
            currentTrack={currentTrack}
            currentTrackDuration={currentTrackDuration}
            isPlaying={isPlaying}
            host={host}
            canDeleteRoom={canDeleteRoom}
            canDisbandRoom={canDisbandRoom}
            currentSourceOwnerNickname={currentSourceOwnerNickname}
            mediaConnectionState={mediaConnectionState}
            mediaConnectedPeersCount={mediaConnectedPeersCount}
            iceConfigSource={iceConfigSource}
            onUpdateRoom={onUpdateRoom}
            onCopyJoinCode={onCopyJoinCode}
            onAwayRoom={onAwayRoom}
            onLeaveRoom={onLeaveRoom}
            onDeleteRoom={onDeleteRoom}
            isLyricsOpen={isLyricsOpen}
            onToggleLyrics={onToggleLyrics}
            socket={socket}
          />
        </div>

      </div>

      {/* ══════ RIGHT: Management Panel ══════ */}
      <div className="material-surface relative z-20 flex min-h-[24rem] w-full min-w-0 flex-1 flex-col border-t border-white/[0.06] lg:min-h-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-[-20px_0_50px_rgba(0,0,0,0.36)]">
        <div className="material-surface-header sticky top-0 z-30 shrink-0 border-b border-white/[0.08] px-3 pb-2 pt-2 sm:px-5 sm:pt-4 lg:rounded-none">
          <div aria-label="房间视图" className="relative flex items-center gap-0 rounded-xl bg-black/20 p-1" role="tablist">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-1 rounded-[9px] bg-white/[0.12] shadow-[0_1px_2px_rgba(0,0,0,0.24)] transition-[transform,width] duration-200 ease-out"
              style={{
                transform: `translateX(${tabIds.indexOf(activeTab) * 100}%)`,
                width: `${100 / tabIds.length}%`
              }}
            />
            {tabIds.map((tab) => (
              <button
                key={tab}
                id={`room-tab-${tab}`}
                data-testid={`room-tab-${tab}`}
                aria-controls={`room-panel-${tab}`}
                aria-selected={activeTab === tab}
                onClick={() => handleTabChange(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tab)}
                role="tab"
                tabIndex={activeTab === tab ? 0 : -1}
                className={`relative z-10 flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition-[color,opacity] duration-150 ease-out sm:text-sm ${
                  activeTab === tab
                    ? "text-white"
                    : "text-white/50 hover:text-white/80"
                }`}
                type="button"
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>
        </div>

        <div
          aria-labelledby={`room-tab-${activeTab}`}
          className="hide-scrollbar min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2.5 pb-[calc(11rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pt-4 lg:pb-32"
          id={`room-panel-${activeTab}`}
          role="tabpanel"
        >
          {activeTab === "library" ? (
            <LibraryTabPanel
              tracks={roomSnapshot.tracks}
              uploadedTracks={uploadedTracks}
              localFolderName={localStorageSummary.localFolderName}
              localSavedFileHashes={localStorageSummary.localSavedFileHashes}
              onSaveTrackToLocal={onSaveTrackToLocal}
              canControlPlayback={canControlPlayback}
              canManageAllTracks={activeSession?.userId === roomSnapshot.room.hostId}
              activeSession={activeSession}
              onFilesSelected={onFilesSelected}
              onAddToQueue={onAddToQueue}
              onDeleteTrack={onDeleteTrack}
              onPlayTrack={onPlayTrack}
            />
          ) : null}

          {activeTab === "local" ? (
            <LocalStorageTabPanel
              tracks={roomSnapshot.tracks}
              playlists={playlists}
              activeSession={activeSession}
              localStorageSummary={localStorageSummary}
              onCleanLocalStorage={onCleanLocalStorage}
              onRefreshLocalStorage={onRefreshLocalStorage}
              onImportCachedTrack={onImportCachedTrack}
              onSavePlaylistFromQueue={onSavePlaylistFromQueue}
              onLoadPlaylistIntoRoom={onLoadPlaylistIntoRoom}
              onImportNeteaseTrack={onImportNeteaseTrack}
              onImportQqMusicTrack={onImportQqMusicTrack}
              onUpdatePlaylistTitle={onUpdatePlaylistTitle}
              onUpdatePlaylistTracks={onUpdatePlaylistTracks}
              onDeletePlaylist={onDeletePlaylist}
            />
          ) : null}

          {activeTab === "members" ? (
            <MembersTabPanel
              members={roomSnapshot.room.members}
              peerDiagnostics={peerDiagnostics}
              peerRecentEvents={peerRecentEvents}
              localMemberState={localMemberState}
              playbackStatus={roomSnapshot.room.playback.status}
              sourceSessionId={roomSnapshot.room.playback.sourceSessionId}
              sourcePeerId={currentSourcePeerId}
              iceConfigSource={iceConfigSource}
              iceConfigStatus={iceConfigStatus}
              activeSessionId={activeSession?.userId ?? null}
              isHost={activeSession?.userId === roomSnapshot.room.hostId}
              onUpdateMemberPermissions={onUpdateMemberPermissions}
              onRemoveMember={onRemoveMember}
              onDiagnosticsVisibilityChange={onDiagnosticsVisibilityChange}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const RoomDashboardView = memo(RoomDashboardViewBase);
