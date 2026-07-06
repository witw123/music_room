"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import {
  ChunkScheduler,
  selectCanonicalTrackAvailabilityAnnouncement,
  useAvailabilityAnnouncements,
  usePeerDiagnostics
} from "@/features/p2p";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import { toUserFacingError } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import type { RoomSocket } from "@/lib/ws-client";
import { BottomPlayerController } from "@/components/BottomPlayerController";
import { AudioUnlockOverlay } from "@/components/AudioUnlockOverlay";
import { RoomWorkspace } from "@/components/room/RoomWorkspace";
import { useRouter } from "next/navigation";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { useProgressiveRuntime } from "@/features/playback/use-progressive-runtime";
import {
  createPlaybackStartIntent,
  type PlaybackStartIntent
} from "@/features/playback/playback-start-intent";
import { getSlidingWindowPlaybackSource } from "@/features/playback/progressive-source-controller";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import {
  buildProgressiveTrackManifest,
  getEffectivePlaybackPositionMs,
  getProgressiveEngineType
} from "@/features/playback/progressive-playback";
import { resolveSlidingWindowFormat } from "@/features/playback/sliding-window/format-detection";
import { isCachedLibraryTrackUsableForRoomTrack } from "@/features/upload/cached-library-track-policy";
import { useTrackUploads } from "@/features/upload/use-track-uploads";
import { useRoomActions } from "@/features/room/hooks/use-room-actions";
import { useRoomRuntime } from "@/features/room/hooks/use-room-runtime";
import {
  resolvePlaybackSourceResetReason
} from "@/features/room/hooks/room-playback-topology";
import { buildAppEntryHref, buildWorkspaceAuthHref } from "@/lib/client-shell";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";
import {
  selectWorkspacePeerDiagnostics,
  useRoomDerivedState
} from "@/components/room/hooks/use-room-derived-state";
import { useRoomLifecycleActions } from "@/components/room/hooks/use-room-lifecycle-actions";
import { consumeRoomSnapshotHandoff } from "@/lib/room-snapshot-handoff";
import { filterOpenPublicRooms } from "@/features/room/room-list-visibility";
import {
  initialRoomStateStore,
  roomStateReducer
} from "@/features/room/room-state-reducer";
import {
  getCachedFullLocalPlaybackLoadKey,
  getPlaybackSourceInitializationKey,
  hasPlayableFullLocalPlaybackTrack,
  resolveCachedFullLocalPlaybackLoadTarget,
  selectFullLocalPlaybackTracks,
  shouldClearCachedFullLocalPlaybackTrack,
  shouldInitializePlaybackSource,
  useRoomPageDerived,
  type CachedFullLocalPlaybackLoadTarget,
  type CachedFullLocalPlaybackTrack
} from "@/components/room/hooks/use-room-page-derived";
import { useRoomPageState } from "@/components/room/hooks/use-room-page-state";

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

const lastRoomStorageKey = "music-room-last-room";
const peerStorageKey = "music-room-peer-id";

type MusicRoomAppProps = {
  workspaceOnly?: boolean;
  initialRoomId?: string | null;
};

export function runPlaybackMutationAfterLocalPrime(input: {
  primeLocalPlayback: () => Promise<unknown>;
  mutatePlayback: () => Promise<unknown>;
}) {
  void input.primeLocalPlayback().catch(() => undefined);
  return input.mutatePlayback();
}

export function startBestEffortPlaybackAudioUnlock(input: {
  unlockAudio: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}) {
  void input.unlockAudio().catch((error) => {
    input.onError?.(error);
  });
}

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
  const resetRealtimePeer = useCallback(() => {
    const nextPeerId = `peer_${crypto.randomUUID()}`;
    window.sessionStorage.setItem(peerStorageKey, nextPeerId);
    setPeerId(nextPeerId);
  }, []);

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

  const [cachedFullLocalPlaybackTrack, setCachedFullLocalPlaybackTrack] =
    useState<CachedFullLocalPlaybackTrack | null>(null);
  const cachedFullLocalPlaybackTrackRef = useRef<CachedFullLocalPlaybackTrack | null>(null);
  const replaceCachedFullLocalPlaybackTrack = useCallback(
    (next: CachedFullLocalPlaybackTrack | null) => {
      const previous = cachedFullLocalPlaybackTrackRef.current;
      if (previous && previous.objectUrl !== next?.objectUrl) {
        URL.revokeObjectURL(previous.objectUrl);
      }
      cachedFullLocalPlaybackTrackRef.current = next;
      setCachedFullLocalPlaybackTrack(next);
    },
    []
  );
  const fullLocalPlaybackTracks = useMemo(
    () =>
      selectFullLocalPlaybackTracks({
        uploadedTracks,
        cachedPlaybackTrack: cachedFullLocalPlaybackTrack
      }),
    [cachedFullLocalPlaybackTrack, uploadedTracks]
  );
  const hasPlayableFullLocalTrack = useMemo(
    () =>
      hasPlayableFullLocalPlaybackTrack({
        currentPlaybackTrackId,
        fullLocalPlaybackTracks
      }),
    [currentPlaybackTrackId, fullLocalPlaybackTracks]
  );

  const loadCachedFullLocalPlaybackTrack = useCallback(
    async (trackId: string | null | undefined) => {
      if (!trackId) {
        return null;
      }

      const uploadedTrack = uploadedTracks[trackId] ?? null;
      if (uploadedTrack) {
        return uploadedTrack;
      }

      const roomTrack =
        roomSnapshot?.tracks.find((entry) => entry.id === trackId) ??
        (currentTrack?.id === trackId ? currentTrack : null);
      if (!roomTrack) {
        return null;
      }

      const existing = cachedFullLocalPlaybackTrackRef.current;
      if (existing?.trackId === trackId && existing.fileHash === roomTrack.fileHash) {
        return existing;
      }

      const cachedTrack = cacheLibraryTracks.find((entry) =>
        isCachedLibraryTrackUsableForRoomTrack({
          cachedTrack: entry,
          roomTrack
        })
      );
      if (!cachedTrack) {
        return null;
      }

      const cachedTrackFile = await loadCachedLibraryTrackFile(cachedTrack.fileHash);
      if (
        !cachedTrackFile ||
        !isCachedLibraryTrackUsableForRoomTrack({
          cachedTrack: cachedTrackFile,
          roomTrack
        })
      ) {
        return null;
      }

      const next = {
        trackId,
        fileHash: roomTrack.fileHash,
        file: cachedTrackFile.file,
        objectUrl: URL.createObjectURL(cachedTrackFile.file)
      };
      replaceCachedFullLocalPlaybackTrack(next);
      return next;
    },
    [
      cacheLibraryTracks,
      currentTrack,
      loadCachedLibraryTrackFile,
      replaceCachedFullLocalPlaybackTrack,
      roomSnapshot?.tracks,
      uploadedTracks
    ]
  );

  const currentUploadedPlaybackTrack = currentPlaybackTrackId
    ? uploadedTracks[currentPlaybackTrackId] ?? null
    : null;
  const cachedFullLocalPlaybackLoadTarget = useMemo(
    () =>
      resolveCachedFullLocalPlaybackLoadTarget({
        currentPlaybackTrackId,
        currentTrack,
        uploadedTrack: currentUploadedPlaybackTrack,
        cachedPlaybackTrack: cachedFullLocalPlaybackTrack,
        cacheLibraryTracks
      }),
    [
      cacheLibraryTracks,
      cachedFullLocalPlaybackTrack,
      currentPlaybackTrackId,
      currentTrack,
      currentUploadedPlaybackTrack
    ]
  );
  const cachedFullLocalPlaybackLoadKey = getCachedFullLocalPlaybackLoadKey(
    cachedFullLocalPlaybackLoadTarget
  );
  const cachedFullLocalPlaybackLoadTargetRef =
    useRef<CachedFullLocalPlaybackLoadTarget | null>(null);
  useEffect(() => {
    cachedFullLocalPlaybackLoadTargetRef.current = cachedFullLocalPlaybackLoadTarget;
  }, [cachedFullLocalPlaybackLoadTarget]);

  useEffect(() => {
    const target = cachedFullLocalPlaybackLoadTargetRef.current;
    if (!target || !cachedFullLocalPlaybackLoadKey) {
      if (
        shouldClearCachedFullLocalPlaybackTrack({
          currentPlaybackTrackId,
          currentTrackFileHash: currentTrack?.fileHash ?? null,
          uploadedTrack: currentUploadedPlaybackTrack,
          cachedPlaybackTrack: cachedFullLocalPlaybackTrackRef.current
        })
      ) {
        replaceCachedFullLocalPlaybackTrack(null);
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      const cachedTrackFile = await loadCachedLibraryTrackFile(target.cachedFileHash);
      const latestTarget = cachedFullLocalPlaybackLoadTargetRef.current;
      if (
        cancelled ||
        getCachedFullLocalPlaybackLoadKey(latestTarget) !== cachedFullLocalPlaybackLoadKey ||
        !cachedTrackFile ||
        !isCachedLibraryTrackUsableForRoomTrack({
          cachedTrack: cachedTrackFile,
          roomTrack: target.roomTrack
        })
      ) {
        return;
      }

      const objectUrl = URL.createObjectURL(cachedTrackFile.file);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      replaceCachedFullLocalPlaybackTrack({
        trackId: target.trackId,
        fileHash: target.fileHash,
        file: cachedTrackFile.file,
        objectUrl
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    cachedFullLocalPlaybackLoadKey,
    currentPlaybackTrackId,
    currentTrack?.fileHash,
    currentUploadedPlaybackTrack,
    loadCachedLibraryTrackFile,
    replaceCachedFullLocalPlaybackTrack
  ]);

  useEffect(
    () => () => {
      const cachedTrack = cachedFullLocalPlaybackTrackRef.current;
      if (cachedTrack) {
        URL.revokeObjectURL(cachedTrack.objectUrl);
        cachedFullLocalPlaybackTrackRef.current = null;
      }
    },
    []
  );

  const currentProgressiveEngineTypeForSource = useMemo(() => {
    if (!currentTrack?.id) {
      return "none";
    }

    const trackAvailability = availabilityByTrack[currentTrack.id] ?? {};
    const localAvailability = trackAvailability[peerId] ?? null;
    const manifestHint = selectCanonicalTrackAvailabilityAnnouncement(
      Object.values(trackAvailability)
    );
    const manifest = buildProgressiveTrackManifest(
      currentTrack,
      localAvailability,
      manifestHint
    );

    return getProgressiveEngineType(manifest);
  }, [availabilityByTrack, currentTrack, peerId]);

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

  const refreshAvailableRooms = useCallback(async () => {
    try {
      const rooms = await musicRoomApi.listRooms();
      setAvailableRooms(filterOpenPublicRooms(rooms));
    } catch {
      setAvailableRooms([]);
    }
  }, [setAvailableRooms]);

  const refreshPlaylists = useCallback(async () => {
    try {
      const nextPlaylists = await musicRoomApi.listMyPlaylists();
      setPlaylists(nextPlaylists);
    } catch {
      setPlaylists([]);
    }
  }, [setPlaylists]);

  const handleTrackDeleted = useCallback(
    (trackId: string) => deleteUploadedTrackArtifacts(trackId),
    [deleteUploadedTrackArtifacts]
  );
  const handleRoomDeleted = useCallback(
    async (trackIds: string[]) => {
      await deleteRoomTrackArtifacts(trackIds);
    },
    [deleteRoomTrackArtifacts]
  );

  const resetPlayerSurface = useCallback(() => {
    const localAudio = audioRef.current;

    if (localAudio) {
      localAudio.pause();
      localAudio.srcObject = null;
      localAudio.removeAttribute("src");
      localAudio.load();
    }

    destroyProgressiveRuntime();
    resetAvailabilityState();
    resetPeerDiagnostics();
    currentPlaybackPositionRef.current = 0;
    setPlayerResetEpoch((current) => current + 1);
    setSchedulerPlaybackBucketMs(0);
    setBufferHealth("healthy");
    setMediaConnectionState("idle");
    setMediaConnectedPeers([]);
    playbackSourceInitializationKeyRef.current = null;
    setActivePlaybackSource("progressive-local");
    setProgressiveFallbackReason(null);
    setPlaybackStartIntent(null);
    setRoomRecoveryState({
      phase: "joining",
      mode: "steady",
      generation: null,
      bootstrapStartedAt: null,
      bootstrapSourcePeerId: null,
      pendingSnapshot: false,
      pendingData: false,
      pendingMedia: false,
      listenerBootstrapAttempts: null,
      fullLocalRecoveryActive: false
    });
  }, [
    destroyProgressiveRuntime,
    resetAvailabilityState,
    resetPeerDiagnostics,
    setActivePlaybackSource,
    setBufferHealth,
    setMediaConnectedPeers,
    setMediaConnectionState,
    setPlaybackStartIntent,
    setPlayerResetEpoch,
    setProgressiveFallbackReason,
    setRoomRecoveryState,
    setSchedulerPlaybackBucketMs
  ]);

  const getCurrentPlaybackPositionMs = useCallback(() => currentPlaybackPositionRef.current, []);
  const getCurrentPeerId = useCallback(() => peerId || null, [peerId]);

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
    seekTrack
  } = useRoomActions({
    activeSession,
    roomSnapshot,
    dispatchRoomStateEvent,
    setSuppressRoomRecovery,
    setStatusMessage,
    refreshAvailableRooms,
    refreshPlaylists,
    resetPlayerSurface,
    resetRealtimePeer,
    lastRoomStorageKey,
    getCurrentPlaybackPositionMs,
    getCurrentPeerId,
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
    resetRealtimePeer,
    setSuppressRoomRecovery,
    dispatchRoomStateEvent,
    setPlaylists,
    leaveRoom,
    deleteRoom,
    setIsNavigatingRoomExit
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

  useEffect(() => {
    if (
      isCurrentSourceOwner &&
      playbackStatus === "playing" &&
      currentPlaybackTrackId &&
      cachedFullLocalPlaybackTrack?.trackId === currentPlaybackTrackId
    ) {
      void ensureSourcePlaybackStarted();
    }
  }, [
    cachedFullLocalPlaybackTrack?.trackId,
    currentPlaybackTrackId,
    ensureSourcePlaybackStarted,
    isCurrentSourceOwner,
    playbackStatus
  ]);

  useEffect(() => {
    if (!initialRoomId) {
      return;
    }

    const handoffSnapshot = consumeRoomSnapshotHandoff(initialRoomId);
    if (!handoffSnapshot) {
      return;
    }

    dispatchRoomStateEvent({
      type: "bootstrap-handoff",
      snapshot: handoffSnapshot
    });
  }, [initialRoomId]);

  useEffect(() => {
    const nextInitializationKey = getPlaybackSourceInitializationKey({
      playbackSurfaceKey,
      currentPlaybackTrackId,
      currentTrack,
      currentProgressiveEngineTypeForSource,
      hasPlayableFullLocalTrack
    });
    if (
      !shouldInitializePlaybackSource({
        previousInitializationKey: playbackSourceInitializationKeyRef.current,
        nextInitializationKey
      })
    ) {
      return;
    }
    playbackSourceInitializationKeyRef.current = nextInitializationKey;

    if (!currentPlaybackTrackId) {
      setActivePlaybackSource("progressive-local");
      setProgressiveFallbackReason(null);
      return;
    }

    setActivePlaybackSource(
      getSlidingWindowPlaybackSource({
        hasFullLocalTrack: hasPlayableFullLocalTrack,
        format: resolveSlidingWindowFormat({
          mimeType: currentTrack?.mimeType ?? null,
          codec: currentTrack?.codec ?? null,
          title: currentTrack?.title ?? null
        }),
        progressiveEngineType: currentProgressiveEngineTypeForSource
      })
    );
    setProgressiveFallbackReason(null);
  }, [
    playbackSurfaceKey,
    currentPlaybackTrackId,
    currentTrack,
    currentProgressiveEngineTypeForSource,
    hasPlayableFullLocalTrack,
    setActivePlaybackSource,
    setProgressiveFallbackReason
  ]);

  const previousPlaybackRef = useRef(playbackTopologySnapshot);

  useEffect(() => {
    const previousPlayback = previousPlaybackRef.current;
    const nextPlayback = playbackTopologySnapshot;
    const sourceResetReason = resolvePlaybackSourceResetReason({
      previousPlayback,
      nextPlayback
    });
    previousPlaybackRef.current = nextPlayback;

    recordPeerDiagnostic({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "playback-surface-state",
      summary: playbackSurfaceKey
        ? `播放面 ${playbackSurfaceKey}`
        : "当前没有活跃播放面",
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          ...(
            snapshot.progressivePlaybackStatus ??
            createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
          ),
          playbackSurfaceKey,
          playbackTimelineKey,
          sourceResetReason
        }
      })
    });
  }, [
    playbackSurfaceKey,
    playbackTimelineKey,
    recordPeerDiagnostic,
    playbackTopologySnapshot
  ]);

  const handleStartManualCacheDownload = useCallback(
    async (trackId: string) => {
      try {
        await startManualCacheDownload(trackId);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [setStatusMessage, startManualCacheDownload]
  );

  const handlePauseManualCacheDownload = useCallback((trackId: string) => {
    pauseManualCacheDownload(trackId);
    const trackTitle = roomSnapshot?.tracks.find((track) => track.id === trackId)?.title ?? "歌曲";
    setStatusMessage(`已暂停《${trackTitle}》的缓存下载。`);
  }, [pauseManualCacheDownload, roomSnapshot?.tracks, setStatusMessage]);

  const handleDeleteCachedLibraryTrack = useCallback(
    async (fileHash: string) => {
      try {
        await deleteCachedLibraryTrackEntry(fileHash);
        setStatusMessage("已从我的缓存库移除歌曲。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [deleteCachedLibraryTrackEntry, setStatusMessage]
  );

  const handleExportCachedLibraryTrack = useCallback(
    async (fileHash: string) => {
      try {
        await exportCachedLibraryTrack(fileHash);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [exportCachedLibraryTrack, setStatusMessage]
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

  const ensureRoomAudioUnlocked = useCallback(
    async (reason: string) => {
      if (roomAudioOutput.isActivated()) {
        setAudioUnlocked(true);
        setLastSourceStartError(null);
        return true;
      }

      try {
        const primeResult = await roomAudioOutput.primeOutputs({
          localAudio: audioRef.current
        });
        setAudioUnlocked(primeResult.ok);
        if (!primeResult.ok) {
          const message = "浏览器仍未允许房间音频输出";
          setLastSourceStartError(message);
          setStatusMessage(message);
          recordPeerDiagnostic({
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: "audio-unlock-failed",
            level: "warning",
            summary: message,
            update: (snapshot) => ({
              ...snapshot,
              lastError: message,
              progressivePlaybackStatus: {
                ...(
                  snapshot.progressivePlaybackStatus ??
                  createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
                ),
                audioUnlocked: false,
                lastSourceStartError: message
              }
            })
          });
          return false;
        }
        setLastSourceStartError(null);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "audio-unlocked",
          summary: `房间音频已解锁：${reason}`,
          recordEvent: false,
          update: (snapshot) => ({
            ...snapshot,
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              audioUnlocked: true,
              lastSourceStartError: null
            }
          })
        });
        return true;
      } catch (error) {
        const message = toUserFacingError(error);
        setAudioUnlocked(roomAudioOutput.isActivated());
        setLastSourceStartError(message);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "audio-unlock-failed",
          level: "error",
          summary: `房间音频解锁失败：${message}`,
          update: (snapshot) => ({
            ...snapshot,
            lastError: `房间音频解锁失败：${message}`,
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              audioUnlocked: roomAudioOutput.isActivated(),
              lastSourceStartError: message
            }
          })
        });
        return false;
      }
    },
    [
      audioRef,
      recordPeerDiagnostic,
      setAudioUnlocked,
      setLastSourceStartError,
      setStatusMessage
    ]
  );

  const handleLocalPlaybackReady = useCallback(() => {
    void ensureSourcePlaybackStarted();
  }, [ensureSourcePlaybackStarted]);

  const handlePlaybackPositionChange = useCallback((positionMs: number) => {
    currentPlaybackPositionRef.current = positionMs;
  }, []);

  const handlePlaybackBucketChange = useCallback((bucketMs: number) => {
    setSchedulerPlaybackBucketMs((current) => (current === bucketMs ? current : bucketMs));
  }, [setSchedulerPlaybackBucketMs]);

  const primeFullLocalTrackPlayback = useCallback(
    async (trackId: string | null | undefined) => {
      if (!trackId) {
        return false;
      }

      const localTrack =
        fullLocalPlaybackTracks[trackId] ?? (await loadCachedFullLocalPlaybackTrack(trackId));
      const audio = audioRef.current;
      if (!localTrack || !audio) {
        return false;
      }

      const track =
        roomSnapshot?.tracks.find((entry) => entry.id === trackId) ?? currentTrack ?? null;
      const playback = roomPlaybackRef.current;
      const positionMs =
        playback?.currentTrackId === trackId
          ? getEffectivePlaybackPositionMs(playback, track?.durationMs ?? 0, Date.now())
          : 0;

      const hadSrcObject = !!audio.srcObject;
      if (audio.srcObject) {
        audio.srcObject = null;
      }
      if (audio.src !== localTrack.objectUrl || hadSrcObject) {
        audio.src = localTrack.objectUrl;
        audio.load();
      }
      audio.muted = false;
      audio.volume = volume;
      if (Number.isFinite(positionMs) && positionMs > 0) {
        audio.currentTime = Math.max(0, positionMs / 1000);
      }

      const playResult = await roomAudioOutput.playElement(audio);
      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: playResult.ok ? "full-local-prime-play" : "full-local-prime-play-failed",
        level: playResult.ok ? "info" : "warning",
        summary: playResult.ok
          ? `点击手势内已预启动本地完整音频 ${trackId}`
          : `点击手势内本地完整音频启动失败 ${trackId}: ${playResult.error ?? "play() failed"}`,
        recordEvent: false
      });
      if (playResult.ok) {
        setActivePlaybackSource("full-local");
        setProgressiveFallbackReason(null);
        setMediaConnectionState("live");
      }
      return playResult.ok;
    },
    [
      audioRef,
      currentTrack,
      fullLocalPlaybackTracks,
      loadCachedFullLocalPlaybackTrack,
      recordPeerDiagnostic,
      roomSnapshot?.tracks,
      setActivePlaybackSource,
      setMediaConnectionState,
      setProgressiveFallbackReason,
      volume
    ]
  );

  const handleFilesSelected = useCallback(
    async (files: FileList | File[] | null) => {
      try {
        if (files && Array.from(files).length > 0) {
          await ensureRoomAudioUnlocked("track-upload");
        }
        await handleTrackFilesSelected(files);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [ensureRoomAudioUnlocked, handleTrackFilesSelected, setStatusMessage]
  );

  const armPlaybackStart = useCallback(
    async (input: {
      reason: PlaybackStartIntent["reason"];
      trackId?: string | null;
      queueItemId?: string | null;
      previousTrackId?: string | null;
    }) => {
      setPlaybackStartIntent(
        createPlaybackStartIntent({
          reason: input.reason,
          trackId: input.trackId,
          queueItemId: input.queueItemId,
          previousTrackId: input.previousTrackId,
          targetPlaybackRevision:
            (playbackRevision ??
              playbackQueueVersion ??
              0) + 1,
          previousQueueVersion: playbackQueueVersion,
          previousMediaEpoch: playbackMediaEpoch
        })
      );
      setStatusMessage("正在准备音源...");
      startBestEffortPlaybackAudioUnlock({
        unlockAudio: () => ensureRoomAudioUnlocked(`playback-intent:${input.reason}`),
        onError: (error) => {
          const message = toUserFacingError(error);
          recordPeerDiagnostic({
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: "audio-prime-failed",
            level: "error",
            summary: `音频输出预激活失败：${message}`,
            update: (snapshot) => ({
              ...snapshot,
              lastError: `音频输出预激活失败：${message}`
            })
          });
          setStatusMessage("音频输出初始化失败，已跳过预激活并继续尝试播放。");
        }
      });
    },
    [
      ensureRoomAudioUnlocked,
      recordPeerDiagnostic,
      playbackMediaEpoch,
      playbackQueueVersion,
      playbackRevision,
      setPlaybackStartIntent,
      setStatusMessage
    ]
  );

  useEffect(() => {
    if (!roomSnapshot?.room.id || audioUnlocked) {
      return;
    }

    const handleFirstInteraction = () => {
      void ensureRoomAudioUnlocked("natural-room-interaction");
    };

    window.addEventListener("pointerdown", handleFirstInteraction, {
      capture: true,
      passive: true
    });
    window.addEventListener("touchstart", handleFirstInteraction, {
      capture: true,
      passive: true
    });
    window.addEventListener("keydown", handleFirstInteraction, true);

    return () => {
      window.removeEventListener("pointerdown", handleFirstInteraction, true);
      window.removeEventListener("touchstart", handleFirstInteraction, true);
      window.removeEventListener("keydown", handleFirstInteraction, true);
    };
  }, [audioUnlocked, ensureRoomAudioUnlocked, roomSnapshot?.room.id]);

  const handlePlayTrack = useCallback(
    async (trackId?: string) => {
      const targetTrackId = trackId ?? roomSnapshot?.room.playback.currentTrackId ?? null;
      await armPlaybackStart({
        reason: trackId ? "track" : "resume-current",
        trackId: targetTrackId
      });
      await runPlaybackMutationAfterLocalPrime({
        primeLocalPlayback: () => primeFullLocalTrackPlayback(targetTrackId),
        mutatePlayback: () => playTrack(trackId)
      });
    },
    [
      armPlaybackStart,
      playTrack,
      primeFullLocalTrackPlayback,
      roomSnapshot?.room.playback.currentTrackId
    ]
  );

  const handleAddCachedLibraryTrackToLibrary = useCallback(
    async (fileHash: string) => {
      try {
        const trackId = await importCachedLibraryTrackToRoom(fileHash);
        if (!trackId) {
          return;
        }
        const importedTrack = roomSnapshot?.tracks.find((track) => track.id === trackId)?.title ?? "歌曲";
        setStatusMessage(`已将《${importedTrack}》添加到当前曲库。`);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [importCachedLibraryTrackToRoom, roomSnapshot?.tracks, setStatusMessage]
  );

  const handlePlayQueueItem = useCallback(
    async (queueItemId: string) => {
      const queueTrackId =
        roomSnapshot?.queue.find((item) => item.id === queueItemId)?.trackId ?? null;
      await armPlaybackStart({
        reason: "queue-item",
        queueItemId,
        trackId: queueTrackId,
        previousTrackId: roomSnapshot?.room.playback.currentTrackId ?? null
      });
      await runPlaybackMutationAfterLocalPrime({
        primeLocalPlayback: () => primeFullLocalTrackPlayback(queueTrackId),
        mutatePlayback: () => playQueueItem(queueItemId)
      });
    },
    [
      armPlaybackStart,
      playQueueItem,
      primeFullLocalTrackPlayback,
      roomSnapshot?.queue,
      roomSnapshot?.room.playback.currentTrackId
    ]
  );

  const handlePrevTrack = useCallback(async () => {
    await armPlaybackStart({
      reason: "prev",
      previousTrackId: roomSnapshot?.room.playback.currentTrackId ?? null
    });
    await prevTrack();
  }, [armPlaybackStart, prevTrack, roomSnapshot?.room.playback.currentTrackId]);

  const handleNextTrack = useCallback(async () => {
    await armPlaybackStart({
      reason: "next",
      previousTrackId: roomSnapshot?.room.playback.currentTrackId ?? null
    });
    await nextTrack();
  }, [armPlaybackStart, nextTrack, roomSnapshot?.room.playback.currentTrackId]);

  const handlePlaybackEnded = useCallback(async () => {
    await armPlaybackStart({
      reason: "next",
      previousTrackId: roomSnapshot?.room.playback.currentTrackId ?? null
    });
    await nextTrack();
  }, [armPlaybackStart, nextTrack, roomSnapshot?.room.playback.currentTrackId]);

  const {
    canDisbandRoom,
    connectedPeersCount,
    mediaConnectedPeersCount,
    availabilitySummary,
    memberTransferSummaries,
    localMemberState,
    visiblePeerDiagnostics,
    visiblePeerRecentEvents,
    statusTone,
    iceConfigStatus,
    iceConfigSource,
    isRoomTransitionPending,
    showRoomTransitionState
  } = useRoomDerivedState({
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
  const workspacePeerDiagnostics = useMemo(
    () =>
      selectWorkspacePeerDiagnostics({
        activeDashboardTab,
        visiblePeerDiagnostics,
        visiblePeerRecentEvents
      }),
    [activeDashboardTab, visiblePeerDiagnostics, visiblePeerRecentEvents]
  );

  // Show audio unlock overlay when playback is active but audio is blocked (listener only).
  useEffect(() => {
    if (
      !audioUnlocked &&
      !isCurrentSourceOwner &&
      playbackStatus === "playing" &&
      currentPlaybackTrackId
    ) {
      const timer = window.setTimeout(() => {
        if (!roomAudioOutput.isActivated()) {
          setAudioBlockedOverlay(true);
        }
      }, 1500);
      return () => window.clearTimeout(timer);
    }

    setAudioBlockedOverlay(false);
  }, [
    audioUnlocked,
    currentPlaybackTrackId,
    isCurrentSourceOwner,
    playbackStatus,
    setAudioBlockedOverlay
  ]);

  const handleAudioUnlock = useCallback(async () => {
    setAudioBlockedOverlay(false);
    const primeResult = await roomAudioOutput.primeOutputs({
      localAudio: audioRef.current
    });
    setAudioUnlocked(primeResult.ok);
    if (primeResult.ok) {
      setStatusMessage("");
      return;
    }
    setStatusMessage("浏览器仍未允许音频输出，请再次点击播放或检查系统媒体权限。");
    setAudioBlockedOverlay(true);
  }, [audioRef, setAudioBlockedOverlay, setAudioUnlocked, setStatusMessage]);

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
