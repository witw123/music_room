"use client";

import type { RefObject } from "react";
import type { AuthSession, RoomSnapshot, TrackMeta } from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import { AudioUnlockOverlay } from "@/components/AudioUnlockOverlay";
import { BottomPlayerController } from "@/components/BottomPlayerController";
import { RoomWorkspace } from "@/components/room/RoomWorkspace";
import type { useTrackUploads } from "@/features/upload/use-track-uploads";
import type { useRoomClipboardActions } from "@/components/room/hooks/use-room-clipboard-actions";
import type { useRoomPageRoomActions } from "@/components/room/hooks/use-room-page-room-actions";
import type { useRoomPageState } from "@/components/room/hooks/use-room-page-state";
import type { useRoomPlaybackActions } from "@/components/room/hooks/use-room-playback-actions";
import type { useRoomWorkspaceViewModel } from "@/components/room/hooks/use-room-workspace-view-model";

type RoomAppShellProps = {
  activeSession: AuthSession | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  authEntryHref: string;
  canControlPlayback: boolean;
  canDeleteRoom: boolean;
  canReorderQueue: boolean;
  clipboardActions: ReturnType<typeof useRoomClipboardActions>;
  currentTrack: TrackMeta | null;
  isSourceOwner: boolean;
  pageState: ReturnType<typeof useRoomPageState>;
  playbackActions: ReturnType<typeof useRoomPlaybackActions>;
  roomActions: ReturnType<typeof useRoomPageRoomActions>;
  roomSnapshot: RoomSnapshot | null;
  socket: RoomSocket | null;
  statusMessage: string;
  uploads: ReturnType<typeof useTrackUploads>;
  workspaceEntryHref: string;
  workspaceViewModel: ReturnType<typeof useRoomWorkspaceViewModel>;
};

export function RoomAppShell({
  activeSession,
  audioRef,
  authEntryHref,
  canControlPlayback,
  canDeleteRoom,
  canReorderQueue,
  clipboardActions,
  currentTrack,
  isSourceOwner,
  pageState,
  playbackActions,
  roomActions,
  roomSnapshot,
  socket,
  statusMessage,
  uploads,
  workspaceEntryHref,
  workspaceViewModel
}: RoomAppShellProps) {
  return (
    <>
      <AudioUnlockOverlay
        visible={pageState.audioBlockedOverlay}
        onUnlock={playbackActions.handleAudioUnlock}
      />
      <RoomWorkspace
        activeSession={activeSession}
        statusMessage={statusMessage}
        statusTone={workspaceViewModel.statusTone}
        roomSnapshot={roomSnapshot}
        currentTrack={currentTrack}
        canControlPlayback={canControlPlayback}
        canDeleteRoom={canDeleteRoom}
        canDisbandRoom={workspaceViewModel.canDisbandRoom}
        canReorderQueue={canReorderQueue}
        uploadedTracks={uploads.uploadedTracks}
        localStorageSummary={uploads.localStorageSummary}
        onCleanLocalStorage={uploads.cleanLocalStorage}
        onChooseLocalFolder={uploads.chooseLocalFolder}
        onSaveTrackToLocal={uploads.saveTrackToLocal}
        connectedPeersCount={workspaceViewModel.connectedPeersCount}
        mediaConnectionState={pageState.mediaConnectionState}
        mediaConnectedPeersCount={workspaceViewModel.mediaConnectedPeersCount}
        localMemberState={workspaceViewModel.localMemberState}
        peerDiagnostics={workspaceViewModel.workspacePeerDiagnostics.peerDiagnostics}
        peerRecentEvents={workspaceViewModel.workspacePeerDiagnostics.peerRecentEvents}
        iceConfigSource={workspaceViewModel.iceConfigSource}
        iceConfigStatus={workspaceViewModel.iceConfigStatus}
        workspaceEntryHref={workspaceEntryHref}
        authEntryHref={authEntryHref}
        showRoomTransitionState={workspaceViewModel.showRoomTransitionState}
        isNavigatingRoomExit={pageState.isNavigatingRoomExit}
        isRecoveringRoom={pageState.isRecoveringRoom}
        isRoomTransitionPending={workspaceViewModel.isRoomTransitionPending}
        onLogout={roomActions.handleLogout}
        onClearIdentity={roomActions.handleClearIdentity}
        onCopyJoinCode={clipboardActions.handleCopyJoinCode}
        onLeaveRoom={roomActions.handleLeaveRoomAction}
        onDeleteRoom={roomActions.handleDeleteRoomAction}
        onFilesSelected={playbackActions.handleFilesSelected}
        onImportNeteaseTrack={uploads.handleNeteaseTrackImport}
        onImportMetingTrack={uploads.handleMetingTrackImport}
        onAddToQueue={roomActions.addToQueue}
        onDeleteTrack={roomActions.deleteTrack}
        onPlayTrack={playbackActions.handlePlayTrack}
        onPlayQueueItem={playbackActions.handlePlayQueueItem}
        onRemoveQueueItem={roomActions.removeQueueItem}
        onReorderQueue={roomActions.reorderQueue}
        onTabChange={pageState.setActiveDashboardTab}
        onDiagnosticsVisibilityChange={pageState.setIsDiagnosticsPanelOpen}
        socket={socket}
        playerSlot={
          <BottomPlayerController
            audioRef={audioRef}
            isSourceOwner={isSourceOwner}
            roomSnapshot={roomSnapshot}
            activeSession={activeSession}
            currentTrack={currentTrack}
            canSeekPlayback={true}
            resetEpoch={pageState.playerResetEpoch}
            onPlaybackPositionChange={playbackActions.handlePlaybackPositionChange}
            onVolumeChange={pageState.setVolume}
            onPlay={playbackActions.handlePlayTrack}
            onPause={roomActions.pauseTrack}
            onSeek={roomActions.seekTrack}
            onPrev={playbackActions.handlePrevTrack}
            onNext={playbackActions.handleNextTrack}
          />
        }
      />
    </>
  );
}
