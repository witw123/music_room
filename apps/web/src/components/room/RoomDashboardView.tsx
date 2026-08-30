"use client";

import { memo, useCallback, useEffect, useState, type KeyboardEvent } from "react";
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
import {
  MusicIcon,
  RadioIcon,
  UsersIcon
} from "@/components/icons/DiscoverIcons";

type ManagementTabId = "library" | "local" | "members";

export type RoomDashboardViewProps = {
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
  canReorderQueue: boolean;
  canRemoveQueue: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onPlayNextQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
  onRefreshRoom: () => Promise<RoomSnapshot | null>;
  socket: RoomSocket | null;
  onTabChange?: (tab: ManagementTabId) => void;
  onDiagnosticsVisibilityChange?: (open: boolean) => void;
  onSeek: (positionMs: number) => void;
};

type RoomLayoutProps = RoomDashboardViewProps & {
  isHost: boolean;
  canManageLibrary: boolean;
  canAddToQueue: boolean;
  currentSourcePeerId: string | null;
  membershipNow: number;
};

const tabConfigs: Array<{ id: ManagementTabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "library", label: "曲库", icon: MusicIcon },
  { id: "local", label: "我的歌单", icon: RadioIcon },
  { id: "members", label: "成员", icon: UsersIcon }
];

const LibraryTabPanel = dynamic(() => import("./LibraryTabPanel").then((mod) => mod.LibraryTabPanel));
const LocalStorageTabPanel = dynamic(() => import("./LocalStorageTabPanel").then((mod) => mod.LocalStorageTabPanel));
const MembersTabPanel = dynamic(() => import("./MembersTabPanel").then((mod) => mod.MembersTabPanel));

function RoomDashboardViewBase(props: RoomDashboardViewProps) {
  const [membershipNow, setMembershipNow] = useState(() => Date.now());
  const currentSourcePeerId = resolveCurrentSourcePeerId(props.roomSnapshot, props.roomSnapshot.room.playback);
  const currentRoomPermissions = getCurrentRoomMemberPermissions(props.roomSnapshot, props.activeSession?.userId);
  const isHost = isRoomHost(props.roomSnapshot, props.activeSession?.userId);
  const canManageLibrary = currentRoomPermissions?.library === true;
  const canAddToQueue = currentRoomPermissions?.queue === true;

  useEffect(() => {
    const timer = window.setInterval(() => setMembershipNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const layoutProps: RoomLayoutProps = {
    ...props,
    isHost,
    canManageLibrary,
    canAddToQueue,
    currentSourcePeerId,
    membershipNow
  };

  return <InteractiveRoomLayout {...layoutProps} />;
}

function InteractiveRoomLayout(props: RoomLayoutProps) {
  const [activeTab, setActiveTab] = useState<ManagementTabId>("library");
  const handleTabChange = useCallback((tab: ManagementTabId) => {
    setActiveTab(tab);
    if (tab !== "members") props.onDiagnosticsVisibilityChange?.(false);
    props.onTabChange?.(tab);
  }, [props]);
  const handleTabKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, tab: ManagementTabId) => {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const tabIds = tabConfigs.map((t) => t.id);
    const nextTab = tabIds[(tabIds.indexOf(tab) + direction + tabIds.length) % tabIds.length];
    handleTabChange(nextTab);
    document.getElementById(`room-tab-${nextTab}`)?.focus();
  }, [handleTabChange]);

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto overscroll-contain lg:grid lg:h-full lg:grid-cols-[minmax(0,1.12fr)_minmax(21rem,0.88fr)] lg:overflow-hidden lg:gap-0" data-custom-layout-room-root="true">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {props.isPlaying ? <div className="absolute left-1/2 top-24 h-[58vw] w-[58vw] -translate-x-1/2 rounded-full bg-accent/6 blur-[110px] sm:h-[46vw] sm:w-[46vw] lg:left-[28%] lg:top-1/4" /> : null}
      </div>
      <div className="relative z-40 flex h-auto w-full min-w-0 shrink-0 flex-col lg:z-10 lg:h-full lg:min-h-0 lg:overflow-hidden" data-custom-layout-item="room-stage">
        <div className="flex h-auto min-h-0 flex-1 flex-col lg:h-full lg:flex-[2] lg:min-h-0">
          <RoomStage {...buildRoomStageProps(props)} />
        </div>
      </div>
      <section className="material-surface relative z-20 flex min-h-[24rem] w-full min-w-0 flex-1 flex-col border-t border-white/[0.06] lg:min-h-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-[-20px_0_50px_rgba(0,0,0,0.36)]" data-custom-layout-item="room-panel">
        <div className="material-surface-header sticky top-0 z-30 shrink-0 border-b border-white/[0.06] px-3 pb-2 pt-2 sm:px-5 sm:pt-4 lg:rounded-none">
          <div aria-label="房间视图" className="flex items-center gap-1 rounded-2xl border border-white/[0.06] p-1 bg-[#10121a]/80 backdrop-blur-xl" role="tablist">
            {tabConfigs.map(({ id: tab, label, icon: IconComp }) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  id={`room-tab-${tab}`}
                  data-testid={`room-tab-${tab}`}
                  aria-controls={`room-panel-${tab}`}
                  aria-selected={isActive}
                  onClick={() => handleTabChange(tab)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab)}
                  role="tab"
                  tabIndex={isActive ? 0 : -1}
                  className={`flex-1 flex min-h-11 whitespace-nowrap items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-semibold transition-all duration-150 ${
                    isActive
                      ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)] scale-[1.01]"
                      : "text-foreground-muted hover:text-white hover:bg-white/[0.06]"
                  }`}
                  type="button"
                >
                  <IconComp className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div aria-labelledby={`room-tab-${activeTab}`} className="hide-scrollbar min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2.5 pb-[var(--room-mobile-bottom-inset)] pt-3 sm:px-5 sm:pt-4 lg:pb-32" id={`room-panel-${activeTab}`} role="tabpanel">
          <RoomManagementContent {...props} activeTab={activeTab} />
        </div>
      </section>
    </div>
  );
}

function RoomManagementContent(props: RoomLayoutProps & { activeTab: ManagementTabId }) {
  if (props.activeTab === "library") return <LibraryTabPanel tracks={props.roomSnapshot.tracks} uploadedTracks={props.uploadedTracks} localFolderName={props.localStorageSummary.localFolderName} localSavedFileHashes={props.localStorageSummary.localSavedFileHashes} onSaveTrackToLocal={props.onSaveTrackToLocal} canControlPlayback={props.canControlPlayback} canManageLibrary={props.canManageLibrary} canManageAllTracks={props.isHost} canAddToQueue={props.canAddToQueue} activeSession={props.activeSession} onFilesSelected={props.onFilesSelected} onAddToQueue={props.onAddToQueue} onDeleteTrack={props.onDeleteTrack} onPlayTrack={props.onPlayTrack} />;
  if (props.activeTab === "local") return <LocalStorageTabPanel tracks={props.roomSnapshot.tracks} playlists={props.playlists} activeSession={props.activeSession} canManageLibrary={props.canManageLibrary} localStorageSummary={props.localStorageSummary} onCleanLocalStorage={props.onCleanLocalStorage} onRefreshLocalStorage={props.onRefreshLocalStorage} onImportCachedTrack={props.onImportCachedTrack} onSavePlaylistFromQueue={props.onSavePlaylistFromQueue} onLoadPlaylistIntoRoom={props.onLoadPlaylistIntoRoom} onImportNeteaseTrack={props.onImportNeteaseTrack} onImportQqMusicTrack={props.onImportQqMusicTrack} onImportNeteaseTracks={props.onImportNeteaseTracks} onImportQqMusicTracks={props.onImportQqMusicTracks} onUpdatePlaylistTitle={props.onUpdatePlaylistTitle} onUpdatePlaylistTracks={props.onUpdatePlaylistTracks} onDeletePlaylist={props.onDeletePlaylist} />;
  return <MembersTabPanel members={props.roomSnapshot.room.members} now={props.membershipNow} peerDiagnostics={props.peerDiagnostics} peerRecentEvents={props.peerRecentEvents} localMemberState={props.localMemberState} playbackStatus={props.roomSnapshot.room.playback.status} sourceSessionId={props.roomSnapshot.room.playback.sourceSessionId} sourcePeerId={props.currentSourcePeerId} iceConfigSource={props.iceConfigSource} iceConfigStatus={props.iceConfigStatus} activeSessionId={props.activeSession?.userId ?? null} isHost={props.isHost} onUpdateMemberPermissions={props.onUpdateMemberPermissions} onRemoveMember={props.onRemoveMember} onDiagnosticsVisibilityChange={props.onDiagnosticsVisibilityChange} />;
}

export function buildRoomStageProps(
  props: RoomDashboardViewProps,
  options?: { showMobilePlayer?: boolean; hideRoomMetadata?: boolean; mobileControlsOnly?: boolean }
) {
  return {
    roomSnapshot: props.roomSnapshot,
    playbackBarrier: props.playbackBarrier,
    currentTrack: props.currentTrack,
    currentTrackDuration: props.currentTrackDuration,
    isPlaying: props.isPlaying,
    host: props.host,
    canDeleteRoom: props.canDeleteRoom,
    canDisbandRoom: props.canDisbandRoom,
    currentSourceOwnerNickname: props.currentSourceOwnerNickname,
    mediaConnectionState: props.mediaConnectionState,
    mediaConnectedPeersCount: props.mediaConnectedPeersCount,
    iceConfigSource: props.iceConfigSource,
    onUpdateRoom: props.onUpdateRoom,
    onCopyJoinCode: props.onCopyJoinCode,
    onShareRoom: props.onShareRoom,
    onAwayRoom: props.onAwayRoom,
    onLeaveRoom: props.onLeaveRoom,
    onDeleteRoom: props.onDeleteRoom,
    onSeek: props.onSeek,
    socket: props.socket,
    showMobilePlayer: options?.showMobilePlayer,
    hideRoomMetadata: options?.hideRoomMetadata,
    mobileControlsOnly: options?.mobileControlsOnly
  };
}

export const RoomDashboardView = memo(RoomDashboardViewBase);
