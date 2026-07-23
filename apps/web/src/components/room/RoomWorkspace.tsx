"use client";

import { memo, type ReactNode } from "react";
import type {
  AuthSession,
  NeteaseTrackCandidate,
  Playlist,
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomMemberPermissions,
  RoomMediaConnectionState,
  RoomSnapshot,
  QqMusicTrackCandidate,
  TrackMeta,
  UpdateRoomRequest
} from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import { EmptyRoomState, RoomTransitionState } from "@/components/room/RoomPageStates";
import { RoomDashboardView } from "@/components/room/RoomDashboardView";
import type { CachedLibraryTrack, UploadedTrack } from "@/features/upload/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileAppNavigation } from "@/components/MobileAppNavigation";
import type { LocalMemberPanelState } from "@/components/room/MembersPanel";

type RoomWorkspaceProps = {
  activeSession: AuthSession | null;
  statusMessage: string;
  statusTone: string;
  roomSnapshot: RoomSnapshot | null;
  roomId: string | null;
  currentTrack: TrackMeta | null;
  canControlPlayback: boolean;
  canDeleteRoom: boolean;
  canDisbandRoom: boolean;
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
  workspaceEntryHref: string;
  authEntryHref: string;
  showRoomTransitionState: boolean;
  isNavigatingRoomExit: boolean;
  isRecoveringRoom: boolean;
  isRoomTransitionPending: boolean;
  onLogout: () => void;
  onClearIdentity: () => void;
  onCopyJoinCode: () => Promise<void>;
  onAwayRoom: () => void;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<unknown>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
  onTabChange: (tab: "library" | "local" | "members") => void;
  onDiagnosticsVisibilityChange: (open: boolean) => void;
  isLyricsOpen: boolean;
  onToggleLyrics: () => void;
  socket: RoomSocket | null;
  playerSlot: ReactNode;
};

function RoomWorkspaceBase({
  activeSession,
  statusMessage,
  statusTone,
  roomSnapshot,
  roomId,
  currentTrack,
  canControlPlayback,
  canDeleteRoom,
  canDisbandRoom,
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
  connectedPeersCount,
  mediaConnectionState,
  mediaConnectedPeersCount,
  peerDiagnostics,
  peerRecentEvents,
  localMemberState,
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
  onAwayRoom,
  onLeaveRoom,
  onDeleteRoom,
  onFilesSelected,
  onAddToQueue,
  onDeleteTrack,
  onPlayTrack,
  onTabChange,
  onDiagnosticsVisibilityChange,
  isLyricsOpen,
  onToggleLyrics,
  socket,
  playerSlot
}: RoomWorkspaceProps) {
  const playback = roomSnapshot?.room.playback;
  const host = roomSnapshot?.room.members.find((member) => member.role === "host");
  const isPlaying = playback?.status === "playing";
  const currentTrackDuration = currentTrack?.durationMs ?? 0;
  const currentSourceOwnerNickname =
    resolveCurrentSourceNickname(roomSnapshot?.room.members ?? [], playback?.sourceSessionId ?? null);

  return (
    <main className="relative box-border flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden bg-background pb-[calc(11rem+env(safe-area-inset-bottom))] md:pl-60 lg:pb-[4.5rem]">

      <div className="hidden md:contents">
        <AppSidebar
          activeSession={activeSession}
          hasBottomPlayer
          compactMobile
          keepHomeInRoom
          roomId={roomId}
          onLogout={onLogout}
        />
      </div>


      {roomSnapshot && statusMessage ? (
        <div
          className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+5rem)] z-50 w-fit max-w-[calc(100vw-1rem)] -translate-x-1/2 px-0 sm:top-20"
          aria-live="polite"
        >
          <div
            data-testid="room-status-message"
            className={`pointer-events-auto w-fit max-w-full break-words whitespace-normal rounded-2xl px-4 py-2.5 text-center text-sm font-medium shadow-xl backdrop-blur-md transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-200 ease-out animate-slide-up ${
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

      <div className="relative min-h-0 flex-1 overflow-hidden" role="tabpanel">
        <div className="h-full min-h-0 w-full">
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
              currentSourceOwnerNickname={currentSourceOwnerNickname}
              uploadedTracks={uploadedTracks}
              localStorageSummary={localStorageSummary}
              playlists={playlists}
              onCleanLocalStorage={onCleanLocalStorage}
              onRefreshLocalStorage={onRefreshLocalStorage}
              onImportCachedTrack={onImportCachedTrack}
              onSaveTrackToLocal={onSaveTrackToLocal}
              onSavePlaylistFromQueue={onSavePlaylistFromQueue}
              onLoadPlaylistIntoRoom={onLoadPlaylistIntoRoom}
              onImportNeteaseTrack={onImportNeteaseTrack}
              onImportQqMusicTrack={onImportQqMusicTrack}
              onUpdatePlaylistTitle={onUpdatePlaylistTitle}
              onUpdatePlaylistTracks={onUpdatePlaylistTracks}
              onUpdateRoom={onUpdateRoom}
              onUpdateMemberPermissions={onUpdateMemberPermissions}
              onRemoveMember={onRemoveMember}
              onDeletePlaylist={onDeletePlaylist}
              connectedPeersCount={connectedPeersCount}
              mediaConnectionState={mediaConnectionState}
              mediaConnectedPeersCount={mediaConnectedPeersCount}
              peerDiagnostics={peerDiagnostics}
              peerRecentEvents={peerRecentEvents}
              localMemberState={localMemberState}
              iceConfigSource={iceConfigSource}
              iceConfigStatus={iceConfigStatus}
              onCopyJoinCode={onCopyJoinCode}
              onAwayRoom={onAwayRoom}
              onLeaveRoom={onLeaveRoom}
              onDeleteRoom={onDeleteRoom}
              onFilesSelected={onFilesSelected}
              onAddToQueue={onAddToQueue}
              onDeleteTrack={onDeleteTrack}
              onPlayTrack={onPlayTrack}
              socket={socket}
              onTabChange={onTabChange}
              onDiagnosticsVisibilityChange={onDiagnosticsVisibilityChange}
              isLyricsOpen={isLyricsOpen}
              onToggleLyrics={onToggleLyrics}
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
      <MobileAppNavigation onNavigateAway={onAwayRoom} />
    </main>
  );
}

export const RoomWorkspace = memo(RoomWorkspaceBase);

export function resolveCurrentSourceNickname(
  members: Array<Pick<RoomSnapshot["room"]["members"][number], "id" | "nickname">>,
  sourceSessionId: string | null
) {
  return members.find((member) => member.id === sourceSessionId)?.nickname ?? null;
}
