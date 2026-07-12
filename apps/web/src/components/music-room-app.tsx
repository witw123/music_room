"use client";

import { useReducer, useState } from "react";
import { useAvailabilityAnnouncements, usePeerDiagnostics } from "@/features/p2p";
import { RoomAppShell } from "@/components/room/RoomAppShell";
import { useRouter } from "next/navigation";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { useProgressiveRuntime } from "@/features/playback/use-progressive-runtime";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { useTrackUploads } from "@/features/upload/use-track-uploads";
import { useRoomRuntime } from "@/features/room/hooks/use-room-runtime";
import { initialRoomStateStore, roomStateReducer } from "@/features/room/room-state-reducer";
import { useCurrentProgressiveEngineTypeForSource, useRoomPageDerived } from "@/components/room/hooks/use-room-page-derived";
import { useRoomCachedFullLocalPlayback } from "@/components/room/hooks/use-room-cached-full-local-playback";
import { useRoomCacheLibraryActions } from "@/components/room/hooks/use-room-cache-library-actions";
import { useRoomCacheTrackCleanup } from "@/components/room/hooks/use-room-cache-track-cleanup";
import { useRoomPlaybackEffects } from "@/components/room/hooks/use-room-playback-effects";
import { useRoomPlaybackActions } from "@/components/room/hooks/use-room-playback-actions";
import { useRoomPageRoomActions } from "@/components/room/hooks/use-room-page-room-actions";
import { useRoomPageState } from "@/components/room/hooks/use-room-page-state";
import { useRoomWorkspaceViewModel } from "@/components/room/hooks/use-room-workspace-view-model";
import { useRoomClipboardActions } from "@/components/room/hooks/use-room-clipboard-actions";
import { useRoomAppEntries } from "@/components/room/hooks/use-room-app-entries";
import { useRoomAppRefs } from "@/components/room/hooks/use-room-app-refs";
export {
  getCachedFullLocalPlaybackLoadKey,
  getCachedFullLocalPlaybackLoadMissKey,
  getPlaybackSourceInitializationKey,
  hasPlayableFullLocalPlaybackTrack,
  resolveCachedFullLocalPlaybackLoadTarget,
  resolveStableCurrentTrack,
  selectFullLocalPlaybackTracks,
  shouldNotifyCachedFullLocalPlaybackLoadMiss,
  shouldClearCachedFullLocalPlaybackTrack,
  shouldInitializePlaybackSource
} from "@/components/room/hooks/use-room-page-derived";
export {
  runPlaybackMutationAfterLocalPrime,
  shouldPrimeFullLocalTrackForPlayCommand,
  startBestEffortPlaybackAudioUnlock
} from "@/components/room/hooks/use-room-playback-actions";

const lastRoomStorageKey = "music-room-last-room";
const peerStorageKey = "music-room-peer-id";

type MusicRoomAppProps = {
  workspaceOnly?: boolean;
  initialRoomId?: string | null;
};

export function MusicRoomApp({
  workspaceOnly = true,
  initialRoomId = null
}: MusicRoomAppProps) {
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
    audioUnlocked: roomAudioOutput.isActivated()
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
  const canReorderQueue = canDeleteRoom;
  const pageDerived = useRoomPageDerived({
    activeSessionId: activeSession?.userId,
    peerId,
    roomSnapshot
  });
  const appRefs = useRoomAppRefs({
    roomPlayback: pageDerived.roomPlayback
  });

  const {
    availabilityByTrack,
    queueAvailability,
    mergeAvailability,
    emitAvailability: stableEmitAvailability,
    flushPendingAvailability,
    clearAvailabilityForPeer,
    clearAvailabilityForTrack,
    resetAvailabilityState
  } = useAvailabilityAnnouncements({
    socketRef: appRefs.socketRef
  });
  const { peerDiagnostics, peerRecentEvents, recordPeerDiagnostic, resetPeerDiagnostics } =
    usePeerDiagnostics({
      highFrequencyEnabled:
        pageState.activeDashboardTab === "members" && pageState.isDiagnosticsPanelOpen
    });
  const uploads = useTrackUploads({
    peerId,
    activeSession,
    roomSnapshot,
    dispatchRoomStateEvent,
    setStatusMessage,
    onAvailability: mergeAvailability,
    emitAvailability: stableEmitAvailability
  });

  const cachedPlayback = useRoomCachedFullLocalPlayback({
    uploadedTracks: uploads.uploadedTracks,
    cacheLibraryTracks: uploads.cacheLibraryTracks,
    loadCachedLibraryTrackFile: uploads.loadCachedLibraryTrackFile,
    roomSnapshot,
    currentTrack: pageDerived.currentTrack,
    currentPlaybackTrackId: pageDerived.currentPlaybackTrackId,
    onCachedFullLocalPlaybackLoadMiss: uploads.startPlaybackDemandCacheDownload
  });

  const currentProgressiveEngineTypeForSource = useCurrentProgressiveEngineTypeForSource({
    currentTrack: pageDerived.currentTrack,
    availabilityByTrack,
    peerId
  });

  const progressiveRuntime = useProgressiveRuntime({
      audioRef: appRefs.audioRef,
      roomSnapshot,
      currentTrack: pageDerived.currentTrack,
      peerId,
      availabilityByTrack,
      uploadedTracks: uploads.uploadedTracks,
      fullLocalPlaybackTracks: cachedPlayback.fullLocalPlaybackTracks,
      isCurrentSourceOwner: pageDerived.isCurrentSourceOwner,
      activePlaybackSource: pageState.activePlaybackSource,
      setActivePlaybackSource: pageState.setActivePlaybackSource,
      progressiveFallbackReason: pageState.progressiveFallbackReason,
      setProgressiveFallbackReason: pageState.setProgressiveFallbackReason,
      playbackStartIntent: pageState.playbackStartIntent,
      setPlaybackStartIntent: pageState.setPlaybackStartIntent,
      audioUnlocked: pageState.audioUnlocked,
      setAudioUnlocked: pageState.setAudioUnlocked,
      roomRecoveryState: pageState.roomRecoveryState,
      isPageVisible: pageState.isPageVisible,
      volume: pageState.volume,
      connectedPeersCount: pageState.connectedPeers.length,
      mediaConnectedPeersCount: pageState.mediaConnectedPeers.length,
      peerDiagnostics,
      recordPeerDiagnostic,
      setStatusMessage,
      setSchedulerMode: pageState.setSchedulerMode,
      setBufferHealth: pageState.setBufferHealth,
      setMediaConnectionState: pageState.setMediaConnectionState
  });
  const clearLocalCacheTrackRuntime = useRoomCacheTrackCleanup({ meshRef: appRefs.meshRef, socketRef: appRefs.socketRef, roomId: roomSnapshot?.room.id, peerId, clearAvailabilityForTrack });
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
    clearCacheStreamTrack: clearLocalCacheTrackRuntime,
    destroyProgressiveRuntime: progressiveRuntime.destroyProgressiveRuntime,
    dispatchRoomStateEvent,
    peerId,
    peerStorageKey,
    playbackSourceInitializationKeyRef: appRefs.playbackSourceInitializationKeyRef,
    resetAvailabilityState,
    resetPeerDiagnostics,
    roomSnapshot,
    setActivePlaybackSource: pageState.setActivePlaybackSource,
    setAvailableRooms: pageState.setAvailableRooms,
    setBufferHealth: pageState.setBufferHealth,
    setIsNavigatingRoomExit: pageState.setIsNavigatingRoomExit,
    setMediaConnectedPeers: pageState.setMediaConnectedPeers,
    setMediaConnectionState: pageState.setMediaConnectionState,
    setPeerId,
    setPlaybackStartIntent: pageState.setPlaybackStartIntent,
    setPlayerResetEpoch: pageState.setPlayerResetEpoch,
    setPlaylists: pageState.setPlaylists,
    setProgressiveFallbackReason: pageState.setProgressiveFallbackReason,
    setRoomRecoveryState: pageState.setRoomRecoveryState,
    setSchedulerPlaybackBucketMs: pageState.setSchedulerPlaybackBucketMs,
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
    mediaConnectedPeers: pageState.mediaConnectedPeers,
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
    mediaConnectionState: pageState.mediaConnectionState,
    setMediaConnectionState: pageState.setMediaConnectionState,
    isPageVisible: pageState.isPageVisible,
    setIsPageVisible: pageState.setIsPageVisible,
    schedulerMode: pageState.schedulerMode,
    setSchedulerMode: pageState.setSchedulerMode,
    schedulerPlaybackBucketMs: pageState.schedulerPlaybackBucketMs,
    bufferHealth: pageState.bufferHealth,
    transportGovernorMode: progressiveRuntime.transportGovernorMode,
    activePlaybackSource: pageState.activePlaybackSource,
    progressiveSchedulerPolicy: progressiveRuntime.progressiveSchedulerPolicy,
    isCurrentSourceOwner: pageDerived.isCurrentSourceOwner,
    hasFullLocalTrack: cachedPlayback.hasPlayableFullLocalTrack,
    audioUnlocked: pageState.audioUnlocked,
    getLocalPlaybackPositionMs: progressiveRuntime.getLocalPlaybackPositionMs,
    setAudioUnlocked: pageState.setAudioUnlocked,
    roomRecoveryState: pageState.roomRecoveryState,
    setRoomRecoveryState: pageState.setRoomRecoveryState,
    sourceStartState: pageState.sourceStartState,
    setSourceStartState: pageState.setSourceStartState,
    lastSourceStartError: pageState.lastSourceStartError,
    setLastSourceStartError: pageState.setLastSourceStartError,
    availabilityByTrack,
    queueAvailability,
    clearAvailabilityForPeer,
    clearAvailabilityForTrack,
    flushPendingAvailability,
    recordPeerDiagnostic,
    uploadedTracks: uploads.uploadedTracks,
    fullLocalPlaybackTracks: cachedPlayback.fullLocalPlaybackTracks,
    uploadedTrackIds: Object.keys(uploads.uploadedTracks),
    uploadedTrackIdsRef: appRefs.uploadedTrackIdsRef,
    manualCacheTrackIds: uploads.manualCacheTrackIds,
    startPlaybackDemandCacheDownload: uploads.startPlaybackDemandCacheDownload,
    announceRoomTrackAvailability: uploads.announceRoomTrackAvailability,
    handleManualCachePieceReceived: uploads.handleManualCachePieceReceived,
    handleManualCachePlan: uploads.handleManualCachePlan,
    deleteUploadedTrackArtifacts: uploads.deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts: uploads.deleteRoomTrackArtifacts,
    audioRef: appRefs.audioRef,
    socketRef: appRefs.socketRef,
    chunkSchedulerRef: appRefs.chunkSchedulerRef,
    resetPlayerSurface: roomActions.resetPlayerSurface,
    setStatusMessage,
    statusMessage,
    refreshAvailableRooms: roomActions.refreshAvailableRooms,
    refreshPlaylists: roomActions.refreshPlaylists
  });
  const playbackActions = useRoomPlaybackActions({
    audioRef: appRefs.audioRef,
    currentPlaybackPositionRef: appRefs.currentPlaybackPositionRef,
    roomPlaybackRef: appRefs.roomPlaybackRef,
    roomSnapshot,
    currentTrack: pageDerived.currentTrack,
    currentPlaybackTrackId: pageDerived.currentPlaybackTrackId,
    playbackMediaEpoch: pageDerived.playbackMediaEpoch,
    playbackQueueVersion: pageDerived.playbackQueueVersion,
    playbackRevision: pageDerived.playbackRevision,
    playbackStatus: pageDerived.playbackStatus,
    isCurrentSourceOwner: pageDerived.isCurrentSourceOwner,
    audioUnlocked: pageState.audioUnlocked,
    volume: pageState.volume,
    fullLocalPlaybackTracks: cachedPlayback.fullLocalPlaybackTracks,
    loadCachedFullLocalPlaybackTrack: cachedPlayback.loadCachedFullLocalPlaybackTrack,
    ensureSourcePlaybackStarted: roomRuntime.ensureSourcePlaybackStarted,
    handleTrackFilesSelected: uploads.handleFilesSelected,
    playTrack: roomActions.playTrack,
    playQueueItem: roomActions.playQueueItem,
    prevTrack: roomActions.prevTrack,
    nextTrack: roomActions.nextTrack,
    recordPeerDiagnostic,
    setActivePlaybackSource: pageState.setActivePlaybackSource,
    setAudioBlockedOverlay: pageState.setAudioBlockedOverlay,
    setAudioUnlocked: pageState.setAudioUnlocked,
    setLastSourceStartError: pageState.setLastSourceStartError,
    setMediaConnectionState: pageState.setMediaConnectionState,
    setPlaybackStartIntent: pageState.setPlaybackStartIntent,
    setProgressiveFallbackReason: pageState.setProgressiveFallbackReason,
    setSchedulerPlaybackBucketMs: pageState.setSchedulerPlaybackBucketMs,
    setStatusMessage
  });
  const cacheActions = useRoomCacheLibraryActions({
    roomSnapshot,
    startManualCacheDownload: uploads.startManualCacheDownload,
    pauseManualCacheDownload: uploads.pauseManualCacheDownload,
    deleteCachedLibraryTrackEntry: uploads.deleteCachedLibraryTrackEntry,
    exportCachedLibraryTrack: uploads.exportCachedLibraryTrack,
    importCachedLibraryTrackToRoom: uploads.importCachedLibraryTrackToRoom,
    setStatusMessage,
    clearCacheStreamTrack: clearLocalCacheTrackRuntime
  });
  useRoomPlaybackEffects({
    cachedFullLocalPlaybackTrack: cachedPlayback.cachedFullLocalPlaybackTrack,
    currentPlaybackTrackId: pageDerived.currentPlaybackTrackId,
    currentProgressiveEngineTypeForSource,
    currentTrack: pageDerived.currentTrack,
    dispatchRoomStateEvent,
    ensureSourcePlaybackStarted: roomRuntime.ensureSourcePlaybackStarted,
    hasPlayableFullLocalTrack: cachedPlayback.hasPlayableFullLocalTrack,
    initialRoomId,
    isCurrentSourceOwner: pageDerived.isCurrentSourceOwner,
    playbackSourceInitializationKeyRef: appRefs.playbackSourceInitializationKeyRef,
    playbackStatus: pageDerived.playbackStatus,
    playbackSurfaceKey: pageDerived.playbackSurfaceKey,
    playbackTimelineKey: pageDerived.playbackTimelineKey,
    playbackTopologySnapshot: pageDerived.playbackTopologySnapshot,
    recordPeerDiagnostic,
    setActivePlaybackSource: pageState.setActivePlaybackSource,
    setProgressiveFallbackReason: pageState.setProgressiveFallbackReason
  });
  const clipboardActions = useRoomClipboardActions({
    roomSnapshot,
    setStatusMessage
  });

  const workspaceViewModel = useRoomWorkspaceViewModel({
    roomSnapshot,
    peerId,
    connectedPeers: pageState.connectedPeers,
    mediaConnectedPeers: pageState.mediaConnectedPeers,
    activeDashboardTab: pageState.activeDashboardTab,
    currentTrack: pageDerived.currentTrack,
    availabilityByTrack,
    peerDiagnostics,
    peerRecentEvents,
    canDeleteRoom,
    statusMessage,
    iceConfig: pageState.iceConfig,
    iceConfigResolved: pageState.iceConfigResolved,
    workspaceOnly,
    initialRoomId,
    activeSessionUserId: activeSession?.userId,
    mediaConnectionState: pageState.mediaConnectionState,
    audioUnlocked: pageState.audioUnlocked,
    sourceStartState: pageState.sourceStartState,
    lastSourceStartError: pageState.lastSourceStartError,
    suppressRoomRecovery: pageState.suppressRoomRecovery,
    isNavigatingRoomExit: pageState.isNavigatingRoomExit,
    isRecoveringRoom: pageState.isRecoveringRoom
  });

  return (
    <RoomAppShell
      activeSession={activeSession}
      audioRef={appRefs.audioRef}
      authEntryHref={appEntries.authEntryHref}
      cacheActions={cacheActions}
      canControlPlayback={canControlPlayback}
      canDeleteRoom={canDeleteRoom}
      canReorderQueue={canReorderQueue}
      clipboardActions={clipboardActions}
      currentTrack={pageDerived.currentTrack}
      pageState={pageState}
      playbackActions={playbackActions}
      progressiveRuntime={progressiveRuntime}
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
