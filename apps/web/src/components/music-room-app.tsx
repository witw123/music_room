"use client";

import { useReducer, useRef, useState } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import {
  ChunkScheduler,
  useAvailabilityAnnouncements,
  usePeerDiagnostics
} from "@/features/p2p";
import type { RoomSocket } from "@/lib/ws-client";
import { BottomPlayerController } from "@/components/BottomPlayerController";
import { AudioUnlockOverlay } from "@/components/AudioUnlockOverlay";
import { RoomWorkspace } from "@/components/room/RoomWorkspace";
import { useRouter } from "next/navigation";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { useProgressiveRuntime } from "@/features/playback/use-progressive-runtime";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { useTrackUploads } from "@/features/upload/use-track-uploads";
import { useRoomRuntime } from "@/features/room/hooks/use-room-runtime";
import { buildAppEntryHref, buildWorkspaceAuthHref } from "@/lib/client-shell";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";
import {
  initialRoomStateStore,
  roomStateReducer
} from "@/features/room/room-state-reducer";
import {
  useCurrentProgressiveEngineTypeForSource,
  useRoomPageDerived
} from "@/components/room/hooks/use-room-page-derived";
import { useRoomCachedFullLocalPlayback } from "@/components/room/hooks/use-room-cached-full-local-playback";
import { useRoomCacheLibraryActions } from "@/components/room/hooks/use-room-cache-library-actions";
import { useRoomPlaybackEffects } from "@/components/room/hooks/use-room-playback-effects";
import { useRoomPlaybackActions } from "@/components/room/hooks/use-room-playback-actions";
import { useRoomPageRoomActions } from "@/components/room/hooks/use-room-page-room-actions";
import { useRoomPageState } from "@/components/room/hooks/use-room-page-state";
import { useRoomWorkspaceViewModel } from "@/components/room/hooks/use-room-workspace-view-model";
import { useRoomClipboardActions } from "@/components/room/hooks/use-room-clipboard-actions";

export {
  getCachedFullLocalPlaybackLoadKey,
  getPlaybackSourceInitializationKey,
  hasPlayableFullLocalPlaybackTrack,
  resolveCachedFullLocalPlaybackLoadTarget,
  resolveStableCurrentTrack,
  selectFullLocalPlaybackTracks,
  shouldClearCachedFullLocalPlaybackTrack,
  shouldInitializePlaybackSource
} from "@/components/room/hooks/use-room-page-derived";
export {
  runPlaybackMutationAfterLocalPrime,
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
  const clientPlatform = getClientPlatformFromBrowser();
  const workspaceEntryHref = buildAppEntryHref(clientPlatform);
  const authEntryHref = buildWorkspaceAuthHref({
    clientPlatform,
    redirectTo: initialRoomId ? `/room/${initialRoomId}` : workspaceEntryHref
  });
  const audioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const chunkSchedulerRef = useRef<ChunkScheduler | null>(null);
  const currentPlaybackPositionRef = useRef(0);
  const activeSessionRef = useRef<ReturnType<typeof useSessionIdentity>["activeSession"]>(null);
  const currentRoomRef = useRef<RoomSnapshot | null>(null);
  const uploadedTrackIdsRef = useRef<string[]>([]);

  const [roomState, dispatchRoomStateEvent] = useReducer(
    roomStateReducer,
    initialRoomStateStore
  );
  const roomSnapshot = roomState.snapshot;
  const [peerId, setPeerId] = useState("");
  const playbackSourceInitializationKeyRef = useRef<string | null>(null);
  const {
    setAvailableRooms,
    setPlaylists,
    connectedPeers,
    setConnectedPeers,
    mediaConnectedPeers,
    setMediaConnectedPeers,
    suppressRoomRecovery,
    setSuppressRoomRecovery,
    isRecoveringRoom,
    setIsRecoveringRoom,
    isNavigatingRoomExit,
    setIsNavigatingRoomExit,
    mediaConnectionState,
    setMediaConnectionState,
    iceConfig,
    setIceConfig,
    iceConfigResolved,
    setIceConfigResolved,
    activeDashboardTab,
    setActiveDashboardTab,
    activePlaybackSource,
    setActivePlaybackSource,
    progressiveFallbackReason,
    setProgressiveFallbackReason,
    playbackStartIntent,
    setPlaybackStartIntent,
    roomRecoveryState,
    setRoomRecoveryState,
    isDiagnosticsPanelOpen,
    setIsDiagnosticsPanelOpen,
    isPageVisible,
    setIsPageVisible,
    schedulerMode,
    setSchedulerMode,
    volume,
    setVolume,
    schedulerPlaybackBucketMs,
    setSchedulerPlaybackBucketMs,
    playerResetEpoch,
    setPlayerResetEpoch,
    bufferHealth,
    setBufferHealth,
    audioUnlocked,
    setAudioUnlocked,
    sourceStartState,
    setSourceStartState,
    lastSourceStartError,
    setLastSourceStartError,
    audioBlockedOverlay,
    setAudioBlockedOverlay
  } = useRoomPageState({
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

  const {
    availabilityByTrack,
    queueAvailability,
    mergeAvailability,
    emitAvailability: stableEmitAvailability,
    flushPendingAvailability,
    clearAvailabilityForPeer,
    resetAvailabilityState
  } = useAvailabilityAnnouncements({
    socketRef
  });
  const { peerDiagnostics, peerRecentEvents, recordPeerDiagnostic, resetPeerDiagnostics } =
    usePeerDiagnostics({
      highFrequencyEnabled: activeDashboardTab === "members" && isDiagnosticsPanelOpen
    });

  const canControlPlayback = !!activeSession && !!roomSnapshot;
  const canDeleteRoom = !!activeSession && roomSnapshot?.room.hostId === activeSession.userId;
  const canReorderQueue = canDeleteRoom;
  const {
    roomPlayback,
    currentPlaybackTrackId,
    playbackMediaEpoch,
    playbackQueueVersion,
    playbackRevision,
    playbackStatus,
    isCurrentSourceOwner,
    playbackSurfaceKey,
    playbackTimelineKey,
    playbackTopologySnapshot,
    currentTrack
  } = useRoomPageDerived({
    activeSessionId: activeSession?.userId,
    peerId,
    roomSnapshot
  });
  const roomPlaybackRef = useRef(roomPlayback);
  roomPlaybackRef.current = roomPlayback;
  const {
    uploadedTracks,
    cachedTrackCount,
    cacheLibraryTracks,
    manualCacheTasks,
    manualCacheTrackIds,
    handleFilesSelected: handleTrackFilesSelected,
    announceRoomTrackAvailability,
    startManualCacheDownload,
    startPlaybackDemandCacheDownload,
    pauseManualCacheDownload,
    handleManualCachePieceReceived,
    handleManualCachePlan,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    deleteCachedLibraryTrackEntry,
    loadCachedLibraryTrackFile,
    exportCachedLibraryTrack,
    importCachedLibraryTrackToRoom
  } = useTrackUploads({
    peerId,
    activeSession,
    roomSnapshot,
    dispatchRoomStateEvent,
    setStatusMessage,
    onAvailability: mergeAvailability,
    emitAvailability: stableEmitAvailability
  });

  const {
    cachedFullLocalPlaybackTrack,
    fullLocalPlaybackTracks,
    hasPlayableFullLocalTrack,
    loadCachedFullLocalPlaybackTrack
  } = useRoomCachedFullLocalPlayback({
    uploadedTracks,
    cacheLibraryTracks,
    loadCachedLibraryTrackFile,
    roomSnapshot,
    currentTrack,
    currentPlaybackTrackId
  });

  const currentProgressiveEngineTypeForSource = useCurrentProgressiveEngineTypeForSource({
    currentTrack,
    availabilityByTrack,
    peerId
  });

  const {
    progressiveSchedulerPolicy,
    transportGovernorMode,
    getLocalPlaybackPositionMs,
    destroyProgressiveRuntime
  } =
    useProgressiveRuntime({
      audioRef,
      roomSnapshot,
      currentTrack,
      peerId,
      availabilityByTrack,
      uploadedTracks,
      fullLocalPlaybackTracks,
      isCurrentSourceOwner,
      activePlaybackSource,
      setActivePlaybackSource,
      progressiveFallbackReason,
      setProgressiveFallbackReason,
      playbackStartIntent,
      setPlaybackStartIntent,
      audioUnlocked,
      roomRecoveryState,
      isPageVisible,
      volume,
      connectedPeersCount: connectedPeers.length,
      mediaConnectedPeersCount: mediaConnectedPeers.length,
      peerDiagnostics,
      recordPeerDiagnostic,
      setStatusMessage,
      setSchedulerMode,
      setBufferHealth,
      setMediaConnectionState
    });

  const {
    deleteTrack,
    addToQueue,
    playTrack,
    playQueueItem,
    pauseTrack,
    prevTrack,
    nextTrack,
    removeQueueItem,
    reorderQueue,
    seekTrack,
    handleClearIdentity,
    handleLeaveRoomAction,
    handleDeleteRoomAction,
    handleLogout,
    refreshAvailableRooms,
    refreshPlaylists,
    resetPlayerSurface
  } = useRoomPageRoomActions({
    workspaceOnly,
    workspaceEntryHref,
    authEntryHref,
    router,
    activeSession,
    audioRef,
    clearIdentity,
    currentPlaybackPositionRef,
    deleteRoomTrackArtifacts,
    deleteUploadedTrackArtifacts,
    destroyProgressiveRuntime,
    dispatchRoomStateEvent,
    peerId,
    peerStorageKey,
    playbackSourceInitializationKeyRef,
    resetAvailabilityState,
    resetPeerDiagnostics,
    roomSnapshot,
    setActivePlaybackSource,
    setAvailableRooms,
    setBufferHealth,
    setIsNavigatingRoomExit,
    setMediaConnectedPeers,
    setMediaConnectionState,
    setPeerId,
    setPlaybackStartIntent,
    setPlayerResetEpoch,
    setPlaylists,
    setProgressiveFallbackReason,
    setRoomRecoveryState,
    setSchedulerPlaybackBucketMs,
    setStatusMessage,
    setSuppressRoomRecovery,
  });

  const { ensureSourcePlaybackStarted } = useRoomRuntime({
    workspaceOnly,
    initialRoomId,
    hydrated,
    authEntryHref,
    workspaceEntryHref,
    router,
    lastRoomStorageKey,
    peerStorageKey,
    activeSession,
    hasStoredSession,
    activeSessionRef,
    refreshSession,
    roomSnapshot,
    dispatchRoomStateEvent,
    currentRoomRef,
    peerId,
    setPeerId,
    connectedPeers,
    setConnectedPeers,
    mediaConnectedPeers,
    setMediaConnectedPeers,
    suppressRoomRecovery,
    setSuppressRoomRecovery,
    setIsRecoveringRoom,
    isNavigatingRoomExit,
    setIsNavigatingRoomExit,
    iceConfig,
    setIceConfig,
    iceConfigResolved,
    setIceConfigResolved,
    mediaConnectionState,
    setMediaConnectionState,
    isPageVisible,
    setIsPageVisible,
    schedulerMode,
    setSchedulerMode,
    schedulerPlaybackBucketMs,
    bufferHealth,
    transportGovernorMode,
    activePlaybackSource,
    progressiveSchedulerPolicy,
    isCurrentSourceOwner,
    hasFullLocalTrack: hasPlayableFullLocalTrack,
    audioUnlocked,
    getLocalPlaybackPositionMs,
    setAudioUnlocked,
    roomRecoveryState,
    setRoomRecoveryState,
    sourceStartState,
    setSourceStartState,
    lastSourceStartError,
    setLastSourceStartError,
    availabilityByTrack,
    queueAvailability,
    clearAvailabilityForPeer,
    flushPendingAvailability,
    recordPeerDiagnostic,
    uploadedTracks,
    fullLocalPlaybackTracks,
    uploadedTrackIds: Object.keys(uploadedTracks),
    uploadedTrackIdsRef,
    manualCacheTrackIds,
    startPlaybackDemandCacheDownload,
    announceRoomTrackAvailability,
    handleManualCachePieceReceived,
    handleManualCachePlan,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    audioRef,
    socketRef,
    chunkSchedulerRef,
    resetPlayerSurface,
    setStatusMessage,
    statusMessage,
    refreshAvailableRooms,
    refreshPlaylists
  });

  const {
    handleAudioUnlock,
    handleFilesSelected,
    handleLocalPlaybackReady,
    handleNextTrack,
    handlePlayQueueItem,
    handlePlaybackBucketChange,
    handlePlaybackEnded,
    handlePlaybackPositionChange,
    handlePlayTrack,
    handlePrevTrack
  } = useRoomPlaybackActions({
    audioRef,
    currentPlaybackPositionRef,
    roomPlaybackRef,
    roomSnapshot,
    currentTrack,
    currentPlaybackTrackId,
    playbackMediaEpoch,
    playbackQueueVersion,
    playbackRevision,
    playbackStatus,
    isCurrentSourceOwner,
    audioUnlocked,
    volume,
    fullLocalPlaybackTracks,
    loadCachedFullLocalPlaybackTrack,
    ensureSourcePlaybackStarted,
    handleTrackFilesSelected,
    playTrack,
    playQueueItem,
    prevTrack,
    nextTrack,
    recordPeerDiagnostic,
    setActivePlaybackSource,
    setAudioBlockedOverlay,
    setAudioUnlocked,
    setLastSourceStartError,
    setMediaConnectionState,
    setPlaybackStartIntent,
    setProgressiveFallbackReason,
    setSchedulerPlaybackBucketMs,
    setStatusMessage
  });

  const {
    handleAddCachedLibraryTrackToLibrary,
    handleDeleteCachedLibraryTrack,
    handleExportCachedLibraryTrack,
    handlePauseManualCacheDownload,
    handleStartManualCacheDownload
  } = useRoomCacheLibraryActions({
    roomSnapshot,
    startManualCacheDownload,
    pauseManualCacheDownload,
    deleteCachedLibraryTrackEntry,
    exportCachedLibraryTrack,
    importCachedLibraryTrackToRoom,
    setStatusMessage
  });

  useRoomPlaybackEffects({
    cachedFullLocalPlaybackTrack,
    currentPlaybackTrackId,
    currentProgressiveEngineTypeForSource,
    currentTrack,
    dispatchRoomStateEvent,
    ensureSourcePlaybackStarted,
    hasPlayableFullLocalTrack,
    initialRoomId,
    isCurrentSourceOwner,
    playbackSourceInitializationKeyRef,
    playbackStatus,
    playbackSurfaceKey,
    playbackTimelineKey,
    playbackTopologySnapshot,
    recordPeerDiagnostic,
    setActivePlaybackSource,
    setProgressiveFallbackReason
  });

  const { handleCopyJoinCode } = useRoomClipboardActions({
    roomSnapshot,
    setStatusMessage
  });

  const {
    canDisbandRoom,
    connectedPeersCount,
    mediaConnectedPeersCount,
    availabilitySummary,
    memberTransferSummaries,
    localMemberState,
    statusTone,
    iceConfigStatus,
    iceConfigSource,
    isRoomTransitionPending,
    showRoomTransitionState,
    workspacePeerDiagnostics
  } = useRoomWorkspaceViewModel({
    roomSnapshot,
    peerId,
    connectedPeers,
    mediaConnectedPeers,
    activeDashboardTab,
    currentTrack,
    availabilityByTrack,
    peerDiagnostics,
    peerRecentEvents,
    canDeleteRoom,
    statusMessage,
    iceConfig,
    iceConfigResolved,
    workspaceOnly,
    initialRoomId,
    activeSessionUserId: activeSession?.userId,
    mediaConnectionState,
    audioUnlocked,
    sourceStartState,
    lastSourceStartError,
    suppressRoomRecovery,
    isNavigatingRoomExit,
    isRecoveringRoom
  });

  return (
    <>
      <AudioUnlockOverlay
        visible={audioBlockedOverlay}
        onUnlock={handleAudioUnlock}
      />
      <RoomWorkspace
        activeSession={activeSession}
        statusMessage={statusMessage}
        statusTone={statusTone}
        roomSnapshot={roomSnapshot}
        currentTrack={currentTrack}
        canControlPlayback={canControlPlayback}
        canDeleteRoom={canDeleteRoom}
        canDisbandRoom={canDisbandRoom}
        canReorderQueue={canReorderQueue}
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
        peerDiagnostics={workspacePeerDiagnostics.peerDiagnostics}
        peerRecentEvents={workspacePeerDiagnostics.peerRecentEvents}
        iceConfigSource={iceConfigSource}
        iceConfigStatus={iceConfigStatus}
        workspaceEntryHref={workspaceEntryHref}
        authEntryHref={authEntryHref}
        showRoomTransitionState={showRoomTransitionState}
        isNavigatingRoomExit={isNavigatingRoomExit}
        isRecoveringRoom={isRecoveringRoom}
        isRoomTransitionPending={isRoomTransitionPending}
        onLogout={handleLogout}
        onClearIdentity={handleClearIdentity}
        onCopyJoinCode={handleCopyJoinCode}
        onLeaveRoom={handleLeaveRoomAction}
        onDeleteRoom={handleDeleteRoomAction}
        onFilesSelected={handleFilesSelected}
        onAddToQueue={addToQueue}
        onDeleteTrack={deleteTrack}
        onPlayTrack={handlePlayTrack}
        onStartManualCacheDownload={handleStartManualCacheDownload}
        onPauseManualCacheDownload={handlePauseManualCacheDownload}
        onAddCachedLibraryTrackToLibrary={handleAddCachedLibraryTrackToLibrary}
        onExportCachedLibraryTrack={handleExportCachedLibraryTrack}
        onDeleteCachedLibraryTrack={handleDeleteCachedLibraryTrack}
        onPlayQueueItem={handlePlayQueueItem}
        onRemoveQueueItem={removeQueueItem}
        onReorderQueue={reorderQueue}
        onTabChange={setActiveDashboardTab}
        onDiagnosticsVisibilityChange={setIsDiagnosticsPanelOpen}
        socket={socketRef.current}
        isSyncPending={false}
        playerSlot={
          <BottomPlayerController
            audioRef={audioRef}
            roomSnapshot={roomSnapshot}
            activeSession={activeSession}
            currentTrack={currentTrack}
            resetEpoch={playerResetEpoch}
            onPlaybackPositionChange={handlePlaybackPositionChange}
            onPlaybackBucketChange={handlePlaybackBucketChange}
            onVolumeChange={setVolume}
            getLocalPlaybackPositionMs={getLocalPlaybackPositionMs}
            onPlay={handlePlayTrack}
            onPause={pauseTrack}
            onSeek={seekTrack}
            onPrev={handlePrevTrack}
            onNext={handleNextTrack}
            onEnded={handlePlaybackEnded}
            onLocalPlaybackReady={handleLocalPlaybackReady}
          />
        }
      />
    </>
  );
}
