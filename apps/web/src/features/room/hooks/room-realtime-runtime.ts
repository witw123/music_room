"use client";

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  AuthSession,
  PeerDiagnosticsSnapshot,
  PeerSignalMessage,
  RoomSubscribeAckPayload,
  RoomSnapshotMissingPayload,
  RoomSnapshot
} from "@music-room/shared";
import { createRoomSocket, type RoomSocket } from "@/lib/ws-client";
import { getWebRTCIceServers, P2PMesh } from "@/features/p2p";
import { createRoomDataMeshRuntime } from "./use-room-data-mesh";
import type { RoomSnapshotResyncReason } from "@/features/room/room-snapshot-resync";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import { calibrateRoomPlaybackClock } from "@/features/playback/room-playback-clock";
import type {
  PlaybackRecoveryRecommendation,
  RoomDataMeshDiagnosticsRefs,
  RoomRecoveryMode,
  RoomRecoveryState
} from "./room-runtime-types";
import {
  buildRoomSubscribePayload,
  createRoomRealtimeEventGate,
  shouldAcceptIncomingPeerSignal,
  shouldExitRoomOnSnapshotMissing,
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

  input.setRoomRecoveryState((current) => ({
    ...current,
    phase: "resyncing",
    mode: nextRecoveryMode,
    generation: input.ack.recoveryGeneration ?? null,
    bootstrapStartedAt: input.ack.serverNow ?? new Date().toISOString(),
    bootstrapSourcePeerId: input.ack.bootstrap?.playback.sourcePeerId ?? null,
    pendingSnapshot: true,
    pendingData: false,
    pendingMedia: false,
    listenerBootstrapAttempts: current.listenerBootstrapAttempts ?? 0,
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
    const linkKind = payload.linkKind ?? "data";
    input.recordPeerDiagnosticRef.current({
      peerId: payload.toPeerId,
      channelKind: linkKind,
      direction: "sent",
      event: payload.type,
      summary: `向 ${payload.toPeerId} 发送 ${linkKind} ${payload.type}`,
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
    const linkKind = payload.linkKind ?? "data";
    input.recordPeerDiagnosticRef.current({
      peerId: payload.fromPeerId,
      channelKind: linkKind,
      direction: "local",
      event: "signal-handle-failed",
      summary: `Failed to apply ${linkKind} ${payload.type} from ${payload.fromPeerId}: ${String(error)}`,
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
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  updatePeerBufferedAmountRef: MutableRefObject<(peerId: string, bufferedAmountBytes: number) => void>;
  setConnectedPeers: Dispatch<SetStateAction<string[]>>;
  isPageVisible: boolean;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  bufferHealth: "healthy" | "low" | "critical";
  queuePlaybackRecoveryRecommendation?: (recommendation: PlaybackRecoveryRecommendation) => void;
  resubscribeRoomRef: MutableRefObject<(() => void) | null>;
  activeSessionRef: MutableRefObject<AuthSession | null>;
  activeRouteRoomIdRef: MutableRefObject<string | null>;
  requestRoomSnapshotResyncRef: MutableRefObject<
    (reason: RoomSnapshotResyncReason, roomId?: string | null) => Promise<void>
  >;
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
  setMediaConnectedPeers: Dispatch<SetStateAction<string[]>>;
  setStatusMessage: (value: string) => void;
  isNavigatingRoomExit: boolean;
  audioUnlocked: boolean;
  emitPresence: () => void;
  startPresenceHeartbeat: () => void;
  exitCurrentRoom: (message: string) => void;
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
    currentRoomRef: input.currentRoomRef,
    recordPeerDiagnosticRef: input.recordPeerDiagnosticRef,
    updatePeerBufferedAmountRef: input.updatePeerBufferedAmountRef,
    updateDataTransportStatsRef: input.updateDataTransportStatsRef,
    updateMediaTransportStatsRef: input.updateMediaTransportStatsRef,
    connectionSupervisorStatesRef: input.connectionSupervisorStatesRef,
    updateConnectionSupervisorSignalState: input.updateConnectionSupervisorSignalState,
    updateConnectionSupervisorTransportStats: input.updateConnectionSupervisorTransportStats,
    withResolvedTransportHealth: input.withResolvedTransportHealth,
    withSupervisorDiagnosticPatch: input.withSupervisorDiagnosticPatch,
    setConnectedPeers: input.setConnectedPeers,
    setMediaConnectedPeers: input.setMediaConnectedPeers,
    isPageVisible: input.isPageVisible,
    playbackStatus: input.playbackStatus,
    currentTrackId: input.currentTrackId,
    bufferHealth: input.bufferHealth,
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
  const realtimeEventGate = createRoomRealtimeEventGate(input.currentRoomRef.current);
  let subscribeRetryId: number | null = null;
  let subscribeAckTimeoutId: number | null = null;
  let subscribeRequestSequence = 0;

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
    const requestSequence = ++subscribeRequestSequence;
    socket.emit(
      "room.subscribe",
      buildRoomSubscribePayload({
        roomId: input.roomId,
        peerId: input.peerId,
        sessionId: activeSessionId
      }),
      (ack: RoomSubscribeAckPayload) => {
        if (requestSequence !== subscribeRequestSequence) {
          return;
        }
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
    input.resyncRealtimePeers();
    void input.requestRoomSnapshotResyncRef.current("socket-connect", input.roomId);
  });

  socket.on("room.snapshot", (snapshot: RoomSnapshot) => {
    if (snapshot.room.id !== input.roomId || input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }

    const currentSnapshot = input.currentRoomRef.current;
    input.dispatchRoomStateEvent({
      type: "server-snapshot",
      snapshot
    });
    if (
      !realtimeEventGate.acceptRoomRevision(
        snapshot.room.roomRevision,
        currentSnapshot
      )
    ) {
      return;
    }
    realtimeEventGate.acceptPlayback(snapshot.room.playback, currentSnapshot);
    const presenceAccepted = realtimeEventGate.acceptPresenceRevision(
      snapshot.room.presenceRevision,
      currentSnapshot,
      true
    );
    input.lastRealtimeRoomEventAtRef.current = Date.now();
    input.setRoomRecoveryState((current: RoomRecoveryState) => ({
      ...current,
      phase: "steady",
      pendingSnapshot: false,
      pendingData: false,
      pendingMedia: false
    }));
    void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
    if (presenceAccepted) {
      input.resyncRealtimePeers(snapshot.room.members);
    }
  });

  socket.on("room.playback.patch", ({ playback }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    const currentSnapshot = input.currentRoomRef.current;
    input.dispatchRoomStateEvent({
      type: "server-playback-patch",
      roomId: input.roomId,
      playback
    });
    if (!currentSnapshot) {
      void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
      return;
    }
    const playbackAcceptance = realtimeEventGate.acceptPlayback(playback, currentSnapshot);
    if (!playbackAcceptance.accepted) {
      return;
    }
    if (
      shouldResyncSnapshotForPlaybackPatch({
        currentSnapshot,
        playback
      })
    ) {
      void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
    }
  });

  socket.on("room.queue.patch", ({ queue, playback, roomRevision }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    const currentSnapshot = input.currentRoomRef.current;
    input.dispatchRoomStateEvent({
      type: "server-queue-patch",
      roomId: input.roomId,
      queue,
      playback,
      roomRevision
    });
    if (!currentSnapshot) {
      void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
      return;
    }
    const topologyAccepted = realtimeEventGate.acceptRoomRevision(
      roomRevision,
      currentSnapshot
    );
    const playbackAcceptance = realtimeEventGate.acceptPlayback(playback, currentSnapshot);
    if (!topologyAccepted && !playbackAcceptance.accepted) {
      return;
    }
    input.lastRealtimeRoomEventAtRef.current = Date.now();
    void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
  });

  socket.on("room.presence.patch", ({ members, playback, presenceRevision, roomRevision }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    const currentSnapshot = input.currentRoomRef.current;
    input.dispatchRoomStateEvent({
      type: "server-presence-patch",
      roomId: input.roomId,
      members,
      playback,
      presenceRevision,
      roomRevision
    });
    if (!currentSnapshot) {
      void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
      return;
    }
    const presenceAccepted = realtimeEventGate.acceptPresenceRevision(
      presenceRevision,
      currentSnapshot
    );
    const playbackAcceptance = realtimeEventGate.acceptPlayback(playback, currentSnapshot);
    if (!presenceAccepted && !playbackAcceptance.accepted) {
      return;
    }
    realtimeEventGate.acceptRoomRevision(roomRevision, currentSnapshot);
    input.lastRealtimeRoomEventAtRef.current = Date.now();
    void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
    if (presenceAccepted) {
      input.resyncRealtimePeers(members);
    }
  });

  socket.on("room.library.patch", ({ tracks, queue, playback, roomRevision }) => {
    if (input.activeRouteRoomIdRef.current !== input.roomId) {
      return;
    }
    const currentSnapshot = input.currentRoomRef.current;
    input.dispatchRoomStateEvent({
      type: "server-library-patch",
      roomId: input.roomId,
      tracks,
      queue,
      playback,
      roomRevision
    });
    if (!currentSnapshot) {
      void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
      return;
    }
    const topologyAccepted = realtimeEventGate.acceptRoomRevision(
      roomRevision,
      currentSnapshot
    );
    const playbackAcceptance = realtimeEventGate.acceptPlayback(playback, currentSnapshot);
    if (!topologyAccepted && !playbackAcceptance.accepted) {
      return;
    }
    input.lastRealtimeRoomEventAtRef.current = Date.now();
    void input.requestRoomSnapshotResyncRef.current("realtime-room-event", input.roomId);
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
        channelKind: payload.linkKind ?? "data",
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
      channelKind: payload.linkKind ?? "data",
      direction: "received",
      event: payload.type,
      summary: `收到 ${payload.fromPeerId} 的 ${payload.linkKind ?? "data"} ${payload.type}`,
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
