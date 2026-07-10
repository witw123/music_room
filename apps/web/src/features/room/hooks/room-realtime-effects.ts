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
import type {
  PlaybackRecoveryRecommendation,
  RoomRecoveryMode
} from "./room-runtime-types";
import {
  resolvePresenceRepairAction,
  resolveRecoveryWatchdogAction,
  resolveRoomRealtimeSnapshotInputs,
  resolveRoomSnapshotWatchdogAction,
  shouldReannounceManualCacheAvailability
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
  enableManualTrackCaching: boolean;
  enableTrackCaching: boolean;
  roomListenerSetHash: string;
  uploadedTrackIds: string[];
  connectedPeers: string[];
  announceRoomTrackAvailabilityRef: MutableRefObject<(
    trackId: string,
    options?: { force?: boolean }
  ) => Promise<boolean>>;
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
  const {
    hasLocalMemberPresence,
    localMemberPeerId,
    localMemberPresenceState,
    snapshotMembersCount,
    snapshotPresenceRevision,
    snapshotRoomId,
    snapshotTrackIds,
    snapshotTrackIdsKey
  } = resolveRoomRealtimeSnapshotInputs({
    roomSnapshot,
    activeSessionId: activeSession?.userId,
    fallbackUploadedTrackIds: uploadedTrackIds
  });
  const presenceIntervalRef = useRef<number | null>(null);
  const snapshotSourcePeerId = roomSnapshot?.room.playback.sourcePeerId ?? null;
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

  useEffect(() => {
    const nextBroadcastKey = shouldReannounceManualCacheAvailability({
      enableManualTrackCaching,
      roomId: snapshotRoomId,
      roomListenerSetHash,
      uploadedTrackIds: snapshotTrackIds,
      sourceReadyTrackIds: uploadedTrackIds,
      lastBroadcastKey: lastManualCacheAvailabilityBroadcastKeyRef.current
    });
    if (!nextBroadcastKey) {
      if (
        !snapshotRoomId ||
        !roomListenerSetHash ||
        snapshotTrackIds.length === 0
      ) {
        lastManualCacheAvailabilityBroadcastKeyRef.current = null;
      }
      return;
    }
    lastManualCacheAvailabilityBroadcastKeyRef.current = nextBroadcastKey;
    for (const trackId of snapshotTrackIds) {
      void announceRoomTrackAvailabilityRef.current(trackId);
    }
  }, [
    announceRoomTrackAvailabilityRef,
    enableManualTrackCaching,
    roomListenerSetHash,
    snapshotRoomId,
    snapshotTrackIds,
    snapshotTrackIdsKey,
    uploadedTrackIds
  ]);

  useEffect(() => {
    if (!snapshotRoomId) {
      stopRecoveryWatchdog();
      return;
    }
    stopRecoveryWatchdog();
    recoveryWatchdogIntervalRef.current = window.setInterval(() => {
      const recoveryAction = resolveRecoveryWatchdogAction({
        snapshotRoomId,
        enableTrackCaching,
        connectedPeersCount: connectedPeers.length,
        snapshotMembersCount,
        playbackConnectionKey: getCurrentPlaybackConnectionKey?.() ?? null,
        sourcePeerId: snapshotSourcePeerId
      });
      if (recoveryAction.recommendation) {
        queuePlaybackRecoveryRecommendation?.(recoveryAction.recommendation);
      }
    }, 5_000);
    return () => stopRecoveryWatchdog();
  }, [
    connectedPeers.length,
    enableTrackCaching,
    getCurrentPlaybackConnectionKey,
    queuePlaybackRecoveryRecommendation,
    snapshotMembersCount,
    snapshotRoomId,
    snapshotSourcePeerId,
    stopRecoveryWatchdog
  ]);

  return {
    emitPresence,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    stopRecoveryWatchdog
  };
}

