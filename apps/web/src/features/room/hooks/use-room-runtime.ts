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
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import type { ProgressiveSchedulerPolicy } from "@/features/playback/progressive-playback";
import type { ReceivedRoomMediaClock } from "@/features/playback/room-media-clock";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
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
  useRoomMediaPublicationRuntime,
  useRoomMediaRuntime
} from "./use-room-media-runtime";
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
import { shouldMaintainRemotePlaybackSurface } from "./room-playback-policy";
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
export { shouldManagePublishedMediaTransport } from "./use-room-media-runtime";
export { shouldForceRemoteAudioElementRebind } from "./use-room-media-runtime";
export { shouldKickRemotePlaybackFromAudioEvent } from "./use-room-media-runtime";
export { shouldReannounceManualCacheAvailability } from "./use-room-realtime-connection";
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
  getHostRelayStream?: () => MediaStream | null;
  getHostRelayClockState?: () => {
    mediaTimeMs: number;
    bufferedAheadMs: number;
    playoutState: "playing" | "buffering" | "paused";
  } | null;
  setAuthoritativeMediaClock: Dispatch<SetStateAction<ReceivedRoomMediaClock | null>>;
  setAudioUnlocked: Dispatch<SetStateAction<boolean>>;
  roomRecoveryState: {
    phase:
      | "joining"
      | "resyncing"
      | "bootstrapping-data"
      | "bootstrapping-media"
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
        | "bootstrapping-media"
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
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  socketRef: MutableRefObject<RoomSocket | null>;
  chunkSchedulerRef: MutableRefObject<ChunkScheduler | null>;
  resetPlayerSurface: () => void;
  setStatusMessage: (value: string) => void;
  statusMessage: string;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
};

type UseRoomRuntimeResult = {
  scheduleRemotePlaybackRetry: (attempt?: number) => void;
  syncHostMediaStream: () => Promise<void>;
  ensureSourcePlaybackStarted: () => Promise<void>;
};

const manualCacheDirectRequestIntervalMs = 450;
const manualCacheDirectRequestBatchSize = 8;
const manualCacheDirectRequestTimeoutMs = 5_000;
const manualCacheDirectPendingTtlMs = 7_000;
const remoteStreamSwapGraceMs = 900;
const remotePlaybackRetryBackoffMs = [120, 240, 400] as const;
const maxRemotePlaybackRetryAttempts = 3;
const listenerSoftRecoveryDelayMs = 1_500;
const listenerHardRecoveryDelayMs = 5_000;
const listenerSoftRecoveryCooldownMs = 800;
const connectionSupervisorIceRestartNoProgressFloorMs = 6_000;
const connectionSupervisorHardRecreateNoProgressFloorMs = 15_000;
const subscribeAckTimeoutMs = 4_000;
const subscribeRetryBackoffMs = [200, 500, 1_000, 2_000, 4_000] as const;
const stalledPieceSyncRecoveryThresholdMs = 20_000;
const recoverySoftRetryThresholdMs = 5_000;
const recoveryMediaRestartThresholdMs = 4_000;
const recoveryDataRestartThresholdMs = 8_000;
const enableTrackCaching = false;

type ListenerMediaRecoveryReason =
  | "connected-but-no-track"
  | "track-received-but-not-bound"
  | "bound-but-not-playing"
  | "bound-but-muted-track";

type ListenerMediaRecoveryAction =
  | "rebind-element"
  | "retry-play"
  | "rebind-and-play";

export function resolveListenerMediaRecoveryReason(input: {
  traceKey: string;
  lastTrackTraceKey: string | null;
  lastBoundTraceKey: string | null;
  lastPlayAttemptTraceKey: string | null;
  lastPlayAttemptResult: "ok" | "rejected" | null;
  lastPlayingTraceKey: string | null;
  remoteAudioPaused: boolean | null;
  hasBoundSrcObject: boolean;
  remoteTrackMuted: boolean | null;
  remoteTrackEnabled: boolean | null;
  remoteTrackReadyState: MediaStreamTrackState | null;
}): ListenerMediaRecoveryReason | null {
  if (input.lastTrackTraceKey !== input.traceKey) {
    return "connected-but-no-track";
  }

  if (input.lastBoundTraceKey !== input.traceKey || !input.hasBoundSrcObject) {
    return "track-received-but-not-bound";
  }

  if (
    input.remoteTrackMuted === true ||
    input.remoteTrackEnabled === false ||
    input.remoteTrackReadyState === "ended"
  ) {
    return "bound-but-muted-track";
  }

  if (input.lastPlayingTraceKey === input.traceKey) {
    return null;
  }

  if (
    input.lastPlayAttemptTraceKey !== input.traceKey ||
    input.lastPlayAttemptResult !== "ok" ||
    input.remoteAudioPaused !== false
  ) {
    return "bound-but-not-playing";
  }

  return null;
}

export function resolveListenerMediaRecoveryAction(input: {
  reason: ListenerMediaRecoveryReason | null;
  bindAttempts: number;
  playAttempts: number;
}) {
  if (!input.reason) {
    return null;
  }

  if (input.reason === "connected-but-no-track") {
    return null;
  }

  if (input.reason === "track-received-but-not-bound") {
    return "rebind-element" satisfies ListenerMediaRecoveryAction;
  }

  if (input.reason === "bound-but-not-playing") {
    return "retry-play" satisfies ListenerMediaRecoveryAction;
  }

  return "rebind-and-play" satisfies ListenerMediaRecoveryAction;
}

function resolveListenerRecoveryDelayMs(input: {
  progressGapMs: number | null;
  remoteTrackReadyState: MediaStreamTrackState | null;
}) {
  if (input.remoteTrackReadyState === "ended") {
    return listenerHardRecoveryDelayMs;
  }

  if (typeof input.progressGapMs !== "number" || !Number.isFinite(input.progressGapMs)) {
    return listenerSoftRecoveryDelayMs;
  }

  return input.progressGapMs >= listenerHardRecoveryDelayMs
    ? listenerHardRecoveryDelayMs
    : listenerSoftRecoveryDelayMs;
}

function resolveConsecutiveNoProgressMs(...values: Array<number | null>) {
  const definedValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0
  );

  if (definedValues.length === 0) {
    return null;
  }

  return Math.max(0, Math.round(Math.min(...definedValues)));
}

export function shouldResumeRemotePlayback(input: {
  audioUnlocked: boolean;
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null;
  hasRemoteSrcObject: boolean;
  remoteAudioPaused: boolean | null;
}) {
  return (
    input.audioUnlocked &&
    !input.isCurrentSourceOwner &&
    input.activePlaybackSource === "remote-stream" &&
    input.playbackStatus === "playing" &&
    !!input.currentTrackId &&
    input.hasRemoteSrcObject &&
    input.remoteAudioPaused !== false
  );
}

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
    "remote-media"
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
  audioUnlocked,
  getLocalPlaybackPositionMs,
  getHostRelayStream,
  getHostRelayClockState,
  setAuthoritativeMediaClock,
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
  announceRoomTrackAvailability,
  handleManualCachePieceReceived,
  handleManualCachePlan,
  deleteUploadedTrackArtifacts,
  deleteRoomTrackArtifacts,
  audioRef,
  remoteAudioRef,
  socketRef,
  chunkSchedulerRef,
  resetPlayerSurface,
  setStatusMessage,
  statusMessage,
  refreshAvailableRooms,
  refreshPlaylists
}: UseRoomRuntimeInput): UseRoomRuntimeResult {
  const {
    meshRef,
    mediaMeshRef,
    initialRecoveryAttemptRef,
    previousInitialRoomIdRef,
    activeRouteRoomIdRef,
    hostStreamRef,
    mediaTransportEpochRef,
    transportResetReasonRef,
    hostMediaSyncRetryRef,
    lastHostCaptureRefreshAtRef,
    remotePlaybackRetryRef,
    remotePlaybackResumeAfterUnlockKeyRef,
    remoteStreamClearTimeoutRef,
    socketDisconnectGraceUntilRef,
    resubscribeRoomRef,
    recoveryGenerationRef,
    roomRecoveryStateRef,
    activePlaybackSourceRef,
    lastSubscribeAckAtRef,
    recoveryModeRef,
    scheduleRemotePlaybackRetryRef,
    mediaTransportOwnerKeyRef,
    lastRealtimeRoomEventAtRef,
    lastDataActivityAtRef,
    lastListenerBootstrapKeyRef,
    missingListenerSinceRef,
    hostMediaSyncStateRef,
    listenerMediaLifecycleRef,
    listenerMediaRecoveryTimeoutRef,
    socketDisconnectGraceTimeoutRef,
    hostMediaClockSequenceRef,
    armListenerMediaRecoveryRef,
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
    clearPendingRemoteStreamClear,
    clearListenerMediaRecovery,
    clearSocketDisconnectGrace,
    clearHostMediaSyncRetry,
    getSilentPrewarmHandle,
    bumpMediaTransportEpoch,
    updateSourceStartState,
    updateHostCaptureDiagnostics
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
  const clearRemotePlaybackRetry = useCallback(() => {
    if (remotePlaybackRetryRef.current !== null) {
      window.clearTimeout(remotePlaybackRetryRef.current);
      remotePlaybackRetryRef.current = null;
    }
  }, [remotePlaybackRetryRef]);
  const {
    playbackConnectionKeyRef,
    listenerPlaybackStateRef,
    activeRecoveryActionRef,
    activeRecoveryActionResultRef,
    lastRecoveryRecommendationRef,
    lastRecoveryDropReasonRef,
    getCurrentPlaybackConnectionKey,
    beginPlaybackConnection,
    disposePlaybackConnection,
    reportPlaybackState,
    applyRecoveryAction,
    finishRecoveryAction,
    noteRecoveryRecommendation
  } = useRoomPlaybackConnectionCoordinator({
    currentRoomRef,
    mediaTransportEpochRef,
    listenerMediaLifecycleRef,
    clearListenerMediaRecovery,
    clearRemotePlaybackRetry
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
    remoteAudioRef,
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
    remoteAudioRef,
    mediaMeshRef,
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

  const resolveSoftRecoveryMediaState = useCallback(
    (fallback: "buffering" | "reconnecting" = "reconnecting") => {
      const continuity = resolveSourceContinuityState();
      if (continuity.audibleSource !== null || continuity.bufferingWhileAudible) {
        return "buffering" as const;
      }

      return fallback;
    },
    [resolveSourceContinuityState]
  );

  const getRemoteAudioDiagnostics = useCallback(() => {
    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) {
      return {
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
      };
    }

    const audioTracks =
      typeof (remoteAudio.srcObject as MediaStream | null | undefined)?.getAudioTracks === "function"
        ? (remoteAudio.srcObject as MediaStream).getAudioTracks()
        : [];
    const primaryTrack = audioTracks[0] ?? null;

    return {
      audioPaused: remoteAudio.paused,
      audioMuted: remoteAudio.muted,
      audioReadyState: remoteAudio.readyState,
      hasSrcObject: !!remoteAudio.srcObject,
      currentSrc: remoteAudio.currentSrc || null,
      audioVolume: remoteAudio.volume,
      trackId: primaryTrack?.id ?? null,
      trackMuted: primaryTrack?.muted ?? null,
      trackEnabled: primaryTrack?.enabled ?? null,
      trackReadyState: primaryTrack?.readyState ?? null
    };
  }, [remoteAudioRef]);

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
        peerId: "remote-media",
        channelKind: "media",
        direction: "local",
        event: options?.event ?? "remote-media-state",
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

  const resetRemoteAudioElement = useCallback(
    (
      stream: MediaStream | null,
      options?: {
        deferNullReset?: boolean;
        generation?: string | null;
        reason?: string;
        forceRebind?: boolean;
      }
    ) => {
      const remoteAudio = remoteAudioRef.current;
      if (!remoteAudio) {
        return;
      }
      const lifecycle = listenerMediaLifecycleRef.current;
      const generation = options?.generation ?? lifecycle.currentGeneration;

      if (stream) {
        if (generation && lifecycle.currentGeneration && generation !== lifecycle.currentGeneration) {
          return;
        }
        clearPendingRemoteStreamClear();
        const traceContext = getRemoteMediaTraceContext();
        if (remoteAudio.srcObject !== stream || options?.forceRebind) {
          remoteAudio.pause();
          if (remoteAudio.srcObject) {
            remoteAudio.srcObject = null;
          }
          remoteAudio.srcObject = stream;
        }
        lifecycle.latestStream = stream;
        lifecycle.boundGeneration = generation ?? null;
        lifecycle.bindAttempts += 1;
        listenerMediaLifecycleRef.current.lastBoundTraceKey = traceContext.traceKey;
        updateRemoteMediaDiagnostic(
          options?.reason ? `远端音频元素已绑定新流：${options.reason}` : "远端音频元素已绑定新流",
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: "buffering",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...traceContext,
              ...getRemoteAudioDiagnostics(),
              boundToAudioElement: true,
              lastBoundAt: new Date().toISOString(),
              boundGeneration: generation ?? null,
              currentGeneration: lifecycle.currentGeneration,
              recoveryStage: lifecycle.recoveryStage,
              restartAttempt: lifecycle.restartAttempt
            }
          }),
          {
            event: "remote-audio-element-state"
          }
        );
        return;
      }

      const clearStream = () => {
        if (generation && listenerMediaLifecycleRef.current.currentGeneration !== generation) {
          remoteStreamClearTimeoutRef.current = null;
          return;
        }
        remoteAudio.pause();
        if (remoteAudio.srcObject) {
          remoteAudio.srcObject = null;
        }
        remoteAudio.load();
        remoteStreamClearTimeoutRef.current = null;
        listenerMediaLifecycleRef.current.latestStream = null;
        listenerMediaLifecycleRef.current.boundGeneration = null;
        updateRemoteMediaDiagnostic(
          "远端音频元素已清空媒体流",
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: "idle",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...getRemoteMediaTraceContext(),
              ...getRemoteAudioDiagnostics(),
              boundToAudioElement: false,
              boundGeneration: null,
              currentGeneration: listenerMediaLifecycleRef.current.currentGeneration,
              recoveryStage: listenerMediaLifecycleRef.current.recoveryStage,
              restartAttempt: listenerMediaLifecycleRef.current.restartAttempt
            },
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              mediaTransportState: snapshot.progressivePlaybackStatus?.mediaTransportState ?? "idle",
              dataRequiredForPlayback: enableTrackCaching,
              firstAudibleAt: snapshot.progressivePlaybackStatus?.firstAudibleAt ?? null
            }
          }),
          {
            event: "remote-audio-element-state"
          }
        );
      };

      if (options?.deferNullReset && remoteAudio.srcObject) {
        clearPendingRemoteStreamClear();
        remoteStreamClearTimeoutRef.current = window.setTimeout(
          clearStream,
          remoteStreamSwapGraceMs
        );
        return;
      }

      clearPendingRemoteStreamClear();
      clearStream();
    },
    [
      clearPendingRemoteStreamClear,
      getRemoteAudioDiagnostics,
      getRemoteMediaTraceContext,
      remoteAudioRef,
      updateRemoteMediaDiagnostic
    ]
  );

  const rawRoomListenerPeerIds = useMemo(
    () => resolveRoomListenerPeerIds(roomSnapshot?.room.members, peerId),
    [roomSnapshot?.room.members, peerId]
  );
  const roomListenerSetHash = rawRoomListenerPeerIds.join(",");
  const roomListenerPeerIds = useMemo(
    () => (roomListenerSetHash ? roomListenerSetHash.split(",") : []),
    [roomListenerSetHash]
  );
  const roomListenerCount = roomListenerPeerIds.length;
  const { clearPendingPiece: clearManualCachePendingPiece } = useManualCacheDownloader({
    enableManualTrackCaching,
    manualCacheTrackIds,
    roomSnapshot,
    availabilityByTrack,
    peerId,
    connectedPeers,
    dataMesh: dataMeshBridge,
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
      scope: "media" | "data" | "room";
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

      const actionType = resolvePlaybackRecoveryActionType(recommendation);
      if (actionType === "retry-play") {
        scheduleRemotePlaybackRetryRef.current(
          0,
          recommendation.playbackConnectionKey ?? currentPlaybackConnectionKey
        );
        return;
      }

      if (actionType !== "full-resubscribe" && !recommendation.peerId) {
        lastRecoveryDropReasonRef.current = "missing-peer";
        return;
      }

      const action = applyRecoveryAction({
        playbackConnectionKey:
          recommendation.playbackConnectionKey ?? currentPlaybackConnectionKey,
        actionType,
        peerId: recommendation.peerId,
        reason: recommendation.reason
      });
      if (!action) {
        return;
      }

      reportPlaybackState("recovering-hard", {
        playbackConnectionKey: action.playbackConnectionKey
      });

      if (actionType === "restart-listener-ice" && recommendation.peerId) {
        setMediaConnectionState(resolveSoftRecoveryMediaState("reconnecting"));
        void mediaMeshRef.current
          ?.restartListenerIce(recommendation.peerId)
          .then(() => {
            finishRecoveryAction(action.actionId, "completed", {
              nextState: "negotiating"
            });
          })
          .catch(() => {
            finishRecoveryAction(action.actionId, "failed", {
              nextState: "failed"
            });
          });
        return;
      }

      if (actionType === "reset-listener-peer" && recommendation.peerId) {
        setMediaConnectionState(resolveSoftRecoveryMediaState("reconnecting"));
        void mediaMeshRef.current
          ?.resetListenerPeer(recommendation.peerId)
          .then(() => {
            finishRecoveryAction(action.actionId, "completed", {
              nextState: "negotiating"
            });
          })
          .catch(() => {
            finishRecoveryAction(action.actionId, "failed", {
              nextState: "failed"
            });
          });
        return;
      }

      if (actionType === "restart-data-peer" && recommendation.peerId) {
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

      if (actionType === "full-resubscribe") {
        resubscribeRoomRef.current?.();
        if (recommendation.peerId) {
          void meshRef.current?.restartPeer(recommendation.peerId);
        }
        const nextTransportEpoch = bumpMediaTransportEpoch("explicit-hard-reset");
        mediaMeshRef.current?.setTransportEpoch(nextTransportEpoch);
        if (recommendation.peerId) {
          void mediaMeshRef.current?.resetListenerPeer(recommendation.peerId);
        }
      finishRecoveryAction(action.actionId, "completed", {
          nextState: "negotiating"
        });
      }
    },
    [
      applyRecoveryAction,
      bumpMediaTransportEpoch,
      finishRecoveryAction,
      getCurrentPlaybackConnectionKey,
      listenerMediaLifecycleRef,
      mediaMeshRef,
      meshRef,
      noteRecoveryRecommendation,
      reportPlaybackState,
      resolveSoftRecoveryMediaState,
      setMediaConnectionState,
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
      mediaConnectedPeers,
      mediaConnectionState,
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
      listenerMediaLifecycleRef,
      scheduleRemotePlaybackRetryRef,
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

  const armListenerMediaRecovery = useCallback(
    (generation?: string | null) => {
      clearListenerMediaRecovery();

      const expectedGeneration = generation ?? getCurrentPlaybackConnectionKey();
      const playback = currentRoomRef.current?.room.playback;
      if (
        !expectedGeneration ||
        !playback?.currentTrackId ||
        playback.status !== "playing" ||
        isCurrentSourceOwner ||
        activePlaybackSource !== "remote-stream" ||
        !playback.sourcePeerId
      ) {
        return;
      }

      const lastProgressAt = Math.max(
        listenerMediaLifecycleRef.current.generationStartedAt ?? 0,
        listenerMediaLifecycleRef.current.lastPlayoutProgressAt ?? 0,
        listenerMediaLifecycleRef.current.lastTransportProgressAt ?? 0
      );
      const progressGapMs = lastProgressAt > 0 ? Date.now() - lastProgressAt : null;
      const remoteTrackReadyState = getRemoteAudioDiagnostics().trackReadyState;
      const recoveryDelayMs = resolveListenerRecoveryDelayMs({
        progressGapMs,
        remoteTrackReadyState
      });

      listenerMediaRecoveryTimeoutRef.current = window.setTimeout(() => {
        const lifecycle = listenerMediaLifecycleRef.current;
        const latestPlayback = currentRoomRef.current?.room.playback;
        const remoteAudio = remoteAudioRef.current;
        const latestPlaybackConnectionKey = getCurrentPlaybackConnectionKey();
        const latestTraceContext = latestPlayback?.sourcePeerId
          ? getRemoteMediaTraceContext(latestPlayback.sourcePeerId)
          : null;
        if (
          !latestPlayback?.currentTrackId ||
          latestPlayback.status !== "playing" ||
          lifecycle.currentGeneration !== expectedGeneration ||
          latestPlaybackConnectionKey !== expectedGeneration
        ) {
          return;
        }

        const now = Date.now();
        const latestProgressAt = Math.max(
          lifecycle.generationStartedAt ?? 0,
          lifecycle.lastPlayoutProgressAt ?? 0,
          lifecycle.lastTransportProgressAt ?? 0
        );
        const latestProgressGapMs = latestProgressAt > 0 ? now - latestProgressAt : null;
        const remoteTrack =
          typeof (remoteAudio?.srcObject as MediaStream | null | undefined)?.getAudioTracks === "function"
            ? ((remoteAudio?.srcObject as MediaStream).getAudioTracks()[0] ?? null)
            : null;
        const reason = resolveListenerMediaRecoveryReason({
          traceKey: latestTraceContext?.traceKey ?? expectedGeneration,
          lastTrackTraceKey: lifecycle.lastTrackTraceKey,
          lastBoundTraceKey: lifecycle.lastBoundTraceKey,
          lastPlayAttemptTraceKey: lifecycle.lastPlayAttemptTraceKey,
          lastPlayAttemptResult: lifecycle.lastPlayAttemptResult,
          lastPlayingTraceKey: lifecycle.lastPlayingTraceKey,
          remoteAudioPaused: remoteAudio?.paused ?? null,
          hasBoundSrcObject: !!remoteAudio?.srcObject,
          remoteTrackMuted: remoteTrack?.muted ?? null,
          remoteTrackEnabled: remoteTrack?.enabled ?? null,
          remoteTrackReadyState: remoteTrack?.readyState ?? null
        });
        const hardRecoveryRequired =
          remoteTrack?.readyState === "ended" ||
          (typeof latestProgressGapMs === "number" &&
            latestProgressGapMs >= listenerHardRecoveryDelayMs);
        if (
          reason === "connected-but-no-track" &&
          !hardRecoveryRequired
        ) {
          armListenerMediaRecoveryRef.current(expectedGeneration);
          return;
        }

        if (
          reason &&
          !hardRecoveryRequired &&
          typeof latestProgressGapMs === "number" &&
          latestProgressGapMs < listenerSoftRecoveryDelayMs
        ) {
          armListenerMediaRecoveryRef.current(expectedGeneration);
          return;
        }

        const action = resolveListenerMediaRecoveryAction({
          reason,
          bindAttempts: lifecycle.bindAttempts,
          playAttempts: lifecycle.playAttempts
        });
        if (hardRecoveryRequired && !action) {
          lifecycle.recoveryStage = "waiting-track";
          setMediaConnectionState(resolveSoftRecoveryMediaState("reconnecting"));
          reportPlaybackState("recovering-hard", {
            playbackConnectionKey: getCurrentPlaybackConnectionKey()
          });
          updateRemoteMediaDiagnostic(
            `监听端等待连接监督恢复媒体链路${reason ? ` · ${reason}` : ""}`,
            (snapshot) => ({
              ...snapshot,
              mediaConnectionState: resolveSoftRecoveryMediaState("reconnecting"),
              recoveryActionLevel: "observe",
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                ...getRemoteMediaTraceContext(latestPlayback.sourcePeerId),
                ...getRemoteAudioDiagnostics(),
                currentGeneration: lifecycle.currentGeneration,
                boundGeneration: lifecycle.boundGeneration,
                playingGeneration: lifecycle.playingGeneration,
                recoveryStage: lifecycle.recoveryStage,
                restartAttempt: lifecycle.restartAttempt
              }
            }),
            {
              event: "remote-media-await-supervisor",
              recordEvent: false,
              level: "warning"
            }
          );
          return;
        }
        if (!action) {
          lifecycle.recoveryStage = "idle";
          reportPlaybackState("stream-bound", {
            playbackConnectionKey: getCurrentPlaybackConnectionKey()
          });
          return;
        }
        const lastRecoveryTraceKey = lifecycle.lastSoftRecoveryTraceKey;
        const lastRecoveryAt = lifecycle.lastSoftRecoveryAt;
        const recoveryCooldownMs = listenerSoftRecoveryCooldownMs;
        if (
          lastRecoveryTraceKey === expectedGeneration &&
          lastRecoveryAt !== null &&
          now - lastRecoveryAt < recoveryCooldownMs
        ) {
          armListenerMediaRecoveryRef.current(expectedGeneration);
          return;
        }

        lifecycle.lastSoftRecoveryTraceKey = expectedGeneration;
        lifecycle.lastSoftRecoveryAt = now;
        lifecycle.recoveryStage =
          action === "rebind-element"
            ? "rebind-element"
            : action === "rebind-and-play"
              ? "rebind-and-play"
              : "retry-play";
        const acceptedRecoveryAction = applyRecoveryAction({
          playbackConnectionKey: expectedGeneration,
          actionType: action === "rebind-element" ? "rebind-element" : "retry-play",
          peerId: latestPlayback.sourcePeerId ?? null,
          reason: reason ?? action
        });
        if (!acceptedRecoveryAction) {
          armListenerMediaRecoveryRef.current(expectedGeneration);
          return;
        }

        updateRemoteMediaDiagnostic(
          `监听端执行媒体恢复：${action}${reason ? ` · ${reason}` : ""}`,
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: "buffering",
            recoveryActionLevel: "soft-media-retry",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...getRemoteMediaTraceContext(latestPlayback.sourcePeerId),
              ...getRemoteAudioDiagnostics(),
              currentGeneration: lifecycle.currentGeneration,
              boundGeneration: lifecycle.boundGeneration,
              playingGeneration: lifecycle.playingGeneration,
              recoveryStage: lifecycle.recoveryStage,
              restartAttempt: lifecycle.restartAttempt
            }
          }),
          {
            event: "remote-media-recover",
            recordEvent: true,
            level: "warning"
          }
        );

        if (lifecycle.latestStream) {
          resetRemoteAudioElement(lifecycle.latestStream, {
            generation: expectedGeneration,
            reason: action,
            forceRebind: action === "rebind-element" || action === "rebind-and-play"
          });
        }

        if (action === "retry-play" || action === "rebind-and-play") {
          scheduleRemotePlaybackRetryRef.current(0, expectedGeneration);
          return;
        }

        finishRecoveryAction(acceptedRecoveryAction.actionId, "completed", {
          nextState: "stream-bound"
        });
        armListenerMediaRecoveryRef.current(expectedGeneration);
      }, recoveryDelayMs);
    },
    [
      activePlaybackSource,
      applyRecoveryAction,
      clearListenerMediaRecovery,
      currentRoomRef,
      finishRecoveryAction,
      getRemoteAudioDiagnostics,
      getCurrentPlaybackConnectionKey,
      getRemoteMediaTraceContext,
      isCurrentSourceOwner,
      remoteAudioRef,
      resetRemoteAudioElement,
      reportPlaybackState,
      resolveSoftRecoveryMediaState,
      updateRemoteMediaDiagnostic
    ]
  );

  const scheduleRemotePlaybackRetry = useCallback(
    (attempt = 0, expectedGeneration?: string | null) => {
      clearRemotePlaybackRetry();

      const remoteAudio = remoteAudioRef.current;
      const playback = currentRoomRef.current?.room.playback;

      if (
        !remoteAudio ||
        !remoteAudio.srcObject ||
        !playback?.currentTrackId ||
        playback.status !== "playing"
      ) {
        return;
      }
      const generation = expectedGeneration ?? getCurrentPlaybackConnectionKey();
      if (
        !generation ||
        listenerMediaLifecycleRef.current.currentGeneration !== generation ||
        getCurrentPlaybackConnectionKey() !== generation
      ) {
        return;
      }
      const acceptedRecoveryAction = applyRecoveryAction({
        playbackConnectionKey: generation,
        actionType: "retry-play",
        peerId: playback.sourcePeerId ?? null,
        reason: attempt === 0 ? "remote-playback-retry" : `remote-playback-retry-${attempt + 1}`
      });
      if (!acceptedRecoveryAction) {
        return;
      }
      listenerMediaLifecycleRef.current.playAttempts += 1;
      reportPlaybackState("playback-starting", {
        playbackConnectionKey: acceptedRecoveryAction.playbackConnectionKey
      });

      void roomAudioOutput.playElement(remoteAudio).then((result) => {
        const now = new Date().toISOString();
        const traceContext = getRemoteMediaTraceContext();
        listenerMediaLifecycleRef.current.lastPlayAttemptTraceKey = traceContext.traceKey;
        listenerMediaLifecycleRef.current.lastPlayAttemptResult = result.ok ? "ok" : "rejected";
        listenerMediaLifecycleRef.current.lastPlayAttemptError = result.ok
          ? null
          : result.error ?? "play-rejected";
        if (result.ok) {
          if (!audioUnlockedRef.current && roomAudioOutput.isActivated()) {
            setAudioUnlockedRef.current(true);
            audioUnlockedRef.current = true;
          }
          listenerMediaLifecycleRef.current.playingGeneration = generation;
          listenerMediaLifecycleRef.current.recoveryStage = "idle";
          listenerMediaLifecycleRef.current.lastPlayoutProgressAt = Date.now();
          listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs =
            Number.isFinite(remoteAudio.currentTime) && remoteAudio.currentTime >= 0
              ? Math.round(remoteAudio.currentTime * 1000)
              : listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs;
          finishRecoveryAction(acceptedRecoveryAction.actionId, "completed", {
            nextState: "live"
          });
          reportPlaybackState("live", {
            playbackConnectionKey: acceptedRecoveryAction.playbackConnectionKey
          });
        } else {
          finishRecoveryAction(acceptedRecoveryAction.actionId, "failed", {
            nextState: "recovering-soft"
          });
        }
        updateRemoteMediaDiagnostic(
          result.ok ? "远端音频自动拉起成功" : `远端音频自动拉起失败：${result.error ?? "未知错误"}`,
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: result.ok && remoteAudio.paused === false ? "live" : "buffering",
            recoveryActionLevel: result.ok ? "observe" : "soft-media-retry",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...traceContext,
              ...getRemoteAudioDiagnostics(),
              lastPlayAttemptAt: now,
              lastPlayAttemptResult: result.ok ? "ok" : "rejected",
              lastPlayAttemptError: result.ok ? null : result.error ?? "play-rejected",
              currentGeneration: listenerMediaLifecycleRef.current.currentGeneration,
              boundGeneration: listenerMediaLifecycleRef.current.boundGeneration,
              playingGeneration: listenerMediaLifecycleRef.current.playingGeneration,
              recoveryStage: listenerMediaLifecycleRef.current.recoveryStage,
              restartAttempt: listenerMediaLifecycleRef.current.restartAttempt
            }
          }),
          {
            event: "remote-play-attempt",
            recordEvent: !result.ok,
            level: result.ok ? "info" : "warning"
          }
        );
        if (result.ok) {
          clearListenerMediaRecovery();
          return;
        }

        if (attempt >= maxRemotePlaybackRetryAttempts) {
          setStatusMessage("远端音频连接已建立，但播放未稳定，请点击一次播放继续。");
          return;
        }

        remotePlaybackRetryRef.current = window.setTimeout(() => {
          scheduleRemotePlaybackRetry(attempt + 1, generation);
        }, remotePlaybackRetryBackoffMs[Math.min(attempt, remotePlaybackRetryBackoffMs.length - 1)]);
      });
    },
    [
      applyRecoveryAction,
      clearListenerMediaRecovery,
      clearRemotePlaybackRetry,
      audioUnlockedRef,
      currentRoomRef,
      finishRecoveryAction,
      getRemoteAudioDiagnostics,
      getCurrentPlaybackConnectionKey,
      getRemoteMediaTraceContext,
      remoteAudioRef,
      reportPlaybackState,
      setAudioUnlockedRef,
      setStatusMessage,
      updateRemoteMediaDiagnostic
    ]
  );

  useEffect(() => {
    armListenerMediaRecoveryRef.current = armListenerMediaRecovery;
  }, [armListenerMediaRecovery]);


  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const shouldMaintainRemotePlayback = shouldMaintainRemotePlaybackSurface({
      isCurrentSourceOwner,
      activePlaybackSource,
      playbackStatus: playback?.status,
      currentTrackId: playback?.currentTrackId ?? null,
      sourcePeerId: playback?.sourcePeerId ?? null,
      localPeerId: peerId,
      hasRemoteSrcObject: !!remoteAudioRef.current?.srcObject
    });
    const traceContext =
      shouldMaintainRemotePlayback && playback?.sourcePeerId
        ? getRemoteMediaTraceContext(playback.sourcePeerId)
        : {
            currentTrackId: null,
            mediaEpoch: null,
            sourcePeerId: null,
            traceKey: null
          };
    const playbackConnectionKey = resolvePlaybackConnectionKey({
      roomId: roomSnapshot?.room.id ?? null,
      sourcePeerId: traceContext.sourcePeerId,
      mediaEpoch: traceContext.mediaEpoch,
      transportEpoch: mediaTransportEpochRef.current
    });
    const lifecycle = listenerMediaLifecycleRef.current;
    if (
      lifecycle.traceKey === traceContext.traceKey &&
      lifecycle.currentGeneration === playbackConnectionKey
    ) {
      return;
    }

    const previousSourcePeerId = lifecycle.sourcePeerId;
    const previousPlaybackConnectionKey = lifecycle.currentGeneration;
    const remoteAudio = remoteAudioRef.current;
    const existingRemoteStream =
      (remoteAudio?.srcObject as MediaStream | null | undefined) ?? null;
    const existingRemoteTrack =
      typeof existingRemoteStream?.getAudioTracks === "function"
        ? (existingRemoteStream.getAudioTracks()[0] ?? null)
        : null;
    const canReuseExistingRemoteStream =
      !!playbackConnectionKey &&
      !!traceContext.sourcePeerId &&
      previousSourcePeerId === traceContext.sourcePeerId &&
      !!existingRemoteStream &&
      !!existingRemoteTrack &&
      existingRemoteTrack.readyState !== "ended";
    const shouldForceRebindReusedRemoteStream =
      canReuseExistingRemoteStream && previousPlaybackConnectionKey !== playbackConnectionKey;
    const existingRemoteAudioPlaying =
      canReuseExistingRemoteStream &&
      !shouldForceRebindReusedRemoteStream &&
      remoteAudio?.paused === false;

    lifecycle.traceKey = traceContext.traceKey;
    lifecycle.sourcePeerId = traceContext.sourcePeerId;
    lifecycle.lastTrackTraceKey = canReuseExistingRemoteStream ? traceContext.traceKey : null;
    lifecycle.lastBoundTraceKey =
      canReuseExistingRemoteStream && !shouldForceRebindReusedRemoteStream
        ? traceContext.traceKey
        : null;
    lifecycle.lastPlayAttemptTraceKey = existingRemoteAudioPlaying ? traceContext.traceKey : null;
    lifecycle.lastPlayAttemptResult = existingRemoteAudioPlaying ? "ok" : null;
    lifecycle.lastPlayAttemptError = null;
    lifecycle.lastPlayingTraceKey = existingRemoteAudioPlaying ? traceContext.traceKey : null;
    lifecycle.lastSoftRecoveryTraceKey = null;
    lifecycle.lastSoftRecoveryAt = null;
    lifecycle.lastHardRecoveryTraceKey = null;
    lifecycle.lastHardRecoveryAt = null;
    lifecycle.latestStream = canReuseExistingRemoteStream ? existingRemoteStream : null;
    lifecycle.currentGeneration = playbackConnectionKey;
    lifecycle.generationStartedAt = playbackConnectionKey ? Date.now() : null;
    lifecycle.boundGeneration =
      canReuseExistingRemoteStream && !shouldForceRebindReusedRemoteStream
        ? playbackConnectionKey
        : null;
    lifecycle.playingGeneration = existingRemoteAudioPlaying ? playbackConnectionKey : null;
    lifecycle.lastPlayoutProgressAt = existingRemoteAudioPlaying ? Date.now() : null;
    lifecycle.lastTransportProgressAt = canReuseExistingRemoteStream ? Date.now() : null;
    lifecycle.lastObservedRemoteCurrentTimeMs = null;
    lifecycle.recoveryStage = playbackConnectionKey
      ? canReuseExistingRemoteStream
        ? shouldForceRebindReusedRemoteStream
          ? "rebind-and-play"
          : "retry-play"
        : "waiting-track"
      : "idle";
    lifecycle.restartAttempt = 0;
    lifecycle.bindAttempts = canReuseExistingRemoteStream ? 1 : 0;
    lifecycle.playAttempts = existingRemoteAudioPlaying ? 1 : 0;
    clearListenerMediaRecovery();
    if (playbackConnectionKey) {
      beginPlaybackConnection(playbackConnectionKey, {
        sourcePeerId: traceContext.sourcePeerId,
        hasExistingBoundStream: canReuseExistingRemoteStream
      });
      reportPlaybackState(
        canReuseExistingRemoteStream ? "stream-bound" : "awaiting-offer",
        {
          playbackConnectionKey
        }
      );
    } else {
      disposePlaybackConnection();
    }

    updateRemoteMediaDiagnostic(
      traceContext.traceKey
        ? canReuseExistingRemoteStream
          ? "监听端播放 trace 已切换，并复用现有远端媒体流"
          : "监听端播放 trace 已切换"
        : "监听端播放 trace 已清空",
      (snapshot) => ({
        ...snapshot,
        remoteTrackStatus: {
          ...snapshot.remoteTrackStatus,
          ...traceContext,
          ...getRemoteAudioDiagnostics(),
          currentGeneration: playbackConnectionKey,
          boundGeneration: lifecycle.boundGeneration,
          playingGeneration: lifecycle.playingGeneration,
          recoveryStage: lifecycle.recoveryStage,
          restartAttempt: lifecycle.restartAttempt
        }
      }),
      {
        event: "remote-media-trace"
      }
    );
    if (playbackConnectionKey) {
      if (shouldForceRebindReusedRemoteStream && existingRemoteStream) {
        resetRemoteAudioElement(existingRemoteStream, {
          generation: playbackConnectionKey,
          reason: "trace-switch",
          forceRebind: true
        });
      }
      armListenerMediaRecoveryRef.current(playbackConnectionKey);
      if (
        canReuseExistingRemoteStream &&
        previousPlaybackConnectionKey !== playbackConnectionKey &&
        remoteAudio?.paused !== false
      ) {
        scheduleRemotePlaybackRetryRef.current(0, playbackConnectionKey);
      }
    }
  }, [
    activePlaybackSource,
    armListenerMediaRecovery,
    clearListenerMediaRecovery,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    isCurrentSourceOwner,
    remoteAudioRef,
    resetRemoteAudioElement,
    beginPlaybackConnection,
    disposePlaybackConnection,
    mediaTransportEpochRef,
    peerId,
    reportPlaybackState,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback.sourcePeerId,
    roomSnapshot?.room.playback.status,
    updateRemoteMediaDiagnostic
  ]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    if (
      !roomSnapshot?.room.id ||
      !peerId ||
      isCurrentSourceOwner ||
      activePlaybackSource !== "remote-stream" ||
      playback?.status !== "playing" ||
      !playback.currentTrackId ||
      !playback.sourcePeerId
    ) {
      clearListenerMediaRecovery();
      return;
    }

    const playbackConnectionKey = getCurrentPlaybackConnectionKey();
    if (!playbackConnectionKey) {
      clearListenerMediaRecovery();
      return;
    }
    armListenerMediaRecoveryRef.current(playbackConnectionKey);

    return () => {
      clearListenerMediaRecovery();
    };
  }, [
    activePlaybackSource,
    armListenerMediaRecovery,
    clearListenerMediaRecovery,
    getCurrentPlaybackConnectionKey,
    isCurrentSourceOwner,
    peerId,
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.sourcePeerId,
    roomSnapshot?.room.playback.status
  ]);

  const requestRoomSnapshotResyncRef = useRef(requestRoomSnapshotResync);
  const ensureMediaTransportConnectedRef = useRef<
    (options?: {
      preferPublishedTrack?: boolean;
      forceResync?: boolean;
      reason?: string;
    }) => Promise<void>
  >(async () => undefined);
  const syncHostMediaStreamRef = useRef<
    (options?: { forceResync?: boolean; reason?: string }) => Promise<void>
  >(async () => undefined);
  const ensureSourcePlaybackStartedRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    requestRoomSnapshotResyncRef.current = requestRoomSnapshotResync;
  }, [requestRoomSnapshotResync]);

  useEffect(() => {
    scheduleRemotePlaybackRetryRef.current = scheduleRemotePlaybackRetry;
  }, [scheduleRemotePlaybackRetry]);

  const {
    ensureMediaTransportConnected,
    syncHostMediaStream,
    ensureSourcePlaybackStarted
  } = useRoomMediaPublicationRuntime({
    roomSnapshot,
    currentRoomRef,
    activeRouteRoomIdRef,
    peerId,
    roomListenerCount,
    activePlaybackSource,
    isCurrentSourceOwner,
    audioUnlocked,
    sourceStartState,
    uploadedTracks,
    audioRef,
    remoteAudioRef,
    socketRef,
    mediaMeshRef,
    hostStreamRef,
    mediaTransportEpochRef,
    transportResetReasonRef,
    hostMediaSyncRetryRef,
    hostMediaClockSequenceRef,
    hostMediaSyncStateRef,
    lastHostCaptureRefreshAtRef,
    ensureMediaTransportConnectedRef,
    syncHostMediaStreamRef,
    ensureSourcePlaybackStartedRef,
    audioUnlockedRef,
    setAudioUnlockedRef,
    setAuthoritativeMediaClock,
    recordPeerDiagnosticRef,
    clearHostMediaSyncRetry,
    getSilentPrewarmHandle,
    getHostRelayStream,
    getHostRelayClockState,
    getLocalPlaybackPositionMs,
    setStatusMessage,
    updateSourceStartState,
    updateHostCaptureDiagnostics,
    enableTrackCaching
  });

  useEffect(
    () => () => {
      clearPendingRemoteStreamClear();
    },
    [clearPendingRemoteStreamClear]
  );

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
    resolveSoftRecoveryMediaState,
    mediaMeshRef,
    hostStreamRef,
    meshRef,
    reportRealtimeFailureRef,
    setMediaConnectionState,
    lastRealtimeRoomEventAtRef,
    resubscribeRoomRef,
    getCurrentPlaybackConnectionKey,
    queuePlaybackRecoveryRecommendation
  });

  useEffect(() => {
    return () => {
      if (remotePlaybackRetryRef.current !== null) {
        window.clearTimeout(remotePlaybackRetryRef.current);
      }
    };
  }, []);

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
      remoteAudioRef,
      mediaMeshRef,
      listenerMediaLifecycleRef,
      armListenerMediaRecoveryRef,
      scheduleRemotePlaybackRetryRef,
      mediaTransportEpochRef,
      updateRemoteMediaDiagnostic,
      getRemoteAudioDiagnostics,
      resetRemoteAudioElement,
      resolveMediaDiagnosticPeerId,
      resolveSoftRecoveryMediaState,
      setMediaConnectedPeers,
      setMediaConnectionState,
      updateMediaTransportStatsRef,
      isCurrentSourceOwner,
      enableTrackCaching,
      activePlaybackSource,
      resubscribeRoomRef,
      hostStreamRef,
      hostMediaSyncStateRef,
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
      remotePlaybackRetryRef,
      socketDisconnectGraceUntilRef,
      socketDisconnectGraceTimeoutRef,
      stopPresenceHeartbeat,
      stopRecoveryWatchdog,
      clearListenerMediaRecovery,
      clearSocketDisconnectGrace,
      clearHostMediaSyncRetry,
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
    });
  }, [
    roomSnapshot?.room.id,
    hydrated,
    iceConfig,
    iceConfigResolved,
    peerId,
    activeSessionRef,
    currentRoomRef,
    uploadedTrackIdsRef,
    clearHostMediaSyncRetry,
    clearListenerMediaRecovery,
    stopRecoveryWatchdog,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    chunkSchedulerRef,
    emitPresence,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    remoteAudioRef,
    resetRemoteAudioElement,
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

  useRoomMediaRuntime({
    roomSnapshot,
    currentRoomRef,
    activeRouteRoomIdRef,
    peerId,
    roomListenerCount,
    roomListenerPeerIds,
    roomListenerSetHash,
    mediaConnectedPeers,
    isCurrentSourceOwner,
    activePlaybackSource,
    audioUnlocked,
    sourceStartState,
    remoteAudioRef,
    mediaMeshRef,
    hostStreamRef,
    mediaTransportOwnerKeyRef,
    mediaTransportEpochRef,
    hostMediaSyncStateRef,
    missingListenerSinceRef,
    lastListenerBootstrapKeyRef,
    lastHostCaptureRefreshAtRef,
    remotePlaybackResumeAfterUnlockKeyRef,
    listenerMediaLifecycleRef,
    armListenerMediaRecoveryRef,
    ensureMediaTransportConnectedRef,
    syncHostMediaStreamRef,
    bumpMediaTransportEpoch,
    clearListenerMediaRecovery,
    clearHostMediaSyncRetry,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    updateRemoteMediaDiagnostic,
    resetRemoteAudioElement,
    scheduleRemotePlaybackRetry,
    queuePlaybackRecoveryRecommendation,
    getCurrentPlaybackConnectionKey,
    shouldResumeRemotePlayback,
    ensureSourcePlaybackStarted,
    syncHostMediaStream,
    updateSourceStartState,
    updateHostCaptureDiagnostics
  });

  const playbackClockSource = useMemo(
    () =>
      roomSnapshot?.room.playback.status === "playing"
        ? activePlaybackSource !== "remote-stream"
          ? "local"
          : "remote"
        : "snapshot",
    [roomSnapshot?.room.playback.status, activePlaybackSource]
  );

  return {
    scheduleRemotePlaybackRetry,
    syncHostMediaStream,
    ensureSourcePlaybackStarted
  };
}
