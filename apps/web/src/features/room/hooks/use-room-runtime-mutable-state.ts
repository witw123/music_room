"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type {
  AssetAvailabilityAnnouncement,
  AuthSession,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import type { P2PMesh } from "@/features/p2p";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import type { RoomSocket } from "@/lib/ws-client";
import type { UploadedTrack } from "@/features/upload/audio-utils";
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
  manualCacheTrackIds: string[];
  uploadedTracks: Record<string, UploadedTrack>;
  fullLocalPlaybackTracks: FullLocalPlaybackTrackRecord;
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
  resetPlayerSurface: () => void;
  queueAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  queueAssetAvailability: (announcement: AssetAvailabilityAnnouncement) => void;
  clearAvailabilityForPeer: (ownerPeerId: string) => void;
  clearAvailabilityForTrack: (trackId: string, ownerPeerId?: string) => void;
  clearAvailabilityForAsset: (assetId: string, ownerPeerId?: string) => void;
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
  const lastSubscribeAckAtRef = useRef<number | null>(null);
  const recoveryModeRef = useRef<"late-join" | "rejoin" | "steady">("steady");
  const lastRealtimeRoomEventAtRef = useRef<number>(Date.now());
  const lastDataActivityAtRef = useRef<number | null>(null);
  const socketDisconnectGraceTimeoutRef = useRef<number | null>(null);
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
  const queueAssetAvailabilityRef = useRef(input.queueAssetAvailability);
  const clearAvailabilityForPeerRef = useRef(input.clearAvailabilityForPeer);
  const clearAvailabilityForTrackRef = useRef(input.clearAvailabilityForTrack);
  const clearAvailabilityForAssetRef = useRef(input.clearAvailabilityForAsset);
  const flushPendingAvailabilityRef = useRef(input.flushPendingAvailability);
  const recordPeerDiagnosticRef = useRef(input.recordPeerDiagnostic);

  const clearSocketDisconnectGrace = useCallback(() => {
    if (socketDisconnectGraceTimeoutRef.current !== null) {
      window.clearTimeout(socketDisconnectGraceTimeoutRef.current);
      socketDisconnectGraceTimeoutRef.current = null;
    }
    socketDisconnectGraceUntilRef.current = null;
  }, []);

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
    input.uploadedTrackIdsRef.current = input.uploadedTrackIds;
  }, [input.uploadedTrackIds, input.uploadedTrackIdsRef]);

  useEffect(() => {
    manualCacheTrackIdsRef.current = input.manualCacheTrackIds;
  }, [input.manualCacheTrackIds]);

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
    queueAssetAvailabilityRef.current = input.queueAssetAvailability;
  }, [input.queueAssetAvailability]);

  useEffect(() => {
    clearAvailabilityForPeerRef.current = input.clearAvailabilityForPeer;
  }, [input.clearAvailabilityForPeer]);

  useEffect(() => {
    clearAvailabilityForTrackRef.current = input.clearAvailabilityForTrack;
  }, [input.clearAvailabilityForTrack]);

  useEffect(() => {
    clearAvailabilityForAssetRef.current = input.clearAvailabilityForAsset;
  }, [input.clearAvailabilityForAsset]);

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
    deleteUploadedTrackArtifactsRef,
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
  };
}
