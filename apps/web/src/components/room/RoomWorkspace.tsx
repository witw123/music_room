"use client";

import { memo, type ReactNode } from "react";
import type {
  AuthSession,
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import { TopBar } from "@/components/TopBar";
import { EmptyRoomState, RoomTransitionState } from "@/components/room/RoomPageStates";
import { RoomDashboardView } from "@/components/room/RoomDashboardView";
import type { LocalMemberPanelState, MemberTransferSummary } from "@/components/room/MembersPanel";
import type { AvailabilityEntry } from "@/components/room/MeshStatusPanel";
import type { CachedLibraryTrack, UploadedTrack } from "@/features/upload/audio-utils";
import type { ManualCacheTask } from "@/features/upload/use-track-uploads";

type RoomWorkspaceProps = {
  activeSession: AuthSession | null;
  statusMessage: string;
  statusTone: string;
  roomSnapshot: RoomSnapshot | null;
  currentTrack: TrackMeta | null;
  canControlPlayback: boolean;
  canDeleteRoom: boolean;
  canDisbandRoom: boolean;
  canReorderQueue: boolean;
  uploadedTracks: Record<string, UploadedTrack>;
  connectedPeersCount: number;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  cachedTrackCount: number;
  cacheLibraryTracks: CachedLibraryTrack[];
  manualCacheTasks: Record<string, ManualCacheTask>;
  availabilitySummary: AvailabilityEntry[];
  memberTransferSummaries: MemberTransferSummary[];
  localMemberState: LocalMemberPanelState | null;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  peerRecentEvents: PeerRecentEvent[];
  iceConfigSource: string;
  iceConfigStatus: string;
  workspaceEntryHref: string;
  authEntryHref: string;
  showRoomTransitionState: boolean;
  isNavigatingRoomExit: boolean;
  isRecoveringRoom: boolean;
  isRoomTransitionPending: boolean;
  onLogout: () => void;
  onClearIdentity: () => void;
  onCopyJoinCode: () => Promise<void>;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
  onStartManualCacheDownload: (trackId: string) => Promise<void>;
  onAddCachedLibraryTrackToLibrary: (fileHash: string) => Promise<void>;
  onExportCachedLibraryTrack: (fileHash: string) => Promise<void>;
  onDeleteCachedLibraryTrack: (fileHash: string) => Promise<void>;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  onTabChange: (tab: "queue" | "library" | "cache" | "members") => void;
  onDiagnosticsVisibilityChange: (open: boolean) => void;
  socket: RoomSocket | null;
  isSyncPending: boolean;
  playerSlot: ReactNode;
};

function RoomWorkspaceBase({
  activeSession,
  statusMessage,
  statusTone,
  roomSnapshot,
  currentTrack,
  canControlPlayback,
  canDeleteRoom,
  canDisbandRoom,
  canReorderQueue,
  uploadedTracks,
  connectedPeersCount,
  mediaConnectionState,
  mediaConnectedPeersCount,
  cachedTrackCount,
  cacheLibraryTracks,
  manualCacheTasks,
  availabilitySummary,
  memberTransferSummaries,
  localMemberState,
  peerDiagnostics,
  peerRecentEvents,
  iceConfigSource,
  iceConfigStatus,
  workspaceEntryHref,
  authEntryHref,
  showRoomTransitionState,
  isNavigatingRoomExit,
  isRecoveringRoom,
  isRoomTransitionPending,
  onLogout,
  onClearIdentity,
  onCopyJoinCode,
  onLeaveRoom,
  onDeleteRoom,
  onFilesSelected,
  onAddToQueue,
  onDeleteTrack,
  onPlayTrack,
  onStartManualCacheDownload,
  onAddCachedLibraryTrackToLibrary,
  onExportCachedLibraryTrack,
  onDeleteCachedLibraryTrack,
  onPlayQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  onTabChange,
  onDiagnosticsVisibilityChange,
  socket,
  isSyncPending,
  playerSlot
}: RoomWorkspaceProps) {
  const playback = roomSnapshot?.room.playback;
  const host = roomSnapshot?.room.members.find((member) => member.role === "host");
  const isPlaying = playback?.status === "playing";
  const currentTrackDuration = currentTrack?.durationMs ?? 0;
  const currentSourceOwnerNickname =
    roomSnapshot?.tracks.find((track) => track.id === playback?.sourceTrackId)?.ownerNickname ?? null;

  return (
    <main className="relative flex min-h-screen flex-col bg-background pb-32">
      <TopBar activeSession={activeSession} onLogout={onLogout} />

      {roomSnapshot && statusMessage ? (
        <div
          className="fixed left-1/2 top-20 z-50 -translate-x-1/2 px-4 pointer-events-none"
          aria-live="polite"
        >
          <div
            className={`pointer-events-auto rounded-full px-5 py-2.5 text-sm font-medium shadow-xl backdrop-blur-md transition-all duration-300 animate-slide-up ${
              statusTone === "warning"
                ? "border border-red-500/20 bg-red-500/10 text-red-400"
                : statusTone === "success"
                  ? "border border-green-500/20 bg-green-500/10 text-green-400"
                  : "border border-surface-border bg-surface/80 text-foreground"
            }`}
          >
            {statusMessage}
          </div>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1" role="tabpanel">
        <div className="h-full w-full">
          {roomSnapshot ? (
            <RoomDashboardView
              roomSnapshot={roomSnapshot}
              currentTrack={currentTrack}
              currentTrackDuration={currentTrackDuration}
              isPlaying={isPlaying}
              activeSession={activeSession}
              host={host}
              canControlPlayback={canControlPlayback}
              canDeleteRoom={canDeleteRoom}
              canDisbandRoom={canDisbandRoom}
              canReorderQueue={canReorderQueue}
              currentSourceOwnerNickname={currentSourceOwnerNickname}
              uploadedTracks={uploadedTracks}
              connectedPeersCount={connectedPeersCount}
              mediaConnectionState={mediaConnectionState}
              mediaConnectedPeersCount={mediaConnectedPeersCount}
              cachedTrackCount={cachedTrackCount}
              cacheLibraryTracks={cacheLibraryTracks}
              manualCacheTasks={manualCacheTasks}
              availabilitySummary={availabilitySummary}
              memberTransferSummaries={memberTransferSummaries}
              localMemberState={localMemberState}
              peerDiagnostics={peerDiagnostics}
              peerRecentEvents={peerRecentEvents}
              iceConfigSource={iceConfigSource}
              iceConfigStatus={iceConfigStatus}
              onCopyJoinCode={onCopyJoinCode}
              onLeaveRoom={onLeaveRoom}
              onDeleteRoom={onDeleteRoom}
              onFilesSelected={onFilesSelected}
              onAddToQueue={onAddToQueue}
              onDeleteTrack={onDeleteTrack}
              onPlayTrack={onPlayTrack}
              onStartManualCacheDownload={onStartManualCacheDownload}
              onAddCachedLibraryTrackToLibrary={onAddCachedLibraryTrackToLibrary}
              onExportCachedLibraryTrack={onExportCachedLibraryTrack}
              onDeleteCachedLibraryTrack={onDeleteCachedLibraryTrack}
              onPlayQueueItem={onPlayQueueItem}
              onRemoveQueueItem={onRemoveQueueItem}
              onReorderQueue={onReorderQueue}
              socket={socket}
              onTabChange={onTabChange}
              onDiagnosticsVisibilityChange={onDiagnosticsVisibilityChange}
            />
          ) : showRoomTransitionState ? (
            <RoomTransitionState
              isNavigatingRoomExit={isNavigatingRoomExit}
              isRecoveringRoom={isRecoveringRoom || isRoomTransitionPending}
            />
          ) : (
            <EmptyRoomState
              activeSession={activeSession}
              workspaceEntryHref={workspaceEntryHref}
              authEntryHref={authEntryHref}
              onClearIdentity={onClearIdentity}
            />
          )}
        </div>
      </div>

      {playerSlot}

      {isSyncPending ? (
        <div className="fixed left-1/2 top-8 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-surface-border bg-surface px-4 py-1.5 shadow-lg backdrop-blur-md animate-fade-in">
          <div className="h-2 w-2 rounded-full bg-accent animate-ping" />
          <span className="text-xs text-foreground">正在同步房间状态…</span>
        </div>
      ) : null}
    </main>
  );
}

export const RoomWorkspace = memo(RoomWorkspaceBase);
