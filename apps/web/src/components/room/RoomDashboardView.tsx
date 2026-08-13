"use client";

/* eslint-disable @next/next/no-img-element */
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
import { RoomChatOverlay } from "./RoomChatOverlay";
import { RoomProviderTrackSearch } from "./RoomProviderTrackSearch";
import { RoomReactionControls } from "./RoomReactionControls";
import { RoomRequestsPanel, submitRoomTrackRequest } from "./RoomRequestsPanel";
import type { CachedLibraryTrack, UploadedTrack } from "@/features/library/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import type { RoomSocket } from "@/lib/network/ws-client";
import type { LocalMemberPanelState } from "./MembersPanel";
import { resolveCurrentSourcePeerId } from "@/features/room/hooks/use-room-page-derived";
import type { RoomPlaybackBarrierClock } from "@/features/playback/room-playback-clock";
import { getCurrentRoomMemberPermissions, isRoomHost } from "@/features/room/room-permissions";
import { formatDuration } from "@/lib/domain/music-room-ui";

type ManagementTabId = "library" | "local" | "members";

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

type RoomLayoutProps = RoomDashboardViewProps & {
  isHost: boolean;
  canManageLibrary: boolean;
  canAddToQueue: boolean;
  currentSourcePeerId: string | null;
  membershipNow: number;
};

const managementTabIds: ManagementTabId[] = ["library", "local", "members"];

const LibraryTabPanel = dynamic(() => import("./LibraryTabPanel").then((mod) => mod.LibraryTabPanel));
const LocalStorageTabPanel = dynamic(() => import("./LocalStorageTabPanel").then((mod) => mod.LocalStorageTabPanel));
const MembersTabPanel = dynamic(() => import("./MembersTabPanel").then((mod) => mod.MembersTabPanel));

function RoomDashboardViewBase(props: RoomDashboardViewProps) {
  const roomType = props.roomSnapshot.room.roomType ?? "interactive";
  const [membershipNow, setMembershipNow] = useState(() => Date.now());
  const currentSourcePeerId = resolveCurrentSourcePeerId(props.roomSnapshot, props.roomSnapshot.room.playback);
  const currentRoomPermissions = getCurrentRoomMemberPermissions(props.roomSnapshot, props.activeSession?.userId);
  const isHost = isRoomHost(props.roomSnapshot, props.activeSession?.userId);
  const hostManagedRoom = roomType === "request" || roomType === "radio";
  const canManageLibrary = currentRoomPermissions?.library === true;
  const canAddToQueue = currentRoomPermissions?.queue === true && (!hostManagedRoom || isHost);

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

  if (roomType === "request") return <RequestRoomLayout {...layoutProps} />;
  if (roomType === "radio") return <RadioRoomLayout {...layoutProps} />;
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
    const nextTab = managementTabIds[(managementTabIds.indexOf(tab) + direction + managementTabIds.length) % managementTabIds.length];
    handleTabChange(nextTab);
    document.getElementById(`room-tab-${nextTab}`)?.focus();
  }, [handleTabChange]);

  return <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto overscroll-contain lg:grid lg:h-full lg:grid-cols-[minmax(0,1.12fr)_minmax(21rem,0.88fr)] lg:overflow-hidden lg:gap-0" data-custom-layout-room-root="true">
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {props.isPlaying ? <div className="absolute left-1/2 top-24 h-[58vw] w-[58vw] -translate-x-1/2 rounded-full bg-accent/6 blur-[110px] sm:h-[46vw] sm:w-[46vw] lg:left-[28%] lg:top-1/4" /> : null}
    </div>
    <div className="relative z-40 flex h-auto w-full min-w-0 shrink-0 flex-col lg:z-10 lg:h-full lg:min-h-0 lg:overflow-hidden" data-custom-layout-item="room-stage">
      <div className="flex h-auto min-h-0 flex-1 flex-col lg:h-full lg:flex-[2] lg:min-h-0">
        <RoomStage {...stageProps(props)} layoutVariant="interactive" />
      </div>
    </div>
    <section className="material-surface relative z-20 flex min-h-[24rem] w-full min-w-0 flex-1 flex-col border-t border-white/[0.06] lg:min-h-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-[-20px_0_50px_rgba(0,0,0,0.36)]" data-custom-layout-item="room-panel">
      <div className="material-surface-header sticky top-0 z-30 shrink-0 border-b border-white/[0.08] px-3 pb-2 pt-2 sm:px-5 sm:pt-4 lg:rounded-none">
        <div aria-label="房间视图" className="relative flex items-center gap-0 rounded-xl bg-black/20 p-1" role="tablist">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-1 rounded-[9px] bg-white/[0.12] shadow-[0_1px_2px_rgba(0,0,0,0.24)] transition-[transform,width] duration-200 ease-out" style={{ transform: `translateX(${managementTabIds.indexOf(activeTab) * 100}%)`, width: `${100 / managementTabIds.length}%` }} />
          {managementTabIds.map((tab) => <button key={tab} id={`room-tab-${tab}`} data-testid={`room-tab-${tab}`} aria-controls={`room-panel-${tab}`} aria-selected={activeTab === tab} onClick={() => handleTabChange(tab)} onKeyDown={(event) => handleTabKeyDown(event, tab)} role="tab" tabIndex={activeTab === tab ? 0 : -1} className={`relative z-10 flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition-[color,opacity] duration-150 ease-out sm:text-sm ${activeTab === tab ? "text-white" : "text-white/50 hover:text-white/80"}`} type="button">{managementTabLabel(tab)}</button>)}
        </div>
      </div>
      <div aria-labelledby={`room-tab-${activeTab}`} className="hide-scrollbar min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2.5 pb-[calc(11rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pt-4 lg:pb-32" id={`room-panel-${activeTab}`} role="tabpanel">
        <RoomManagementContent {...props} activeTab={activeTab} />
      </div>
    </section>
  </div>;
}

function RequestRoomLayout(props: RoomLayoutProps) {
  const submitRequest = useCallback((track: NeteaseTrackCandidate | QqMusicTrackCandidate) => submitRoomTrackRequest(props.roomSnapshot.room.id, track), [props.roomSnapshot.room.id]);
  return <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto bg-background lg:overflow-hidden" data-custom-layout-room-root="true" data-room-layout="request">
    <div className="shrink-0 border-b border-surface-border bg-surface/20"><RoomStage {...stageProps(props)} layoutVariant="request" /></div>
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.52fr)] lg:overflow-hidden">
      <main className="min-w-0 px-3 py-4 sm:px-5 lg:overflow-y-auto lg:px-7 lg:py-6">
        <RoomProviderTrackSearch roomTracks={props.roomSnapshot.tracks} mode="request" onRequestTrack={submitRequest} testId="request-room-provider-search" />
        <RoomManagementPanel {...props} />
      </main>
      <aside className="min-h-[16rem] min-w-0 border-t border-surface-border bg-surface/25 px-3 py-4 sm:px-5 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:px-5 lg:py-6">
        <RoomRequestsPanel roomSnapshot={props.roomSnapshot} activeSessionId={props.activeSession?.userId ?? null} onImportNeteaseTrack={props.onImportNeteaseTrack} onImportQqMusicTrack={props.onImportQqMusicTrack} onAddToQueue={props.onAddToQueue} onUpdateRoom={props.onUpdateRoom} variant="request" />
      </aside>
    </div>
    <RoomInteractionBar roomId={props.roomSnapshot.room.id} trackId={props.roomSnapshot.room.playback.currentTrackId} activeSession={props.activeSession} socket={props.socket} />
  </div>;
}

function RadioRoomLayout(props: RoomLayoutProps) {
  const submitRequest = useCallback((track: NeteaseTrackCandidate | QqMusicTrackCandidate) => submitRoomTrackRequest(props.roomSnapshot.room.id, track), [props.roomSnapshot.room.id]);
  return <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto bg-background lg:overflow-hidden" data-custom-layout-room-root="true" data-room-layout="radio">
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.22fr)_minmax(21rem,0.78fr)] lg:overflow-hidden">
      <main className="relative min-h-[34rem] min-w-0 border-b border-surface-border lg:min-h-0 lg:overflow-hidden lg:border-b-0">
        <RoomStage {...stageProps(props)} layoutVariant="radio" />
      </main>
      <aside className="min-h-0 min-w-0 border-t border-surface-border bg-surface/20 px-3 py-4 sm:px-5 lg:flex lg:flex-col lg:overflow-hidden lg:border-l lg:border-t-0 lg:px-5 lg:py-6">
        <div className="min-h-0 lg:flex-1 lg:overflow-y-auto"><RadioQueuePanel roomSnapshot={props.roomSnapshot} isHost={props.isHost} onUpdateRoom={props.onUpdateRoom} /><div className="mt-6"><RoomProviderTrackSearch roomTracks={props.roomSnapshot.tracks} mode="suggest" onRequestTrack={submitRequest} testId="radio-room-provider-search" /></div><div className="mt-6"><RoomRequestsPanel roomSnapshot={props.roomSnapshot} activeSessionId={props.activeSession?.userId ?? null} onImportNeteaseTrack={props.onImportNeteaseTrack} onImportQqMusicTrack={props.onImportQqMusicTrack} onAddToQueue={props.onAddToQueue} onUpdateRoom={props.onUpdateRoom} variant="radio" /></div></div>
      </aside>
    </div>
    <div className="border-t border-surface-border px-3 py-4 sm:px-5 lg:px-7"><RoomManagementPanel {...props} compact /></div>
    <RoomInteractionBar roomId={props.roomSnapshot.room.id} trackId={props.roomSnapshot.room.playback.currentTrackId} activeSession={props.activeSession} socket={props.socket} />
  </div>;
}

function RoomManagementPanel(props: RoomLayoutProps & { compact?: boolean }) {
  const [activeTab, setActiveTab] = useState<ManagementTabId>("library");
  const onChange = (tab: ManagementTabId) => {
    setActiveTab(tab);
    if (tab !== "members") props.onDiagnosticsVisibilityChange?.(false);
    props.onTabChange?.(tab);
  };
  return <section className={`${props.compact ? "mt-0" : "mt-6 border-t border-surface-border pt-5"}`} data-testid="room-secondary-entries">
    <div className="flex items-center gap-5 border-b border-surface-border" role="tablist" aria-label="房间次级入口">
      {managementTabIds.map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => onChange(tab)} className={`border-b-2 px-0 pb-2 text-xs font-semibold transition ${activeTab === tab ? "border-accent text-foreground" : "border-transparent text-foreground-muted hover:text-foreground"}`}>{managementTabLabel(tab)}</button>)}
    </div>
    <div className="pt-4"><RoomManagementContent {...props} activeTab={activeTab} /></div>
  </section>;
}

function RoomManagementContent(props: RoomLayoutProps & { activeTab: ManagementTabId }) {
  if (props.activeTab === "library") return <LibraryTabPanel tracks={props.roomSnapshot.tracks} uploadedTracks={props.uploadedTracks} localFolderName={props.localStorageSummary.localFolderName} localSavedFileHashes={props.localStorageSummary.localSavedFileHashes} onSaveTrackToLocal={props.onSaveTrackToLocal} canControlPlayback={props.canControlPlayback} canManageLibrary={props.canManageLibrary && (!isScenarioRoom(props) || props.isHost)} canManageAllTracks={props.isHost} canAddToQueue={props.canAddToQueue} activeSession={props.activeSession} onFilesSelected={props.onFilesSelected} onAddToQueue={props.onAddToQueue} onDeleteTrack={props.onDeleteTrack} onPlayTrack={props.onPlayTrack} />;
  if (props.activeTab === "local") return <LocalStorageTabPanel tracks={props.roomSnapshot.tracks} playlists={props.playlists} activeSession={props.activeSession} canManageLibrary={props.canManageLibrary && (!isScenarioRoom(props) || props.isHost)} localStorageSummary={props.localStorageSummary} onCleanLocalStorage={props.onCleanLocalStorage} onRefreshLocalStorage={props.onRefreshLocalStorage} onImportCachedTrack={props.onImportCachedTrack} onSavePlaylistFromQueue={props.onSavePlaylistFromQueue} onLoadPlaylistIntoRoom={props.onLoadPlaylistIntoRoom} onImportNeteaseTrack={props.onImportNeteaseTrack} onImportQqMusicTrack={props.onImportQqMusicTrack} onImportNeteaseTracks={props.onImportNeteaseTracks} onImportQqMusicTracks={props.onImportQqMusicTracks} onUpdatePlaylistTitle={props.onUpdatePlaylistTitle} onUpdatePlaylistTracks={props.onUpdatePlaylistTracks} onDeletePlaylist={props.onDeletePlaylist} />;
  return <MembersTabPanel members={props.roomSnapshot.room.members} now={props.membershipNow} peerDiagnostics={props.peerDiagnostics} peerRecentEvents={props.peerRecentEvents} localMemberState={props.localMemberState} playbackStatus={props.roomSnapshot.room.playback.status} sourceSessionId={props.roomSnapshot.room.playback.sourceSessionId} sourcePeerId={props.currentSourcePeerId} iceConfigSource={props.iceConfigSource} iceConfigStatus={props.iceConfigStatus} activeSessionId={props.activeSession?.userId ?? null} isHost={props.isHost} onUpdateMemberPermissions={props.onUpdateMemberPermissions} onRemoveMember={props.onRemoveMember} onDiagnosticsVisibilityChange={props.onDiagnosticsVisibilityChange} />;
}

function RadioQueuePanel({ roomSnapshot, isHost, onUpdateRoom }: { roomSnapshot: RoomSnapshot; isHost: boolean; onUpdateRoom: (input: UpdateRoomRequest) => Promise<boolean> }) {
  const currentTrackId = roomSnapshot.room.playback.currentTrackId;
  const queueTracks = roomSnapshot.queue.map((item) => roomSnapshot.tracks.find((track) => track.id === item.trackId)).filter((track): track is TrackMeta => !!track);
  const roomType = roomSnapshot.room.roomType ?? "interactive";
  return <section data-testid="radio-programme">
    <div className="flex items-center justify-between gap-3 border-b border-surface-border pb-3"><h2 className="text-sm font-semibold text-foreground">节目单</h2>{isHost ? <button className="text-xs text-accent transition hover:text-accent/80" onClick={() => void onUpdateRoom({ visibility: roomSnapshot.room.visibility, name: roomSnapshot.room.name ?? "未命名房间", description: roomSnapshot.room.description, roomType, radioAutoFill: roomSnapshot.room.radioAutoFill === false })} type="button">{roomSnapshot.room.radioAutoFill === false ? "开启自动补歌" : "暂停自动补歌"}</button> : null}</div>
    <div className="divide-y divide-surface-border">{queueTracks.map((track, index) => <article className={`flex min-w-0 items-center gap-3 py-3 ${track.id === currentTrackId ? "border-l-2 border-accent pl-3" : ""}`} key={track.id}><span className="w-5 shrink-0 text-xs tabular-nums text-foreground-muted">{String(index + 1).padStart(2, "0")}</span>{track.artworkUrl ? <img alt="" className="h-9 w-9 shrink-0 object-cover" src={track.artworkUrl} /> : <span className="h-9 w-9 shrink-0 bg-surface" />}<span className="min-w-0 flex-1"><strong className="block truncate text-xs font-semibold text-foreground">{track.title}</strong><span className="mt-0.5 block truncate text-[11px] text-foreground-muted">{track.artist}</span></span><span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">{formatDuration(track.durationMs)}</span></article>)}</div>
  </section>;
}

function RoomInteractionBar({ roomId, trackId, activeSession, socket }: { roomId: string; trackId: string | null; activeSession: AuthSession | null; socket: RoomSocket | null }) {
  return <footer className="shrink-0 border-t border-surface-border bg-surface/70 px-3 py-2 backdrop-blur-md sm:px-5"><div className="mx-auto flex w-full max-w-6xl flex-col gap-2 lg:flex-row lg:items-end lg:justify-between"><RoomReactionControls roomId={roomId} trackId={trackId} socket={socket} /><RoomChatOverlay roomId={roomId} activeSession={activeSession} socket={socket} compact /></div></footer>;
}

function stageProps(props: RoomLayoutProps) {
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
    isLyricsOpen: props.isLyricsOpen,
    onToggleLyrics: props.onToggleLyrics,
    onSeek: props.onSeek,
    socket: props.socket
  };
}

function managementTabLabel(tab: ManagementTabId) { return tab === "library" ? "曲库" : tab === "local" ? "我的歌单" : "成员"; }
function isScenarioRoom(props: RoomLayoutProps) { return props.roomSnapshot.room.roomType === "request" || props.roomSnapshot.room.roomType === "radio"; }

export const RoomDashboardView = memo(RoomDashboardViewBase);
