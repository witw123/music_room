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
  PeerDiagnosticsSnapshot,
  PeerSignalMessage,
  RoomSubscribeAckPayload,
  RoomSnapshotMissingPayload,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import { createRoomSocket, type RoomSocket } from "@/lib/ws-client";
import { ChunkScheduler, getWebRTCIceServers, P2PMesh } from "@/features/p2p";
import { createRoomDataMeshRuntime } from "./use-room-data-mesh";
import type { RoomSnapshotResyncReason } from "@/features/room/room-snapshot-resync";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import type {
  FullLocalPlaybackTrackRecord,
  ManualCachePieceReceivedInput,
  PieceRequestSampleInput,
  PieceTransferInput,
  PlaybackRecoveryRecommendation,
  RoomDataMeshDiagnosticsRefs,
  RoomRecoveryMode,
  RoomRecoveryState
} from "./room-runtime-types";

const subscribeAckTimeoutMs = 4_000;
const subscribeRetryBackoffMs = [200, 500, 1_000, 2_000, 4_000] as const;
const socketDisconnectGraceMs = 6_000;

export function isSocketDisconnectGraceActive(disconnectGraceUntilMs: number | null, now = Date.now()) {
  return typeof disconnectGraceUntilMs === "number" && disconnectGraceUntilMs > now;
}

export function shouldSuppressPlaybackWatchdogEscalation(input: {
  recoverySuppressedReason: string | null;
  socketDisconnectGraceActive: boolean;
}) {
  return input.recoverySuppressedReason !== null || input.socketDisconnectGraceActive;
}

export function shouldResyncSnapshotForPlaybackPatch(input: {
  currentSnapshot: RoomSnapshot | null | undefined;
  playback: RoomSnapshot["room"]["playback"];
}) {
  const trackId = input.playback.currentTrackId;
  if (!trackId) {
    return false;
  }

  return !input.currentSnapshot?.tracks.some((track) => track.id === trackId);
}

export function shouldQueueIncomingAvailability(input: {
  announcementRoomId: string;
  runtimeRoomId: string;
  activeRouteRoomId: string | null | undefined;
}) {
  return (
    input.announcementRoomId === input.runtimeRoomId &&
    input.activeRouteRoomId === input.runtimeRoomId
  );
}

export function shouldReannounceManualCacheAvailability(input: {
  enableManualTrackCaching: boolean;
  roomId: string | null | undefined;
  roomListenerSetHash: string;
  uploadedTrackIds: string[];
  lastBroadcastKey: string | null;
}) {
  if (!input.roomId || !input.roomListenerSetHash) {
    return null;
  }

  const sortedTrackIds = [...input.uploadedTrackIds].filter(Boolean).sort();
  if (sortedTrackIds.length === 0) {
    return null;
  }

  const nextKey = [input.roomId, input.roomListenerSetHash, sortedTrackIds.join(",")].join("|");
  return nextKey === input.lastBroadcastKey ? null : nextKey;
}

export function shouldAcceptIncomingPeerSignal(input: {
  payload: PeerSignalMessage;
}) {
  return input.payload.channelKind === "data";
}

export function buildRoomSubscribePayload(input: {
  roomId: string;
  peerId: string;
  sessionId: string;
}) {
  return {
    roomId: input.roomId,
    sessionId: input.sessionId,
    peerId: input.peerId
  };
}

export function hasSubscribeBootstrapFullLocalTrack(input: {
  enableTrackCaching: boolean;
  currentTrackId: string | null | undefined;
  uploadedTracks: Record<string, unknown>;
  fullLocalPlaybackTracks: Record<string, unknown>;
}) {
  return !!(
    input.enableTrackCaching &&
    input.currentTrackId &&
    (input.uploadedTracks[input.currentTrackId] ||
      input.fullLocalPlaybackTracks[input.currentTrackId])
  );
}

export function shouldExitRoomOnSnapshotMissing(input: {
  currentRoomId: string;
  missingRoomId?: string | null;
}) {
  return !input.missingRoomId || input.missingRoomId === input.currentRoomId;
}

function applyRoomSubscribeBootstrap(input: {
  ack: RoomSubscribeAckPayload;
  activeRouteRoomIdRef: MutableRefObject<string | null>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  lastSubscribeAckAtRef: MutableRefObject<number | null>;
  recoveryGenerationRef: MutableRefObject<number | null>;
  recoveryModeRef: MutableRefObject<RoomRecoveryMode>;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  uploadedTracks: Record<string, unknown>;
  fullLocalPlaybackTracks: Record<string, unknown>;
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
  const hasFullLocalTrack = hasSubscribeBootstrapFullLocalTrack({
    enableTrackCaching: input.enableTrackCaching,
    currentTrackId,
    uploadedTracks: input.uploadedTracks,
    fullLocalPlaybackTracks: input.fullLocalPlaybackTracks
  });
  input.setRoomRecoveryState((current) => ({
    ...current,
    phase: hasFullLocalTrack && input.audioUnlocked ? "playing-local-fallback" : "resyncing",
    mode: nextRecoveryMode,
    generation: input.ack.recoveryGeneration ?? null,
    bootstrapStartedAt: input.ack.serverNow ?? new Date().toISOString(),
    bootstrapSourcePeerId: input.ack.bootstrap?.playback.sourcePeerId ?? null,
    pendingSnapshot: true,
    pendingData: input.enableTrackCaching && !hasFullLocalTrack,
    pendingMedia: false,
    listenerBootstrapAttempts: current.listenerBootstrapAttempts ?? 0,
    fullLocalRecoveryActive: hasFullLocalTrack
  }));

  return true;
}

export function createRoomSocketRuntime(input: {
  socketRef: MutableRefObject<RoomSocket | null>;
  recordPeerDiagnosticRef: RoomDataMeshDiagnosticsRefs["recordPeerDiagnosticRef"];
}) {
  const socket = createRoomSocket();
  input.socketRef.current = socket;

  const emitPeerSignal = (payload: PeerSignalMessage) => {
    input.recordPeerDiagnosticRef.current({
      peerId: payload.toPeerId,
      channelKind: payload.channelKind,
      direction: "sent",
      event: payload.type,
      summary: `向 ${payload.toPeerId} 发送 ${payload.channelKind} ${payload.type}`,
      update: (snapshot: PeerDiagnosticsSnapshot) => ({
        ...snapshot,
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
    input.recordPeerDiagnosticRef.current({
      peerId: payload.fromPeerId,
      channelKind: payload.channelKind,
      direction: "local",
      event: "signal-handle-failed",
      summary: `Failed to apply ${payload.channelKind} ${payload.type} from ${payload.fromPeerId}: ${String(error)}`,
      level: "error"
    });
  };

  return {
    socket,
    emitPeerSignal,
    handleSignalFailure
  };
}

type RoomRealtimeRuntimeInput = {
  roomId: string;
  peerId: string;
  iceConfig: Parameters<typeof getWebRTCIceServers>[0];
  socketRef: MutableRefObject<RoomSocket | null>;
  meshRef: MutableRefObject<P2PMesh | null>;
  chunkSchedulerRef: MutableRefObject<ChunkScheduler | null>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  uploadedTracksRef: MutableRefObject<Record<string, UploadedTrack>>;
  fullLocalPlaybackTracksRef: MutableRefObject<FullLocalPlaybackTrackRecord>;
  uploadedTrackIdsRef: MutableRefObject<string[]>;
  manualCacheTrackIdsRef: MutableRefObject<string[]>;
  announceRoomTrackAvailabilityRef: MutableRefObject<(trackId: string) => Promise<void>>;
  handleManualCachePieceReceivedRef: MutableRefObject<(input: ManualCachePieceReceivedInput) => void>;
  clearManualCachePendingPiece: (trackId: string, chunkIndex: number) => void;
  flushPendingAvailabilityRef: MutableRefObject<() => void>;
  recordPieceTransferRef: MutableRefObject<(input: PieceTransferInput) => void>;
  recordPieceRequestSampleRef: MutableRefObject<(input: PieceRequestSampleInput) => void>;
  updatePeerBufferedAmountRef: MutableRefObject<(peerId: string, bufferedAmountBytes: number) => void>;
  setConnectedPeers: Dispatch<SetStateAction<string[]>>;
  isPageVisible: boolean;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  bufferHealth: "healthy" | "low" | "critical";
  enableManualTrackCaching: boolean;
  enableTrackCaching: boolean;
  resubscribeRoomRef: MutableRefObject<(() => void) | null>;
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
  recoveryModeRef: MutableRefObject<RoomRecoveryMode>;
  socketDisconnectGraceUntilRef: MutableRefObject<number | null>;
  socketDisconnectGraceTimeoutRef: MutableRefObject<number | null>;
  stopPresenceHeartbeat: () => void;
  stopRecoveryWatchdog: () => void;
  clearSocketDisconnectGrace: () => void;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setStatusMessage: (value: string) => void;
  isNavigatingRoomExit: boolean;
  audioUnlocked: boolean;
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
} & RoomDataMeshDiagnosticsRefs;

type RoomSocketHandlersInput = RoomRealtimeRuntimeInput & {
  socket: RoomSocket;
  mesh: P2PMesh;
  resyncRealtimePeers: (members?: Array<{ peerId: string | null }>) => void;
  handleSignalFailure: (payload: PeerSignalMessage, error: unknown) => void;
};

export function createRoomRealtimeRuntime(input: RoomRealtimeRuntimeInput) {
  const iceServers = getWebRTCIceServers(input.iceConfig);
  const { socket, emitPeerSignal, handleSignalFailure } = createRoomSocketRuntime({
    socketRef: input.socketRef,
    recordPeerDiagnosticRef: input.recordPeerDiagnosticRef
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
      input.recordPeerDiagnosticRef.current({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "mesh-resync-failed",
        summary: `Failed to resync data peers: ${String(error)}`,
        level: "error"
      });
    }
  });

  return attachRoomSocketHandlers({
    ...input,
    socket,
    mesh,
    resyncRealtimePeers,
    handleSignalFailure
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
  announceRoomTrackAvailabilityRef: MutableRefObject<(trackId: string) => Promise<void>>;
  lastRealtimeRoomEventAtRef: MutableRefObject<number>;
  lastSubscribeAckAtRef: MutableRefObject<number | null>;
  recoveryGenerationRef: MutableRefObject<number | null>;
  recoveryModeRef: MutableRefObject<RoomRecoveryMode>;
  resubscribeRoomRef: MutableRefObject<(() => void) | null>;
  meshRef: MutableRefObject<{ restartPeer: (peerId: string) => Promise<unknown> } | null>;
  socketDisconnectGraceUntilRef: MutableRefObject<number | null>;
  requestRoomSnapshotResync: (
    reason: RoomSnapshotResyncReason,
    roomId?: string | null
  ) => Promise<void>;
  getCurrentPlaybackConnectionKey?: () => string | null;
  queuePlaybackRecoveryRecommendation?: (recommendation: PlaybackRecoveryRecommendation) => void;
}) {
  const {
    activeRouteRoomIdRef,
    activeSession,
    activeSessionRef,
    announceRoomTrackAvailabilityRef,
    connectedPeers,
    currentRoomRef,
    enableManualTrackCaching,
    enableTrackCaching,
    getCurrentPlaybackConnectionKey,
    hydrated,
    initialRoomId,
    isNavigatingRoomExit,
    lastRealtimeRoomEventAtRef,
    peerId,
    queuePlaybackRecoveryRecommendation,
    requestRoomSnapshotResync,
    roomListenerSetHash,
    roomSnapshot,
    socketRef,
    uploadedTrackIds
  } = input;
  const presenceIntervalRef = useRef<number | null>(null);
  const roomSnapshotWatchdogIntervalRef = useRef<number | null>(null);
  const recoveryWatchdogIntervalRef = useRef<number | null>(null);
  const presenceRepairKeyRef = useRef<string | null>(null);
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
    const currentSession = activeSessionRef.current;
    const currentRoomId = currentRoomRef.current?.room.id;
    if (!currentRoomId || !currentSession?.userId || !peerId) {
      return;
    }

    socketRef.current?.emit("room.presence", {
      roomId: currentRoomId,
      sessionId: currentSession.userId,
      peerId
    });
  }, [activeSessionRef, currentRoomRef, peerId, socketRef]);

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
      !roomSnapshot?.room.id ||
      !hydrated ||
      !activeSession?.userId ||
      isNavigatingRoomExit ||
      roomSnapshot.room.members.length <= 1
    ) {
      stopRoomSnapshotWatchdog();
      return;
    }

    lastRealtimeRoomEventAtRef.current = Date.now();
    stopRoomSnapshotWatchdog();
    roomSnapshotWatchdogIntervalRef.current = window.setInterval(() => {
      const activeRoomId = activeRouteRoomIdRef.current;
      const socket = socketRef.current;
      if (!activeRoomId || activeRoomId !== roomSnapshot?.room.id || !socket?.connected) {
        return;
      }
      if (Date.now() - lastRealtimeRoomEventAtRef.current < 8_000) {
        return;
      }
      lastRealtimeRoomEventAtRef.current = Date.now();
      void requestRoomSnapshotResync("stale-watchdog", roomSnapshot.room.id);
    }, 4_000);

    return () => stopRoomSnapshotWatchdog();
  }, [
    activeRouteRoomIdRef,
    activeSession?.userId,
    hydrated,
    isNavigatingRoomExit,
    lastRealtimeRoomEventAtRef,
    requestRoomSnapshotResync,
    roomSnapshot,
    socketRef,
    stopRoomSnapshotWatchdog
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !activeSession?.userId || !peerId) {
      presenceRepairKeyRef.current = null;
      return;
    }
    const localMember =
      roomSnapshot.room.members.find((member) => member.id === activeSession?.userId) ??
      null;
    if (!localMember) {
      presenceRepairKeyRef.current = null;
      return;
    }
    if (localMember.presenceState === "online" && localMember.peerId === peerId) {
      presenceRepairKeyRef.current = null;
      return;
    }
    const repairKey = [
      roomSnapshot.room.id,
      roomSnapshot.room.presenceRevision,
      localMember.peerId ?? "none",
      localMember.presenceState,
      peerId
    ].join("|");
    if (presenceRepairKeyRef.current === repairKey) {
      return;
    }
    presenceRepairKeyRef.current = repairKey;
    if (!socketRef.current?.connected) {
      return;
    }
    startPresenceHeartbeat();
    emitPresence();
    void requestRoomSnapshotResync("subscribe-ack", roomSnapshot.room.id);
  }, [
    emitPresence,
    activeSession?.userId,
    peerId,
    requestRoomSnapshotResync,
    roomSnapshot,
    socketRef,
    startPresenceHeartbeat
  ]);

  useEffect(() => {
    if (
      !initialRoomId ||
      !hydrated ||
      !activeSession?.userId ||
      isNavigatingRoomExit ||
      roomSnapshot?.room.id !== initialRoomId
    ) {
      if (!initialRoomId || roomSnapshot?.room.id !== initialRoomId) {
        initialRoomSnapshotResyncKeyRef.current = null;
      }
      return;
    }
    const resyncKey = `${activeSession.userId}:${initialRoomId}`;
    if (initialRoomSnapshotResyncKeyRef.current === resyncKey) {
      return;
    }
    initialRoomSnapshotResyncKeyRef.current = resyncKey;
    void requestRoomSnapshotResync("subscribe-ack", initialRoomId);
  }, [
    activeSession?.userId,
    hydrated,
    initialRoomId,
    isNavigatingRoomExit,
    requestRoomSnapshotResync,
    roomSnapshot?.room.id
  ]);

  useEffect(() => {
    const nextBroadcastKey = shouldReannounceManualCacheAvailability({
      enableManualTrackCaching,
      roomId: roomSnapshot?.room.id,
      roomListenerSetHash,
      uploadedTrackIds: roomSnapshot?.tracks.map((track) => track.id) ?? uploadedTrackIds,
      lastBroadcastKey: lastManualCacheAvailabilityBroadcastKeyRef.current
    });
    if (!nextBroadcastKey) {
      if (
        !roomSnapshot?.room.id ||
        !roomListenerSetHash ||
        (roomSnapshot?.tracks.length ?? uploadedTrackIds.length) === 0
      ) {
        lastManualCacheAvailabilityBroadcastKeyRef.current = null;
      }
      return;
    }
    lastManualCacheAvailabilityBroadcastKeyRef.current = nextBroadcastKey;
    for (const trackId of roomSnapshot?.tracks.map((track) => track.id) ?? uploadedTrackIds) {
      void announceRoomTrackAvailabilityRef.current(trackId);
    }
  }, [
    announceRoomTrackAvailabilityRef,
    enableManualTrackCaching,
    roomListenerSetHash,
    roomSnapshot?.room.id,
    roomSnapshot?.tracks,
    uploadedTrackIds
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id) {
      stopRecoveryWatchdog();
      return;
    }
    stopRecoveryWatchdog();
    recoveryWatchdogIntervalRef.current = window.setInterval(() => {
      if (!roomSnapshot?.room.id || !enableTrackCaching) {
        return;
      }
      if (connectedPeers.length === 0 && roomSnapshot.room.members.length > 1) {
        queuePlaybackRecoveryRecommendation?.({
          playbackConnectionKey: getCurrentPlaybackConnectionKey?.() ?? null,
          peerId: null,
          scope: "data",
          level: "soft",
          reason: "watchdog-data-stalled",
          observedNoProgressMs: null
        });
      }
    }, 5_000);
    return () => stopRecoveryWatchdog();
  }, [
    connectedPeers.length,
    enableTrackCaching,
    getCurrentPlaybackConnectionKey,
    queuePlaybackRecoveryRecommendation,
    roomSnapshot,
    stopRecoveryWatchdog
  ]);

  return {
    emitPresence,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    stopRecoveryWatchdog
  };
}

function attachRoomSocketHandlers(input: RoomSocketHandlersInput) {
  const socket = input.socket;
  let subscribeRetryId: number | null = null;
  let subscribeAckTimeoutId: number | null = null;

  const clearSubscribeTimers = () => {
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
    const delayMs =
      subscribeRetryBackoffMs[Math.min(attempt, subscribeRetryBackoffMs.length - 1)] ??
      subscribeRetryBackoffMs[subscribeRetryBackoffMs.length - 1];
    subscribeRetryId = window.setTimeout(() => {
      subscribeRetryId = null;
      subscribeToRoom(attempt);
    }, delayMs);
  };

  const subscribeToRoom = (attempt = 0) => {
    const activeSessionId = input.activeSessionRef.current?.userId;
    if (!activeSessionId || input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }

    if (subscribeAckTimeoutId !== null) {
      window.clearTimeout(subscribeAckTimeoutId);
    }
    subscribeAckTimeoutId = window.setTimeout(() => {
      subscribeAckTimeoutId = null;
      scheduleSubscribeRetry(attempt + 1);
    }, subscribeAckTimeoutMs);

    socket.emit(
      "room.subscribe",
      buildRoomSubscribePayload({
        roomId: input.roomId,
        peerId: input.peerId,
        sessionId: activeSessionId
      }),
      (ack: RoomSubscribeAckPayload) => {
        if (subscribeAckTimeoutId !== null) {
          window.clearTimeout(subscribeAckTimeoutId);
          subscribeAckTimeoutId = null;
        }

        if (!ack.ok) {
          scheduleSubscribeRetry(attempt + 1);
          return;
        }

        applyRoomSubscribeBootstrap({
          ack,
          activeRouteRoomIdRef: input.activeRouteRoomIdRef,
          currentRoomRef: input.currentRoomRef,
          lastSubscribeAckAtRef: input.lastSubscribeAckAtRef,
          recoveryGenerationRef: input.recoveryGenerationRef,
          recoveryModeRef: input.recoveryModeRef,
          dispatchRoomStateEvent: input.dispatchRoomStateEvent,
          setRoomRecoveryState: input.setRoomRecoveryState,
          uploadedTracks: input.uploadedTracksRef.current,
          fullLocalPlaybackTracks: input.fullLocalPlaybackTracksRef.current,
          enableTrackCaching: input.enableTrackCaching,
          audioUnlocked: input.audioUnlocked
        });
      }
    );
  };

  input.resubscribeRoomRef.current = () => {
    clearSubscribeTimers();
    subscribeToRoom();
    void input.requestRoomSnapshotResyncRef.current("subscribe-ack", input.roomId);
  };

  socket.on("connect", () => {
    input.clearSocketDisconnectGrace();
    subscribeToRoom();
    input.flushPendingAvailabilityRef.current();
    for (const trackId of input.currentRoomRef.current?.tracks.map((track) => track.id) ?? input.uploadedTrackIdsRef.current) {
      void input.announceRoomTrackAvailabilityRef.current(trackId);
    }
    input.resyncRealtimePeers();
    if (
      input.currentRoomRef.current?.room.playback.sourceSessionId ===
      input.activeSessionRef.current?.userId
    ) {
      void input.ensureSourcePlaybackStartedRef.current();
    }
    void input.requestRoomSnapshotResyncRef.current("socket-connect", input.roomId);
  });

  const applyPlaybackKick = (previousPlayback: RoomSnapshot["room"]["playback"] | null | undefined, nextPlayback: RoomSnapshot["room"]["playback"]) => {
    const shouldKick = input.shouldKickSourcePlaybackFromRealtimeEvent({
      previousPlayback,
      nextPlayback,
      activeSessionId: input.activeSessionRef.current?.userId
    });
    if (shouldKick) {
      window.setTimeout(() => {
        if (input.activeRouteRoomIdRef.current === input.roomId) {
          void input.ensureSourcePlaybackStartedRef.current();
        }
      }, 0);
    }
  };

  socket.on("room.snapshot", (snapshot: RoomSnapshot) => {
    if (snapshot.room.id !== input.roomId || input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }

    const previousPlayback = input.currentRoomRef.current?.room.playback;
    input.lastRealtimeRoomEventAtRef.current = Date.now();
    input.dispatchRoomStateEvent({
      type: "server-snapshot",
      snapshot
    });
    input.setRoomRecoveryState((current: RoomRecoveryState) => ({
      ...current,
      phase: current.fullLocalRecoveryActive ? "playing-local-fallback" : "resyncing",
      pendingSnapshot: false,
      pendingMedia: false
    }));
    void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
    input.flushPendingAvailabilityRef.current();
    input.resyncRealtimePeers(snapshot.room.members);
    applyPlaybackKick(previousPlayback, snapshot.room.playback);
  });

  socket.on("room.playback.patch", ({ playback }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    const previousPlayback = input.currentRoomRef.current?.room.playback;
    input.dispatchRoomStateEvent({
      type: "server-playback-patch",
      roomId: input.roomId,
      playback
    });
    if (
      shouldResyncSnapshotForPlaybackPatch({
        currentSnapshot: input.currentRoomRef.current,
        playback
      })
    ) {
      void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
    }
    applyPlaybackKick(previousPlayback, playback);
  });

  socket.on("room.queue.patch", ({ queue, playback, roomRevision }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    const previousPlayback = input.currentRoomRef.current?.room.playback;
    input.lastRealtimeRoomEventAtRef.current = Date.now();
    input.dispatchRoomStateEvent({
      type: "server-queue-patch",
      roomId: input.roomId,
      queue,
      playback,
      roomRevision
    });
    void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
    applyPlaybackKick(previousPlayback, playback);
  });

  socket.on("room.presence.patch", ({ members, playback, presenceRevision, roomRevision }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    const previousPlayback = input.currentRoomRef.current?.room.playback;
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
    applyPlaybackKick(previousPlayback, playback);
  });

  socket.on("room.library.patch", ({ tracks, queue, playback, roomRevision }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    const previousPlayback = input.currentRoomRef.current?.room.playback;
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
    applyPlaybackKick(previousPlayback, playback);
  });

  socket.on("peer.signal", (payload) => {
    if (payload.roomId !== input.roomId || input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    if (!shouldAcceptIncomingPeerSignal({ payload })) {
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

    input.recordPeerDiagnosticRef.current({
      peerId: payload.fromPeerId,
      channelKind: payload.channelKind,
      direction: "received",
      event: payload.type,
      summary: `收到 ${payload.fromPeerId} 的 ${payload.channelKind} ${payload.type}`,
      update: (snapshot: PeerDiagnosticsSnapshot) => ({
        ...snapshot,
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
    if (!input.mesh) {
      return;
    }
    void input.mesh.handleSignal(payload).catch((error: unknown) => {
      input.handleSignalFailure(payload, error);
    });
  });

  socket.on("piece.availability", (announcement: TrackAvailabilityAnnouncement) => {
    if (!shouldQueueIncomingAvailability({
      announcementRoomId: announcement.roomId,
      runtimeRoomId: input.roomId,
      activeRouteRoomId: input.activeRouteRoomIdRef.current
    })) {
      return;
    }
    input.queueAvailabilityRef.current(announcement);
  });

  socket.on("piece.availability.clear", ({ roomId, ownerPeerId }) => {
    if (roomId !== input.roomId || input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    input.clearAvailabilityForPeerRef.current(ownerPeerId);
  });

  socket.on("room.session.replaced", ({ roomId }) => {
    if (roomId === input.roomId) {
      input.exitCurrentRoom("当前账号已在其他窗口加入此房间。");
    }
  });

  socket.on("room.deleted", ({ roomId, trackIds }) => {
    if (roomId !== input.roomId) {
      return;
    }
    void input.deleteRoomTrackArtifactsRef.current(trackIds);
    input.exitCurrentRoom("这个房间已被删除。");
  });

  socket.on("room.snapshot.missing", (payload?: RoomSnapshotMissingPayload) => {
    if (
      shouldExitRoomOnSnapshotMissing({
        currentRoomId: input.roomId,
        missingRoomId: payload?.roomId
      })
    ) {
      input.exitCurrentRoom("这个房间已不可用，请重新创建或加入房间。");
      return;
    }

    void input.requestRoomSnapshotResyncRef.current("subscribe-ack", input.roomId);
  });

  socket.on("disconnect", () => {
    input.socketDisconnectGraceUntilRef.current = Date.now() + socketDisconnectGraceMs;
    if (input.socketDisconnectGraceTimeoutRef.current !== null) {
      window.clearTimeout(input.socketDisconnectGraceTimeoutRef.current);
    }
    input.socketDisconnectGraceTimeoutRef.current = window.setTimeout(() => {
      input.socketDisconnectGraceUntilRef.current = null;
      input.socketDisconnectGraceTimeoutRef.current = null;
    }, socketDisconnectGraceMs);
  });

  subscribeToRoom();

  return () => {
    clearSubscribeTimers();
    input.stopPresenceHeartbeat();
    input.stopRecoveryWatchdog();
    input.resubscribeRoomRef.current = null;
    socket.emit("room.unsubscribe", { roomId: input.roomId });
    socket.removeAllListeners();
    input.mesh.destroy();
    input.meshRef.current = null;
    input.socketRef.current = null;
    socket.disconnect();
  };
}
