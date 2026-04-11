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
  AuthSession,
  PeerSignalMessage,
  RoomMediaClockPayload,
  RoomSubscribeAckPayload,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import { createRoomSocket, type RoomSocket } from "@/lib/ws-client";
import { toUserFacingError } from "@/lib/music-room-ui";
import { getWebRTCIceServers } from "@/features/p2p";
import type { RoomSnapshotResyncReason } from "@/features/room/room-snapshot-resync";
import type { ReceivedRoomMediaClock } from "@/features/playback/room-media-clock";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import { createRoomDataMeshRuntime } from "./use-room-data-mesh";
import { createRoomMediaMeshRuntime } from "./use-room-media-runtime";

const subscribeAckTimeoutMs = 4_000;
const subscribeRetryBackoffMs = [200, 500, 1_000, 2_000, 4_000] as const;
const recoverySoftRetryThresholdMs = 5_000;
const recoveryMediaRestartThresholdMs = 4_000;
const recoveryDataRestartThresholdMs = 8_000;
const recoveryFullResubscribeThresholdMs = 15_000;

export function shouldReannounceManualCacheAvailability(input: {
  enableManualTrackCaching: boolean;
  roomId: string | null | undefined;
  roomListenerSetHash: string;
  uploadedTrackIds: string[];
  lastBroadcastKey: string | null;
}) {
  if (!input.enableManualTrackCaching || !input.roomId || !input.roomListenerSetHash) {
    return null;
  }

  const sortedTrackIds = [...input.uploadedTrackIds].filter(Boolean).sort();
  if (sortedTrackIds.length === 0) {
    return null;
  }

  const nextKey = [input.roomId, input.roomListenerSetHash, sortedTrackIds.join(",")].join("|");
  if (nextKey === input.lastBroadcastKey) {
    return null;
  }

  return nextKey;
}

function applyRoomSubscribeBootstrap(input: {
  ack: RoomSubscribeAckPayload;
  activeRouteRoomIdRef: MutableRefObject<string | null>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  lastSubscribeAckAtRef: MutableRefObject<number | null>;
  recoveryGenerationRef: MutableRefObject<number | null>;
  recoveryModeRef: MutableRefObject<"late-join" | "rejoin" | "steady">;
  sourceRecoveryCoordinatorRef: MutableRefObject<{
    actionKey: string | null;
    action: "ice-restart" | "hard-recreate" | "full-resubscribe" | null;
    startedAtMs: number | null;
  }>;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setRoomRecoveryState: Dispatch<SetStateAction<any>>;
  uploadedTracks: Record<string, unknown>;
  enableTrackCaching: boolean;
  audioUnlocked: boolean;
}) {
  if (!input.ack.bootstrap || input.ack.bootstrap.roomId !== input.activeRouteRoomIdRef.current) {
    return false;
  }

  input.lastSubscribeAckAtRef.current = Date.now();
  const nextRecoveryMode =
    input.recoveryGenerationRef.current === null ? "late-join" : "rejoin";
  input.recoveryGenerationRef.current = input.ack.recoveryGeneration ?? null;
  input.recoveryModeRef.current = nextRecoveryMode;
  input.sourceRecoveryCoordinatorRef.current = {
    actionKey: null,
    action: null,
    startedAtMs: null
  };

  const currentMembers = input.currentRoomRef.current?.room.members ?? [];
  const mergedMembers = input.ack.bootstrap.members.map((member) => {
    const existing = currentMembers.find((entry) => entry.id === member.id);
    return {
      id: member.id,
      nickname: existing?.nickname ?? (member.role === "host" ? "房主" : "成员"),
      role: member.role,
      joinedAt: existing?.joinedAt ?? new Date().toISOString(),
      peerId: member.peerId ?? null,
      presenceState: member.presenceState
    };
  });

  input.dispatchRoomStateEvent({
    type: "subscribe-bootstrap",
    roomId: input.ack.bootstrap.roomId,
    members: mergedMembers,
    playback: input.ack.bootstrap.playback,
    presenceRevision: input.ack.bootstrap.presenceRevision,
    roomRevision: input.ack.bootstrap.roomRevision
  });

  const currentTrackId = input.ack.bootstrap.playback.currentTrackId ?? null;
  const hasFullLocalTrack =
    input.enableTrackCaching && !!(currentTrackId && input.uploadedTracks[currentTrackId]);
  input.setRoomRecoveryState((current: any) => ({
    ...current,
    phase: hasFullLocalTrack && input.audioUnlocked ? "playing-local-fallback" : "resyncing",
    mode: nextRecoveryMode,
    generation: input.ack.recoveryGeneration ?? null,
    bootstrapStartedAt: input.ack.serverNow ?? new Date().toISOString(),
    bootstrapSourcePeerId: input.ack.bootstrap?.playback.sourcePeerId ?? null,
    pendingSnapshot: true,
    pendingData: input.enableTrackCaching && !hasFullLocalTrack,
    pendingMedia: !hasFullLocalTrack,
    listenerBootstrapAttempts: current.listenerBootstrapAttempts ?? 0,
    fullLocalRecoveryActive: hasFullLocalTrack
  }));

  return true;
}

export function createRoomSocketRuntime(input: {
  socketRef: MutableRefObject<RoomSocket | null>;
  recordPeerDiagnosticRef: MutableRefObject<(input: any) => void>;
  getRemoteMediaTraceContext: (remotePeerId?: string | null) => {
    traceKey: string | null;
  };
  reportRealtimeFailureRef: MutableRefObject<(input: any) => void>;
  activePlaybackSourceRef: MutableRefObject<
    "none" | "remote-stream" | "progressive-local" | "full-local"
  >;
  roomRecoveryStateRef: MutableRefObject<{
    fullLocalRecoveryActive: boolean;
  }>;
}) {
  const socket = createRoomSocket();
  input.socketRef.current = socket;

  const resolveSocketRecoveryMediaState = () => {
    const source = input.activePlaybackSourceRef.current;
    if (
      source === "progressive-local" ||
      source === "full-local" ||
      input.roomRecoveryStateRef.current.fullLocalRecoveryActive
    ) {
      return "buffering" as const;
    }

    return "reconnecting" as const;
  };

  const emitPeerSignal = (payload: PeerSignalMessage) => {
    const traceContext =
      payload.channelKind === "media" ? input.getRemoteMediaTraceContext(payload.toPeerId) : null;
    input.recordPeerDiagnosticRef.current({
      peerId: payload.toPeerId,
      channelKind: payload.channelKind,
      direction: "sent",
      event: payload.type,
      summary:
        payload.channelKind === "media" && traceContext?.traceKey
          ? `向 ${payload.toPeerId} 发送 ${payload.channelKind} ${payload.type} · ${traceContext.traceKey}`
          : `向 ${payload.toPeerId} 发送 ${payload.channelKind} ${payload.type}`,
      update: (snapshot: any) => ({
        ...snapshot,
        remoteTrackStatus:
          payload.channelKind === "media"
            ? {
                ...snapshot.remoteTrackStatus,
                ...traceContext
              }
            : snapshot.remoteTrackStatus,
        signalStats: {
          ...snapshot.signalStats,
          sentOffers: snapshot.signalStats.sentOffers + (payload.type === "offer" ? 1 : 0),
          sentAnswers: snapshot.signalStats.sentAnswers + (payload.type === "answer" ? 1 : 0),
          sentCandidates:
            snapshot.signalStats.sentCandidates + (payload.type === "candidate" ? 1 : 0)
        }
      })
    });
    socket.emit("peer.signal", payload);
  };

  const handleSignalFailure = (payload: PeerSignalMessage, error: unknown) => {
    input.reportRealtimeFailureRef.current({
      peerId: payload.fromPeerId,
      channelKind: payload.channelKind,
      event: "signal-handle-failed",
      summary: `Failed to apply ${payload.channelKind} ${payload.type} from ${payload.fromPeerId}`,
      error,
      mediaConnectionState:
        payload.channelKind === "media" ? resolveSocketRecoveryMediaState() : undefined
    });
  };

  return {
    socket,
    emitPeerSignal,
    handleSignalFailure,
    resolveSocketRecoveryMediaState
  };
}

export function createRoomRealtimeRuntime(input: {
  roomId: string;
  peerId: string;
  iceConfig: any;
  socketRef: MutableRefObject<RoomSocket | null>;
  recordPeerDiagnosticRef: MutableRefObject<(input: any) => void>;
  getRemoteMediaTraceContext: (remotePeerId?: string | null) => {
    traceKey: string | null;
  };
  reportRealtimeFailureRef: MutableRefObject<(input: any) => void>;
  activePlaybackSourceRef: MutableRefObject<
    "none" | "remote-stream" | "progressive-local" | "full-local"
  >;
  roomRecoveryStateRef: MutableRefObject<{
    fullLocalRecoveryActive: boolean;
    generation: number | null;
    mode: "late-join" | "rejoin" | "steady";
  }>;
  pieceTransferRatesRef: MutableRefObject<Map<string, any>>;
  pieceRequestSamplesRef: MutableRefObject<Map<string, any>>;
  sourceRecoveryCoordinatorRef: MutableRefObject<{
    actionKey: string | null;
    action: "ice-restart" | "hard-recreate" | "full-resubscribe" | null;
    startedAtMs: number | null;
  }>;
  meshRef: MutableRefObject<any>;
  chunkSchedulerRef: MutableRefObject<any>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  uploadedTracksRef: MutableRefObject<Record<string, any>>;
  uploadedTrackIdsRef: MutableRefObject<string[]>;
  manualCacheTrackIdsRef: MutableRefObject<string[]>;
  announceRoomTrackAvailabilityRef: MutableRefObject<(trackId: string) => Promise<void>>;
  handleManualCachePieceReceivedRef: MutableRefObject<(input: any) => void>;
  clearManualCachePendingPiece: (trackId: string, chunkIndex: number) => void;
  flushPendingAvailabilityRef: MutableRefObject<() => void>;
  recordPieceTransferRef: MutableRefObject<(input: any) => void>;
  recordPieceRequestSampleRef: MutableRefObject<(input: any) => void>;
  updatePeerBufferedAmountRef: MutableRefObject<(peerId: string, bufferedAmountBytes: number) => void>;
  updateDataTransportStatsRef: MutableRefObject<(input: any) => void>;
  connectionSupervisorStatesRef: MutableRefObject<Map<string, any>>;
  updateConnectionSupervisorSignalState: (input: any) => any;
  withResolvedTransportHealth: (snapshot: any) => any;
  withSupervisorDiagnosticPatch: (snapshot: any, state: any) => any;
  getPieceTransferRates: (transferWindows: Map<string, any>, peerId: string, now?: number) => any;
  getPeerMedianRttMs: (state: any) => number | null;
  setConnectedPeers: Dispatch<SetStateAction<string[]>>;
  isPageVisible: boolean;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  bufferHealth: "healthy" | "low" | "critical";
  enableManualTrackCaching: boolean;
  remoteAudioRef: MutableRefObject<HTMLAudioElement | null> | { current: HTMLAudioElement | null };
  mediaMeshRef: MutableRefObject<any>;
  listenerMediaLifecycleRef: MutableRefObject<any>;
  armListenerMediaRecoveryRef: MutableRefObject<(generation?: string | null) => void>;
  scheduleRemotePlaybackRetryRef: MutableRefObject<
    (attempt?: number, generation?: string | null) => void
  >;
  mediaTransportEpochRef: MutableRefObject<number>;
  updateRemoteMediaDiagnostic: (
    summary: string,
    update?: (snapshot: any) => any,
    options?: { event?: string; recordEvent?: boolean; level?: "info" | "warning" | "error" }
  ) => void;
  getRemoteAudioDiagnostics: () => any;
  resetRemoteAudioElement: (stream: MediaStream | null, options?: any) => void;
  resolveMediaDiagnosticPeerId: (input: {
    remotePeerId: string;
    connectedPeerIds: string[];
    currentSourcePeerId: string | null;
  }) => string;
  resolveSoftRecoveryMediaState: (state: any) => any;
  setMediaConnectedPeers: Dispatch<SetStateAction<string[]>>;
  setMediaConnectionState: Dispatch<SetStateAction<any>>;
  updateMediaTransportStatsRef: MutableRefObject<(input: { peerId: string; sample: any }) => void>;
  isCurrentSourceOwner: boolean;
  enableTrackCaching: boolean;
  activePlaybackSource: any;
  resubscribeRoomRef: MutableRefObject<(() => void) | null>;
  hostStreamRef: MutableRefObject<MediaStream | null>;
  hostMediaSyncStateRef: MutableRefObject<any>;
  activeSessionRef: MutableRefObject<AuthSession | null>;
  activeRouteRoomIdRef: MutableRefObject<string | null>;
  requestRoomSnapshotResyncRef: MutableRefObject<
    (reason: RoomSnapshotResyncReason, roomId?: string | null) => Promise<void>
  >;
  ensureSourcePlaybackStartedRef: MutableRefObject<() => Promise<void>>;
  queueAvailabilityRef: MutableRefObject<(announcement: TrackAvailabilityAnnouncement) => void>;
  clearAvailabilityForPeerRef: MutableRefObject<(ownerPeerId: string) => void>;
  deleteRoomTrackArtifactsRef: MutableRefObject<(trackIds: string[]) => Promise<void> | void>;
  lastRealtimeRoomEventAtRef: MutableRefObject<number>;
  recoveryGenerationRef: MutableRefObject<number | null>;
  lastSubscribeAckAtRef: MutableRefObject<number | null>;
  recoveryModeRef: MutableRefObject<"late-join" | "rejoin" | "steady">;
  remotePlaybackRetryRef: MutableRefObject<number | null>;
  stopPresenceHeartbeat: () => void;
  stopRecoveryWatchdog: () => void;
  clearListenerMediaRecovery: () => void;
  clearHostMediaSyncRetry: () => void;
  bumpMediaTransportEpoch: (
    reason?: "source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none"
  ) => number;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setAuthoritativeMediaClock: Dispatch<SetStateAction<ReceivedRoomMediaClock | null>>;
  setRoomRecoveryState: Dispatch<SetStateAction<any>>;
  setStatusMessage: (value: string) => void;
  isNavigatingRoomExit: boolean;
  audioUnlocked: boolean;
  uploadedTracks: Record<string, unknown>;
  emitPresence: () => void;
  startPresenceHeartbeat: () => void;
  exitCurrentRoom: (message: string) => void;
  shouldKickSourcePlaybackFromRealtimeEvent: (input: {
    previousPlayback: RoomSnapshot["room"]["playback"] | null | undefined;
    nextPlayback: RoomSnapshot["room"]["playback"];
    activeSessionId: string | null | undefined;
  }) => boolean;
  shouldAcceptIncomingPeerSignalRecoveryGeneration: (input: {
    payloadRecoveryGeneration: number | null | undefined;
    currentRecoveryGeneration: number | null;
  }) => boolean;
}) {
  input.pieceTransferRatesRef.current.clear();
  input.pieceRequestSamplesRef.current.clear();
  input.sourceRecoveryCoordinatorRef.current = {
    actionKey: null,
    action: null,
    startedAtMs: null
  };

  const iceServers = getWebRTCIceServers(input.iceConfig);
  const { socket, emitPeerSignal, handleSignalFailure, resolveSocketRecoveryMediaState } =
    createRoomSocketRuntime({
      socketRef: input.socketRef,
      recordPeerDiagnosticRef: input.recordPeerDiagnosticRef,
      getRemoteMediaTraceContext: input.getRemoteMediaTraceContext,
      reportRealtimeFailureRef: input.reportRealtimeFailureRef,
      activePlaybackSourceRef: input.activePlaybackSourceRef,
      roomRecoveryStateRef: input.roomRecoveryStateRef
    });

  const { mesh, resyncRealtimePeers } = createRoomDataMeshRuntime({
    roomId: input.roomId,
    peerId: input.peerId,
    emitPeerSignal,
    iceServers,
    meshRef: input.meshRef,
    chunkSchedulerRef: input.chunkSchedulerRef,
    currentRoomRef: input.currentRoomRef,
    uploadedTracksRef: input.uploadedTracksRef,
    uploadedTrackIdsRef: input.uploadedTrackIdsRef,
    manualCacheTrackIdsRef: input.manualCacheTrackIdsRef,
    announceRoomTrackAvailabilityRef: input.announceRoomTrackAvailabilityRef,
    handleManualCachePieceReceivedRef: input.handleManualCachePieceReceivedRef,
    clearManualCachePendingPiece: input.clearManualCachePendingPiece,
    flushPendingAvailabilityRef: input.flushPendingAvailabilityRef,
    recordPeerDiagnosticRef: input.recordPeerDiagnosticRef,
    recordPieceTransferRef: input.recordPieceTransferRef,
    recordPieceRequestSampleRef: input.recordPieceRequestSampleRef,
    updatePeerBufferedAmountRef: input.updatePeerBufferedAmountRef,
    updateDataTransportStatsRef: input.updateDataTransportStatsRef,
    connectionSupervisorStatesRef: input.connectionSupervisorStatesRef,
    updateConnectionSupervisorSignalState: input.updateConnectionSupervisorSignalState,
    withResolvedTransportHealth: input.withResolvedTransportHealth,
    withSupervisorDiagnosticPatch: input.withSupervisorDiagnosticPatch,
    getPieceTransferRates: input.getPieceTransferRates,
    pieceTransferRatesRef: input.pieceTransferRatesRef,
    getPeerMedianRttMs: input.getPeerMedianRttMs,
    setConnectedPeers: input.setConnectedPeers,
    isPageVisible: input.isPageVisible,
    playbackStatus: input.playbackStatus,
    currentTrackId: input.currentTrackId,
    bufferHealth: input.bufferHealth,
    enableManualTrackCaching: input.enableManualTrackCaching,
    reportMeshResyncFailure: (error) => {
      input.reportRealtimeFailureRef.current({
        peerId: "system",
        channelKind: "system",
        event: "mesh-resync-failed",
        summary: "Failed to resync data peers",
        error
      });
    }
  });

  const { mediaMesh } = createRoomMediaMeshRuntime({
    roomId: input.roomId,
    peerId: input.peerId,
    emitPeerSignal,
    iceServers,
    remoteAudioRef: input.remoteAudioRef,
    currentRoomRef: input.currentRoomRef,
    mediaMeshRef: input.mediaMeshRef,
    listenerMediaLifecycleRef: input.listenerMediaLifecycleRef,
    armListenerMediaRecoveryRef: input.armListenerMediaRecoveryRef,
    scheduleRemotePlaybackRetryRef: input.scheduleRemotePlaybackRetryRef,
    mediaTransportEpochRef: input.mediaTransportEpochRef,
    connectionSupervisorStatesRef: input.connectionSupervisorStatesRef,
    updateConnectionSupervisorSignalState: input.updateConnectionSupervisorSignalState,
    withResolvedTransportHealth: input.withResolvedTransportHealth,
    withSupervisorDiagnosticPatch: input.withSupervisorDiagnosticPatch,
    recordPeerDiagnosticRef: input.recordPeerDiagnosticRef,
    updateRemoteMediaDiagnostic: input.updateRemoteMediaDiagnostic,
    getRemoteMediaTraceContext: input.getRemoteMediaTraceContext,
    getRemoteAudioDiagnostics: input.getRemoteAudioDiagnostics,
    resetRemoteAudioElement: input.resetRemoteAudioElement,
    resolveMediaDiagnosticPeerId: input.resolveMediaDiagnosticPeerId,
    resolveSoftRecoveryMediaState: input.resolveSoftRecoveryMediaState,
    setMediaConnectedPeers: input.setMediaConnectedPeers,
    setMediaConnectionState: input.setMediaConnectionState,
    updateMediaTransportStatsRef: input.updateMediaTransportStatsRef,
    isCurrentSourceOwner: input.isCurrentSourceOwner,
    enableTrackCaching: input.enableTrackCaching,
    isPageVisible: input.isPageVisible,
    playbackStatus: input.playbackStatus,
    currentTrackId: input.currentTrackId,
    activePlaybackSource: input.activePlaybackSource,
    bufferHealth: input.bufferHealth
  });

  return attachRoomSocketHandlers({
    socket,
    roomId: input.roomId,
    peerId: input.peerId,
    mesh,
    mediaMesh,
    meshRef: input.meshRef,
    socketRef: input.socketRef,
    resubscribeRoomRef: input.resubscribeRoomRef,
    chunkSchedulerRef: input.chunkSchedulerRef,
    mediaMeshRef: input.mediaMeshRef,
    connectionSupervisorStatesRef: input.connectionSupervisorStatesRef,
    pieceRequestSamplesRef: input.pieceRequestSamplesRef,
    sourceRecoveryCoordinatorRef: input.sourceRecoveryCoordinatorRef,
    hostStreamRef: input.hostStreamRef,
    hostMediaSyncStateRef: input.hostMediaSyncStateRef,
    activeSessionRef: input.activeSessionRef,
    activeRouteRoomIdRef: input.activeRouteRoomIdRef,
    currentRoomRef: input.currentRoomRef,
    uploadedTrackIdsRef: input.uploadedTrackIdsRef,
    announceRoomTrackAvailabilityRef: input.announceRoomTrackAvailabilityRef,
    flushPendingAvailabilityRef: input.flushPendingAvailabilityRef,
    requestRoomSnapshotResyncRef: input.requestRoomSnapshotResyncRef,
    ensureSourcePlaybackStartedRef: input.ensureSourcePlaybackStartedRef,
    queueAvailabilityRef: input.queueAvailabilityRef,
    clearAvailabilityForPeerRef: input.clearAvailabilityForPeerRef,
    deleteRoomTrackArtifactsRef: input.deleteRoomTrackArtifactsRef,
    recordPeerDiagnosticRef: input.recordPeerDiagnosticRef,
    lastRealtimeRoomEventAtRef: input.lastRealtimeRoomEventAtRef,
    recoveryGenerationRef: input.recoveryGenerationRef,
    remotePlaybackRetryRef: input.remotePlaybackRetryRef,
    roomRecoveryStateRef: input.roomRecoveryStateRef,
    lastSubscribeAckAtRef: input.lastSubscribeAckAtRef,
    recoveryModeRef: input.recoveryModeRef,
    stopPresenceHeartbeat: input.stopPresenceHeartbeat,
    stopRecoveryWatchdog: input.stopRecoveryWatchdog,
    clearListenerMediaRecovery: input.clearListenerMediaRecovery,
    clearHostMediaSyncRetry: input.clearHostMediaSyncRetry,
    bumpMediaTransportEpoch: input.bumpMediaTransportEpoch,
    resetRemoteAudioElement: input.resetRemoteAudioElement,
    dispatchRoomStateEvent: input.dispatchRoomStateEvent,
    setConnectedPeers: input.setConnectedPeers,
    setMediaConnectedPeers: input.setMediaConnectedPeers,
    setAuthoritativeMediaClock: input.setAuthoritativeMediaClock,
    setMediaConnectionState: input.setMediaConnectionState,
    setRoomRecoveryState: input.setRoomRecoveryState,
    setStatusMessage: input.setStatusMessage,
    isNavigatingRoomExit: input.isNavigatingRoomExit,
    audioUnlocked: input.audioUnlocked,
    enableManualTrackCaching: input.enableManualTrackCaching,
    enableTrackCaching: input.enableTrackCaching,
    uploadedTracks: input.uploadedTracks,
    emitPresence: input.emitPresence,
    startPresenceHeartbeat: input.startPresenceHeartbeat,
    exitCurrentRoom: input.exitCurrentRoom,
    handleSignalFailure,
    resolveSocketRecoveryMediaState,
    shouldKickSourcePlaybackFromRealtimeEvent: input.shouldKickSourcePlaybackFromRealtimeEvent,
    shouldAcceptIncomingPeerSignalRecoveryGeneration:
      input.shouldAcceptIncomingPeerSignalRecoveryGeneration,
    getRemoteMediaTraceContext: input.getRemoteMediaTraceContext,
    withResolvedTransportHealth: input.withResolvedTransportHealth,
    resyncRealtimePeers
  });
}

export function useRoomRealtimeConnection(input: {
  roomSnapshot: RoomSnapshot | null;
  initialRoomId: string | null;
  hydrated: boolean;
  activeSession: AuthSession | null;
  activeSessionRef: MutableRefObject<AuthSession | null>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  activeRouteRoomIdRef: MutableRefObject<string | null>;
  peerId: string;
  socketRef: MutableRefObject<RoomSocket | null>;
  isNavigatingRoomExit: boolean;
  enableManualTrackCaching: boolean;
  enableTrackCaching: boolean;
  roomListenerSetHash: string;
  uploadedTrackIds: string[];
  connectedPeers: string[];
  mediaConnectedPeers: string[];
  mediaConnectionState: any;
  roomRecoveryState: any;
  setRoomRecoveryState: Dispatch<SetStateAction<any>>;
  isCurrentSourceOwner: boolean;
  uploadedTracks: Record<string, unknown>;
  announceRoomTrackAvailabilityRef: MutableRefObject<(trackId: string) => Promise<void>>;
  lastRealtimeRoomEventAtRef: MutableRefObject<number>;
  lastSubscribeAckAtRef: MutableRefObject<number | null>;
  lastDataActivityAtRef: MutableRefObject<number | null>;
  recoveryGenerationRef: MutableRefObject<number | null>;
  recoveryModeRef: MutableRefObject<"late-join" | "rejoin" | "steady">;
  listenerMediaLifecycleRef: MutableRefObject<{ currentGeneration: string | null }>;
  scheduleRemotePlaybackRetryRef: MutableRefObject<
    (attempt?: number, generation?: string | null) => void
  >;
  resubscribeRoomRef: MutableRefObject<(() => void) | null>;
  meshRef: MutableRefObject<{
    restartPeer: (peerId: string) => Promise<unknown>;
  } | null>;
  mediaMeshRef: MutableRefObject<{
    restartListenerIce: (peerId: string) => Promise<unknown>;
    setTransportEpoch: (epoch: number) => void;
    resetListenerPeer: (peerId: string) => Promise<unknown>;
  } | null>;
  bumpMediaTransportEpoch: (
    reason?: "source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none"
  ) => number;
  resolveSourceContinuityState: (now?: number) => {
    audibleSource: "none" | "remote-stream" | "progressive-local" | "full-local" | null | undefined;
    consecutiveNoProgressMs: number | null;
  };
  requestRoomSnapshotResync: (
    reason: RoomSnapshotResyncReason,
    roomId?: string | null
  ) => Promise<void>;
}) {
  const presenceIntervalRef = useRef<number | null>(null);
  const roomSnapshotWatchdogIntervalRef = useRef<number | null>(null);
  const recoveryWatchdogIntervalRef = useRef<number | null>(null);
  const recoveryWatchdogActionsRef = useRef<{
    snapshotResyncKey: string | null;
    softMediaRetryKey: string | null;
    dataRestartKey: string | null;
    mediaRestartKey: string | null;
    fullResubscribeKey: string | null;
  }>({
    snapshotResyncKey: null,
    softMediaRetryKey: null,
    dataRestartKey: null,
    mediaRestartKey: null,
    fullResubscribeKey: null
  });
  const presenceRepairKeyRef = useRef<string | null>(null);
  const trackMetadataRepairKeyRef = useRef<string | null>(null);
  const initialRoomSnapshotResyncKeyRef = useRef<string | null>(null);
  const lastManualCacheAvailabilityBroadcastKeyRef = useRef<string | null>(null);

  const stopPresenceHeartbeat = useCallback(() => {
    if (presenceIntervalRef.current !== null) {
      window.clearInterval(presenceIntervalRef.current);
      presenceIntervalRef.current = null;
    }
  }, []);

  const stopRoomSnapshotWatchdog = useCallback(() => {
    if (roomSnapshotWatchdogIntervalRef.current !== null) {
      window.clearInterval(roomSnapshotWatchdogIntervalRef.current);
      roomSnapshotWatchdogIntervalRef.current = null;
    }
  }, []);

  const stopRecoveryWatchdog = useCallback(() => {
    if (recoveryWatchdogIntervalRef.current !== null) {
      window.clearInterval(recoveryWatchdogIntervalRef.current);
      recoveryWatchdogIntervalRef.current = null;
    }
  }, []);

  const emitPresence = useCallback(() => {
    const currentSession = input.activeSessionRef.current;
    const currentRoomId = input.currentRoomRef.current?.room.id;
    if (!currentRoomId || !currentSession?.userId || !input.peerId) {
      return;
    }

    input.socketRef.current?.emit("room.presence", {
      roomId: currentRoomId,
      sessionId: currentSession.userId,
      peerId: input.peerId
    });
  }, [input.activeSessionRef, input.currentRoomRef, input.peerId, input.socketRef]);

  const startPresenceHeartbeat = useCallback(() => {
    emitPresence();
    stopPresenceHeartbeat();
    presenceIntervalRef.current = window.setInterval(emitPresence, 10_000);
  }, [emitPresence, stopPresenceHeartbeat]);

  useEffect(() => {
    return () => {
      stopPresenceHeartbeat();
      stopRoomSnapshotWatchdog();
      stopRecoveryWatchdog();
    };
  }, [stopPresenceHeartbeat, stopRecoveryWatchdog, stopRoomSnapshotWatchdog]);

  useEffect(() => {
    if (
      !input.roomSnapshot?.room.id ||
      !input.hydrated ||
      !input.activeSession?.userId ||
      input.isNavigatingRoomExit ||
      input.roomSnapshot.room.members.length <= 1
    ) {
      stopRoomSnapshotWatchdog();
      return;
    }

    input.lastRealtimeRoomEventAtRef.current = Date.now();
    stopRoomSnapshotWatchdog();
    roomSnapshotWatchdogIntervalRef.current = window.setInterval(() => {
      const activeRoomId = input.activeRouteRoomIdRef.current;
      const socket = input.socketRef.current;
      if (!activeRoomId || activeRoomId !== input.roomSnapshot?.room.id || !socket?.connected) {
        return;
      }

      if (Date.now() - input.lastRealtimeRoomEventAtRef.current < 8_000) {
        return;
      }

      input.lastRealtimeRoomEventAtRef.current = Date.now();
      void input.requestRoomSnapshotResync("stale-watchdog", input.roomSnapshot.room.id);
    }, 4_000);

    return () => {
      stopRoomSnapshotWatchdog();
    };
  }, [
    input.activeRouteRoomIdRef,
    input.activeSession?.userId,
    input.hydrated,
    input.isNavigatingRoomExit,
    input.lastRealtimeRoomEventAtRef,
    input.requestRoomSnapshotResync,
    input.roomSnapshot,
    input.socketRef,
    stopRoomSnapshotWatchdog
  ]);

  useEffect(() => {
    if (!input.roomSnapshot?.room.id || !input.activeSession?.userId || !input.peerId) {
      presenceRepairKeyRef.current = null;
      return;
    }

    const localMember =
      input.roomSnapshot.room.members.find((member) => member.id === input.activeSession?.userId) ??
      null;
    if (!localMember) {
      presenceRepairKeyRef.current = null;
      return;
    }

    if (localMember.presenceState === "online" && localMember.peerId === input.peerId) {
      presenceRepairKeyRef.current = null;
      return;
    }

    const repairKey = [
      input.roomSnapshot.room.id,
      input.roomSnapshot.room.presenceRevision,
      localMember.peerId ?? "none",
      localMember.presenceState,
      input.peerId
    ].join("|");
    if (presenceRepairKeyRef.current === repairKey) {
      return;
    }
    presenceRepairKeyRef.current = repairKey;

    const socket = input.socketRef.current;
    if (!socket?.connected) {
      return;
    }

    startPresenceHeartbeat();
    emitPresence();
    void input.requestRoomSnapshotResync("subscribe-ack", input.roomSnapshot.room.id);
  }, [
    emitPresence,
    input.activeSession?.userId,
    input.peerId,
    input.requestRoomSnapshotResync,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.members,
    input.roomSnapshot?.room.presenceRevision,
    input.socketRef,
    startPresenceHeartbeat
  ]);

  useEffect(() => {
    if (
      !input.initialRoomId ||
      !input.hydrated ||
      !input.activeSession?.userId ||
      input.isNavigatingRoomExit ||
      input.roomSnapshot?.room.id !== input.initialRoomId
    ) {
      if (!input.initialRoomId || input.roomSnapshot?.room.id !== input.initialRoomId) {
        initialRoomSnapshotResyncKeyRef.current = null;
      }
      return;
    }

    const resyncKey = `${input.activeSession.userId}:${input.initialRoomId}`;
    if (initialRoomSnapshotResyncKeyRef.current === resyncKey) {
      return;
    }
    initialRoomSnapshotResyncKeyRef.current = resyncKey;

    void input.requestRoomSnapshotResync("subscribe-ack", input.initialRoomId);
  }, [
    input.activeSession?.userId,
    input.hydrated,
    input.initialRoomId,
    input.isNavigatingRoomExit,
    input.requestRoomSnapshotResync,
    input.roomSnapshot?.room.id
  ]);

  useEffect(() => {
    const roomId = input.roomSnapshot?.room.id ?? null;
    const currentTrackId = input.roomSnapshot?.room.playback.currentTrackId ?? null;
    const playbackQueueVersion = input.roomSnapshot?.room.playback.queueVersion ?? 0;

    if (!roomId || !currentTrackId) {
      trackMetadataRepairKeyRef.current = null;
      return;
    }

    if (input.roomSnapshot?.tracks.some((track) => track.id === currentTrackId)) {
      trackMetadataRepairKeyRef.current = null;
      return;
    }

    const repairKey = [roomId, currentTrackId, playbackQueueVersion].join("|");
    if (trackMetadataRepairKeyRef.current === repairKey) {
      return;
    }
    trackMetadataRepairKeyRef.current = repairKey;

    void input.requestRoomSnapshotResync("subscribe-ack", roomId);
  }, [
    input.requestRoomSnapshotResync,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.currentTrackId,
    input.roomSnapshot?.room.playback.queueVersion,
    input.roomSnapshot?.tracks
  ]);

  useEffect(() => {
    const nextBroadcastKey = shouldReannounceManualCacheAvailability({
      enableManualTrackCaching: input.enableManualTrackCaching,
      roomId: input.roomSnapshot?.room.id,
      roomListenerSetHash: input.roomListenerSetHash,
      uploadedTrackIds: input.uploadedTrackIds,
      lastBroadcastKey: lastManualCacheAvailabilityBroadcastKeyRef.current
    });

    if (!nextBroadcastKey) {
      if (
        !input.roomSnapshot?.room.id ||
        !input.roomListenerSetHash ||
        input.uploadedTrackIds.length === 0
      ) {
        lastManualCacheAvailabilityBroadcastKeyRef.current = null;
      }
      return;
    }

    lastManualCacheAvailabilityBroadcastKeyRef.current = nextBroadcastKey;
    for (const trackId of input.uploadedTrackIds) {
      void input.announceRoomTrackAvailabilityRef.current(trackId);
    }
  }, [
    input.announceRoomTrackAvailabilityRef,
    input.enableManualTrackCaching,
    input.roomListenerSetHash,
    input.roomSnapshot?.room.id,
    input.uploadedTrackIds
  ]);

  useEffect(() => {
    const playback = input.roomSnapshot?.room.playback ?? null;
    const currentTrackId = playback?.currentTrackId ?? null;
    const sourcePeerId = playback?.sourcePeerId ?? null;
    const hasFullLocalTrack =
      input.enableTrackCaching && !!(currentTrackId && input.uploadedTracks[currentTrackId]);
    const dataReady =
      !input.enableTrackCaching || !!(sourcePeerId && input.connectedPeers.includes(sourcePeerId));
    const continuity = input.resolveSourceContinuityState();
    const mediaNoProgressMs =
      continuity.consecutiveNoProgressMs ??
      (input.lastSubscribeAckAtRef.current !== null
        ? Date.now() - input.lastSubscribeAckAtRef.current
        : null);
    const remoteMediaStillProtected =
      continuity.audibleSource === "remote-stream" &&
      (mediaNoProgressMs === null || mediaNoProgressMs < recoveryMediaRestartThresholdMs);
    const mediaReady =
      !!(sourcePeerId && input.mediaConnectedPeers.includes(sourcePeerId)) ||
      input.mediaConnectionState === "live" ||
      remoteMediaStillProtected ||
      continuity.audibleSource === "progressive-local" ||
      continuity.audibleSource === "full-local";

    if (
      !input.roomSnapshot?.room.id ||
      !playback ||
      !playback.currentTrackId ||
      !input.roomRecoveryState.generation ||
      input.isCurrentSourceOwner
    ) {
      stopRecoveryWatchdog();
      recoveryWatchdogActionsRef.current = {
        snapshotResyncKey: null,
        softMediaRetryKey: null,
        dataRestartKey: null,
        mediaRestartKey: null,
        fullResubscribeKey: null
      };
      return;
    }

    input.setRoomRecoveryState((current: any) => {
      const nextPhase =
        input.enableTrackCaching && current.fullLocalRecoveryActive && hasFullLocalTrack
          ? "playing-local-fallback"
          : current.pendingSnapshot
            ? "resyncing"
            : !dataReady
              ? "bootstrapping-data"
              : !mediaReady
                ? "bootstrapping-media"
                : "steady";
      const nextFullLocalRecoveryActive =
        input.enableTrackCaching && (current.fullLocalRecoveryActive || hasFullLocalTrack);
      if (
        current.phase === nextPhase &&
        current.pendingData === !dataReady &&
        current.pendingMedia === !mediaReady &&
        current.fullLocalRecoveryActive === nextFullLocalRecoveryActive
      ) {
        return current;
      }

      return {
        ...current,
        phase: nextPhase,
        pendingData: !dataReady,
        pendingMedia: !mediaReady,
        fullLocalRecoveryActive: nextFullLocalRecoveryActive
      };
    });

    if (playback.status !== "playing" || input.lastSubscribeAckAtRef.current === null) {
      stopRecoveryWatchdog();
      return;
    }

    stopRecoveryWatchdog();
    recoveryWatchdogIntervalRef.current = window.setInterval(() => {
      const ackAt = input.lastSubscribeAckAtRef.current;
      const currentPlayback = input.currentRoomRef.current?.room.playback;
      const roomId = input.roomSnapshot?.room.id ?? null;
      const latestTrackId = currentPlayback?.currentTrackId ?? null;
      const latestSourcePeerId = currentPlayback?.sourcePeerId ?? null;
      const latestGeneration = input.recoveryGenerationRef.current;
      if (
        !ackAt ||
        !roomId ||
        !currentPlayback ||
        !latestTrackId ||
        !latestSourcePeerId ||
        latestGeneration === null
      ) {
        return;
      }

      const now = Date.now();
      const ageMs = now - ackAt;
      const recoveryKey = [
        roomId,
        latestTrackId,
        currentPlayback.mediaEpoch,
        latestGeneration,
        latestSourcePeerId
      ].join("|");
      const latestHasFullLocalTrack =
        input.enableTrackCaching && !!input.uploadedTracks[latestTrackId];
      const latestDataReady =
        !input.enableTrackCaching || input.connectedPeers.includes(latestSourcePeerId);
      const continuity = input.resolveSourceContinuityState(now);
      const noProgressMs = continuity.consecutiveNoProgressMs ?? ageMs;
      const noDataProgressMs =
        input.lastDataActivityAtRef.current !== null
          ? now - input.lastDataActivityAtRef.current
          : ageMs;
      const hasProtectedAudibleSource =
        continuity.audibleSource === "progressive-local" ||
        continuity.audibleSource === "full-local" ||
        (continuity.audibleSource === "remote-stream" &&
          noProgressMs < recoveryMediaRestartThresholdMs);
      const latestMediaReady =
        input.mediaConnectedPeers.includes(latestSourcePeerId) ||
        input.mediaConnectionState === "live" ||
        hasProtectedAudibleSource;

      if (input.roomRecoveryState.pendingSnapshot && ageMs >= 1_500) {
        const snapshotResyncKey = `${recoveryKey}|snapshot`;
        if (recoveryWatchdogActionsRef.current.snapshotResyncKey !== snapshotResyncKey) {
          recoveryWatchdogActionsRef.current.snapshotResyncKey = snapshotResyncKey;
          void input.requestRoomSnapshotResync("subscribe-ack", roomId);
        }
      }

      if (!latestMediaReady && noProgressMs >= recoverySoftRetryThresholdMs) {
        const mediaRetryKey = `${recoveryKey}|soft-media`;
        if (recoveryWatchdogActionsRef.current.softMediaRetryKey !== mediaRetryKey) {
          recoveryWatchdogActionsRef.current.softMediaRetryKey = mediaRetryKey;
          input.setRoomRecoveryState((current: any) => ({
            ...current,
            phase: latestHasFullLocalTrack ? "playing-local-fallback" : "bootstrapping-media",
            fullLocalRecoveryActive: latestHasFullLocalTrack,
            listenerBootstrapAttempts: (current.listenerBootstrapAttempts ?? 0) + 1
          }));
          if (!latestHasFullLocalTrack) {
            input.scheduleRemotePlaybackRetryRef.current(
              0,
              input.listenerMediaLifecycleRef.current.currentGeneration
            );
          }
        }
      }

      if (!latestDataReady && noDataProgressMs >= recoveryDataRestartThresholdMs) {
        const dataRestartKey = `${recoveryKey}|data`;
        if (recoveryWatchdogActionsRef.current.dataRestartKey !== dataRestartKey) {
          recoveryWatchdogActionsRef.current.dataRestartKey = dataRestartKey;
          input.setRoomRecoveryState((current: any) => ({
            ...current,
            phase: "bootstrapping-data",
            listenerBootstrapAttempts: (current.listenerBootstrapAttempts ?? 0) + 1
          }));
          void input.meshRef.current?.restartPeer(latestSourcePeerId);
        }
      }

      if (!latestMediaReady && noProgressMs >= recoveryMediaRestartThresholdMs) {
        if (latestHasFullLocalTrack) {
          input.setRoomRecoveryState((current: any) => ({
            ...current,
            phase: "playing-local-fallback",
            fullLocalRecoveryActive: true,
            pendingMedia: true
          }));
        } else if (!hasProtectedAudibleSource) {
          const mediaRestartKey = `${recoveryKey}|media`;
          if (recoveryWatchdogActionsRef.current.mediaRestartKey !== mediaRestartKey) {
            recoveryWatchdogActionsRef.current.mediaRestartKey = mediaRestartKey;
            input.setRoomRecoveryState((current: any) => ({
              ...current,
              phase: "bootstrapping-media",
              listenerBootstrapAttempts: (current.listenerBootstrapAttempts ?? 0) + 1
            }));
            void input.mediaMeshRef.current?.restartListenerIce(latestSourcePeerId);
          }
        }
      }

      if (
        !latestDataReady &&
        !latestMediaReady &&
        noProgressMs >= recoveryFullResubscribeThresholdMs &&
        noDataProgressMs >= recoveryFullResubscribeThresholdMs &&
        !hasProtectedAudibleSource &&
        !latestHasFullLocalTrack
      ) {
        const fullResubscribeKey = `${recoveryKey}|resubscribe`;
        if (recoveryWatchdogActionsRef.current.fullResubscribeKey !== fullResubscribeKey) {
          recoveryWatchdogActionsRef.current.fullResubscribeKey = fullResubscribeKey;
          input.setRoomRecoveryState((current: any) => ({
            ...current,
            phase: "resyncing",
            pendingSnapshot: true,
            listenerBootstrapAttempts: (current.listenerBootstrapAttempts ?? 0) + 1
          }));
          input.resubscribeRoomRef.current?.();
          void input.meshRef.current?.restartPeer(latestSourcePeerId);
          const nextTransportEpoch = input.bumpMediaTransportEpoch("explicit-hard-reset");
          input.mediaMeshRef.current?.setTransportEpoch(nextTransportEpoch);
          void input.mediaMeshRef.current?.resetListenerPeer(latestSourcePeerId);
        }
      }
    }, 500);

    return () => {
      stopRecoveryWatchdog();
    };
  }, [
    input.connectedPeers,
    input.enableTrackCaching,
    input.isCurrentSourceOwner,
    input.lastDataActivityAtRef,
    input.lastSubscribeAckAtRef,
    input.listenerMediaLifecycleRef,
    input.mediaConnectedPeers,
    input.mediaConnectionState,
    input.mediaMeshRef,
    input.meshRef,
    input.recoveryGenerationRef,
    input.requestRoomSnapshotResync,
    input.resolveSourceContinuityState,
    input.roomRecoveryState.fullLocalRecoveryActive,
    input.roomRecoveryState.generation,
    input.roomRecoveryState.pendingSnapshot,
    input.roomSnapshot,
    input.scheduleRemotePlaybackRetryRef,
    input.setRoomRecoveryState,
    input.uploadedTracks,
    input.bumpMediaTransportEpoch,
    input.currentRoomRef,
    input.resubscribeRoomRef,
    stopRecoveryWatchdog
  ]);

  return {
    emitPresence,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    stopRecoveryWatchdog
  };
}

export function attachRoomSocketHandlers(input: {
  socket: RoomSocket;
  roomId: string;
  peerId: string;
  mesh: {
    syncPeers: (peerIds: string[]) => Promise<void>;
    handleSignal: (payload: PeerSignalMessage) => Promise<void>;
    destroy: () => void;
  };
  mediaMesh: {
    handleSignal: (payload: PeerSignalMessage) => Promise<void>;
    destroy: () => void;
  };
  meshRef: MutableRefObject<unknown>;
  socketRef: MutableRefObject<RoomSocket | null>;
  resubscribeRoomRef: MutableRefObject<(() => void) | null>;
  chunkSchedulerRef: MutableRefObject<unknown>;
  mediaMeshRef: MutableRefObject<unknown>;
  connectionSupervisorStatesRef: MutableRefObject<Map<string, unknown>>;
  pieceRequestSamplesRef: MutableRefObject<Map<string, unknown>>;
  sourceRecoveryCoordinatorRef: MutableRefObject<{
    actionKey: string | null;
    action: "ice-restart" | "hard-recreate" | "full-resubscribe" | null;
    startedAtMs: number | null;
  }>;
  hostStreamRef: MutableRefObject<MediaStream | null>;
  hostMediaSyncStateRef: MutableRefObject<{
    inFlight: boolean;
    lastAppliedKey: string | null;
    pendingKey: string | null;
    lastCaptureRefreshKey: string | null;
    lastPublishKey: string | null;
    retryKey: string | null;
    publishGeneration: number;
    stage: string;
    lastPublishedListenerSet: string | null;
  }>;
  activeSessionRef: MutableRefObject<AuthSession | null>;
  activeRouteRoomIdRef: MutableRefObject<string | null>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  uploadedTrackIdsRef: MutableRefObject<string[]>;
  announceRoomTrackAvailabilityRef: MutableRefObject<(trackId: string) => Promise<void>>;
  flushPendingAvailabilityRef: MutableRefObject<() => void>;
  requestRoomSnapshotResyncRef: MutableRefObject<
    (reason: RoomSnapshotResyncReason, roomId?: string | null) => Promise<void>
  >;
  ensureSourcePlaybackStartedRef: MutableRefObject<() => Promise<void>>;
  queueAvailabilityRef: MutableRefObject<(announcement: TrackAvailabilityAnnouncement) => void>;
  clearAvailabilityForPeerRef: MutableRefObject<(ownerPeerId: string) => void>;
  deleteRoomTrackArtifactsRef: MutableRefObject<
    (trackIds: string[]) => Promise<void> | void
  >;
  recordPeerDiagnosticRef: MutableRefObject<(input: any) => void>;
  lastRealtimeRoomEventAtRef: MutableRefObject<number>;
  recoveryGenerationRef: MutableRefObject<number | null>;
  remotePlaybackRetryRef: MutableRefObject<number | null>;
  roomRecoveryStateRef: MutableRefObject<{
    fullLocalRecoveryActive: boolean;
    generation: number | null;
    mode: "late-join" | "rejoin" | "steady";
  }>;
  lastSubscribeAckAtRef: MutableRefObject<number | null>;
  recoveryModeRef: MutableRefObject<"late-join" | "rejoin" | "steady">;
  stopPresenceHeartbeat: () => void;
  stopRecoveryWatchdog: () => void;
  clearListenerMediaRecovery: () => void;
  clearHostMediaSyncRetry: () => void;
  bumpMediaTransportEpoch: (
    reason?: "source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none"
  ) => number;
  resetRemoteAudioElement: (stream: MediaStream | null) => void;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setConnectedPeers: Dispatch<SetStateAction<string[]>>;
  setMediaConnectedPeers: Dispatch<SetStateAction<string[]>>;
  setAuthoritativeMediaClock: Dispatch<SetStateAction<ReceivedRoomMediaClock | null>>;
  setMediaConnectionState: Dispatch<SetStateAction<any>>;
  setRoomRecoveryState: Dispatch<SetStateAction<any>>;
  setStatusMessage: (value: string) => void;
  isNavigatingRoomExit: boolean;
  audioUnlocked: boolean;
  enableManualTrackCaching: boolean;
  enableTrackCaching: boolean;
  uploadedTracks: Record<string, unknown>;
  emitPresence: () => void;
  startPresenceHeartbeat: () => void;
  exitCurrentRoom: (message: string) => void;
  handleSignalFailure: (payload: PeerSignalMessage, error: unknown) => void;
  resolveSocketRecoveryMediaState: () => "buffering" | "reconnecting";
  shouldKickSourcePlaybackFromRealtimeEvent: (input: {
    previousPlayback: RoomSnapshot["room"]["playback"] | null | undefined;
    nextPlayback: RoomSnapshot["room"]["playback"];
    activeSessionId: string | null | undefined;
  }) => boolean;
  shouldAcceptIncomingPeerSignalRecoveryGeneration: (input: {
    payloadRecoveryGeneration: number | null | undefined;
    currentRecoveryGeneration: number | null;
  }) => boolean;
  getRemoteMediaTraceContext: (remotePeerId?: string | null) => {
    traceKey: string | null;
  };
  withResolvedTransportHealth: (snapshot: any) => any;
  resyncRealtimePeers: (
    members?: Array<{ peerId: string | null }>
  ) => void;
}) {
  let subscribeRetryId: number | null = null;
  let subscribeAckTimeoutId: number | null = null;

  const clearSubscribeRetry = () => {
    if (subscribeRetryId !== null) {
      window.clearTimeout(subscribeRetryId);
      subscribeRetryId = null;
    }
    if (subscribeAckTimeoutId !== null) {
      window.clearTimeout(subscribeAckTimeoutId);
      subscribeAckTimeoutId = null;
    }
  };

  const scheduleSubscribeRetry = (attempt: number) => {
    if (subscribeRetryId !== null) {
      return;
    }

    const delay =
      subscribeRetryBackoffMs[Math.min(attempt, subscribeRetryBackoffMs.length - 1)] ??
      subscribeRetryBackoffMs[subscribeRetryBackoffMs.length - 1];
    subscribeRetryId = window.setTimeout(() => {
      subscribeRetryId = null;
      subscribeToRoom(attempt);
    }, delay);
  };

  const subscribeToRoom = (attempt = 0) => {
    const currentSession = input.activeSessionRef.current;
    if (!input.socket.connected || !currentSession?.userId || !input.peerId) {
      scheduleSubscribeRetry(attempt + 1);
      return;
    }

    input.setRoomRecoveryState((current: any) => ({
      ...current,
      phase: "joining",
      mode: current.generation === null ? "late-join" : "rejoin",
      pendingSnapshot: true,
      pendingData: input.enableTrackCaching,
      pendingMedia: true,
      bootstrapStartedAt: null,
      bootstrapSourcePeerId: null,
      listenerBootstrapAttempts: 0,
      fullLocalRecoveryActive: false
    }));

    if (subscribeAckTimeoutId !== null) {
      window.clearTimeout(subscribeAckTimeoutId);
    }
    subscribeAckTimeoutId = window.setTimeout(() => {
      subscribeAckTimeoutId = null;
      scheduleSubscribeRetry(attempt + 1);
    }, subscribeAckTimeoutMs);

    input.socket.emit(
      "room.subscribe",
      {
        roomId: input.roomId,
        sessionId: currentSession.userId,
        peerId: input.peerId
      },
      (response?: RoomSubscribeAckPayload) => {
        if (subscribeAckTimeoutId !== null) {
          window.clearTimeout(subscribeAckTimeoutId);
          subscribeAckTimeoutId = null;
        }
        if (!response?.ok) {
          scheduleSubscribeRetry(attempt + 1);
          return;
        }

        clearSubscribeRetry();
        const appliedBootstrap = applyRoomSubscribeBootstrap({
          ack: response,
          activeRouteRoomIdRef: input.activeRouteRoomIdRef,
          currentRoomRef: input.currentRoomRef,
          lastSubscribeAckAtRef: input.lastSubscribeAckAtRef,
          recoveryGenerationRef: input.recoveryGenerationRef,
          recoveryModeRef: input.recoveryModeRef,
          sourceRecoveryCoordinatorRef: input.sourceRecoveryCoordinatorRef,
          dispatchRoomStateEvent: input.dispatchRoomStateEvent,
          setRoomRecoveryState: input.setRoomRecoveryState,
          uploadedTracks: input.uploadedTracks,
          enableTrackCaching: input.enableTrackCaching,
          audioUnlocked: input.audioUnlocked
        });
        if (!appliedBootstrap) {
          scheduleSubscribeRetry(attempt + 1);
          return;
        }
        input.startPresenceHeartbeat();
        input.resyncRealtimePeers(response.bootstrap?.members ?? undefined);
        input.flushPendingAvailabilityRef.current();
        if (input.enableManualTrackCaching) {
          for (const trackId of input.uploadedTrackIdsRef.current) {
            void input.announceRoomTrackAvailabilityRef.current(trackId);
          }
        }
        if (
          input.currentRoomRef.current?.room.playback.sourceSessionId ===
          input.activeSessionRef.current?.userId
        ) {
          void input.ensureSourcePlaybackStartedRef.current();
        }
        void input.requestRoomSnapshotResyncRef.current("subscribe-ack", input.roomId);
      }
    );
  };

  input.resubscribeRoomRef.current = () => {
    if (!input.socket.connected) {
      input.socket.connect();
    }
    subscribeToRoom();
    input.emitPresence();
    void input.requestRoomSnapshotResyncRef.current("subscribe-ack", input.roomId);
  };

  const exitAndStopPresence = (message: string) => {
    input.stopPresenceHeartbeat();
    input.exitCurrentRoom(message);
  };

  input.socket.on("connect", () => {
    subscribeToRoom();
    input.flushPendingAvailabilityRef.current();
    if (input.enableManualTrackCaching) {
      for (const trackId of input.uploadedTrackIdsRef.current) {
        void input.announceRoomTrackAvailabilityRef.current(trackId);
      }
    }
    input.resyncRealtimePeers();
    if (
      input.currentRoomRef.current?.room.playback.sourceSessionId ===
      input.activeSessionRef.current?.userId
    ) {
      void input.ensureSourcePlaybackStartedRef.current();
    }
    void input.requestRoomSnapshotResyncRef.current("socket-connect", input.roomId);
    const joinCode = input.currentRoomRef.current?.room.joinCode;
    if (joinCode) {
      input.setStatusMessage(`已连接到房间 ${joinCode}。`);
    }
  });

  let didReplayLocalAvailability = false;

  input.socket.on("room.snapshot", (snapshot: RoomSnapshot) => {
    if (snapshot.room.id !== input.roomId || input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }

    const shouldKickSourcePlayback = input.shouldKickSourcePlaybackFromRealtimeEvent({
      previousPlayback: input.currentRoomRef.current?.room.playback,
      nextPlayback: snapshot.room.playback,
      activeSessionId: input.activeSessionRef.current?.userId
    });

    input.lastRealtimeRoomEventAtRef.current = Date.now();
    input.dispatchRoomStateEvent({
      type: "server-snapshot",
      snapshot
    });
    input.setRoomRecoveryState((current: any) => ({
      ...current,
      phase:
        input.enableTrackCaching && current.fullLocalRecoveryActive
          ? "playing-local-fallback"
          : "resyncing",
      pendingSnapshot: false
    }));
    void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);

    if (!didReplayLocalAvailability) {
      didReplayLocalAvailability = true;
      if (input.enableManualTrackCaching) {
        for (const trackId of input.uploadedTrackIdsRef.current) {
          void input.announceRoomTrackAvailabilityRef.current(trackId);
        }
      }
    }

    input.flushPendingAvailabilityRef.current();
    input.resyncRealtimePeers(snapshot.room.members);
    if (shouldKickSourcePlayback) {
      window.setTimeout(() => {
        if (input.activeRouteRoomIdRef.current === input.roomId) {
          void input.ensureSourcePlaybackStartedRef.current();
        }
      }, 0);
    }
  });

  input.socket.on("room.playback.patch", ({ playback }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }

    input.dispatchRoomStateEvent({
      type: "server-playback-patch",
      roomId: input.roomId,
      playback
    });
  });

  input.socket.on("room.media.clock", (payload: RoomMediaClockPayload) => {
    if (payload.roomId !== input.roomId || input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }

    const currentPlayback = input.currentRoomRef.current?.room.playback;
    if (
      !currentPlayback ||
      payload.mediaEpoch !== currentPlayback.mediaEpoch ||
      (currentPlayback.sourcePeerId && payload.sourcePeerId !== currentPlayback.sourcePeerId)
    ) {
      return;
    }

    input.setAuthoritativeMediaClock((current: any) => {
      if (
        current &&
        current.mediaEpoch === payload.mediaEpoch &&
        current.sourcePeerId === payload.sourcePeerId &&
        current.relayGeneration > payload.relayGeneration
      ) {
        return current;
      }

      if (
        current &&
        current.mediaEpoch === payload.mediaEpoch &&
        current.sourcePeerId === payload.sourcePeerId &&
        current.relayGeneration === payload.relayGeneration &&
        current.sequence > payload.sequence
      ) {
        return current;
      }

      return {
        ...payload,
        receivedAtMs: Date.now()
      };
    });
  });

  input.socket.on("room.queue.patch", ({ queue, playback, roomRevision }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }

    input.lastRealtimeRoomEventAtRef.current = Date.now();
    input.dispatchRoomStateEvent({
      type: "server-queue-patch",
      roomId: input.roomId,
      queue,
      playback,
      roomRevision
    });
    void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
  });

  input.socket.on("room.presence.patch", ({ members, playback, presenceRevision, roomRevision }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }

    const shouldKickSourcePlayback = input.shouldKickSourcePlaybackFromRealtimeEvent({
      previousPlayback: input.currentRoomRef.current?.room.playback,
      nextPlayback: playback,
      activeSessionId: input.activeSessionRef.current?.userId
    });

    input.lastRealtimeRoomEventAtRef.current = Date.now();
    input.dispatchRoomStateEvent({
      type: "server-presence-patch",
      roomId: input.roomId,
      members,
      playback,
      presenceRevision,
      roomRevision
    });
    void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
    input.resyncRealtimePeers(members);
    if (shouldKickSourcePlayback) {
      window.setTimeout(() => {
        if (input.activeRouteRoomIdRef.current === input.roomId) {
          void input.ensureSourcePlaybackStartedRef.current();
        }
      }, 0);
    }
  });

  input.socket.on("room.library.patch", ({ tracks, queue, playback, roomRevision }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }

    input.lastRealtimeRoomEventAtRef.current = Date.now();
    input.dispatchRoomStateEvent({
      type: "server-library-patch",
      roomId: input.roomId,
      tracks,
      queue,
      playback,
      roomRevision
    });
    void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
  });

  input.socket.on("peer.signal", (payload) => {
    if (payload.roomId !== input.roomId || input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }

    if (
      !input.shouldAcceptIncomingPeerSignalRecoveryGeneration({
        payloadRecoveryGeneration: payload.recoveryGeneration,
        currentRecoveryGeneration: input.recoveryGenerationRef.current
      })
    ) {
      input.recordPeerDiagnosticRef.current({
        peerId: payload.fromPeerId,
        channelKind: payload.channelKind,
        direction: "received",
        event: "stale-signal-dropped",
        summary: `丢弃旧恢复代次信令 ${payload.recoveryGeneration}`,
        level: "warning",
        recordEvent: false
      });
      return;
    }

    const traceContext =
      payload.channelKind === "media" ? input.getRemoteMediaTraceContext(payload.fromPeerId) : null;
    input.recordPeerDiagnosticRef.current({
      peerId: payload.fromPeerId,
      channelKind: payload.channelKind,
      direction: "received",
      event: payload.type,
      summary:
        payload.channelKind === "media" && traceContext?.traceKey
          ? `收到 ${payload.fromPeerId} 的 ${payload.channelKind} ${payload.type} · ${traceContext.traceKey}`
          : `收到 ${payload.fromPeerId} 的 ${payload.channelKind} ${payload.type}`,
      update: (snapshot: any) => ({
        ...snapshot,
        remoteTrackStatus:
          payload.channelKind === "media"
            ? {
                ...snapshot.remoteTrackStatus,
                ...traceContext
              }
            : snapshot.remoteTrackStatus,
        signalStats: {
          ...snapshot.signalStats,
          receivedOffers: snapshot.signalStats.receivedOffers + (payload.type === "offer" ? 1 : 0),
          receivedAnswers:
            snapshot.signalStats.receivedAnswers + (payload.type === "answer" ? 1 : 0),
          receivedCandidates:
            snapshot.signalStats.receivedCandidates + (payload.type === "candidate" ? 1 : 0)
        }
      })
    });
    if (payload.channelKind === "media") {
      void input.mediaMesh.handleSignal(payload).catch((error) => {
        input.handleSignalFailure(payload, error);
      });
      return;
    }

    void input.mesh.handleSignal(payload).catch((error) => {
      input.handleSignalFailure(payload, error);
    });
  });

  input.socket.on("piece.availability", (announcement: TrackAvailabilityAnnouncement) => {
    if (announcement.roomId !== input.roomId || input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    if (!input.enableManualTrackCaching) {
      return;
    }
    input.recordPeerDiagnosticRef.current({
      peerId: announcement.ownerPeerId,
      channelKind: "data",
      direction: "received",
      event: "piece-availability",
      summary: `收到 ${announcement.ownerPeerId} 的分片公告`,
      recordEvent: false,
      update: (snapshot: any) => ({
        ...input.withResolvedTransportHealth({
          ...snapshot,
          lastAvailabilitySeenAt: new Date().toISOString()
        })
      })
    });
    input.queueAvailabilityRef.current(announcement);
  });

  input.socket.on("piece.availability.clear", ({ roomId: clearedRoomId, ownerPeerId }) => {
    if (clearedRoomId !== input.roomId || input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    if (!input.enableManualTrackCaching) {
      return;
    }
    input.clearAvailabilityForPeerRef.current(ownerPeerId);
  });

  input.socket.on("room.session.replaced", ({ roomId: replacedRoomId }) => {
    if (replacedRoomId !== input.roomId) {
      return;
    }

    input.socket.disconnect();
    exitAndStopPresence("同一账号已在其他标签页或设备进入这个房间，当前页面已退出房间。");
  });

  input.socket.on("room.deleted", ({ roomId: deletedRoomId, trackIds }) => {
    if (deletedRoomId !== input.roomId) {
      return;
    }

    const roomTrackIds =
      trackIds.length > 0
        ? trackIds
        : (input.currentRoomRef.current?.tracks.map((track) => track.id) ?? []);
    void Promise.resolve(input.deleteRoomTrackArtifactsRef.current(roomTrackIds));
    exitAndStopPresence("房间已解散，当前房间的歌单和本地缓存已清理。");
  });

  input.socket.on("room.snapshot.missing", () => {
    if (input.isNavigatingRoomExit) {
      return;
    }

    exitAndStopPresence("这个房间已不可用，请返回音乐房重新加入。");
  });

  input.socket.on("connect_error", (error) => {
    input.recordPeerDiagnosticRef.current({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "socket-connect-error",
      level: "error",
      summary: `实时连接失败：${toUserFacingError(error)}`,
      update: (snapshot: any) => ({
        ...snapshot,
        lastError: toUserFacingError(error)
      })
    });
    input.setStatusMessage(`实时连接失败：${toUserFacingError(error)}`);
  });

  input.socket.on("disconnect", (reason) => {
    input.stopPresenceHeartbeat();
    input.stopRecoveryWatchdog();
    input.bumpMediaTransportEpoch("socket-reconnect");
    input.hostMediaSyncStateRef.current.lastAppliedKey = null;
    input.hostMediaSyncStateRef.current.pendingKey = null;
    input.setConnectedPeers([]);
    input.setMediaConnectedPeers([]);
    input.setAuthoritativeMediaClock(null);
    input.resetRemoteAudioElement(null);
    input.setMediaConnectionState(
      input.currentRoomRef.current?.room.playback.status === "playing"
        ? input.resolveSocketRecoveryMediaState()
        : "idle"
    );
    input.setRoomRecoveryState((current: any) => ({
      ...current,
      phase:
        input.enableTrackCaching && current.fullLocalRecoveryActive
          ? "playing-local-fallback"
          : "joining",
      mode: current.generation === null ? current.mode : "rejoin",
      pendingSnapshot: true,
      pendingData: input.enableTrackCaching,
      pendingMedia: !(input.enableTrackCaching && current.fullLocalRecoveryActive)
    }));

    if (reason === "io client disconnect") {
      return;
    }
    input.setStatusMessage("实时连接已断开，正在尝试重新连接…");
  });

  return () => {
    input.stopPresenceHeartbeat();
    input.stopRecoveryWatchdog();
    clearSubscribeRetry();
    if (input.remotePlaybackRetryRef.current !== null) {
      window.clearTimeout(input.remotePlaybackRetryRef.current);
      input.remotePlaybackRetryRef.current = null;
    }
    input.clearListenerMediaRecovery();
    input.clearHostMediaSyncRetry();
    input.socket.emit("room.unsubscribe", { roomId: input.roomId });
    input.socket.disconnect();
    input.socketRef.current = null;
    input.resubscribeRoomRef.current = null;
    input.mesh.destroy();
    input.meshRef.current = null;
    input.mediaMesh.destroy();
    input.chunkSchedulerRef.current = null;
    input.mediaMeshRef.current = null;
    input.connectionSupervisorStatesRef.current.clear();
    input.pieceRequestSamplesRef.current.clear();
    input.sourceRecoveryCoordinatorRef.current = {
      actionKey: null,
      action: null,
      startedAtMs: null
    };
    input.hostStreamRef.current = null;
    input.hostMediaSyncStateRef.current = {
      inFlight: false,
      lastAppliedKey: null,
      pendingKey: null,
      lastCaptureRefreshKey: null,
      lastPublishKey: null,
      retryKey: null,
      publishGeneration: 0,
      stage: "idle",
      lastPublishedListenerSet: null
    };
    input.setConnectedPeers([]);
    input.setMediaConnectedPeers([]);
    input.setAuthoritativeMediaClock(null);
    input.setMediaConnectionState("idle");
    input.setRoomRecoveryState((current: any) => ({
      ...current,
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
    }));
  };
}
