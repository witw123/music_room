"use client";

import { useReducer, useState } from "react";
import { usePeerDiagnostics } from "@/features/p2p";
import { RoomAppShell } from "@/components/room/RoomAppShell";
import { useRouter } from "next/navigation";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { useTrackUploads } from "@/features/upload/use-track-uploads";
import { useRoomRuntime } from "@/features/room/hooks/use-room-runtime";
import { initialRoomStateStore, roomStateReducer } from "@/features/room/room-state-reducer";
import { useRoomPageDerived } from "@/components/room/hooks/use-room-page-derived";
import { useRoomPlaybackEffects } from "@/components/room/hooks/use-room-playback-effects";
import { useRoomPlaybackActions } from "@/components/room/hooks/use-room-playback-actions";
import { isSegmentedAudioOutputReady } from "@/components/room/hooks/use-room-playback-actions";
import { useRoomPageRoomActions } from "@/components/room/hooks/use-room-page-room-actions";
import { useRoomPageState } from "@/components/room/hooks/use-room-page-state";
import { useRoomWorkspaceViewModel } from "@/components/room/hooks/use-room-workspace-view-model";
import { useRoomClipboardActions } from "@/components/room/hooks/use-room-clipboard-actions";
import { useRoomAppEntries } from "@/components/room/hooks/use-room-app-entries";
import { useRoomAppRefs } from "@/components/room/hooks/use-room-app-refs";
import { useRoomSegmentedPlaybackRuntime } from "@/components/room/hooks/use-room-segmented-playback-runtime";
export * from "@/components/room/hooks/use-room-page-derived";
export * from "@/components/room/hooks/use-room-playback-actions";

const lastRoomStorageKey = "music-room-last-room";
const peerStorageKey = "music-room-peer-id";

type MusicRoomAppProps = { workspaceOnly?: boolean; initialRoomId?: string | null };

export function MusicRoomApp({ workspaceOnly = true, initialRoomId = null }: MusicRoomAppProps) {
  const router = useRouter();
  const appEntries = useRoomAppEntries({
    initialRoomId
  });

  const [roomState, dispatchRoomStateEvent] = useReducer(
    roomStateReducer,
    initialRoomStateStore
  );
  const roomSnapshot = roomState.snapshot;
  const [peerId, setPeerId] = useState("");
  const pageState = useRoomPageState({
    audioUnlocked: isSegmentedAudioOutputReady()
  });

  const {
    activeSession,
    hasStoredSession,
    hydrated,
    statusMessage,
    setStatusMessage,
    clearIdentity,
    refreshSession
  } = useSessionIdentity({
    initialStatusMessage: "登录后即可进入你的音乐房。",
    sessionStorageKey: "music-room-session"
  });

  const canControlPlayback = !!activeSession && !!roomSnapshot;
  const canDeleteRoom = !!activeSession && roomSnapshot?.room.hostId === activeSession.userId;
  const canReorderQueue = canControlPlayback;
  const pageDerived = useRoomPageDerived({
    activeSessionId: activeSession?.userId,
    peerId,
    roomSnapshot
  });
  const appRefs = useRoomAppRefs({
    roomPlayback: pageDerived.roomPlayback
  });

  const { peerDiagnostics, peerRecentEvents, recordPeerDiagnostic, resetPeerDiagnostics } =
    usePeerDiagnostics({
      highFrequencyEnabled:
        pageState.activeDashboardTab === "members" && pageState.isDiagnosticsPanelOpen
    });
  const uploads = useTrackUploads({
    activeSession,
    roomSnapshot,
    dispatchRoomStateEvent,
    setStatusMessage
  });

  const roomActions = useRoomPageRoomActions({
    workspaceOnly,
    workspaceEntryHref: appEntries.workspaceEntryHref,
    authEntryHref: appEntries.authEntryHref,
    router,
    activeSession,
    audioRef: appRefs.audioRef,
    clearIdentity,
    currentPlaybackPositionRef: appRefs.currentPlaybackPositionRef,
    deleteRoomTrackArtifacts: uploads.deleteRoomTrackArtifacts,
    deleteUploadedTrackArtifacts: uploads.deleteUploadedTrackArtifacts,
    dispatchRoomStateEvent,
    peerId,
    peerStorageKey,
    resetPeerDiagnostics,
    roomSnapshot,
    setAvailableRooms: pageState.setAvailableRooms,
    setBufferHealth: pageState.setBufferHealth,
    setIsNavigatingRoomExit: pageState.setIsNavigatingRoomExit,
    setMediaConnectedPeers: pageState.setMediaConnectedPeers,
    setMediaConnectionState: pageState.setMediaConnectionState,
    setPeerId,
    setPlaybackStartRequest: pageState.setPlaybackStartRequest,
    setPlayerResetEpoch: pageState.setPlayerResetEpoch,
    setPlaylists: pageState.setPlaylists,
    setRoomRecoveryState: pageState.setRoomRecoveryState,
    setStatusMessage,
    setSuppressRoomRecovery: pageState.setSuppressRoomRecovery,
  });
  const roomRuntime = useRoomRuntime({
    workspaceOnly,
    initialRoomId,
    hydrated,
    authEntryHref: appEntries.authEntryHref,
    workspaceEntryHref: appEntries.workspaceEntryHref,
    router,
    lastRoomStorageKey,
    peerStorageKey,
    activeSession,
    hasStoredSession,
    activeSessionRef: appRefs.activeSessionRef,
    refreshSession,
    roomSnapshot,
    dispatchRoomStateEvent,
    currentRoomRef: appRefs.currentRoomRef,
    peerId,
    setPeerId,
    connectedPeers: pageState.connectedPeers,
    setConnectedPeers: pageState.setConnectedPeers,
    setMediaConnectedPeers: pageState.setMediaConnectedPeers,
    suppressRoomRecovery: pageState.suppressRoomRecovery,
    setSuppressRoomRecovery: pageState.setSuppressRoomRecovery,
    setIsRecoveringRoom: pageState.setIsRecoveringRoom,
    isNavigatingRoomExit: pageState.isNavigatingRoomExit,
    setIsNavigatingRoomExit: pageState.setIsNavigatingRoomExit,
    iceConfig: pageState.iceConfig,
    setIceConfig: pageState.setIceConfig,
    iceConfigResolved: pageState.iceConfigResolved,
    setIceConfigResolved: pageState.setIceConfigResolved,
    isPageVisible: pageState.isPageVisible,
    setIsPageVisible: pageState.setIsPageVisible,
    schedulerMode: pageState.schedulerMode,
    setSchedulerMode: pageState.setSchedulerMode,
    bufferHealth: pageState.bufferHealth,
    audioUnlocked: pageState.audioUnlocked,
    roomRecoveryState: pageState.roomRecoveryState,
    setRoomRecoveryState: pageState.setRoomRecoveryState,
    recordPeerDiagnostic,
    deleteUploadedTrackArtifacts: uploads.deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts: uploads.deleteRoomTrackArtifacts,
    socketRef: appRefs.socketRef,
    resetPlayerSurface: roomActions.resetPlayerSurface,
    setStatusMessage,
    statusMessage,
    refreshAvailableRooms: roomActions.refreshAvailableRooms,
    refreshPlaylists: roomActions.refreshPlaylists
  });
  const segmentedPlayback = useRoomSegmentedPlaybackRuntime({
    roomSnapshot, currentTrack: pageDerived.currentTrack, peerId,
    isCurrentSource: pageDerived.isCurrentSourceOwner,
    audioRef: appRefs.audioRef,
    volume: pageState.volume, audioUnlocked: pageState.audioUnlocked,
    setAudioUnlocked: pageState.setAudioUnlocked,
    setLocalAudioStream: roomRuntime.setLocalAudioStream,
    getPeerMediaState: roomRuntime.getPeerMediaState,
    onPlaybackEnded: roomActions.nextTrack,
    setMediaConnectionState: pageState.setMediaConnectionState,
    setSourceStartState: pageState.setSourceStartState,
    setLastSourceStartError: pageState.setLastSourceStartError,
    setStatusMessage,
    recordPeerDiagnostic
  });
  const playbackActions = useRoomPlaybackActions({
    currentPlaybackPositionRef: appRefs.currentPlaybackPositionRef,
    audioRef: appRefs.audioRef,
    roomSnapshot,
    currentPlaybackTrackId: pageDerived.currentPlaybackTrackId,
    playbackMediaEpoch: pageDerived.playbackMediaEpoch,
    playbackQueueVersion: pageDerived.playbackQueueVersion,
    playbackRevision: pageDerived.playbackRevision,
    playbackStatus: pageDerived.playbackStatus,
    isCurrentSourceOwner: pageDerived.isCurrentSourceOwner,
    audioUnlocked: pageState.audioUnlocked,
    handleTrackFilesSelected: uploads.handleFilesSelected,
    playTrack: roomActions.playTrack,
    playQueueItem: roomActions.playQueueItem,
    prevTrack: roomActions.prevTrack,
    nextTrack: roomActions.nextTrack,
    recordPeerDiagnostic,
    setAudioBlockedOverlay: pageState.setAudioBlockedOverlay,
    setAudioUnlocked: pageState.setAudioUnlocked,
    setLastSourceStartError: pageState.setLastSourceStartError,
    setPlaybackStartRequest: pageState.setPlaybackStartRequest,
    setStatusMessage
  });
  useRoomPlaybackEffects({
    dispatchRoomStateEvent,
    initialRoomId
  });
  const clipboardActions = useRoomClipboardActions({
    roomSnapshot,
    setStatusMessage
  });

  const workspaceViewModel = useRoomWorkspaceViewModel({
    roomSnapshot,
    connectedPeers: pageState.connectedPeers,
    mediaConnectedPeers: pageState.mediaConnectedPeers,
    activeDashboardTab: pageState.activeDashboardTab,
    segmentedPlayback,
    peerDiagnostics,
    peerRecentEvents,
    canDeleteRoom,
    statusMessage,
    iceConfig: pageState.iceConfig,
    iceConfigResolved: pageState.iceConfigResolved,
    workspaceOnly,
    initialRoomId,
    activeSessionUserId: activeSession?.userId,
    suppressRoomRecovery: pageState.suppressRoomRecovery,
    isNavigatingRoomExit: pageState.isNavigatingRoomExit,
    isRecoveringRoom: pageState.isRecoveringRoom
  });

  return (
    <RoomAppShell
      activeSession={activeSession}
      audioRef={appRefs.audioRef}
      authEntryHref={appEntries.authEntryHref}
      canControlPlayback={canControlPlayback}
      canDeleteRoom={canDeleteRoom}
      canReorderQueue={canReorderQueue}
      clipboardActions={clipboardActions}
      currentTrack={pageDerived.currentTrack}
      isSourceOwner={pageDerived.isCurrentSourceOwner}
      pageState={pageState}
      playbackActions={playbackActions}
      roomActions={roomActions}
      roomSnapshot={roomSnapshot}
      socket={appRefs.socketRef.current}
      statusMessage={statusMessage}
      uploads={uploads}
      workspaceEntryHref={appEntries.workspaceEntryHref}
      workspaceViewModel={workspaceViewModel}
    />
  );
}
