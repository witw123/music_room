"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject
} from "react";
import type { AuthSession, RoomSnapshot } from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import type { RoomSnapshotResyncReason } from "@/features/room/room-snapshot-resync";
import type { RoomRecoveryMode } from "./room-runtime-types";
import {
  resolvePresenceRepairAction,
  resolveRoomRealtimeSnapshotInputs,
  resolveRoomSnapshotWatchdogAction
} from "./room-realtime-policy";
export function useRoomRealtimeConnectionEffects(input: {
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
  uploadedTrackIds: string[];
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
}) {
  const {
    activeRouteRoomIdRef,
    activeSession,
    activeSessionRef,
    currentRoomRef,
    hydrated,
    initialRoomId,
    isNavigatingRoomExit,
    lastRealtimeRoomEventAtRef,
    peerId,
    requestRoomSnapshotResync,
    roomSnapshot,
    socketRef,
    uploadedTrackIds
  } = input;
  const {
    hasLocalMemberPresence,
    localMemberPeerId,
    localMemberPresenceState,
    snapshotMembersCount,
    snapshotPresenceRevision,
    snapshotRoomId
  } = resolveRoomRealtimeSnapshotInputs({
    roomSnapshot,
    activeSessionId: activeSession?.userId,
    fallbackUploadedTrackIds: uploadedTrackIds
  });
  const presenceIntervalRef = useRef<number | null>(null);
  const roomSnapshotWatchdogIntervalRef = useRef<number | null>(null);
  const presenceRepairKeyRef = useRef<string | null>(null);
  const initialRoomSnapshotResyncKeyRef = useRef<string | null>(null);

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

  const stopRecoveryWatchdog = useCallback(() => undefined, []);

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
      !snapshotRoomId ||
      !hydrated ||
      !activeSession?.userId ||
      isNavigatingRoomExit ||
      snapshotMembersCount <= 1
    ) {
      stopRoomSnapshotWatchdog();
      return;
    }

    lastRealtimeRoomEventAtRef.current = Date.now();
    stopRoomSnapshotWatchdog();
    roomSnapshotWatchdogIntervalRef.current = window.setInterval(() => {
      const activeRoomId = activeRouteRoomIdRef.current;
      const socket = socketRef.current;
      const watchdogAction = resolveRoomSnapshotWatchdogAction({
        activeRouteRoomId: activeRoomId,
        socketConnected: !!socket?.connected,
        snapshotRoomId,
        lastRealtimeRoomEventAtMs: lastRealtimeRoomEventAtRef.current,
        nowMs: Date.now(),
        staleAfterMs: 8_000
      });
      lastRealtimeRoomEventAtRef.current = watchdogAction.nextLastRealtimeRoomEventAtMs;
      if (watchdogAction.shouldRequestResync) {
        void requestRoomSnapshotResync("stale-watchdog", watchdogAction.resyncRoomId);
      }
    }, 4_000);

    return () => stopRoomSnapshotWatchdog();
  }, [
    activeRouteRoomIdRef,
    activeSession?.userId,
    hydrated,
    isNavigatingRoomExit,
    lastRealtimeRoomEventAtRef,
    requestRoomSnapshotResync,
    snapshotMembersCount,
    snapshotRoomId,
    socketRef,
    stopRoomSnapshotWatchdog
  ]);

  useEffect(() => {
    const presenceRepairAction = resolvePresenceRepairAction({
      snapshotRoomId,
      activeSessionId: activeSession?.userId,
      peerId,
      hasLocalMemberPresence,
      localMemberPeerId,
      localMemberPresenceState,
      snapshotPresenceRevision,
      previousRepairKey: presenceRepairKeyRef.current,
      socketConnected: !!socketRef.current?.connected
    });
    presenceRepairKeyRef.current = presenceRepairAction.nextRepairKey;
    if (!presenceRepairAction.shouldStartHeartbeat) {
      return;
    }
    if (presenceRepairAction.shouldStartHeartbeat) {
      startPresenceHeartbeat();
    }
    if (presenceRepairAction.shouldEmitPresence) {
      emitPresence();
    }
    if (presenceRepairAction.shouldRequestResync && snapshotRoomId) {
      void requestRoomSnapshotResync("subscribe-ack", snapshotRoomId);
    }
  }, [
    emitPresence,
    activeSession?.userId,
    hasLocalMemberPresence,
    localMemberPeerId,
    localMemberPresenceState,
    peerId,
    requestRoomSnapshotResync,
    snapshotPresenceRevision,
    snapshotRoomId,
    socketRef,
    startPresenceHeartbeat
  ]);

  useEffect(() => {
    if (
      !initialRoomId ||
      !hydrated ||
      !activeSession?.userId ||
      isNavigatingRoomExit ||
      snapshotRoomId !== initialRoomId
    ) {
      if (!initialRoomId || snapshotRoomId !== initialRoomId) {
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
    snapshotRoomId
  ]);

  return {
    emitPresence,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    stopRecoveryWatchdog
  };
}

