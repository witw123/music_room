"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  IceConfigResponse,
  Playlist,
  RoomMediaConnectionState,
  RoomSnapshot
} from "@music-room/shared";
import { ChunkScheduler, useAvailabilityAnnouncements, usePeerDiagnostics } from "@/features/p2p";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import { toUserFacingError } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import type { RoomSocket } from "@/lib/ws-client";
import { BottomPlayerController } from "@/components/BottomPlayerController";
import { AudioUnlockOverlay } from "@/components/AudioUnlockOverlay";
import { RoomWorkspace } from "@/components/room/RoomWorkspace";
import { useRouter } from "next/navigation";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import {
  useProgressiveRuntime,
  type FullLocalPlaybackTrack
} from "@/features/playback/use-progressive-runtime";
import {
  createPlaybackStartIntent,
  type PlaybackStartIntent
} from "@/features/playback/playback-start-intent";
import { isCurrentPlaybackSourceDevice } from "@/features/playback/playback-source-identity";
import { getInitialProgressivePlaybackSource } from "@/features/playback/progressive-source-controller";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import {
  getEffectivePlaybackPositionMs
} from "@/features/playback/progressive-playback";
import { useTrackUploads } from "@/features/upload/use-track-uploads";
import { useRoomActions } from "@/features/room/hooks/use-room-actions";
import { useRoomRuntime } from "@/features/room/hooks/use-room-runtime";
import {
  resolvePlaybackSourceResetReason,
  resolvePlaybackSurfaceKey,
  resolvePlaybackTimelineKey
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

const lastRoomStorageKey = "music-room-last-room";
const peerStorageKey = "music-room-peer-id";
type RoomRecoveryPhase =
  | "joining"
  | "resyncing"
  | "bootstrapping-data"
  | "playing-local-fallback"
  | "steady";

type RoomRecoveryMode = "late-join" | "rejoin" | "steady";

type RoomRecoveryState = {
  phase: RoomRecoveryPhase;
  mode: RoomRecoveryMode;
  generation: number | null;
  bootstrapStartedAt: string | null;
  bootstrapSourcePeerId: string | null;
  pendingSnapshot: boolean;
  pendingData: boolean;
  pendingMedia: boolean;
  listenerBootstrapAttempts: number | null;
  fullLocalRecoveryActive: boolean;
};

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
  const [activeDashboardTab, setActiveDashboardTab] = useState<"queue" | "library" | "cache" | "members">(
    "queue"
  );
  const [isDiagnosticsPanelOpen, setIsDiagnosticsPanelOpen] = useState(false);
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
    useState<ProgressivePlaybackSource>("progressive-local");
  const [progressiveFallbackReason, setProgressiveFallbackReason] = useState<string | null>(null);
  const [playbackStartIntent, setPlaybackStartIntent] = useState<PlaybackStartIntent | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(() => roomAudioOutput.isActivated());
  const [sourceStartState, setSourceStartState] = useState<
    "idle" | "awaiting-unlock" | "starting" | "live" | "failed"
  >("idle");
  const [lastSourceStartError, setLastSourceStartError] = useState<string | null>(null);
  const [audioBlockedOverlay, setAudioBlockedOverlay] = useState(false);
  const [roomRecoveryState, setRoomRecoveryState] = useState<RoomRecoveryState>({
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
  const isCurrentSourceOwner = isCurrentPlaybackSourceDevice({
    playback: roomSnapshot?.room.playback,
    peerId,
    activeSessionId: activeSession?.userId
  });
  const playbackSurfaceKey = useMemo(
    () => resolvePlaybackSurfaceKey(roomSnapshot?.room.playback),
    [roomSnapshot?.room.playback]
  );
  const playbackTimelineKey = useMemo(
    () => resolvePlaybackTimelineKey(roomSnapshot?.room.playback),
    [roomSnapshot?.room.playback]
  );
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

  const hasFullLocalTrack = useMemo(
    () =>
      currentPlaybackTrackId
        ? !!uploadedTracks[currentPlaybackTrackId] ||
          !!cacheLibraryTracks.find((track) => track.fileHash === currentTrack?.fileHash)
        : false,
    [cacheLibraryTracks, currentPlaybackTrackId, currentTrack?.fileHash, uploadedTracks]
  );
  const fullLocalPlaybackTracks = useMemo<Record<string, FullLocalPlaybackTrack>>(() => {
    const next: Record<string, FullLocalPlaybackTrack> = { ...uploadedTracks };
    if (!roomSnapshot) {
      return next;
    }

    const cachedTracksByHash = new Map(
      cacheLibraryTracks.map((track) => [track.fileHash, track] as const)
    );
    for (const track of roomSnapshot.tracks) {
      if (next[track.id]) {
        continue;
      }
      const cachedTrack = cachedTracksByHash.get(track.fileHash);
      if (!cachedTrack) {
        continue;
      }
      next[track.id] = {
        file: cachedTrack.file,
        objectUrl: cachedTrack.objectUrl
      };
    }

    return next;
  }, [cacheLibraryTracks, roomSnapshot, uploadedTracks]);

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
    resetPeerDiagnostics
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
    hasFullLocalTrack,
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
    if (!currentPlaybackTrackId) {
      setActivePlaybackSource("progressive-local");
      setProgressiveFallbackReason(null);
      return;
    }

    setActivePlaybackSource(
      isCurrentSourceOwner
        ? getInitialProgressivePlaybackSource(hasFullLocalTrack)
        : getInitialProgressivePlaybackSource(hasFullLocalTrack)
    );
    setProgressiveFallbackReason(null);
  }, [playbackSurfaceKey, currentPlaybackTrackId, hasFullLocalTrack, isCurrentSourceOwner]);

  const previousPlaybackRef = useRef(roomSnapshot?.room.playback ?? null);

  useEffect(() => {
    const previousPlayback = previousPlaybackRef.current;
    const nextPlayback = roomSnapshot?.room.playback ?? null;
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
  }, [playbackSurfaceKey, playbackTimelineKey, recordPeerDiagnostic, roomSnapshot?.room.playback]);

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
  }, []);

  const primeFullLocalTrackPlayback = useCallback(
    async (trackId: string | null | undefined) => {
      if (!trackId) {
        return false;
      }

      const localTrack = fullLocalPlaybackTracks[trackId] ?? null;
      const audio = audioRef.current;
      if (!localTrack || !audio) {
        return false;
      }

      const track =
        roomSnapshot?.tracks.find((entry) => entry.id === trackId) ?? currentTrack ?? null;
      const playback = roomSnapshot?.room.playback ?? null;
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
      recordPeerDiagnostic,
      roomSnapshot?.room.playback,
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
            (roomSnapshot?.room.playback.playbackRevision ??
              roomSnapshot?.room.playback.queueVersion ??
              0) + 1,
          previousQueueVersion: roomSnapshot?.room.playback.queueVersion ?? null,
          previousMediaEpoch: roomSnapshot?.room.playback.mediaEpoch ?? null
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
    [ensureRoomAudioUnlocked, recordPeerDiagnostic, setStatusMessage]
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
    const playback = roomSnapshot?.room.playback;
    if (
      !audioUnlocked &&
      !isCurrentSourceOwner &&
      playback?.status === "playing" &&
      playback.currentTrackId
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
    isCurrentSourceOwner,
    roomSnapshot?.room.playback?.status,
    roomSnapshot?.room.playback?.currentTrackId
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
  }, [audioRef, setAudioUnlocked, setStatusMessage]);

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
