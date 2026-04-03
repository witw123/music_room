"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  IceConfigResponse,
  Playlist,
  RoomMediaConnectionState,
  RoomSnapshot
} from "@music-room/shared";
import { ChunkScheduler, useAvailabilityAnnouncements, usePeerDiagnostics } from "@/features/p2p";
import { toUserFacingError } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import type { RoomSocket } from "@/lib/ws-client";
import { BottomPlayerController } from "@/components/BottomPlayerController";
import { RoomWorkspace } from "@/components/room/RoomWorkspace";
import { useRouter } from "next/navigation";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import { getInitialProgressivePlaybackSource } from "@/features/playback/progressive-source-controller";
import { useProgressiveRuntime } from "@/features/playback/use-progressive-runtime";
import { primePlaybackActivation } from "@/features/playback/prime-playback-activation";
import { useTrackUploads } from "@/features/upload/use-track-uploads";
import { useRoomActions } from "@/features/room/hooks/use-room-actions";
import { useRoomRuntime } from "@/features/room/hooks/use-room-runtime";
import { buildAppEntryHref, buildWorkspaceAuthHref } from "@/lib/client-shell";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";
import { useTrackHydrationQueue } from "@/components/room/hooks/use-track-hydration-queue";
import { useRoomDerivedState } from "@/components/room/hooks/use-room-derived-state";
import { useRoomLifecycleActions } from "@/components/room/hooks/use-room-lifecycle-actions";

const lastRoomStorageKey = "music-room-last-room";
const peerStorageKey = "music-room-peer-id";
const maxCachedTracks = 24;

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
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const chunkSchedulerRef = useRef<ChunkScheduler | null>(null);
  const currentPlaybackPositionRef = useRef(0);
  const activeSessionRef = useRef<ReturnType<typeof useSessionIdentity>["activeSession"]>(null);
  const currentRoomRef = useRef<RoomSnapshot | null>(null);
  const uploadedTrackIdsRef = useRef<string[]>([]);

  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [, setAvailableRooms] = useState<RoomSnapshot[]>([]);
  const [, setPlaylists] = useState<Playlist[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [mediaConnectedPeers, setMediaConnectedPeers] = useState<string[]>([]);
  const [peerId, setPeerId] = useState("");
  const [suppressRoomRecovery, setSuppressRoomRecovery] = useState(false);
  const [isRecoveringRoom, setIsRecoveringRoom] = useState(false);
  const [isNavigatingRoomExit, setIsNavigatingRoomExit] = useState(false);
  const [mediaConnectionState, setMediaConnectionState] =
    useState<RoomMediaConnectionState>("idle");
  const [iceConfig, setIceConfig] = useState<IceConfigResponse | null>(null);
  const [iceConfigResolved, setIceConfigResolved] = useState(false);
  const [activeDashboardTab, setActiveDashboardTab] = useState<"queue" | "library" | "members">(
    "queue"
  );
  const [isPageVisible, setIsPageVisible] = useState(
    typeof document === "undefined" ? true : !document.hidden
  );
  const [volume, setVolume] = useState(0.72);
  const [schedulerMode, setSchedulerMode] = useState<"normal" | "conservative" | "idle">(
    "normal"
  );
  const [schedulerPlaybackBucketMs, setSchedulerPlaybackBucketMs] = useState(0);
  const [playerResetEpoch, setPlayerResetEpoch] = useState(0);
  const [bufferHealth, setBufferHealth] = useState<"healthy" | "low" | "critical">("healthy");
  const [activePlaybackSource, setActivePlaybackSource] =
    useState<ProgressivePlaybackSource>("remote-stream");
  const [progressiveFallbackReason, setProgressiveFallbackReason] = useState<string | null>(null);

  const {
    activeSession,
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
    mergeLocalPieceAvailability,
    emitAvailability: stableEmitAvailability,
    flushPendingAvailability
  } = useAvailabilityAnnouncements({
    peerId,
    socketRef,
    activeSessionRef,
    currentRoomRef
  });
  const { peerDiagnostics, peerRecentEvents, recordPeerDiagnostic } = usePeerDiagnostics();

  const canControlPlayback = !!activeSession && !!roomSnapshot;
  const canDeleteRoom = !!activeSession && roomSnapshot?.room.hostId === activeSession.userId;
  const canReorderQueue = canDeleteRoom;
  const isCurrentSourceOwner =
    !!activeSession && roomSnapshot?.room.playback.sourceSessionId === activeSession.userId;
  const currentPlaybackTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;
  const currentTrack = useMemo(
    () =>
      currentPlaybackTrackId
        ? roomSnapshot?.tracks.find((track) => track.id === currentPlaybackTrackId) ?? null
        : null,
    [currentPlaybackTrackId, roomSnapshot?.tracks]
  );

  const {
    uploadedTracks,
    cachedTrackCount,
    handleFilesSelected: handleTrackFilesSelected,
    announceLocalCache,
    hydrateTrackFromPieces,
    deleteUploadedTrackArtifacts
  } = useTrackUploads({
    maxCachedTracks,
    peerId,
    activeSession,
    roomSnapshot,
    setRoomSnapshot,
    setStatusMessage,
    onAvailability: mergeAvailability,
    emitAvailability: stableEmitAvailability
  });

  const { progressiveSchedulerPolicy, getLocalPlaybackPositionMs, destroyProgressiveRuntime } =
    useProgressiveRuntime({
      audioRef,
      remoteAudioRef,
      roomSnapshot,
      currentTrack,
      peerId,
      availabilityByTrack,
      uploadedTracks,
      isCurrentSourceOwner,
      activePlaybackSource,
      setActivePlaybackSource,
      progressiveFallbackReason,
      setProgressiveFallbackReason,
      isPageVisible,
      volume,
      mediaConnectedPeersCount: mediaConnectedPeers.length,
      recordPeerDiagnostic,
      setStatusMessage,
      setSchedulerMode,
      setBufferHealth,
      setMediaConnectionState
    });

  const { scheduleTrackHydration, resetHydrationQueue } = useTrackHydrationQueue({
    isPageVisible,
    uploadedTrackIdsRef,
    chunkSchedulerRef,
    canHydrateTrack: (trackId) => {
      if (trackId !== currentPlaybackTrackId) {
        return true;
      }

      return (
        roomSnapshot?.room.playback.status !== "playing" ||
        progressiveSchedulerPolicy === "steady" ||
        progressiveSchedulerPolicy === "background"
      );
    },
    hydrateTrackFromPieces
  });

  const refreshAvailableRooms = useCallback(async () => {
    try {
      const rooms = await musicRoomApi.listRooms();
      setAvailableRooms(rooms);
    } catch {
      setAvailableRooms([]);
    }
  }, []);

  const refreshPlaylists = useCallback(async () => {
    try {
      const nextPlaylists = await musicRoomApi.listMyPlaylists();
      setPlaylists(nextPlaylists);
    } catch {
      setPlaylists([]);
    }
  }, []);

  const handleTrackDeleted = useCallback(
    (trackId: string) => deleteUploadedTrackArtifacts(trackId),
    [deleteUploadedTrackArtifacts]
  );
  const handleRoomDeleted = useCallback(
    async (trackIds: string[]) => {
      await Promise.all(trackIds.map((trackId) => deleteUploadedTrackArtifacts(trackId)));
    },
    [deleteUploadedTrackArtifacts]
  );

  const resetPlayerSurface = useCallback(() => {
    const localAudio = audioRef.current;
    const remoteAudio = remoteAudioRef.current;

    if (localAudio) {
      localAudio.pause();
      localAudio.srcObject = null;
      localAudio.removeAttribute("src");
      localAudio.load();
    }

    if (remoteAudio) {
      remoteAudio.pause();
      remoteAudio.srcObject = null;
      remoteAudio.load();
    }

    destroyProgressiveRuntime();
    currentPlaybackPositionRef.current = 0;
    resetHydrationQueue();
    setPlayerResetEpoch((current) => current + 1);
    setSchedulerPlaybackBucketMs(0);
    setBufferHealth("healthy");
    setMediaConnectionState("idle");
    setMediaConnectedPeers([]);
    setActivePlaybackSource("remote-stream");
    setProgressiveFallbackReason(null);
  }, [destroyProgressiveRuntime, resetHydrationQueue]);

  const getCurrentPlaybackPositionMs = useCallback(() => currentPlaybackPositionRef.current, []);

  const {
    leaveRoom,
    deleteRoom,
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
    handleEnded
  } = useRoomActions({
    activeSession,
    roomSnapshot,
    setRoomSnapshot,
    setSuppressRoomRecovery,
    setStatusMessage,
    refreshAvailableRooms,
    refreshPlaylists,
    resetPlayerSurface,
    lastRoomStorageKey,
    getCurrentPlaybackPositionMs,
    onTrackDeleted: handleTrackDeleted,
    onRoomDeleted: handleRoomDeleted
  });

  const {
    handleClearIdentity,
    handleLeaveRoomAction,
    handleDeleteRoomAction,
    handleLogout
  } = useRoomLifecycleActions({
    workspaceOnly,
    workspaceEntryHref,
    authEntryHref,
    router,
    clearIdentity,
    resetPlayerSurface,
    setSuppressRoomRecovery,
    setRoomSnapshot,
    setPlaylists,
    leaveRoom,
    deleteRoom,
    setIsNavigatingRoomExit
  });

  const { scheduleRemotePlaybackRetry, syncHostMediaStream } = useRoomRuntime({
    workspaceOnly,
    initialRoomId,
    hydrated,
    authEntryHref,
    workspaceEntryHref,
    router,
    lastRoomStorageKey,
    peerStorageKey,
    activeSession,
    activeSessionRef,
    refreshSession,
    roomSnapshot,
    setRoomSnapshot,
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
    setMediaConnectionState,
    isPageVisible,
    setIsPageVisible,
    schedulerMode,
    setSchedulerMode,
    schedulerPlaybackBucketMs,
    bufferHealth,
    activePlaybackSource,
    progressiveSchedulerPolicy,
    isCurrentSourceOwner,
    availabilityByTrack,
    queueAvailability,
    mergeLocalPieceAvailability,
    flushPendingAvailability,
    recordPeerDiagnostic,
    uploadedTracks,
    uploadedTrackIds: Object.keys(uploadedTracks),
    uploadedTrackIdsRef,
    announceLocalCache,
    deleteUploadedTrackArtifacts,
    scheduleTrackHydration,
    audioRef,
    remoteAudioRef,
    socketRef,
    chunkSchedulerRef,
    resetPlayerSurface,
    setStatusMessage,
    statusMessage,
    refreshAvailableRooms,
    refreshPlaylists
  });

  useEffect(() => {
    if (!currentPlaybackTrackId) {
      setActivePlaybackSource("remote-stream");
      setProgressiveFallbackReason(null);
      return;
    }

    setActivePlaybackSource(
      getInitialProgressivePlaybackSource(!!uploadedTracks[currentPlaybackTrackId])
    );
    setProgressiveFallbackReason(null);
  }, [currentPlaybackTrackId, uploadedTracks]);

  const handleFilesSelected = useCallback(
    async (files: FileList | File[] | null) => {
      try {
        await handleTrackFilesSelected(files);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [handleTrackFilesSelected, setStatusMessage]
  );

  const handleCopyJoinCode = useCallback(async () => {
    if (!roomSnapshot) {
      return;
    }

    try {
      await navigator.clipboard.writeText(roomSnapshot.room.joinCode);
      setStatusMessage(`已复制房间码 ${roomSnapshot.room.joinCode}。`);
    } catch {
      setStatusMessage("复制房间码失败，请手动复制。");
    }
  }, [roomSnapshot, setStatusMessage]);

  const handleLocalPlaybackReady = useCallback(() => {
    void syncHostMediaStream();
  }, [syncHostMediaStream]);

  const handlePlaybackPositionChange = useCallback((positionMs: number) => {
    currentPlaybackPositionRef.current = positionMs;
  }, []);

  const handlePlaybackBucketChange = useCallback((bucketMs: number) => {
    setSchedulerPlaybackBucketMs((current) => (current === bucketMs ? current : bucketMs));
  }, []);

  const handlePlayTrack = useCallback(
    async (trackId?: string) => {
      primePlaybackActivation();
      await playTrack(trackId);
    },
    [playTrack]
  );

  const handlePlayQueueItem = useCallback(
    async (queueItemId: string) => {
      primePlaybackActivation();
      await playQueueItem(queueItemId);
    },
    [playQueueItem]
  );

  const handlePrevTrack = useCallback(async () => {
    primePlaybackActivation();
    await prevTrack();
  }, [prevTrack]);

  const handleNextTrack = useCallback(async () => {
    primePlaybackActivation();
    await nextTrack();
  }, [nextTrack]);

  const handleRemotePlaying = useCallback(() => {
    recordPeerDiagnostic({
      peerId: "remote-media",
      channelKind: "media",
      direction: "local",
      event: "audio-playing",
      summary: "远端音频元素开始播放",
      update: (snapshot) => ({
        ...snapshot,
        remoteTrackStatus: {
          ...snapshot.remoteTrackStatus,
          lastAudioEvent: "playing"
        }
      })
    });
    setMediaConnectionState("live");
  }, [recordPeerDiagnostic]);

  const handleRemoteWaiting = useCallback(() => {
    scheduleRemotePlaybackRetry();
    recordPeerDiagnostic({
      peerId: "remote-media",
      channelKind: "media",
      direction: "local",
      event: "audio-waiting",
      summary: "远端音频元素进入缓冲",
      update: (snapshot) => ({
        ...snapshot,
        remoteTrackStatus: {
          ...snapshot.remoteTrackStatus,
          lastAudioEvent: "waiting"
        }
      })
    });
    setMediaConnectionState("buffering");
  }, [recordPeerDiagnostic, scheduleRemotePlaybackRetry]);

  const handleRemotePause = useCallback(() => {
    scheduleRemotePlaybackRetry();
    recordPeerDiagnostic({
      peerId: "remote-media",
      channelKind: "media",
      direction: "local",
      event: "audio-pause",
      summary: "远端音频元素暂停",
      update: (snapshot) => ({
        ...snapshot,
        remoteTrackStatus: {
          ...snapshot.remoteTrackStatus,
          lastAudioEvent: "pause"
        }
      })
    });
    setMediaConnectionState((current) =>
      roomSnapshot?.room.playback.status === "paused" ? current : "buffering"
    );
  }, [recordPeerDiagnostic, roomSnapshot?.room.playback.status, scheduleRemotePlaybackRetry]);

  const handleRemoteError = useCallback(() => {
    recordPeerDiagnostic({
      peerId: "remote-media",
      channelKind: "media",
      direction: "local",
      event: "audio-error",
      level: "error",
      summary: "远端音频元素播放失败",
      update: (snapshot) => ({
        ...snapshot,
        lastError: "远端音频元素播放失败",
        remoteTrackStatus: {
          ...snapshot.remoteTrackStatus,
          lastAudioEvent: "error"
        }
      })
    });
    setMediaConnectionState("failed");
  }, [recordPeerDiagnostic]);

  const {
    canDisbandRoom,
    availabilitySummary,
    memberTransferSummaries,
    statusTone,
    iceConfigStatus,
    iceConfigSource,
    isRoomTransitionPending,
    showRoomTransitionState
  } = useRoomDerivedState({
    roomSnapshot,
    peerId,
    activeDashboardTab,
    currentTrack,
    availabilityByTrack,
    canDeleteRoom,
    statusMessage,
    iceConfig,
    iceConfigResolved,
    workspaceOnly,
    initialRoomId,
    activeSessionUserId: activeSession?.userId,
    suppressRoomRecovery,
    isNavigatingRoomExit,
    isRecoveringRoom
  });

  return (
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
      connectedPeersCount={connectedPeers.length}
      mediaConnectionState={mediaConnectionState}
      mediaConnectedPeersCount={mediaConnectedPeers.length}
      cachedTrackCount={cachedTrackCount}
      availabilitySummary={availabilitySummary}
      memberTransferSummaries={memberTransferSummaries}
      peerDiagnostics={peerDiagnostics}
      peerRecentEvents={peerRecentEvents}
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
      onPlayQueueItem={handlePlayQueueItem}
      onRemoveQueueItem={removeQueueItem}
      onReorderQueue={reorderQueue}
      onTabChange={setActiveDashboardTab}
      socket={socketRef.current}
      isSyncPending={false}
      playerSlot={
        <BottomPlayerController
          audioRef={audioRef}
          remoteAudioRef={remoteAudioRef}
          roomSnapshot={roomSnapshot}
          activeSession={activeSession}
          currentTrack={currentTrack}
          activePlaybackSource={activePlaybackSource}
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
          onEnded={handleEnded}
          onLocalPlaybackReady={handleLocalPlaybackReady}
          onRemotePlaying={handleRemotePlaying}
          onRemoteWaiting={handleRemoteWaiting}
          onRemotePause={handleRemotePause}
          onRemoteError={handleRemoteError}
        />
      }
    />
  );
}
