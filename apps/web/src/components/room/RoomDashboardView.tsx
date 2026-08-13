"use client";

import { memo, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
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
import type { CachedLibraryTrack, UploadedTrack } from "@/features/library/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import type { RoomSocket } from "@/lib/network/ws-client";
import type { LocalMemberPanelState } from "./MembersPanel";
import { resolveCurrentSourcePeerId } from "@/features/room/hooks/use-room-page-derived";
import type { RoomPlaybackBarrierClock } from "@/features/playback/room-playback-clock";
import { getCurrentRoomMemberPermissions, isRoomHost } from "@/features/room/room-permissions";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { RoomRequestsPanel } from "./RoomRequestsPanel";

type ManagementTabId = "library" | "local" | "members";
type TabId = "scenario" | ManagementTabId;

type RoomDashboardViewProps = {
  roomSnapshot: RoomSnapshot;
  playbackBarrier?: RoomPlaybackBarrierClock | null;
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
  onImportNeteaseTracks: (tracks: NeteaseTrackCandidate[]) => Promise<void>;
  onImportQqMusicTracks: (tracks: QqMusicTrackCandidate[]) => Promise<void>;
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
  onShareRoom: () => Promise<void>;
  onAwayRoom: () => void;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<unknown>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
  socket: RoomSocket | null;
  onTabChange?: (tab: ManagementTabId) => void;
  onDiagnosticsVisibilityChange?: (open: boolean) => void;
  isLyricsOpen: boolean;
  onToggleLyrics: () => void;
  onSeek: (positionMs: number) => void;
};

const managementTabIds: ManagementTabId[] = ["library", "local", "members"];

function getScenarioTabLabel(roomType: "interactive" | "request" | "radio") {
  return roomType === "request" ? "点歌台" : roomType === "radio" ? "电台队列" : "曲库";
}

function getDefaultTab(roomType: "interactive" | "request" | "radio"): TabId {
  return roomType === "interactive" ? "library" : "scenario";
}

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
  playbackBarrier,
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
  onImportNeteaseTracks,
  onImportQqMusicTracks,
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
  onShareRoom,
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
  onToggleLyrics,
  onSeek
}: RoomDashboardViewProps) {
  const roomType = roomSnapshot.room.roomType ?? "interactive";
  const [activeTab, setActiveTab] = useState<TabId>(() => getDefaultTab(roomType));
  const [membershipNow, setMembershipNow] = useState(() => Date.now());
  const currentSourcePeerId = resolveCurrentSourcePeerId(roomSnapshot, roomSnapshot.room.playback);
  const currentRoomPermissions = getCurrentRoomMemberPermissions(
    roomSnapshot,
    activeSession?.userId
  );
  const canManageLibrary = currentRoomPermissions?.library === true;
  const isHost = isRoomHost(roomSnapshot, activeSession?.userId);
  const hostManagedRoom = roomSnapshot.room.roomType === "request" || roomSnapshot.room.roomType === "radio";
  const canManageScenarioContent = !hostManagedRoom || isHost;
  const canAddToQueue = currentRoomPermissions?.queue === true && canManageScenarioContent;
  const tabIds = useMemo<TabId[]>(
    () => roomType === "interactive" ? managementTabIds : ["scenario", ...managementTabIds],
    [roomType]
  );
  const tabLabels: Record<TabId, string> = {
    scenario: getScenarioTabLabel(roomType),
    library: "曲库",
    local: "我的歌单",
    members: "成员"
  };

  useEffect(() => {
    setActiveTab(getDefaultTab(roomType));
  }, [roomType]);

  useEffect(() => {
    const updateMembershipNow = () => setMembershipNow(Date.now());
    updateMembershipNow();
    const timer = window.setInterval(updateMembershipNow, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleTabChange = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      if (tab !== "members") {
        onDiagnosticsVisibilityChange?.(false);
      }
      if (tab !== "scenario") {
        onTabChange?.(tab);
      }
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
  }, [handleTabChange, tabIds]);

  return (
    <div className={`relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto overscroll-contain lg:grid lg:h-full lg:overflow-hidden lg:gap-0 ${
      roomType === "radio"
        ? "lg:grid-cols-[minmax(0,1.28fr)_minmax(24rem,0.72fr)]"
        : roomType === "request"
          ? "lg:grid-cols-[minmax(0,1fr)_minmax(25rem,1fr)]"
          : "lg:grid-cols-[minmax(0,1.12fr)_minmax(21rem,0.88fr)]"
    }`} data-custom-layout-room-root="true">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {isPlaying ? (
          <div className="absolute left-1/2 top-24 h-[58vw] w-[58vw] -translate-x-1/2 rounded-full bg-accent/6 blur-[110px] sm:h-[46vw] sm:w-[46vw] lg:left-[28%] lg:top-1/4" />
        ) : null}
      </div>

      {/* ══════ LEFT: Immersive Stage ══════ */}
      <div className="relative z-40 flex h-auto w-full min-w-0 shrink-0 flex-col lg:z-10 lg:h-full lg:max-h-none lg:min-h-0 lg:min-w-0 lg:overflow-hidden" data-custom-layout-item="room-stage">

        {/* Vinyl + Track Info */}
        <div className="flex h-auto min-h-0 flex-1 flex-col lg:h-full lg:flex-[2] lg:min-h-0">
          <RoomStage
            roomSnapshot={roomSnapshot}
            playbackBarrier={playbackBarrier}
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
            onShareRoom={onShareRoom}
            onAwayRoom={onAwayRoom}
            onLeaveRoom={onLeaveRoom}
            onDeleteRoom={onDeleteRoom}
            isLyricsOpen={isLyricsOpen}
            onToggleLyrics={onToggleLyrics}
            onSeek={onSeek}
            socket={socket}
            layoutVariant={roomType}
          />
        </div>

      </div>

      {/* ══════ RIGHT: Management Panel ══════ */}
      <div className="material-surface relative z-20 flex min-h-[24rem] w-full min-w-0 flex-1 flex-col border-t border-white/[0.06] lg:min-h-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-[-20px_0_50px_rgba(0,0,0,0.36)]" data-custom-layout-item="room-panel">
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
          {activeTab === "scenario" ? (
            <RoomScenarioPanel
              roomSnapshot={roomSnapshot}
              activeSessionId={activeSession?.userId ?? null}
              onImportNeteaseTrack={onImportNeteaseTrack}
              onImportQqMusicTrack={onImportQqMusicTrack}
              onAddToQueue={onAddToQueue}
              onUpdateRoom={onUpdateRoom}
            />
          ) : null}
          {activeTab === "library" ? (
            <LibraryTabPanel
              tracks={roomSnapshot.tracks}
              uploadedTracks={uploadedTracks}
              localFolderName={localStorageSummary.localFolderName}
              localSavedFileHashes={localStorageSummary.localSavedFileHashes}
              onSaveTrackToLocal={onSaveTrackToLocal}
              canControlPlayback={canControlPlayback}
              canManageLibrary={canManageLibrary && canManageScenarioContent}
              canManageAllTracks={isHost}
              canAddToQueue={canAddToQueue}
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
              canManageLibrary={canManageLibrary}
              localStorageSummary={localStorageSummary}
              onCleanLocalStorage={onCleanLocalStorage}
              onRefreshLocalStorage={onRefreshLocalStorage}
              onImportCachedTrack={onImportCachedTrack}
              onSavePlaylistFromQueue={onSavePlaylistFromQueue}
              onLoadPlaylistIntoRoom={onLoadPlaylistIntoRoom}
              onImportNeteaseTrack={onImportNeteaseTrack}
              onImportQqMusicTrack={onImportQqMusicTrack}
              onImportNeteaseTracks={onImportNeteaseTracks}
              onImportQqMusicTracks={onImportQqMusicTracks}
              onUpdatePlaylistTitle={onUpdatePlaylistTitle}
              onUpdatePlaylistTracks={onUpdatePlaylistTracks}
              onDeletePlaylist={onDeletePlaylist}
            />
          ) : null}

          {activeTab === "members" ? (
            <MembersTabPanel
              members={roomSnapshot.room.members}
              now={membershipNow}
              peerDiagnostics={peerDiagnostics}
              peerRecentEvents={peerRecentEvents}
              localMemberState={localMemberState}
              playbackStatus={roomSnapshot.room.playback.status}
              sourceSessionId={roomSnapshot.room.playback.sourceSessionId}
              sourcePeerId={currentSourcePeerId}
              iceConfigSource={iceConfigSource}
              iceConfigStatus={iceConfigStatus}
              activeSessionId={activeSession?.userId ?? null}
              isHost={isHost}
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

function RoomScenarioPanel({
  roomSnapshot,
  activeSessionId,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onAddToQueue,
  onUpdateRoom
}: {
  roomSnapshot: RoomSnapshot;
  activeSessionId: string | null;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<unknown>;
  onUpdateRoom: (input: UpdateRoomRequest) => Promise<boolean>;
}) {
  const roomType = roomSnapshot.room.roomType ?? "interactive";
  if (roomType === "request") {
    return <RoomRequestsPanel
      activeSessionId={activeSessionId}
      onAddToQueue={onAddToQueue}
      onImportNeteaseTrack={onImportNeteaseTrack}
      onImportQqMusicTrack={onImportQqMusicTrack}
      onUpdateRoom={onUpdateRoom}
      roomSnapshot={roomSnapshot}
      variant="request"
    />;
  }
  if (roomType === "radio") {
    return <div className="grid gap-6"><RadioQueuePanel roomSnapshot={roomSnapshot} /><RoomRequestsPanel
      activeSessionId={activeSessionId}
      onAddToQueue={onAddToQueue}
      onImportNeteaseTrack={onImportNeteaseTrack}
      onImportQqMusicTrack={onImportQqMusicTrack}
      onUpdateRoom={onUpdateRoom}
      roomSnapshot={roomSnapshot}
      variant="radio"
    /></div>;
  }
  return null;
}

function RadioQueuePanel({ roomSnapshot }: { roomSnapshot: RoomSnapshot }) {
  const currentTrackId = roomSnapshot.room.playback.currentTrackId;
  const queueTracks = roomSnapshot.queue
    .map((item) => roomSnapshot.tracks.find((track) => track.id === item.trackId))
    .filter((track): track is TrackMeta => !!track);
  const currentTrack = roomSnapshot.tracks.find((track) => track.id === currentTrackId) ?? null;

  return <section className="border-b border-white/[0.08] pb-5">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-white">电台队列</h2><span className="shrink-0 text-xs text-white/45">{queueTracks.length} 首待播</span></div>
    {currentTrack ? <div className="mb-4 flex min-w-0 items-center gap-3 border-l-2 border-accent py-1 pl-3"><span className="min-w-0"><strong className="block truncate text-sm font-medium text-white">{currentTrack.title}</strong><span className="mt-1 block truncate text-xs text-white/45">{currentTrack.artist}</span></span></div> : null}
    <div className="divide-y divide-white/[0.07]">{queueTracks.filter((track) => track.id !== currentTrackId).slice(0, 6).map((track, index) => <div className="flex min-w-0 items-center justify-between gap-3 py-3" key={track.id}><span className="flex min-w-0 items-center gap-3"><span className="w-5 shrink-0 text-xs tabular-nums text-white/35">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0"><strong className="block truncate text-sm font-medium text-white/90">{track.title}</strong><span className="mt-1 block truncate text-xs text-white/45">{track.artist}</span></span></span><span className="shrink-0 text-xs tabular-nums text-white/40">{formatDuration(track.durationMs)}</span></div>)}</div>
  </section>;
}
