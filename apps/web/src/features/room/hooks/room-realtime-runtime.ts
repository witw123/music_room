"use client";

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
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
import { calibrateRoomPlaybackClock } from "@/features/playback/room-playback-clock";
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
import {
  buildRoomSubscribePayload,
  hasSubscribeBootstrapFullLocalTrack,
  shouldAcceptIncomingPeerSignal,
  shouldExitRoomOnSnapshotMissing,
  shouldQueueIncomingAvailability,
  resolveSourceAvailabilityReannounceTrackId,
  shouldResyncSnapshotForPlaybackPatch
} from "./room-realtime-policy";

const subscribeAckTimeoutMs = 4_000;
const subscribeRetryBackoffMs = [200, 500, 1_000, 2_000, 4_000] as const;
const socketDisconnectGraceMs = 6_000;
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
  announceRoomTrackAvailabilityRef: MutableRefObject<(
    trackId: string,
    options?: { force?: boolean }
  ) => Promise<void>>;
  handleManualCachePieceReceivedRef: MutableRefObject<(input: ManualCachePieceReceivedInput) => void>;
  clearManualCachePendingPiece: (trackId: string, chunkIndex: number) => void;
  deferManualCachePendingPiece: (
    trackId: string,
    chunkIndex: number,
    options: { delayMs: number }
  ) => void;
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
  queuePlaybackRecoveryRecommendation?: (recommendation: PlaybackRecoveryRecommendation) => void;
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
    deferManualCachePendingPiece: input.deferManualCachePendingPiece,
    flushPendingAvailabilityRef: input.flushPendingAvailabilityRef,
    recordPeerDiagnosticRef: input.recordPeerDiagnosticRef,
    recordPieceTransferRef: input.recordPieceTransferRef,
    recordPieceRequestSampleRef: input.recordPieceRequestSampleRef,
    updatePeerBufferedAmountRef: input.updatePeerBufferedAmountRef,
    updateDataTransportStatsRef: input.updateDataTransportStatsRef,
    connectionSupervisorStatesRef: input.connectionSupervisorStatesRef,
    updateConnectionSupervisorSignalState: input.updateConnectionSupervisorSignalState,
    updateConnectionSupervisorTransportStats: input.updateConnectionSupervisorTransportStats,
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
    queuePlaybackRecoveryRecommendation: input.queuePlaybackRecoveryRecommendation,
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

    const subscribeStartedAtMs = Date.now();
    socket.emit(
      "room.subscribe",
      buildRoomSubscribePayload({
        roomId: input.roomId,
        peerId: input.peerId,
        sessionId: activeSessionId
      }),
      (ack: RoomSubscribeAckPayload) => {
        const subscribeCompletedAtMs = Date.now();
        calibrateRoomPlaybackClock({
          serverNow: ack.serverNow,
          requestStartedAtMs: subscribeStartedAtMs,
          responseReceivedAtMs: subscribeCompletedAtMs
        });
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
    const currentRoom = input.currentRoomRef.current;
    input.clearSocketDisconnectGrace();
    subscribeToRoom();
    input.flushPendingAvailabilityRef.current();
    for (const trackId of currentRoom?.tracks.map((track) => track.id) ?? input.uploadedTrackIdsRef.current) {
      void input.announceRoomTrackAvailabilityRef.current(trackId);
    }
    input.resyncRealtimePeers();
    if (
      currentRoom &&
      input.activeSessionRef.current?.userId &&
      currentRoom.room.playback.sourceSessionId === input.activeSessionRef.current.userId
    ) {
      const currentTrackId = resolveSourceAvailabilityReannounceTrackId({
        activeSessionId: input.activeSessionRef.current.userId,
        playback: currentRoom.room.playback
      });
      if (currentTrackId) {
        void input.announceRoomTrackAvailabilityRef.current(currentTrackId, { force: true });
      }
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
          const sourceTrackId = resolveSourceAvailabilityReannounceTrackId({
            activeSessionId: input.activeSessionRef.current?.userId,
            playback: nextPlayback
          });
          if (sourceTrackId) {
            void input.announceRoomTrackAvailabilityRef.current(sourceTrackId, { force: true });
          }
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
