"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";
import type {
  AssetAvailabilityAnnouncement,
  AuthSession,
  IceConfigResponse,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import type { Route } from "next";
import type { RoomSocket } from "@/lib/ws-client";
import { ChunkScheduler } from "@/features/p2p";
import type { P2PMesh } from "@/features/p2p";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { createRoomSnapshotResyncController, type RoomSnapshotResyncReason } from "@/features/room/room-snapshot-resync";
import { musicRoomApi } from "@/lib/music-room-api";
import { toUserFacingError } from "@/lib/music-room-ui";
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
  resolveRemoteAvailabilityRequestTrackId,
  resolveSourceAvailabilityReannounceTrackId,
  useRoomRealtimeConnection,
  shouldAcceptIncomingPeerSignal,
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
import type { PeerRoundTripTimeSource, RoomRecoveryState } from "./room-runtime-types";

export {
  resolveManualCacheProviderPeerIds,
  resolveManualCacheUploaderPeerIds,
  shouldForceManualCacheBootstrap,
  resolveManualCacheMeshRecoveryMode,
  shouldRecoverManualCacheDataPeers
} from "./use-manual-cache-downloader";
export {
  resolveRemoteAvailabilityRequestTrackId,
  resolveSourceAvailabilityReannounceTrackId,
  shouldAcceptIncomingPeerSignal,
  shouldReannounceManualCacheAvailability
};
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
  isPageVisible: boolean;
  setIsPageVisible: Dispatch<SetStateAction<boolean>>;
  schedulerMode: "normal" | "conservative" | "idle";
  setSchedulerMode: Dispatch<SetStateAction<"normal" | "conservative" | "idle">>;
  bufferHealth: "healthy" | "low" | "critical";
  audioUnlocked: boolean;
  roomRecoveryState: RoomRecoveryState;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  queueAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  queueAssetAvailability: (announcement: AssetAvailabilityAnnouncement) => void;
  clearAvailabilityForPeer: (ownerPeerId: string) => void;
  clearAvailabilityForTrack: (trackId: string, ownerPeerId?: string) => void;
  clearAvailabilityForAsset: (assetId: string, ownerPeerId?: string) => void;
  flushPendingAvailability: () => void;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  uploadedTracks: Record<string, UploadedTrack>;
  fullLocalPlaybackTracks: Record<string, SourceLocalPlaybackTrack>;
  uploadedTrackIds: string[];
  uploadedTrackIdsRef: MutableRefObject<string[]>;
  announceRoomTrackAvailability: (
    trackId: string,
    options?: { force?: boolean }
  ) => Promise<boolean>;
  handleManualCachePieceReceived: (input: {
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
  }) => void;
  deleteUploadedTrackArtifacts: (trackId: string) => Promise<void> | void;
  deleteRoomTrackArtifacts: (trackIds: string[]) => Promise<void> | void;
  socketRef: MutableRefObject<RoomSocket | null>;
  chunkSchedulerRef: MutableRefObject<ChunkScheduler | null>;
  resetPlayerSurface: () => void;
  setStatusMessage: (value: string) => void;
  statusMessage: string;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
};

type UseRoomRuntimeResult = {
  requestOriginalAssetUnits: (input: Parameters<P2PMesh["requestOriginalAssetUnits"]>[0]) => boolean;
  cancelOriginalAssetRequests: (assetId: string) => void;
  setLocalAudioStream: (
    stream: MediaStream | null,
    sourcePeerId: string | null,
    maxBitrateKbps?: number | null
  ) => void;
  getPeerMediaState: (peerId: string) => ReturnType<P2PMesh["getPeerMediaState"]>;
};

type SourceLocalPlaybackTrack = Pick<UploadedTrack, "objectUrl">;

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

function getPeerMedianRttMs(state: PeerRoundTripTimeSource) {
  if (!state || !("pieceRttMsP50" in state)) {
    return null;
  }
  return typeof state.pieceRttMsP50 === "number" ? state.pieceRttMsP50 : null;
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
  isPageVisible,
  setIsPageVisible,
  setSchedulerMode,
  bufferHealth,
  audioUnlocked,
  roomRecoveryState,
  setRoomRecoveryState,
  queueAvailability,
  queueAssetAvailability,
  clearAvailabilityForPeer,
  clearAvailabilityForTrack,
  clearAvailabilityForAsset,
  flushPendingAvailability,
  recordPeerDiagnostic,
  uploadedTracks,
  fullLocalPlaybackTracks,
  uploadedTrackIds,
  uploadedTrackIdsRef,
  announceRoomTrackAvailability,
  handleManualCachePieceReceived,
  deleteUploadedTrackArtifacts,
  deleteRoomTrackArtifacts,
  socketRef,
  chunkSchedulerRef,
  resetPlayerSurface,
  setStatusMessage,
  statusMessage,
  refreshAvailableRooms,
  refreshPlaylists
}: UseRoomRuntimeInput): UseRoomRuntimeResult {
  const roomPlayback = roomSnapshot?.room.playback ?? null;
  const roomPlaybackCurrentTrackId = roomPlayback?.currentTrackId ?? null;
  const roomPlaybackStatus = roomPlayback?.status ?? null;
  const realtimeRuntimeStateRef = useRef({
    playbackStatus: roomPlaybackStatus,
    currentTrackId: roomPlaybackCurrentTrackId,
    bufferHealth,
    isPageVisible,
    audioUnlocked
  });
  realtimeRuntimeStateRef.current = {
    playbackStatus: roomPlaybackStatus,
    currentTrackId: roomPlaybackCurrentTrackId,
    bufferHealth,
    isPageVisible,
    audioUnlocked
  };
  const {
    meshRef,
    initialRecoveryAttemptRef,
    previousInitialRoomIdRef,
    activeRouteRoomIdRef,
    socketDisconnectGraceUntilRef,
    resubscribeRoomRef,
    recoveryGenerationRef,
    lastSubscribeAckAtRef,
    recoveryModeRef,
    lastRealtimeRoomEventAtRef,
    lastDataActivityAtRef,
    socketDisconnectGraceTimeoutRef,
    manualCacheTrackIdsRef,
    uploadedTracksRef,
    fullLocalPlaybackTracksRef,
    announceRoomTrackAvailabilityRef,
    handleManualCachePieceReceivedRef,
    deleteRoomTrackArtifactsRef,
    resetPlayerSurfaceRef,
    queueAvailabilityRef,
    queueAssetAvailabilityRef,
    clearAvailabilityForPeerRef,
    clearAvailabilityForTrackRef,
    clearAvailabilityForAssetRef,
    flushPendingAvailabilityRef,
    recordPeerDiagnosticRef,
    clearSocketDisconnectGrace
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
    manualCacheTrackIds: [],
    uploadedTracks,
    fullLocalPlaybackTracks,
    announceRoomTrackAvailability,
    handleManualCachePieceReceived,
    deleteUploadedTrackArtifacts,
    deleteRoomTrackArtifacts,
    resetPlayerSurface,
    queueAvailability,
    queueAssetAvailability,
    clearAvailabilityForPeer,
    clearAvailabilityForTrack,
    clearAvailabilityForAsset,
    flushPendingAvailability,
    recordPeerDiagnostic,
    enableTrackCaching: false
  });

  const {
    connectionSupervisorStatesRef,
    updateConnectionSupervisorSignalState,
    updateConnectionSupervisorTransportStats,
    updateConnectionSupervisorPlayout
  } = useRoomConnectionSupervisor({ lastSubscribeAckAtRef });
  const {
    pieceTransferRatesRef,
    updateDataTransportStatsRef,
    updateMediaTransportStatsRef,
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
      currentRoomRef,
      initialRoomId,
      recordPeerDiagnostic,
      roomSnapshotResyncController
    ]
  );

  const requestRoomSnapshotResyncRef = useRef(requestRoomSnapshotResync);
  useEffect(() => {
    requestRoomSnapshotResyncRef.current = requestRoomSnapshotResync;
  }, [requestRoomSnapshotResync]);

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
    enableManualTrackCaching: false,
    enableTrackCaching: false,
    roomListenerSetHash: roomSnapshot?.room.members.map((member) => member.peerId ?? member.id).sort().join("|") ?? "",
    uploadedTrackIds,
    connectedPeers,
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

  const clearManualCachePendingPiece = useCallback(() => undefined, []);
  const clearManualCachePendingPieces = useCallback(() => undefined, []);
  const deferManualCachePendingPiece = useCallback(() => undefined, []);

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
    const realtimeRuntimeState = realtimeRuntimeStateRef.current;

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
      fullLocalPlaybackTracksRef,
      uploadedTrackIdsRef,
      manualCacheTrackIdsRef,
      announceRoomTrackAvailabilityRef,
      handleManualCachePieceReceivedRef,
      clearManualCachePendingPiece,
      clearManualCachePendingPieces,
      deferManualCachePendingPiece,
      flushPendingAvailabilityRef,
      recordPieceTransferRef,
      recordPieceRequestSampleRef,
      updatePeerBufferedAmountRef,
      updateDataTransportStatsRef,
      updateMediaTransportStatsRef,
      connectionSupervisorStatesRef,
      updateConnectionSupervisorSignalState,
      updateConnectionSupervisorTransportStats,
      withResolvedTransportHealth,
      withSupervisorDiagnosticPatch,
      getPieceTransferRates,
      pieceTransferRatesRef,
      getPeerMedianRttMs,
      setConnectedPeers,
      setMediaConnectedPeers,
      isPageVisible: realtimeRuntimeState.isPageVisible,
      playbackStatus: realtimeRuntimeState.playbackStatus ?? "paused",
      currentTrackId: realtimeRuntimeState.currentTrackId,
      bufferHealth: realtimeRuntimeState.bufferHealth,
      enableManualTrackCaching: false,
      enableTrackCaching: false,
      queuePlaybackRecoveryRecommendation,
      resubscribeRoomRef,
      activeSessionRef,
      activeRouteRoomIdRef,
      requestRoomSnapshotResyncRef,
      queueAvailabilityRef,
      queueAssetAvailabilityRef,
      clearAvailabilityForPeerRef,
      clearAvailabilityForTrackRef,
      clearAvailabilityForAssetRef,
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
      audioUnlocked: realtimeRuntimeState.audioUnlocked,
      emitPresence,
      startPresenceHeartbeat,
      exitCurrentRoom,
      shouldAcceptIncomingPeerSignalRecoveryGeneration
    });
  }, [
    roomSnapshot?.room.id,
    hydrated,
    iceConfig,
    iceConfigResolved,
    peerId,
    activeSessionRef,
    activeRouteRoomIdRef,
    announceRoomTrackAvailabilityRef,
    clearAvailabilityForAssetRef,
    clearAvailabilityForPeerRef,
    clearAvailabilityForTrackRef,
    clearManualCachePendingPiece,
    clearManualCachePendingPieces,
    deferManualCachePendingPiece,
    currentRoomRef,
    chunkSchedulerRef,
    connectionSupervisorStatesRef,
    deleteRoomTrackArtifactsRef,
    dispatchRoomStateEvent,
    flushPendingAvailabilityRef,
    fullLocalPlaybackTracksRef,
    handleManualCachePieceReceivedRef,
    lastRealtimeRoomEventAtRef,
    lastSubscribeAckAtRef,
    manualCacheTrackIdsRef,
    meshRef,
    pieceTransferRatesRef,
    queuePlaybackRecoveryRecommendation,
    queueAssetAvailabilityRef,
    queueAvailabilityRef,
    recordPeerDiagnosticRef,
    recordPieceRequestSampleRef,
    recordPieceTransferRef,
    recoveryGenerationRef,
    recoveryModeRef,
    resubscribeRoomRef,
    socketDisconnectGraceTimeoutRef,
    socketDisconnectGraceUntilRef,
    socketRef,
    stopPresenceHeartbeat,
    stopRecoveryWatchdog,
    clearSocketDisconnectGrace,
    setConnectedPeers,
    setMediaConnectedPeers,
    setRoomRecoveryState,
    setStatusMessage,
    updateConnectionSupervisorSignalState,
    updateConnectionSupervisorTransportStats,
    updateDataTransportStatsRef,
    updateMediaTransportStatsRef,
    updatePeerBufferedAmountRef,
    uploadedTrackIdsRef,
    uploadedTracksRef,
    exitCurrentRoom,
    emitPresence,
    startPresenceHeartbeat,
    isNavigatingRoomExit
  ]);

  useEffect(() => {
    meshRef.current?.setStatsSamplingMode(
      !roomPlaybackCurrentTrackId || (!isPageVisible && roomPlaybackStatus !== "playing")
        ? "off"
        : bufferHealth !== "healthy"
          ? "active"
          : "steady"
    );
  }, [
    bufferHealth,
    isPageVisible,
    meshRef,
    roomPlaybackCurrentTrackId,
    roomPlaybackStatus
  ]);

  useEffect(() => {
    updateConnectionSupervisorPlayout();
    lastDataActivityAtRef.current = Date.now();
  }, [lastDataActivityAtRef, updateConnectionSupervisorPlayout, connectedPeers.length]);

  const requestOriginalAssetUnits = useCallback(
    (request: Parameters<P2PMesh["requestOriginalAssetUnits"]>[0]) =>
      meshRef.current?.requestOriginalAssetUnits(request) ?? false,
    [meshRef]
  );
  const cancelOriginalAssetRequests = useCallback(
    (assetId: string) => meshRef.current?.cancelOriginalAssetRequests(assetId),
    [meshRef]
  );
  const setLocalAudioStream = useCallback(
    (stream: MediaStream | null, sourcePeerId: string | null, maxBitrateKbps?: number | null) =>
      meshRef.current?.setLocalAudioStream(stream, sourcePeerId, maxBitrateKbps),
    [meshRef]
  );
  const getPeerMediaState = useCallback(
    (remotePeerId: string) => meshRef.current?.getPeerMediaState(remotePeerId) ?? null,
    [meshRef]
  );

  return {
    requestOriginalAssetUnits,
    cancelOriginalAssetRequests,
    setLocalAudioStream,
    getPeerMediaState
  };
}
