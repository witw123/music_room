"use client";

import { memo, type ReactNode } from "react";
import type {
  AuthSession,
  NeteaseTrackCandidate,
  Playlist,
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomMediaConnectionState,
  RoomSnapshot,
  QqMusicTrackCandidate,
  TrackMeta
} from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import { EmptyRoomState, RoomTransitionState } from "@/components/room/RoomPageStates";
import { RoomDashboardView } from "@/components/room/RoomDashboardView";
import type { LocalMemberPanelState } from "@/components/room/MembersPanel";
import type { CachedLibraryTrack, UploadedTrack } from "@/features/upload/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import { AppSidebar } from "@/components/AppSidebar";

type RoomWorkspaceProps = {
  activeSession: AuthSession | null;
  statusMessage: string;
  statusTone: string;
  roomSnapshot: RoomSnapshot | null;
  currentTrack: TrackMeta | null;
  canControlPlayback: boolean;
  canDeleteRoom: boolean;
  canDisbandRoom: boolean;
  uploadedTracks: Record<string, UploadedTrack>;
  localStorageSummary: LocalStorageSummary;
  playlists: Playlist[];
  onCleanLocalStorage: () => Promise<void>;
  onChooseLocalFolder: () => Promise<void>;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  onSaveTrackToLocal: (track: TrackMeta) => Promise<void>;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onUpdatePlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
  connectedPeersCount: number;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
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
  onAwayRoom: () => void;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
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
  currentTrack,
  canControlPlayback,
  canDeleteRoom,
  canDisbandRoom,
  uploadedTracks,
  localStorageSummary,
  playlists,
  onCleanLocalStorage,
  onChooseLocalFolder,
  onImportCachedTrack,
  onSaveTrackToLocal,
  onSavePlaylistFromQueue,
  onLoadPlaylistIntoRoom,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onUpdatePlaylistTitle,
  onUpdatePlaylistTracks,
  onDeletePlaylist,
  connectedPeersCount,
  mediaConnectionState,
  mediaConnectedPeersCount,
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
    <main className="relative box-border flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden bg-background pb-[calc(12rem+env(safe-area-inset-bottom))] md:pl-60 lg:pb-[4.5rem]">

      <AppSidebar
        activeSession={activeSession}
        hasBottomPlayer
        onLogout={onLogout}
      />


      {roomSnapshot && statusMessage ? (
        <div
          className="fixed left-1/2 top-20 z-50 -translate-x-1/2 px-4 pointer-events-none"
          aria-live="polite"
        >
          <div
            data-testid="room-status-message"
            className={`pointer-events-auto rounded-full px-5 py-2.5 text-sm font-medium shadow-xl backdrop-blur-md transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-200 ease-out animate-slide-up ${
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
              onChooseLocalFolder={onChooseLocalFolder}
              onImportCachedTrack={onImportCachedTrack}
              onSaveTrackToLocal={onSaveTrackToLocal}
              onSavePlaylistFromQueue={onSavePlaylistFromQueue}
              onLoadPlaylistIntoRoom={onLoadPlaylistIntoRoom}
              onImportNeteaseTrack={onImportNeteaseTrack}
              onImportQqMusicTrack={onImportQqMusicTrack}
              onUpdatePlaylistTitle={onUpdatePlaylistTitle}
              onUpdatePlaylistTracks={onUpdatePlaylistTracks}
              onDeletePlaylist={onDeletePlaylist}
              connectedPeersCount={connectedPeersCount}
              mediaConnectionState={mediaConnectionState}
              mediaConnectedPeersCount={mediaConnectedPeersCount}
              localMemberState={localMemberState}
              peerDiagnostics={peerDiagnostics}
              peerRecentEvents={peerRecentEvents}
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
