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
  PeerDiagnosticsSnapshot,
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import type { Route } from "next";
import type { RoomSocket } from "@/lib/ws-client";
import {
  ChunkScheduler,
  resolveTrackPieceManifest,
  selectCanonicalTrackAvailabilityAnnouncement,
  type PeerConnectionSupervisorState
} from "@/features/p2p";
import {
  createRoomSnapshotResyncController,
  type RoomSnapshotResyncReason
} from "@/features/room/room-snapshot-resync";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { toUserFacingError } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  enableManualTrackCaching
} from "@/features/cache/cache-policy";
import {
  getEffectivePlaybackPositionMs,
  type ProgressivePlaybackSource
} from "@/features/playback/progressive-playback";
import type { ProgressiveSchedulerPolicy } from "@/features/playback/progressive-playback";
import type { ReceivedRoomMediaClock } from "@/features/playback/room-media-clock";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import { useRoomDiagnosticsBridge } from "./use-room-diagnostics-bridge";
import {
  useRoomConnectionSupervisor,
  useRoomConnectionSupervisorRuntime,
  withResolvedTransportHealth,
  withSupervisorDiagnosticPatch
} from "./use-room-connection-supervisor";
import { useManualCacheDownloader } from "./use-manual-cache-downloader";
import type { ManualCacheTrackPlan } from "./use-manual-cache-downloader";
import {
  formatDiagnosticsTimestamp,
  getPieceTransferRates,
  useRoomRuntimeObservability
} from "./use-room-runtime-observability";
import {
  useRoomDataMesh
} from "./use-room-data-mesh";
import {
  createRoomRealtimeRuntime,
  useRoomRealtimeConnection
} from "./use-room-realtime-connection";
import {
  useRoomRuntimeMutableState
} from "./use-room-runtime-mutable-state";
import {
  useRoomRuntimeLifecycle
} from "./use-room-runtime-lifecycle";
import {
  resolvePlaybackConnectionKey,
  resolvePlaybackRecoveryActionType,
  useRoomPlaybackConnectionCoordinator
} from "./use-room-playback-connection-coordinator";
import {
  classifyRoomPlaybackChange,
  resolvePlaybackSurfaceKey,
  resolvePlaybackTimelineKey,
  type RoomChangeKind,
  type RoomRealtimeEventKind,
  type SourceResetReason
} from "./room-playback-topology";

export {
  resolveManualCacheProviderPeerIds,
  resolveManualCacheUploaderPeerIds,
  shouldForceManualCacheBootstrap,
  resolveManualCacheMeshRecoveryMode,
  shouldRecoverManualCacheDataPeers
} from "./use-manual-cache-downloader";
export {
  shouldAcceptIncomingMediaSignal,
  shouldReannounceManualCacheAvailability
} from "./use-room-realtime-connection";
export { shouldRedirectRoomRouteToAuth } from "./use-room-runtime-lifecycle";

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
  progressiveSchedulerPolicy:
    | ProgressiveSchedulerPolicy
    | null;
  isCurrentSourceOwner: boolean;
  audioUnlocked: boolean;
  getLocalPlaybackPositionMs?: () => number | null;
  setAuthoritativeMediaClock?: Dispatch<SetStateAction<ReceivedRoomMediaClock | null>>;
  setAudioUnlocked: Dispatch<SetStateAction<boolean>>;
  roomRecoveryState: {
    phase:
      | "joining"
      | "resyncing"
      | "bootstrapping-data"
      | "playing-local-fallback"
      | "steady";
    mode: "late-join" | "rejoin" | "steady";
    generation: number | null;
    bootstrapStartedAt: string | null;
    bootstrapSourcePeerId: string | null;
    pendingSnapshot: boolean;
    pendingData: boolean;
    pendingMedia: boolean;
    listenerBootstrapAttempts: number | null;
    fullLocalRecoveryActive: boolean;
  };
  setRoomRecoveryState: Dispatch<
    SetStateAction<{
      phase:
      | "joining"
      | "resyncing"
      | "bootstrapping-data"
      | "playing-local-fallback"
      | "steady";
      mode: "late-join" | "rejoin" | "steady";
      generation: number | null;
      bootstrapStartedAt: string | null;
      bootstrapSourcePeerId: string | null;
      pendingSnapshot: boolean;
      pendingData: boolean;
      pendingMedia: boolean;
      listenerBootstrapAttempts: number | null;
      fullLocalRecoveryActive: boolean;
    }>
  >;
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
  startPlaybackDemandCacheDownload: (trackId: string) => Promise<void>;
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

const manualCacheDirectRequestIntervalMs = 450;
const manualCacheDirectRequestBatchSize = 8;
const manualCacheDirectRequestTimeoutMs = 5_000;
const manualCacheDirectPendingTtlMs = 7_000;
const connectionSupervisorIceRestartNoProgressFloorMs = 6_000;
const connectionSupervisorHardRecreateNoProgressFloorMs = 45_000;
const enableTrackCaching = true;

export function shouldAcceptIncomingPeerSignalRecoveryGeneration(input: {
  payloadRecoveryGeneration: number | null | undefined;
  currentRecoveryGeneration: number | null;
}) {
  if (
    typeof input.payloadRecoveryGeneration !== "number" ||
    input.currentRecoveryGeneration === null
  ) {
    return true;
  }

  return input.payloadRecoveryGeneration === input.currentRecoveryGeneration;
}

function resolveCurrentRoomTrackTotalChunks(input: {
  trackId: string | null;
  roomSnapshot: RoomSnapshot | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
}) {
  if (!input.trackId) {
    return 0;
  }

  const roomId = input.roomSnapshot?.room.id ?? null;
  const activeMemberPeerIds = new Set(
    input.roomSnapshot?.room.members
      .map((member) => member.peerId)
      .filter((peerId): peerId is string => !!peerId) ?? []
  );
  const track = input.roomSnapshot?.tracks.find((entry) => entry.id === input.trackId) ?? null;
  const availability = selectCanonicalTrackAvailabilityAnnouncement(
    Object.values(input.availabilityByTrack[input.trackId] ?? {}).filter(
      (announcement) =>
        announcement.totalChunks > 0 &&
        announcement.chunkSize > 0 &&
        (!roomId || announcement.roomId === roomId) &&
        activeMemberPeerIds.has(announcement.ownerPeerId)
    )
  );

  return (
    resolveTrackPieceManifest({
      track,
      availability
    })?.totalChunks ?? 0
  );
}

function getPeerMedianRttMs(state: PeerConnectionSupervisorState | null | undefined) {
  if (!state?.samples?.length) {
    return null;
  }

  const values = state.samples
    .map((sample) => sample.currentRoundTripTimeMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (values.length === 0) {
    return null;
  }

  return values[Math.floor(values.length / 2)] ?? null;
}

function resolveIceRestartNoProgressMs(state: PeerConnectionSupervisorState | null | undefined) {
  const rttMs = getPeerMedianRttMs(state) ?? 0;
  return Math.max(connectionSupervisorIceRestartNoProgressFloorMs, Math.round(rttMs * 4));
}

function resolveHardRecreateNoProgressMs(state: PeerConnectionSupervisorState | null | undefined) {
  const rttMs = getPeerMedianRttMs(state) ?? 0;
  return Math.max(connectionSupervisorHardRecreateNoProgressFloorMs, Math.round(rttMs * 8));
}

export function resolvePeerConnectionNoProgressMs(
  state: PeerConnectionSupervisorState,
  now = Date.now()
) {
  const latestProgressAt = Math.max(
    state.lastTransportProgressAtMs ?? 0,
    state.lastPlayoutProgressAtMs ?? 0
  );
  if (latestProgressAt > 0) {
    return Math.max(0, now - latestProgressAt);
  }

  return Math.max(0, now - (state.unhealthySignalStateStartedAtMs ?? state.lastSignalStateAtMs));
}

export function resolveMediaDiagnosticPeerId(input: {
  remotePeerId: string | null | undefined;
  connectedPeerIds: string[];
  currentSourcePeerId: string | null | undefined;
}) {
  return (
    input.remotePeerId ||
    input.connectedPeerIds[0] ||
    input.currentSourcePeerId ||
    "system"
  );
}

function resolveRoomListenerPeerIds(
  members: RoomSnapshot["room"]["members"] | null | undefined,
  localPeerId: string | null | undefined
) {
  if (!members || !localPeerId) {
    return [] as string[];
  }

  return members
    .map((member) => member.peerId)
    .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== localPeerId)
    .sort();
}

export function shouldKickSourcePlaybackFromRealtimeEvent(input: {
  previousPlayback: RoomSnapshot["room"]["playback"] | null | undefined;
  nextPlayback: RoomSnapshot["room"]["playback"] | null | undefined;
  activeSessionId: string | null | undefined;
  eventKind?: RoomRealtimeEventKind;
}) {
  const { previousPlayback, nextPlayback, activeSessionId } = input;
  if (!activeSessionId || !nextPlayback || nextPlayback.sourceSessionId !== activeSessionId) {
    return false;
  }

  const roomChangeKind = classifyRoomPlaybackChange({
    eventKind: input.eventKind ?? "playback",
    previousPlayback,
    nextPlayback
  });

  if (roomChangeKind === "playback-topology" || roomChangeKind === "transport-topology") {
    return true;
  }

  if (!previousPlayback) {
    return true;
  }

  if (input.eventKind === "presence") {
    return false;
  }

  if (roomChangeKind !== "playback-timeline" || nextPlayback.status !== "playing") {
    return false;
  }

  return (
    previousPlayback.status !== "playing" ||
    previousPlayback.positionMs !== nextPlayback.positionMs ||
    previousPlayback.startedAt !== nextPlayback.startedAt
  );
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
  activeSessionRef,
  refreshSession,
  roomSnapshot,
  dispatchRoomStateEvent,
  currentRoomRef,
  peerId,
  setPeerId,
  connectedPeers,
  setConnectedPeers,
  mediaConnectedPeers: _mediaConnectedPeers,
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
  schedulerMode: _schedulerMode,
  setSchedulerMode,
  schedulerPlaybackBucketMs: _schedulerPlaybackBucketMs,
  bufferHealth,
  transportGovernorMode: _transportGovernorMode,
  activePlaybackSource,
  progressiveSchedulerPolicy,
  isCurrentSourceOwner,
  audioUnlocked,
  getLocalPlaybackPositionMs: _getLocalPlaybackPositionMs,
  setAuthoritativeMediaClock = (() => {}) as Dispatch<SetStateAction<ReceivedRoomMediaClock | null>>,
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
  audioRef: _audioRef,
  socketRef,
  chunkSchedulerRef,
  resetPlayerSurface,
  setStatusMessage,
  statusMessage,
  refreshAvailableRooms,
  refreshPlaylists
}: UseRoomRuntimeInput): UseRoomRuntimeResult {
  const clearPlaybackRetry = useCallback(() => undefined, []);

  const {
    meshRef,
    mediaMeshRef,
    initialRecoveryAttemptRef,
    previousInitialRoomIdRef,
    activeRouteRoomIdRef,
    mediaTransportEpochRef,
    remotePlaybackResumeAfterUnlockKeyRef,
    socketDisconnectGraceUntilRef,
    resubscribeRoomRef,
    recoveryGenerationRef,
    roomRecoveryStateRef,
    activePlaybackSourceRef,
    lastSubscribeAckAtRef,
    recoveryModeRef,
    lastRealtimeRoomEventAtRef,
    lastDataActivityAtRef,
    listenerMediaLifecycleRef,
    listenerMediaRecoveryTimeoutRef,
    socketDisconnectGraceTimeoutRef,
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
    clearListenerMediaRecovery,
    clearSocketDisconnectGrace,
    bumpMediaTransportEpoch,
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
    manualCacheTrackIds,
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
    setAuthoritativeMediaClock,
    enableTrackCaching
  });
  const {
    playbackConnectionKeyRef,
    listenerPlaybackStateRef,
    activeRecoveryActionRef,
    activeRecoveryActionResultRef,
    lastRecoveryRecommendationRef,
    lastRecoveryDropReasonRef,
    getCurrentPlaybackConnectionKey,
    reportPlaybackState,
    applyRecoveryAction,
    finishRecoveryAction,
    noteRecoveryRecommendation
  } = useRoomPlaybackConnectionCoordinator({
    currentRoomRef,
    mediaTransportEpochRef,
    listenerMediaLifecycleRef,
    clearListenerMediaRecovery,
    clearPlaybackRetry
  });
  const dataMeshBridge = useRoomDataMesh({ meshRef });
  const lastRoomChangeKindRef = useRef<RoomChangeKind | null>(null);
  const lastSourceResetReasonRef = useRef<SourceResetReason | null>(null);
  const emitRuntimeEvent = useRoomDiagnosticsBridge({
    recordPeerDiagnostic,
    setStatusMessage
  });
  const {
    connectionSupervisorStatesRef,
    sourceRecoveryCoordinatorRef,
    beginSourceHardRecoveryAction,
    clearSourceHardRecoveryAction,
    resolveCurrentAudibleSource,
    resolveSourceContinuityState,
    resolveSourceRecoverySuppressedReason,
    ensureConnectionSupervisorState,
    commitConnectionSupervisorState,
    updateConnectionSupervisorSignalState,
    updateConnectionSupervisorTransport,
    updateConnectionSupervisorPlayout
  } = useRoomConnectionSupervisor({
    roomSnapshot,
    currentRoomRef,
    recordPeerDiagnostic,
    listenerMediaLifecycleRef,
    lastDataActivityAtRef,
    mediaConnectionState,
    activePlaybackSource,
    isCurrentSourceOwner,
    isPageVisible,
    lastSubscribeAckAtRef
  });
  const {
    pieceTransferRatesRef,
    pieceRequestSamplesRef,
    updateDataTransportStatsRef,
    updateMediaTransportStatsRef,
    reportRealtimeFailureRef,
    recordPieceTransferRef,
    recordPieceRequestSampleRef,
    updatePeerBufferedAmountRef
  } = useRoomRuntimeObservability({
    roomSnapshot,
    currentRoomRef,
    peerId,
    meshRef,
    recordPeerDiagnostic,
    setMediaConnectionState,
    updateConnectionSupervisorTransport,
    updateConnectionSupervisorPlayout,
    resolveCurrentAudibleSource,
    resolveSourceContinuityState,
    listenerMediaLifecycleRef,
    lastDataActivityAtRef,
    activePlaybackSource,
    isCurrentSourceOwner,
    mediaConnectionState,
    isPageVisible,
    bufferHealth
  });

  const getRemoteAudioDiagnostics = useCallback(
    () => ({
      audioPaused: null,
      audioMuted: null,
      audioReadyState: null,
      hasSrcObject: null,
      currentSrc: null,
      audioVolume: null,
      trackId: null,
      trackMuted: null,
      trackEnabled: null,
      trackReadyState: null
    }),
    []
  );

  const getRemoteMediaTraceContext = useCallback(
    (remotePeerId?: string | null) => {
      const playback = currentRoomRef.current?.room.playback;
      const currentTrackId = playback?.currentTrackId ?? null;
      const mediaEpoch = playback?.mediaEpoch ?? null;
      const sourcePeerId = playback?.sourcePeerId ?? null;
      const resolvedRemotePeerId = remotePeerId ?? sourcePeerId ?? null;
      return {
        currentTrackId,
        mediaEpoch,
        sourcePeerId,
        remotePeerId: resolvedRemotePeerId,
        traceKey:
          currentTrackId && mediaEpoch !== null
            ? `${currentTrackId}|${mediaEpoch}|${sourcePeerId ?? "none"}|${peerId ?? "none"}`
            : null
      };
    },
    [currentRoomRef, peerId]
  );

  const resetListenerMediaLifecycle = useCallback(() => {
    const lifecycle = listenerMediaLifecycleRef.current;
    lifecycle.traceKey = null;
    lifecycle.sourcePeerId = null;
    lifecycle.lastPlayAttemptResult = null;
    lifecycle.lastPlayAttemptError = null;
    lifecycle.lastSoftRecoveryTraceKey = null;
    lifecycle.lastSoftRecoveryAt = null;
    lifecycle.lastHardRecoveryTraceKey = null;
    lifecycle.lastHardRecoveryAt = null;
    lifecycle.currentGeneration = null;
    lifecycle.generationStartedAt = null;
    lifecycle.boundGeneration = null;
    lifecycle.playingGeneration = null;
    lifecycle.lastPlayoutProgressAt = null;
    lifecycle.lastTransportProgressAt = null;
    lifecycle.recoveryStage = "idle";
  }, [listenerMediaLifecycleRef]);

  useEffect(() => {
    clearListenerMediaRecovery();
    resetListenerMediaLifecycle();
  }, [clearListenerMediaRecovery, resetListenerMediaLifecycle]);

  const updateRemoteMediaDiagnostic = useCallback(
    (
      summary: string,
      update?: (snapshot: PeerDiagnosticsSnapshot) => PeerDiagnosticsSnapshot,
      options?: { event?: string; recordEvent?: boolean; level?: "info" | "warning" | "error" }
    ) => {
      const withPlaybackConnectionDiagnostics = (snapshot: PeerDiagnosticsSnapshot) => {
        const playback = currentRoomRef.current?.room.playback;
        const baselineProgressiveStatus =
          snapshot.progressivePlaybackStatus ??
          createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!;
        const activeRecoveryAction = activeRecoveryActionRef.current;
        const lastRecoveryRecommendation = lastRecoveryRecommendationRef.current;
        return {
          ...snapshot,
          progressivePlaybackStatus: {
            ...baselineProgressiveStatus,
            playbackConnectionKey: playbackConnectionKeyRef.current,
            listenerPlaybackState: listenerPlaybackStateRef.current,
            activeRecoveryActionType: activeRecoveryAction?.actionType ?? null,
            activeRecoveryActionResult: activeRecoveryActionResultRef.current,
            activeRecoveryActionStartedAt: activeRecoveryAction?.startedAt ?? null,
            activeRecoveryActionReason: activeRecoveryAction?.reason ?? null,
            lastRecoveryRecommendationScope: lastRecoveryRecommendation?.scope ?? null,
            lastRecoveryRecommendationLevel: lastRecoveryRecommendation?.level ?? null,
            lastRecoveryRecommendationReason: lastRecoveryRecommendation?.reason ?? null,
            lastRecoveryRecommendationAt: lastRecoveryRecommendation?.recommendedAt ?? null,
            recoveryDropReason: lastRecoveryDropReasonRef.current,
            playbackSurfaceKey: resolvePlaybackSurfaceKey(playback),
            playbackTimelineKey: resolvePlaybackTimelineKey(playback),
            roomChangeKind: lastRoomChangeKindRef.current,
            sourceResetReason: lastSourceResetReasonRef.current,
            socketDisconnectGraceActive:
              socketDisconnectGraceUntilRef.current !== null &&
              socketDisconnectGraceUntilRef.current > Date.now()
          }
        };
      };
      recordPeerDiagnosticRef.current({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: options?.event ?? "cache-playback-state",
        summary,
        recordEvent: options?.recordEvent ?? false,
        level: options?.level,
        update: (snapshot) => {
          const seededSnapshot = withPlaybackConnectionDiagnostics(snapshot);
          return withPlaybackConnectionDiagnostics(update ? update(seededSnapshot) : seededSnapshot);
        }
      });
    },
    [
      activeRecoveryActionRef,
      activeRecoveryActionResultRef,
      lastRecoveryRecommendationRef,
      lastRecoveryDropReasonRef,
      lastRoomChangeKindRef,
      lastSourceResetReasonRef,
      listenerPlaybackStateRef,
      playbackConnectionKeyRef,
      socketDisconnectGraceUntilRef,
      currentRoomRef
    ]
  );

  const rawRoomListenerPeerIds = useMemo(
    () => resolveRoomListenerPeerIds(roomSnapshot?.room.members, peerId),
    [roomSnapshot?.room.members, peerId]
  );
  const roomListenerSetHash = rawRoomListenerPeerIds.join(",");
  const shouldPauseManualCacheDirectRequests = false;
  const activePlaybackWindow = useMemo(() => {
    const playback = roomSnapshot?.room.playback ?? null;
    const track = playback?.currentTrackId
      ? roomSnapshot?.tracks.find((entry) => entry.id === playback.currentTrackId) ?? null
      : null;
    if (!playback?.currentTrackId || !track) {
      return null;
    }

    const positionMs = getEffectivePlaybackPositionMs(
      playback,
      track.durationMs,
      Date.now()
    );
    return {
      trackId: playback.currentTrackId,
      positionMs,
      revision: playback.playbackRevision,
      mediaEpoch: playback.mediaEpoch,
      status: playback.status,
      policy:
        playback.status === "paused"
          ? "pause-fill"
          : progressiveSchedulerPolicy ?? "startup"
    };
  }, [progressiveSchedulerPolicy, roomSnapshot?.room.playback, roomSnapshot?.tracks]);

  useEffect(() => {
    const currentTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;
    if (!currentTrackId) {
      return;
    }
    if (
      roomSnapshot?.room.playback.status !== "playing" &&
      roomSnapshot?.room.playback.status !== "buffering" &&
      roomSnapshot?.room.playback.status !== "paused"
    ) {
      return;
    }
    void startPlaybackDemandCacheDownload(currentTrackId).catch((error) => {
      setStatusMessage(toUserFacingError(error));
    });
  }, [
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status,
    roomSnapshot?.room.playback.playbackRevision,
    roomSnapshot?.room.playback.mediaEpoch,
    setStatusMessage,
    startPlaybackDemandCacheDownload
  ]);
  const { clearPendingPiece: clearManualCachePendingPiece } = useManualCacheDownloader({
    enableManualTrackCaching,
    manualCacheTrackIds,
    roomSnapshot,
    availabilityByTrack,
    peerId,
    connectedPeers,
    dataMesh: dataMeshBridge,
    pauseDirectRequests: shouldPauseManualCacheDirectRequests,
    activePlaybackWindow,
    onRuntimeEvent: emitRuntimeEvent,
    onManualCachePlan: handleManualCachePlan
  });

  const exitCurrentRoom = useCallback(
    (message: string) => {
      setIsNavigatingRoomExit(true);
      setSuppressRoomRecovery(true);
      dispatchRoomStateEvent({ type: "local-reset" });
      resetPlayerSurface();
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage(message);
      if (workspaceOnly) {
        router.replace(workspaceEntryHref as Route);
        return;
      }

      setIsNavigatingRoomExit(false);
    },
    [
      lastRoomStorageKey,
      resetPlayerSurface,
      router,
      dispatchRoomStateEvent,
      setIsNavigatingRoomExit,
      setStatusMessage,
      setSuppressRoomRecovery,
      workspaceEntryHref,
      workspaceOnly
    ]
  );

  const applyResyncedRoomSnapshot = useCallback(
    (expectedRoomId: string, snapshot: RoomSnapshot, reason: RoomSnapshotResyncReason) => {
      if (
        snapshot.room.id !== expectedRoomId ||
        activeRouteRoomIdRef.current !== expectedRoomId
      ) {
        return;
      }

      dispatchRoomStateEvent({
        type: "recover-snapshot",
        snapshot
      });

      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "room-snapshot-resync",
        summary: `房间状态已全量刷新（${reason}）`,
        recordEvent: false
      });
    },
    [dispatchRoomStateEvent, recordPeerDiagnostic]
  );

  const handleRoomSnapshotResyncError = useCallback(
    (roomId: string, reason: RoomSnapshotResyncReason, error: unknown) => {
      if (activeRouteRoomIdRef.current !== roomId || isNavigatingRoomExit) {
        return;
      }

      const message = toUserFacingError(error);
      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "room-snapshot-resync-failed",
        level: "warning",
        summary: `房间状态刷新失败（${reason}）：${message}`,
        update: (snapshot) => ({
          ...snapshot,
          lastError: `房间状态刷新失败：${message}`
        })
      });

      if (
        message.includes("房间不存在") ||
        message.includes("已经被删除") ||
        message.includes("房间已不可用")
      ) {
        exitCurrentRoom("这个房间已不可用，请返回音乐房重新加入。");
        return;
      }

      setStatusMessage(`房间状态刷新失败：${message}`);
    },
    [exitCurrentRoom, isNavigatingRoomExit, recordPeerDiagnostic, setStatusMessage]
  );

  const roomSnapshotResyncController = useMemo(
    () =>
      createRoomSnapshotResyncController({
        loadSnapshot: (roomId: string) => musicRoomApi.getRoom(roomId),
        applySnapshot: applyResyncedRoomSnapshot,
        onError: handleRoomSnapshotResyncError
      }),
    [applyResyncedRoomSnapshot, handleRoomSnapshotResyncError]
  );

  useEffect(() => () => roomSnapshotResyncController.reset(), [roomSnapshotResyncController]);

  const requestRoomSnapshotResync = useCallback(
    async (reason: RoomSnapshotResyncReason, roomId = activeRouteRoomIdRef.current) => {
      if (
        !roomId ||
        !hydrated ||
        !activeSessionRef.current?.userId ||
        isNavigatingRoomExit
      ) {
        return;
      }

      await roomSnapshotResyncController.request(roomId, reason);
    },
    [activeSessionRef, hydrated, isNavigatingRoomExit, roomSnapshotResyncController]
  );
  const queuePlaybackRecoveryRecommendation = useCallback(
    (recommendation: {
      playbackConnectionKey: string | null;
      peerId: string | null;
      scope: "data" | "room";
      level: "soft" | "ice-restart" | "hard-recreate" | "full-resubscribe";
      reason: string;
      observedNoProgressMs: number | null;
      guardReason?: string | null;
    }) => {
      noteRecoveryRecommendation(recommendation);
      if (recommendation.guardReason) {
        lastRecoveryDropReasonRef.current = "suppressed-by-guard";
        return;
      }
      const currentPlaybackConnectionKey = getCurrentPlaybackConnectionKey();
      if (
        recommendation.playbackConnectionKey &&
        recommendation.playbackConnectionKey !== currentPlaybackConnectionKey
      ) {
        lastRecoveryDropReasonRef.current = "stale-connection-key";
        return;
      }
      updateRemoteMediaDiagnostic("收到播放恢复建议", undefined, {
        event: "playback-recovery-recommendation",
        recordEvent: false
      });

      const dataActionType = resolvePlaybackRecoveryActionType(recommendation);

      if (dataActionType !== "full-resubscribe" && !recommendation.peerId) {
        lastRecoveryDropReasonRef.current = "missing-peer";
        return;
      }

      const action = applyRecoveryAction({
        playbackConnectionKey:
          recommendation.playbackConnectionKey ?? currentPlaybackConnectionKey,
        actionType: dataActionType,
        peerId: recommendation.peerId,
        reason: recommendation.reason
      });
      if (!action) {
        return;
      }

      reportPlaybackState("recovering-hard", {
        playbackConnectionKey: action.playbackConnectionKey
      });

      if (dataActionType === "restart-data-peer" && recommendation.peerId) {
        void meshRef.current
          ?.restartPeer(recommendation.peerId)
          .then(() => {
            finishRecoveryAction(action.actionId, "completed", {
              nextState: "recovering-hard"
            });
          })
          .catch(() => {
            finishRecoveryAction(action.actionId, "failed", {
              nextState: "failed"
            });
          });
        return;
      }

      if (dataActionType === "full-resubscribe") {
        resubscribeRoomRef.current?.();
        if (recommendation.peerId) {
          void meshRef.current?.restartPeer(recommendation.peerId);
        }
        finishRecoveryAction(action.actionId, "completed", {
          nextState: "recovering-hard"
        });
      }
    },
    [
      applyRecoveryAction,
      finishRecoveryAction,
      getCurrentPlaybackConnectionKey,
      meshRef,
      noteRecoveryRecommendation,
      reportPlaybackState,
      lastRecoveryDropReasonRef,
      updateRemoteMediaDiagnostic
    ]
  );
  const {
    emitPresence,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    stopRecoveryWatchdog
  } =
    useRoomRealtimeConnection({
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
      roomListenerSetHash,
      uploadedTrackIds,
      connectedPeers,
      roomRecoveryState,
      setRoomRecoveryState,
      isCurrentSourceOwner,
      uploadedTracks,
      announceRoomTrackAvailabilityRef,
      lastRealtimeRoomEventAtRef,
      lastSubscribeAckAtRef,
      lastDataActivityAtRef,
      recoveryGenerationRef,
      recoveryModeRef,
      resubscribeRoomRef,
      meshRef,
      mediaMeshRef,
      bumpMediaTransportEpoch,
      resolveSourceContinuityState,
      resolveSourceRecoverySuppressedReason,
      socketDisconnectGraceUntilRef,
      requestRoomSnapshotResync,
      getCurrentPlaybackConnectionKey,
      queuePlaybackRecoveryRecommendation
    } as any);

  useRoomRuntimeLifecycle({
    workspaceOnly,
    initialRoomId,
    hydrated,
    authEntryHref,
    router,
    lastRoomStorageKey,
    peerStorageKey,
    activeSession,
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

  const requestRoomSnapshotResyncRef = useRef(requestRoomSnapshotResync);
  const ensureSourcePlaybackStarted = useCallback(async () => {
    const currentRoom = currentRoomRef.current;
    if (!currentRoom?.room.id || !peerId || !isCurrentSourceOwner) {
      updateSourceStartState("idle");
      return;
    }

    const playback = currentRoom.room.playback;
    if (playback.status !== "playing" || !playback.currentTrackId) {
      updateSourceStartState("idle");
      return;
    }

    updateSourceStartState("live", {
      summary: "音源端使用本地播放和缓存分片同步"
    });
  }, [currentRoomRef, isCurrentSourceOwner, peerId, updateSourceStartState]);
  const ensureSourcePlaybackStartedRef = useRef<() => Promise<void>>(ensureSourcePlaybackStarted);

  useEffect(() => {
    requestRoomSnapshotResyncRef.current = requestRoomSnapshotResync;
  }, [requestRoomSnapshotResync]);

  useEffect(() => {
    ensureSourcePlaybackStartedRef.current = ensureSourcePlaybackStarted;
  }, [ensureSourcePlaybackStarted]);

  useRoomConnectionSupervisorRuntime({
    roomSnapshot,
    peerId,
    currentRoomRef,
    connectionSupervisorStatesRef,
    ensureConnectionSupervisorState,
    commitConnectionSupervisorState,
    resolveSourceContinuityState,
    resolveSourceRecoverySuppressedReason,
    beginSourceHardRecoveryAction,
    clearSourceHardRecoveryAction,
    listenerMediaLifecycleRef,
    recordPeerDiagnosticRef,
    formatDiagnosticsTimestamp,
    resolvePeerConnectionNoProgressMs,
    resolveIceRestartNoProgressMs,
    resolveHardRecreateNoProgressMs,
    activePlaybackSource,
    isPageVisible,
    isCurrentSourceOwner,
    meshRef,
    reportRealtimeFailureRef,
    lastRealtimeRoomEventAtRef,
    resubscribeRoomRef,
    getCurrentPlaybackConnectionKey,
    queuePlaybackRecoveryRecommendation
  });

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
    if (!roomSnapshot?.room.id || !hydrated || !iceConfigResolved) {
      return;
    }

    return createRoomRealtimeRuntime({
      roomId: roomSnapshot.room.id,
      peerId,
      iceConfig,
      socketRef,
      recordPeerDiagnosticRef,
      getRemoteMediaTraceContext,
      reportRealtimeFailureRef,
      activePlaybackSourceRef,
      roomRecoveryStateRef,
      pieceTransferRatesRef,
      pieceRequestSamplesRef,
      sourceRecoveryCoordinatorRef,
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
      getPeerMedianRttMs,
      setConnectedPeers,
      isPageVisible,
      playbackStatus: roomSnapshot?.room.playback.status,
      currentTrackId: roomSnapshot?.room.playback.currentTrackId,
      bufferHealth,
      enableManualTrackCaching,
      mediaMeshRef,
      listenerMediaLifecycleRef,
      mediaTransportEpochRef,
      updateRemoteMediaDiagnostic,
      getRemoteAudioDiagnostics,
      resolveMediaDiagnosticPeerId,
      setMediaConnectedPeers,
      setMediaConnectionState,
      updateMediaTransportStatsRef,
      isCurrentSourceOwner,
      enableTrackCaching,
      activePlaybackSource,
      resubscribeRoomRef,
      activeSessionRef,
      activeRouteRoomIdRef,
      requestRoomSnapshotResyncRef,
      ensureSourcePlaybackStartedRef,
      queueAvailabilityRef,
      clearAvailabilityForPeerRef,
      deleteRoomTrackArtifactsRef,
      lastRealtimeRoomEventAtRef,
      lastRoomChangeKindRef,
      lastSourceResetReasonRef,
      recoveryGenerationRef,
      lastSubscribeAckAtRef,
      recoveryModeRef,
      socketDisconnectGraceUntilRef,
      socketDisconnectGraceTimeoutRef,
      stopPresenceHeartbeat,
      stopRecoveryWatchdog,
      clearListenerMediaRecovery,
      clearSocketDisconnectGrace,
      bumpMediaTransportEpoch,
      dispatchRoomStateEvent,
      setAuthoritativeMediaClock,
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
    } as any);
  }, [
    roomSnapshot?.room.id,
    hydrated,
    iceConfig,
    iceConfigResolved,
    peerId,
    activeSessionRef,
    currentRoomRef,
    uploadedTrackIdsRef,
    clearListenerMediaRecovery,
    stopRecoveryWatchdog,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    chunkSchedulerRef,
    emitPresence,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    isNavigatingRoomExit,
    setConnectedPeers,
    setMediaConnectedPeers,
    setAuthoritativeMediaClock,
    setMediaConnectionState,
    setRoomRecoveryState,
    exitCurrentRoom,
    setStatusMessage,
    updateRemoteMediaDiagnostic
  ]);

  return {
    ensureSourcePlaybackStarted
  };
}
