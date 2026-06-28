"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import type {
  AuthSession,
  IceConfigResponse,
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import type { Route } from "next";
import type { RoomSocket } from "@/lib/ws-client";
import { ChunkScheduler } from "@/features/p2p";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import {
  getEffectivePlaybackPositionMs,
  hasActivePlaybackIntent,
  type ProgressivePlaybackSource,
  type ProgressiveSchedulerPolicy
} from "@/features/playback/progressive-playback";
import { isCurrentPlaybackSourceDevice } from "@/features/playback/playback-source-identity";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { createRoomSnapshotResyncController, type RoomSnapshotResyncReason } from "@/features/room/room-snapshot-resync";
import { musicRoomApi } from "@/lib/music-room-api";
import { getPlaybackConsistencyVersion, toUserFacingError } from "@/lib/music-room-ui";
import { enableManualTrackCaching, enableTrackCaching } from "@/features/cache/cache-policy";
import { useRoomDiagnosticsBridge } from "./use-room-diagnostics-bridge";
import { useManualCacheDownloader, type ManualCacheTrackPlan } from "./use-manual-cache-downloader";
import { useRoomDataMesh } from "./use-room-data-mesh";
import {
  getPieceTransferRates,
  useRoomRuntimeObservability
} from "./use-room-runtime-observability";
import {
  useRoomConnectionSupervisor,
  withResolvedTransportHealth,
  withSupervisorDiagnosticPatch
} from "./use-room-connection-supervisor";
import {
  createRoomRealtimeRuntime,
  useRoomRealtimeConnection,
  shouldAcceptIncomingDataSignal,
  shouldReannounceManualCacheAvailability
} from "./use-room-realtime-connection";
import { useRoomRuntimeMutableState } from "./use-room-runtime-mutable-state";
import { useRoomRuntimeLifecycle } from "./use-room-runtime-lifecycle";
import {
  resolvePlaybackConnectionKey,
  resolvePlaybackRecoveryActionType,
  resolvePlaybackRecoveryDropReason,
  useRoomPlaybackConnectionCoordinator
} from "./use-room-playback-connection-coordinator";
import type { RoomRecoveryState } from "./room-runtime-types";

export {
  resolveManualCacheProviderPeerIds,
  resolveManualCacheUploaderPeerIds,
  shouldForceManualCacheBootstrap,
  resolveManualCacheMeshRecoveryMode,
  shouldRecoverManualCacheDataPeers
} from "./use-manual-cache-downloader";
export { shouldAcceptIncomingDataSignal, shouldReannounceManualCacheAvailability };
export { isCurrentPlaybackSourceDevice } from "@/features/playback/playback-source-identity";
export {
  resetInitialRoomRecoveryAttemptOnCancellation,
  shouldRedirectRoomRouteToAuth,
  shouldSuppressRoomRecoveryAfterFailure
} from "./use-room-runtime-lifecycle";
export {
  resolvePlaybackConnectionKey,
  resolvePlaybackRecoveryActionType,
  resolvePlaybackRecoveryDropReason
};

export function buildRoomExitHref(input: {
  activeSession: Pick<AuthSession, "userId"> | null | undefined;
  workspaceEntryHref: string;
  authEntryHref: string;
}) {
  return input.activeSession ? input.workspaceEntryHref : input.authEntryHref;
}

type RoomRouter = {
  push: (href: Route) => void;
  replace: (href: Route) => void;
};

type UseRoomRuntimeInput = {
  workspaceOnly: boolean;
  initialRoomId: string | null;
  hydrated: boolean;
  authEntryHref: string;
  workspaceEntryHref: string;
  router: RoomRouter;
  lastRoomStorageKey: string;
  peerStorageKey: string;
  activeSession: AuthSession | null;
  hasStoredSession: boolean;
  activeSessionRef: MutableRefObject<AuthSession | null>;
  refreshSession: () => Promise<unknown>;
  roomSnapshot: RoomSnapshot | null;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  peerId: string;
  setPeerId: Dispatch<SetStateAction<string>>;
  connectedPeers: string[];
  setConnectedPeers: Dispatch<SetStateAction<string[]>>;
  mediaConnectedPeers: string[];
  setMediaConnectedPeers: Dispatch<SetStateAction<string[]>>;
  suppressRoomRecovery: boolean;
  setSuppressRoomRecovery: Dispatch<SetStateAction<boolean>>;
  setIsRecoveringRoom: Dispatch<SetStateAction<boolean>>;
  isNavigatingRoomExit: boolean;
  setIsNavigatingRoomExit: Dispatch<SetStateAction<boolean>>;
  iceConfig: IceConfigResponse | null;
  setIceConfig: Dispatch<SetStateAction<IceConfigResponse | null>>;
  iceConfigResolved: boolean;
  setIceConfigResolved: Dispatch<SetStateAction<boolean>>;
  mediaConnectionState: RoomMediaConnectionState;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  isPageVisible: boolean;
  setIsPageVisible: Dispatch<SetStateAction<boolean>>;
  schedulerMode: "normal" | "conservative" | "idle";
  setSchedulerMode: Dispatch<SetStateAction<"normal" | "conservative" | "idle">>;
  schedulerPlaybackBucketMs: number;
  bufferHealth: "healthy" | "low" | "critical";
  transportGovernorMode: "bootstrap" | "segment-catchup" | "local-primary" | "emergency-fallback";
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveSchedulerPolicy: ProgressiveSchedulerPolicy | null;
  isCurrentSourceOwner: boolean;
  hasFullLocalTrack: boolean;
  audioUnlocked: boolean;
  getLocalPlaybackPositionMs?: () => number | null;
  setAudioUnlocked: Dispatch<SetStateAction<boolean>>;
  roomRecoveryState: RoomRecoveryState;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  sourceStartState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed";
  setSourceStartState: Dispatch<
    SetStateAction<"idle" | "awaiting-unlock" | "starting" | "live" | "failed">
  >;
  lastSourceStartError: string | null;
  setLastSourceStartError: Dispatch<SetStateAction<string | null>>;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  queueAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  clearAvailabilityForPeer: (ownerPeerId: string) => void;
  flushPendingAvailability: () => void;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  uploadedTracks: Record<string, UploadedTrack>;
  uploadedTrackIds: string[];
  uploadedTrackIdsRef: MutableRefObject<string[]>;
  manualCacheTrackIds: string[];
  startPlaybackDemandCacheDownload: (trackId: string) => void;
  announceRoomTrackAvailability: (trackId: string) => Promise<void>;
  handleManualCachePieceReceived: (input: {
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
  }) => void;
  handleManualCachePlan: (plan: ManualCacheTrackPlan) => void;
  deleteUploadedTrackArtifacts: (trackId: string) => Promise<void> | void;
  deleteRoomTrackArtifacts: (trackIds: string[]) => Promise<void> | void;
  audioRef: RefObject<HTMLAudioElement | null>;
  socketRef: MutableRefObject<RoomSocket | null>;
  chunkSchedulerRef: MutableRefObject<ChunkScheduler | null>;
  resetPlayerSurface: () => void;
  setStatusMessage: (value: string) => void;
  statusMessage: string;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
};

type UseRoomRuntimeResult = {
  ensureSourcePlaybackStarted: () => Promise<void>;
};

export function shouldKickSourcePlaybackFromRealtimeEvent(input: {
  previousPlayback: RoomSnapshot["room"]["playback"] | null | undefined;
  nextPlayback: RoomSnapshot["room"]["playback"];
  activeSessionId: string | null | undefined;
}) {
  const { previousPlayback, nextPlayback, activeSessionId } = input;
  if (!activeSessionId || nextPlayback.sourceSessionId !== activeSessionId) {
    return false;
  }
  if (
    previousPlayback &&
    getPlaybackConsistencyVersion(nextPlayback) < getPlaybackConsistencyVersion(previousPlayback)
  ) {
    return false;
  }
  return (
    previousPlayback?.currentTrackId !== nextPlayback.currentTrackId ||
    previousPlayback?.status !== nextPlayback.status ||
    previousPlayback?.mediaEpoch !== nextPlayback.mediaEpoch
  );
}

export function shouldStartPlaybackDemandCacheForPlayback(input: {
  playback: RoomSnapshot["room"]["playback"] | null | undefined;
  peerId: string | null | undefined;
  activeSessionId: string | null | undefined;
  manualCacheTrackIds: string[];
  hasLocalFullTrack?: boolean;
  enableManualTrackCaching: boolean;
}) {
  const playback = input.playback;
  if (
    !input.enableManualTrackCaching ||
    !playback?.currentTrackId ||
    !hasActivePlaybackIntent(playback)
  ) {
    return false;
  }

  if (isCurrentPlaybackSourceDevice({
    playback,
    peerId: input.peerId,
    activeSessionId: input.activeSessionId
  }) && input.hasLocalFullTrack !== false) {
    return false;
  }

  return !input.manualCacheTrackIds.includes(playback.currentTrackId);
}

export function resolveRuntimeManualCacheTrackIds(input: {
  playback: RoomSnapshot["room"]["playback"] | null | undefined;
  peerId: string | null | undefined;
  activeSessionId: string | null | undefined;
  manualCacheTrackIds: string[];
  hasLocalFullTrack: boolean;
  enableManualTrackCaching: boolean;
}) {
  const trackIds = new Set(input.manualCacheTrackIds.filter(Boolean));
  const playback = input.playback;
  const isSourceDevice = isCurrentPlaybackSourceDevice({
    playback,
    peerId: input.peerId,
    activeSessionId: input.activeSessionId
  });
  if (
    input.enableManualTrackCaching &&
    playback?.currentTrackId &&
    hasActivePlaybackIntent(playback) &&
    (!isSourceDevice || !input.hasLocalFullTrack)
  ) {
    trackIds.add(playback.currentTrackId);
  }

  return [...trackIds].sort();
}

export function buildActivePlaybackCacheWindow(input: {
  playback: RoomSnapshot["room"]["playback"] | null | undefined;
  positionMs: number | null | undefined;
  policy: ProgressiveSchedulerPolicy | null | undefined;
}) {
  const playback = input.playback;
  if (
    !playback?.currentTrackId ||
    !hasActivePlaybackIntent(playback) ||
    !input.policy
  ) {
    return null;
  }

  return {
    trackId: playback.currentTrackId,
    positionMs:
      typeof input.positionMs === "number" && Number.isFinite(input.positionMs)
        ? Math.max(0, input.positionMs)
        : Math.max(0, playback.positionMs),
    revision: playback.playbackRevision ?? playback.queueVersion,
    mediaEpoch: playback.mediaEpoch,
    status: playback.status,
    policy: input.policy
  };
}

export function resolveActivePlaybackCacheWindowPosition(input: {
  localPlaybackPositionMs: number | null | undefined;
  playback: RoomSnapshot["room"]["playback"] | null | undefined;
  durationMs: number;
  schedulerPlaybackBucketMs: number;
  now?: number;
}) {
  if (
    typeof input.localPlaybackPositionMs === "number" &&
    Number.isFinite(input.localPlaybackPositionMs)
  ) {
    return Math.max(0, input.localPlaybackPositionMs);
  }

  if (input.playback?.currentTrackId) {
    return getEffectivePlaybackPositionMs(
      input.playback,
      input.durationMs,
      input.now ?? Date.now()
    );
  }

  return Math.max(0, input.schedulerPlaybackBucketMs);
}

export function buildManualCachePendingPieceClearer(
  clearPendingPieceRef: MutableRefObject<(trackId: string, chunkIndex: number) => void>
) {
  return (trackId: string, chunkIndex: number) => {
    clearPendingPieceRef.current(trackId, chunkIndex);
  };
}

export function shouldStartRoomRealtimeRuntime(input: {
  roomId: string | null | undefined;
  hydrated: boolean;
  iceConfigResolved: boolean;
  peerId: string | null | undefined;
}) {
  return Boolean(input.roomId && input.hydrated && input.iceConfigResolved && input.peerId);
}

export function shouldAcceptIncomingPeerSignalRecoveryGeneration(input: {
  payloadRecoveryGeneration: number | null | undefined;
  currentRecoveryGeneration: number | null;
}) {
  if (typeof input.payloadRecoveryGeneration !== "number") {
    return true;
  }
  if (typeof input.currentRecoveryGeneration !== "number") {
    return true;
  }
  return input.payloadRecoveryGeneration >= input.currentRecoveryGeneration;
}

function getPeerMedianRttMs(state: any) {
  return typeof state?.pieceRttMsP50 === "number" ? state.pieceRttMsP50 : null;
}

export function useRoomRuntime({
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
  setSchedulerMode,
  schedulerPlaybackBucketMs,
  bufferHealth,
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
  uploadedTrackIds,
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
}: UseRoomRuntimeInput): UseRoomRuntimeResult {
  void mediaConnectedPeers;
  void setMediaConnectedPeers;
  void mediaConnectionState;

  const runtimeManualCacheTrackIds = useMemo(
    () =>
      resolveRuntimeManualCacheTrackIds({
        playback: roomSnapshot?.room.playback,
        peerId,
        activeSessionId: activeSession?.userId,
        manualCacheTrackIds,
        hasLocalFullTrack: hasFullLocalTrack,
        enableManualTrackCaching
      }),
    [
      activeSession?.userId,
      hasFullLocalTrack,
      manualCacheTrackIds,
      peerId,
      roomSnapshot?.room.playback
    ]
  );

  const {
    meshRef,
    initialRecoveryAttemptRef,
    previousInitialRoomIdRef,
    activeRouteRoomIdRef,
    socketDisconnectGraceUntilRef,
    resubscribeRoomRef,
    recoveryGenerationRef,
    roomRecoveryStateRef,
    activePlaybackSourceRef,
    lastSubscribeAckAtRef,
    recoveryModeRef,
    lastRealtimeRoomEventAtRef,
    lastDataActivityAtRef,
    socketDisconnectGraceTimeoutRef,
    audioUnlockedRef,
    setAudioUnlockedRef,
    sourceStartStateRef,
    setSourceStartStateRef,
    lastSourceStartErrorRef,
    setLastSourceStartErrorRef,
    manualCacheTrackIdsRef,
    uploadedTracksRef,
    announceRoomTrackAvailabilityRef,
    handleManualCachePieceReceivedRef,
    deleteUploadedTrackArtifactsRef,
    deleteRoomTrackArtifactsRef,
    resetPlayerSurfaceRef,
    queueAvailabilityRef,
    clearAvailabilityForPeerRef,
    flushPendingAvailabilityRef,
    recordPeerDiagnosticRef,
    clearSocketDisconnectGrace,
    updateSourceStartState
  } = useRoomRuntimeMutableState({
    initialRoomId,
    roomSnapshot,
    currentRoomRef,
    activeSession,
    activeSessionRef,
    socketRef,
    uploadedTrackIds,
    uploadedTrackIdsRef,
    roomRecoveryState,
    activePlaybackSource,
    audioUnlocked,
    setAudioUnlocked,
    sourceStartState,
    setSourceStartState,
    lastSourceStartError,
    setLastSourceStartError,
    manualCacheTrackIds: runtimeManualCacheTrackIds,
    uploadedTracks,
    announceRoomTrackAvailability,
    handleManualCachePieceReceived,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    resetPlayerSurface,
    queueAvailability,
    clearAvailabilityForPeer,
    flushPendingAvailability,
    recordPeerDiagnostic,
    enableTrackCaching
  });

  const emitRuntimeEvent = useRoomDiagnosticsBridge({
    recordPeerDiagnostic,
    setStatusMessage
  });
  const dataMeshBridge = useRoomDataMesh({ meshRef });
  const activePlaybackTrackDurationMs =
    roomSnapshot?.tracks.find(
      (track) => track.id === roomSnapshot.room.playback.currentTrackId
    )?.durationMs ?? 0;
  const activePlaybackCacheWindow = buildActivePlaybackCacheWindow({
    playback: roomSnapshot?.room.playback,
    positionMs: resolveActivePlaybackCacheWindowPosition({
      localPlaybackPositionMs:
        typeof getLocalPlaybackPositionMs === "function"
          ? getLocalPlaybackPositionMs()
          : null,
      playback: roomSnapshot?.room.playback,
      durationMs: activePlaybackTrackDurationMs,
      schedulerPlaybackBucketMs
    }),
    policy: progressiveSchedulerPolicy
  });
  const {
    connectionSupervisorStatesRef,
    sourceRecoveryCoordinatorRef,
    updateConnectionSupervisorSignalState,
    updateConnectionSupervisorTransport,
    updateConnectionSupervisorPlayout
  } = useRoomConnectionSupervisor({ lastSubscribeAckAtRef });
  const {
    pieceTransferRatesRef,
    pieceRequestSamplesRef,
    updateDataTransportStatsRef,
    reportRealtimeFailureRef,
    recordPieceTransferRef,
    recordPieceRequestSampleRef,
    updatePeerBufferedAmountRef
  } = useRoomRuntimeObservability({
    roomSnapshot,
    peerId,
    recordPeerDiagnostic
  });
  const {
    getCurrentPlaybackConnectionKey,
    applyRecoveryAction,
    finishRecoveryAction,
    noteRecoveryRecommendation
  } = useRoomPlaybackConnectionCoordinator({
    currentRoomRef
  });

  const roomSnapshotResyncController = useRef(
    createRoomSnapshotResyncController({
      loadSnapshot: (roomId) => musicRoomApi.getRoom(roomId),
      applySnapshot: (_roomId, snapshot) => {
        if (activeRouteRoomIdRef.current && snapshot.room.id !== activeRouteRoomIdRef.current) {
          return;
        }
        dispatchRoomStateEvent({
          type: "recover-snapshot",
          snapshot
        });
      },
      onError: (_roomId, _reason, error) => {
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "snapshot-resync-failed",
          summary: `房间快照同步失败：${toUserFacingError(error)}`,
          level: "warning"
        });
      }
    })
  ).current;

  const exitCurrentRoom = useCallback(
    (message: string) => {
      setStatusMessage(message);
      setIsNavigatingRoomExit(true);
      resetPlayerSurfaceRef.current();
      dispatchRoomStateEvent({ type: "local-reset" });
      router.replace(
        buildRoomExitHref({
          activeSession,
          workspaceEntryHref,
          authEntryHref
        }) as Route
      );
    },
    [
      activeSession,
      authEntryHref,
      dispatchRoomStateEvent,
      resetPlayerSurfaceRef,
      router,
      setIsNavigatingRoomExit,
      setStatusMessage,
      workspaceEntryHref
    ]
  );

  const requestRoomSnapshotResync = useCallback(
    async (reason: RoomSnapshotResyncReason, roomId?: string | null) => {
      const targetRoomId = roomId ?? currentRoomRef.current?.room.id ?? initialRoomId;
      if (!targetRoomId) {
        return;
      }
      try {
        await roomSnapshotResyncController.request(targetRoomId, reason);
      } catch (error) {
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "snapshot-resync-failed",
          summary: `房间快照同步失败：${toUserFacingError(error)}`,
          level: "warning"
        });
      }
    },
    [
      activeRouteRoomIdRef,
      currentRoomRef,
      dispatchRoomStateEvent,
      initialRoomId,
      recordPeerDiagnostic,
      roomSnapshotResyncController
    ]
  );

  const ensureSourcePlaybackStarted = useCallback(async () => {
    const playback = currentRoomRef.current?.room.playback ?? roomSnapshot?.room.playback ?? null;
    if (!playback?.currentTrackId || playback.status !== "playing") {
      updateSourceStartState("idle", { recordEvent: false });
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      updateSourceStartState("failed", {
        error: "missing-audio-element",
        summary: "本地音频元素不可用",
        level: "error"
      });
      return;
    }

    try {
      audio.muted = false;
      await roomAudioOutput.playElement(audio);
      updateSourceStartState("live", {
        summary: "本地缓存播放已启动",
        recordEvent: false
      });
    } catch (error) {
      updateSourceStartState("awaiting-unlock", {
        error: toUserFacingError(error),
        summary: "等待用户解锁本地音频播放",
        level: "warning"
      });
    }
  }, [audioRef, currentRoomRef, roomSnapshot?.room.playback, updateSourceStartState]);

  const requestRoomSnapshotResyncRef = useRef(requestRoomSnapshotResync);
  const ensureSourcePlaybackStartedRef = useRef(ensureSourcePlaybackStarted);
  useEffect(() => {
    requestRoomSnapshotResyncRef.current = requestRoomSnapshotResync;
  }, [requestRoomSnapshotResync]);
  useEffect(() => {
    ensureSourcePlaybackStartedRef.current = ensureSourcePlaybackStarted;
  }, [ensureSourcePlaybackStarted]);

  const queuePlaybackRecoveryRecommendation = useCallback(
    (recommendation: Parameters<typeof noteRecoveryRecommendation>[0]) => {
      noteRecoveryRecommendation(recommendation);
      const actionType = resolvePlaybackRecoveryActionType(recommendation);
      if (!actionType) {
        return;
      }
      const action = applyRecoveryAction({
        playbackConnectionKey:
          recommendation.playbackConnectionKey ?? getCurrentPlaybackConnectionKey(),
        actionType,
        peerId: recommendation.peerId,
        reason: recommendation.reason
      });
      if (!action) {
        return;
      }
      if (actionType === "restart-data-peer" && recommendation.peerId) {
        void meshRef.current?.restartPeer(recommendation.peerId).finally(() => {
          finishRecoveryAction(action.actionId, "completed");
        });
        return;
      }
      resubscribeRoomRef.current?.();
      finishRecoveryAction(action.actionId, "completed");
    },
    [
      applyRecoveryAction,
      finishRecoveryAction,
      getCurrentPlaybackConnectionKey,
      meshRef,
      noteRecoveryRecommendation,
      resubscribeRoomRef
    ]
  );

  const {
    emitPresence,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    stopRecoveryWatchdog
  } = useRoomRealtimeConnection({
    roomSnapshot,
    initialRoomId,
    hydrated,
    activeSession,
    activeSessionRef,
    currentRoomRef,
    activeRouteRoomIdRef,
    peerId,
    socketRef,
    isNavigatingRoomExit,
    enableManualTrackCaching,
    enableTrackCaching,
    roomListenerSetHash: roomSnapshot?.room.members.map((member) => member.peerId ?? member.id).sort().join("|") ?? "",
    uploadedTrackIds,
    connectedPeers,
    uploadedTracks,
    announceRoomTrackAvailabilityRef,
    lastRealtimeRoomEventAtRef,
    lastSubscribeAckAtRef,
    recoveryGenerationRef,
    recoveryModeRef,
    resubscribeRoomRef,
    meshRef,
    socketDisconnectGraceUntilRef,
    requestRoomSnapshotResync,
    getCurrentPlaybackConnectionKey,
    queuePlaybackRecoveryRecommendation
  });

  useRoomRuntimeLifecycle({
    workspaceOnly,
    initialRoomId,
    hydrated,
    authEntryHref,
    router,
    lastRoomStorageKey,
    peerStorageKey,
    activeSession,
    hasStoredSession,
    roomSnapshot,
    currentRoomRef,
    activeRouteRoomIdRef,
    initialRecoveryAttemptRef,
    previousInitialRoomIdRef,
    resetPlayerSurfaceRef,
    requestRoomSnapshotResync,
    emitPresence,
    peerId,
    setPeerId,
    suppressRoomRecovery,
    setSuppressRoomRecovery,
    setIsRecoveringRoom,
    isNavigatingRoomExit,
    setIsNavigatingRoomExit,
    setIceConfig,
    setIceConfigResolved,
    setIsPageVisible,
    setSchedulerMode,
    dispatchRoomStateEvent,
    recordPeerDiagnostic,
    refreshSession,
    refreshAvailableRooms,
    refreshPlaylists,
    setStatusMessage
  });

  const manualCacheDownloader = useManualCacheDownloader({
    enableManualTrackCaching,
    manualCacheTrackIds: runtimeManualCacheTrackIds,
    roomSnapshot,
    availabilityByTrack,
    peerId,
    connectedPeers,
    dataMesh: dataMeshBridge,
    activePlaybackWindow: activePlaybackCacheWindow,
    onRuntimeEvent: emitRuntimeEvent,
    onManualCachePlan: handleManualCachePlan
  });
  const clearManualCachePendingPieceRef = useRef(manualCacheDownloader.clearPendingPiece);
  useEffect(() => {
    clearManualCachePendingPieceRef.current = manualCacheDownloader.clearPendingPiece;
  }, [manualCacheDownloader.clearPendingPiece]);
  const clearManualCachePendingPiece = useMemo(
    () => buildManualCachePendingPieceClearer(clearManualCachePendingPieceRef),
    []
  );

  useEffect(() => {
    const playback = roomSnapshot?.room.playback ?? null;
    if (
      !shouldStartPlaybackDemandCacheForPlayback({
        playback,
        peerId,
        activeSessionId: activeSessionRef.current?.userId,
        manualCacheTrackIds,
        hasLocalFullTrack: hasFullLocalTrack,
        enableManualTrackCaching
      })
    ) {
      return;
    }

    void startPlaybackDemandCacheDownload(playback!.currentTrackId!);
  }, [
    activeSessionRef,
    hasFullLocalTrack,
    manualCacheTrackIds,
    peerId,
    roomSnapshot?.room.playback,
    startPlaybackDemandCacheDownload
  ]);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }
    const timer = window.setTimeout(() => {
      setStatusMessage("");
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, [setStatusMessage, statusMessage]);

  useEffect(() => {
    const activeRoomId = roomSnapshot?.room.id ?? null;
    if (
      !shouldStartRoomRealtimeRuntime({
        roomId: activeRoomId,
        hydrated,
        iceConfigResolved,
        peerId
      })
    ) {
      return;
    }

    if (!activeRoomId) {
      return;
    }

    return createRoomRealtimeRuntime({
      roomId: activeRoomId,
      peerId,
      iceConfig,
      socketRef,
      recordPeerDiagnosticRef,
      meshRef,
      chunkSchedulerRef,
      currentRoomRef,
      uploadedTracksRef,
      uploadedTrackIdsRef,
      manualCacheTrackIdsRef,
      announceRoomTrackAvailabilityRef,
      handleManualCachePieceReceivedRef,
      clearManualCachePendingPiece,
      flushPendingAvailabilityRef,
      recordPieceTransferRef,
      recordPieceRequestSampleRef,
      updatePeerBufferedAmountRef,
      updateDataTransportStatsRef,
      connectionSupervisorStatesRef,
      updateConnectionSupervisorSignalState,
      withResolvedTransportHealth,
      withSupervisorDiagnosticPatch,
      getPieceTransferRates,
      pieceTransferRatesRef,
      getPeerMedianRttMs,
      setConnectedPeers,
      isPageVisible,
      playbackStatus: roomSnapshot?.room.playback.status ?? "paused",
      currentTrackId: roomSnapshot?.room.playback.currentTrackId ?? null,
      bufferHealth,
      enableManualTrackCaching,
      resubscribeRoomRef,
      activeSessionRef,
      activeRouteRoomIdRef,
      requestRoomSnapshotResyncRef,
      ensureSourcePlaybackStartedRef,
      queueAvailabilityRef,
      clearAvailabilityForPeerRef,
      deleteRoomTrackArtifactsRef,
      lastRealtimeRoomEventAtRef,
      recoveryGenerationRef,
      lastSubscribeAckAtRef,
      recoveryModeRef,
      socketDisconnectGraceUntilRef,
      socketDisconnectGraceTimeoutRef,
      stopPresenceHeartbeat,
      stopRecoveryWatchdog,
      clearSocketDisconnectGrace,
      dispatchRoomStateEvent,
      setRoomRecoveryState,
      setStatusMessage,
      isNavigatingRoomExit,
      audioUnlocked,
      uploadedTracks,
      emitPresence,
      startPresenceHeartbeat,
      exitCurrentRoom,
      shouldKickSourcePlaybackFromRealtimeEvent,
      shouldAcceptIncomingPeerSignalRecoveryGeneration
    });
  }, [
    roomSnapshot?.room.id,
    hydrated,
    iceConfig,
    iceConfigResolved,
    peerId,
    activeSessionRef,
    currentRoomRef,
    chunkSchedulerRef,
    stopPresenceHeartbeat,
    stopRecoveryWatchdog,
    clearSocketDisconnectGrace,
    setConnectedPeers,
    setRoomRecoveryState,
    setStatusMessage,
    exitCurrentRoom,
    emitPresence,
    startPresenceHeartbeat,
    isNavigatingRoomExit,
    audioUnlocked
  ]);

  useEffect(() => {
    setMediaConnectionState(
      roomSnapshot?.room.playback.currentTrackId
        ? bufferHealth === "critical"
          ? "buffering"
          : "live"
        : "idle"
    );
  }, [bufferHealth, roomSnapshot?.room.playback.currentTrackId, setMediaConnectionState]);

  useEffect(() => {
    updateConnectionSupervisorPlayout();
    lastDataActivityAtRef.current = Date.now();
  }, [lastDataActivityAtRef, updateConnectionSupervisorPlayout, connectedPeers.length]);

  return {
    ensureSourcePlaybackStarted
  };
}
