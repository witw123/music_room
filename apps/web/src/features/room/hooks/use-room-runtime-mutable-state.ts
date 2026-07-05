"use client";

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AuthSession, RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { P2PMesh } from "@/features/p2p";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import type { RoomSocket } from "@/lib/ws-client";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import type { FullLocalPlaybackTrackRecord, RoomRecoveryState } from "./room-runtime-types";

export function useRoomRuntimeMutableState(input: {
  initialRoomId: string | null;
  roomSnapshot: RoomSnapshot | null;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  activeSession: AuthSession | null;
  activeSessionRef: MutableRefObject<AuthSession | null>;
  socketRef: MutableRefObject<RoomSocket | null>;
  uploadedTrackIds: string[];
  uploadedTrackIdsRef: MutableRefObject<string[]>;
  roomRecoveryState: RoomRecoveryState;
  activePlaybackSource: ProgressivePlaybackSource;
  audioUnlocked: boolean;
  setAudioUnlocked: Dispatch<SetStateAction<boolean>>;
  sourceStartState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed";
  setSourceStartState: Dispatch<SetStateAction<"idle" | "awaiting-unlock" | "starting" | "live" | "failed">>;
  lastSourceStartError: string | null;
  setLastSourceStartError: Dispatch<SetStateAction<string | null>>;
  manualCacheTrackIds: string[];
  uploadedTracks: Record<string, UploadedTrack>;
  fullLocalPlaybackTracks: FullLocalPlaybackTrackRecord;
  announceRoomTrackAvailability: (trackId: string) => Promise<void>;
  handleManualCachePieceReceived: (input: {
    trackId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
  }) => void;
  deleteUploadedTrackArtifacts: (trackId: string) => Promise<void> | void;
  deleteRoomTrackArtifacts: (trackIds: string[]) => Promise<void> | void;
  resetPlayerSurface: () => void;
  queueAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  clearAvailabilityForPeer: (ownerPeerId: string) => void;
  flushPendingAvailability: () => void;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  enableTrackCaching: boolean;
}) {
  const meshRef = useRef<P2PMesh | null>(null);
  const initialRecoveryAttemptRef = useRef<string | null>(null);
  const previousInitialRoomIdRef = useRef<string | null>(input.initialRoomId);
  const activeRouteRoomIdRef = useRef<string | null>(input.initialRoomId);
  const socketDisconnectGraceUntilRef = useRef<number | null>(null);
  const resubscribeRoomRef = useRef<(() => void) | null>(null);
  const recoveryGenerationRef = useRef<number | null>(input.roomRecoveryState.generation);
  const roomRecoveryStateRef = useRef(input.roomRecoveryState);
  const activePlaybackSourceRef = useRef<ProgressivePlaybackSource>(input.activePlaybackSource);
  const lastSubscribeAckAtRef = useRef<number | null>(null);
  const recoveryModeRef = useRef<"late-join" | "rejoin" | "steady">("steady");
  const lastRealtimeRoomEventAtRef = useRef<number>(Date.now());
  const lastDataActivityAtRef = useRef<number | null>(null);
  const socketDisconnectGraceTimeoutRef = useRef<number | null>(null);
  const audioUnlockedRef = useRef(input.audioUnlocked);
  const setAudioUnlockedRef = useRef(input.setAudioUnlocked);
  const sourceStartStateRef = useRef(input.sourceStartState);
  const setSourceStartStateRef = useRef(input.setSourceStartState);
  const lastSourceStartErrorRef = useRef(input.lastSourceStartError);
  const setLastSourceStartErrorRef = useRef(input.setLastSourceStartError);
  const manualCacheTrackIdsRef = useRef(input.manualCacheTrackIds);
  const uploadedTracksRef = useRef(input.uploadedTracks);
  const fullLocalPlaybackTracksRef = useRef<FullLocalPlaybackTrackRecord>(
    input.fullLocalPlaybackTracks
  );
  const announceRoomTrackAvailabilityRef = useRef(input.announceRoomTrackAvailability);
  const handleManualCachePieceReceivedRef = useRef(input.handleManualCachePieceReceived);
  const deleteUploadedTrackArtifactsRef = useRef(input.deleteUploadedTrackArtifacts);
  const deleteRoomTrackArtifactsRef = useRef(input.deleteRoomTrackArtifacts);
  const resetPlayerSurfaceRef = useRef(input.resetPlayerSurface);
  const queueAvailabilityRef = useRef(input.queueAvailability);
  const clearAvailabilityForPeerRef = useRef(input.clearAvailabilityForPeer);
  const flushPendingAvailabilityRef = useRef(input.flushPendingAvailability);
  const recordPeerDiagnosticRef = useRef(input.recordPeerDiagnostic);

  const clearSocketDisconnectGrace = useCallback(() => {
    if (socketDisconnectGraceTimeoutRef.current !== null) {
      window.clearTimeout(socketDisconnectGraceTimeoutRef.current);
      socketDisconnectGraceTimeoutRef.current = null;
    }
    socketDisconnectGraceUntilRef.current = null;
  }, []);

  const updateSourceStartState = useCallback(
    (
      nextState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed",
      options?: { error?: string | null; recordEvent?: boolean; summary?: string; level?: "info" | "warning" | "error" }
    ) => {
      setSourceStartStateRef.current(nextState);
      sourceStartStateRef.current = nextState;
      const nextError = options?.error ?? null;
      setLastSourceStartErrorRef.current(nextError);
      lastSourceStartErrorRef.current = nextError;
      recordPeerDiagnosticRef.current({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: `source-start-${nextState}`,
        summary: options?.summary ?? `本地缓存播放源状态：${nextState}`,
        level: options?.level ?? (nextState === "failed" ? "error" : "info"),
        recordEvent: options?.recordEvent ?? false,
        update: (snapshot) => ({
          ...snapshot,
          lastError: nextState === "failed" && nextError ? `本地播放启动失败：${nextError}` : snapshot.lastError,
          progressivePlaybackStatus: {
            ...(
              snapshot.progressivePlaybackStatus ??
              createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
            ),
            audioUnlocked: audioUnlockedRef.current,
            sourceStartState: nextState,
            lastSourceStartError: nextError,
            hostPublishingReady: nextState === "live"
          }
        })
      });
    },
    []
  );

  useEffect(() => {
    input.activeSessionRef.current = input.activeSession;
  }, [input.activeSession, input.activeSessionRef]);

  useEffect(() => {
    input.currentRoomRef.current = input.roomSnapshot;
  }, [input.roomSnapshot, input.currentRoomRef]);

  useEffect(() => {
    recoveryGenerationRef.current = input.roomRecoveryState.generation;
    recoveryModeRef.current = input.roomRecoveryState.mode;
    roomRecoveryStateRef.current = input.roomRecoveryState;
  }, [input.roomRecoveryState]);

  useEffect(() => {
    activePlaybackSourceRef.current = input.activePlaybackSource;
  }, [input.activePlaybackSource]);

  useEffect(() => {
    input.uploadedTrackIdsRef.current = input.uploadedTrackIds;
  }, [input.uploadedTrackIds, input.uploadedTrackIdsRef]);

  useEffect(() => {
    manualCacheTrackIdsRef.current = input.manualCacheTrackIds;
  }, [input.manualCacheTrackIds]);

  useEffect(() => {
    audioUnlockedRef.current = input.audioUnlocked;
  }, [input.audioUnlocked]);

  useEffect(() => {
    setAudioUnlockedRef.current = input.setAudioUnlocked;
  }, [input.setAudioUnlocked]);

  useEffect(() => {
    sourceStartStateRef.current = input.sourceStartState;
  }, [input.sourceStartState]);

  useEffect(() => {
    setSourceStartStateRef.current = input.setSourceStartState;
  }, [input.setSourceStartState]);

  useEffect(() => {
    lastSourceStartErrorRef.current = input.lastSourceStartError;
  }, [input.lastSourceStartError]);

  useEffect(() => {
    setLastSourceStartErrorRef.current = input.setLastSourceStartError;
  }, [input.setLastSourceStartError]);

  useEffect(() => {
    uploadedTracksRef.current = input.uploadedTracks;
  }, [input.uploadedTracks]);

  useEffect(() => {
    fullLocalPlaybackTracksRef.current = input.fullLocalPlaybackTracks;
  }, [input.fullLocalPlaybackTracks]);

  useEffect(() => {
    announceRoomTrackAvailabilityRef.current = input.announceRoomTrackAvailability;
  }, [input.announceRoomTrackAvailability]);

  useEffect(() => {
    handleManualCachePieceReceivedRef.current = input.handleManualCachePieceReceived;
  }, [input.handleManualCachePieceReceived]);

  useEffect(() => {
    deleteUploadedTrackArtifactsRef.current = input.deleteUploadedTrackArtifacts;
  }, [input.deleteUploadedTrackArtifacts]);

  useEffect(() => {
    deleteRoomTrackArtifactsRef.current = input.deleteRoomTrackArtifacts;
  }, [input.deleteRoomTrackArtifacts]);

  useEffect(() => {
    resetPlayerSurfaceRef.current = input.resetPlayerSurface;
  }, [input.resetPlayerSurface]);

  useEffect(() => {
    queueAvailabilityRef.current = input.queueAvailability;
  }, [input.queueAvailability]);

  useEffect(() => {
    clearAvailabilityForPeerRef.current = input.clearAvailabilityForPeer;
  }, [input.clearAvailabilityForPeer]);

  useEffect(() => {
    flushPendingAvailabilityRef.current = input.flushPendingAvailability;
  }, [input.flushPendingAvailability]);

  useEffect(() => {
    recordPeerDiagnosticRef.current = input.recordPeerDiagnostic;
  }, [input.recordPeerDiagnostic]);

  return {
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
    fullLocalPlaybackTracksRef,
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
  };
}
