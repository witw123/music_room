"use client";

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PeerDiagnosticsSnapshot, RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import {
  getHostMediaStreamTrackState
} from "@/features/playback/host-media-sync";
import {
  createSilentPrewarmHandle,
  type SilentPrewarmHandle
} from "@/features/playback/silent-prewarm-stream";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import type { PlaybackConnectionKey } from "./room-runtime-types";
import type {
  HostPublishReadiness,
  HostPublishSourceTarget,
  HostPublishTrackKind,
  ResolvedPublishElement,
  ResolvedPublishStreamKind
} from "@/features/room/host-relay-audio";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import type { AuthSession } from "@music-room/shared";
import type { RoomSocket } from "@/lib/ws-client";
import type { P2PMesh, RoomMediaMesh } from "@/features/p2p";

export type HostPublishStage = "idle" | "waiting-source-audio" | "capture-ready" | "published";
type MediaTransportState = "idle" | "prewarming" | "connected" | "publishing" | "failed";
type HostPublishedTrackKind = HostPublishTrackKind | "none";

export type HostMediaSyncState = {
  inFlight: boolean;
  lastAppliedKey: string | null;
  pendingKey: string | null;
  lastCaptureRefreshKey: string | null;
  lastPublishKey: string | null;
  retryKey: string | null;
  publishGeneration: number;
  stage: HostPublishStage;
  lastPublishedListenerSet: string | null;
};

export type ListenerMediaLifecycleState = {
  traceKey: string | null;
  sourcePeerId: string | null;
  lastTrackTraceKey: string | null;
  lastBoundTraceKey: string | null;
  lastPlayAttemptTraceKey: string | null;
  lastPlayAttemptResult: "ok" | "rejected" | null;
  lastPlayAttemptError: string | null;
  lastPlayingTraceKey: string | null;
  lastSoftRecoveryTraceKey: string | null;
  lastSoftRecoveryAt: number | null;
  lastHardRecoveryTraceKey: string | null;
  lastHardRecoveryAt: number | null;
  latestStream: MediaStream | null;
  currentGeneration: PlaybackConnectionKey | null;
  generationStartedAt: number | null;
  boundGeneration: PlaybackConnectionKey | null;
  playingGeneration: PlaybackConnectionKey | null;
  lastPlayoutProgressAt: number | null;
  lastTransportProgressAt: number | null;
  lastObservedRemoteCurrentTimeMs: number | null;
  recoveryStage: "idle" | "waiting-track" | "rebind-element" | "retry-play" | "rebind-and-play";
  restartAttempt: number;
  bindAttempts: number;
  playAttempts: number;
};

export function useRoomRuntimeMutableState(input: {
  initialRoomId: string | null;
  roomSnapshot: RoomSnapshot | null;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  activeSession: AuthSession | null;
  activeSessionRef: MutableRefObject<AuthSession | null>;
  socketRef: MutableRefObject<RoomSocket | null>;
  uploadedTrackIds: string[];
  uploadedTrackIdsRef: MutableRefObject<string[]>;
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
  activePlaybackSource: ProgressivePlaybackSource;
  audioUnlocked: boolean;
  setAudioUnlocked: Dispatch<SetStateAction<boolean>>;
  sourceStartState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed";
  setSourceStartState: Dispatch<SetStateAction<"idle" | "awaiting-unlock" | "starting" | "live" | "failed">>;
  lastSourceStartError: string | null;
  setLastSourceStartError: Dispatch<SetStateAction<string | null>>;
  manualCacheTrackIds: string[];
  uploadedTracks: Record<string, UploadedTrack>;
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
  setAuthoritativeMediaClock: Dispatch<SetStateAction<any>>;
  enableTrackCaching: boolean;
}) {
  const meshRef = useRef<P2PMesh | null>(null);
  const mediaMeshRef = useRef<RoomMediaMesh | null>(null);
  const initialRecoveryAttemptRef = useRef<string | null>(null);
  const previousInitialRoomIdRef = useRef<string | null>(input.initialRoomId);
  const activeRouteRoomIdRef = useRef<string | null>(input.initialRoomId);
  const hostStreamRef = useRef<MediaStream | null>(null);
  const silentPrewarmHandleRef = useRef<SilentPrewarmHandle | null>(null);
  const mediaTransportEpochRef = useRef(0);
  const transportResetReasonRef = useRef<"source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none">(
    "none"
  );
  const hostMediaSyncRetryRef = useRef<number | null>(null);
  const lastHostCaptureRefreshAtRef = useRef<number>(0);
  const remotePlaybackRetryRef = useRef<number | null>(null);
  const remotePlaybackResumeAfterUnlockKeyRef = useRef<string | null>(null);
  const remoteStreamClearTimeoutRef = useRef<number | null>(null);
  const socketDisconnectGraceUntilRef = useRef<number | null>(null);
  const resubscribeRoomRef = useRef<(() => void) | null>(null);
  const recoveryGenerationRef = useRef<number | null>(input.roomRecoveryState.generation);
  const roomRecoveryStateRef = useRef(input.roomRecoveryState);
  const activePlaybackSourceRef = useRef(input.activePlaybackSource);
  const lastSubscribeAckAtRef = useRef<number | null>(null);
  const recoveryModeRef = useRef<"late-join" | "rejoin" | "steady">("steady");
  const scheduleRemotePlaybackRetryRef = useRef<(attempt?: number, generation?: string | null) => void>(() => {});
  const mediaTransportOwnerKeyRef = useRef<string | null>(null);
  const lastRealtimeRoomEventAtRef = useRef<number>(Date.now());
  const lastDataActivityAtRef = useRef<number | null>(null);
  const lastListenerBootstrapKeyRef = useRef<string | null>(null);
  const missingListenerSinceRef = useRef<Map<string, number>>(new Map());
  const hostMediaSyncStateRef = useRef<HostMediaSyncState>({
    inFlight: false,
    lastAppliedKey: null,
    pendingKey: null,
    lastCaptureRefreshKey: null,
    lastPublishKey: null,
    retryKey: null,
    publishGeneration: 0,
    stage: "idle",
    lastPublishedListenerSet: null
  });
  const listenerMediaLifecycleRef = useRef<ListenerMediaLifecycleState>({
    traceKey: null,
    sourcePeerId: null,
    lastTrackTraceKey: null,
    lastBoundTraceKey: null,
    lastPlayAttemptTraceKey: null,
    lastPlayAttemptResult: null,
    lastPlayAttemptError: null,
    lastPlayingTraceKey: null,
    lastSoftRecoveryTraceKey: null,
    lastSoftRecoveryAt: null,
    lastHardRecoveryTraceKey: null,
    lastHardRecoveryAt: null,
    latestStream: null,
    currentGeneration: null,
    generationStartedAt: null,
    boundGeneration: null,
    playingGeneration: null,
    lastPlayoutProgressAt: null,
    lastTransportProgressAt: null,
    lastObservedRemoteCurrentTimeMs: null,
    recoveryStage: "idle",
    restartAttempt: 0,
    bindAttempts: 0,
    playAttempts: 0
  });
  const listenerMediaRecoveryTimeoutRef = useRef<number | null>(null);
  const socketDisconnectGraceTimeoutRef = useRef<number | null>(null);
  const hostMediaClockSequenceRef = useRef(0);
  const armListenerMediaRecoveryRef = useRef<(generation?: string | null) => void>(() => undefined);
  const audioUnlockedRef = useRef(input.audioUnlocked);
  const setAudioUnlockedRef = useRef(input.setAudioUnlocked);
  const sourceStartStateRef = useRef(input.sourceStartState);
  const setSourceStartStateRef = useRef(input.setSourceStartState);
  const lastSourceStartErrorRef = useRef(input.lastSourceStartError);
  const setLastSourceStartErrorRef = useRef(input.setLastSourceStartError);
  const manualCacheTrackIdsRef = useRef(input.manualCacheTrackIds);
  const uploadedTracksRef = useRef(input.uploadedTracks);
  const announceRoomTrackAvailabilityRef = useRef(input.announceRoomTrackAvailability);
  const handleManualCachePieceReceivedRef = useRef(input.handleManualCachePieceReceived);
  const deleteUploadedTrackArtifactsRef = useRef(input.deleteUploadedTrackArtifacts);
  const deleteRoomTrackArtifactsRef = useRef(input.deleteRoomTrackArtifacts);
  const resetPlayerSurfaceRef = useRef(input.resetPlayerSurface);
  const queueAvailabilityRef = useRef(input.queueAvailability);
  const clearAvailabilityForPeerRef = useRef(input.clearAvailabilityForPeer);
  const flushPendingAvailabilityRef = useRef(input.flushPendingAvailability);
  const recordPeerDiagnosticRef = useRef(input.recordPeerDiagnostic);

  const clearPendingRemoteStreamClear = useCallback(() => {
    if (remoteStreamClearTimeoutRef.current !== null) {
      window.clearTimeout(remoteStreamClearTimeoutRef.current);
      remoteStreamClearTimeoutRef.current = null;
    }
  }, []);

  const clearListenerMediaRecovery = useCallback(() => {
    if (listenerMediaRecoveryTimeoutRef.current !== null) {
      window.clearTimeout(listenerMediaRecoveryTimeoutRef.current);
      listenerMediaRecoveryTimeoutRef.current = null;
    }
  }, []);

  const clearSocketDisconnectGrace = useCallback(() => {
    if (socketDisconnectGraceTimeoutRef.current !== null) {
      window.clearTimeout(socketDisconnectGraceTimeoutRef.current);
      socketDisconnectGraceTimeoutRef.current = null;
    }
    socketDisconnectGraceUntilRef.current = null;
  }, []);

  const clearHostMediaSyncRetry = useCallback(() => {
    if (hostMediaSyncRetryRef.current !== null) {
      window.clearTimeout(hostMediaSyncRetryRef.current);
      hostMediaSyncRetryRef.current = null;
    }
  }, []);

  const getSilentPrewarmHandle = useCallback(() => {
    if (!silentPrewarmHandleRef.current) {
      silentPrewarmHandleRef.current = createSilentPrewarmHandle();
    }

    return silentPrewarmHandleRef.current;
  }, []);

  const disposeSilentPrewarmHandle = useCallback(() => {
    silentPrewarmHandleRef.current?.close();
    silentPrewarmHandleRef.current = null;
  }, []);

  const bumpMediaTransportEpoch = useCallback(
    (
      reason: "source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none" = "explicit-hard-reset"
    ) => {
      transportResetReasonRef.current = reason;
      mediaTransportEpochRef.current += 1;
      return mediaTransportEpochRef.current;
    },
    []
  );

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
        summary:
          options?.summary ??
          (nextState === "awaiting-unlock"
            ? "音源端等待本机音频解锁"
            : nextState === "starting"
              ? "音源端正在启动本地音频"
              : nextState === "live"
                ? "音源端已开始稳定分发"
                : nextState === "failed"
                  ? "音源端本机音频启动失败"
                  : "音源端处于待机状态"),
        level: options?.level ?? (nextState === "failed" ? "error" : "info"),
        recordEvent: options?.recordEvent ?? false,
        update: (snapshot) => ({
          ...snapshot,
          lastError: nextState === "failed" && nextError ? `音源端启动失败：${nextError}` : snapshot.lastError,
          progressivePlaybackStatus: {
            ...(
              snapshot.progressivePlaybackStatus ??
              createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
            ),
            audioUnlocked: audioUnlockedRef.current,
            sourceStartState: nextState,
            lastSourceStartError: nextError,
            hostPublishingReady: nextState === "live",
            mediaBootstrapState:
              nextState === "live"
                ? "steady"
                : nextState === "starting"
                  ? "bootstrapping"
                  : nextState === "failed"
                    ? "failed"
                    : snapshot.progressivePlaybackStatus?.mediaBootstrapState ?? "idle"
          }
        })
      });
    },
    []
  );

  const updateHostCaptureDiagnostics = useCallback(
    (inputValue: {
      refreshKey: string | null;
      forcedRefresh: boolean;
      captureMode: "native" | "audio-context" | null;
      mediaEpoch: number | null;
      transportEpoch?: number | null;
      mediaTransportState?: MediaTransportState | null;
      usingSilentPrewarmTrack?: boolean;
      publishedTrackKind?: HostPublishedTrackKind | null;
      hostPublishSource?: HostPublishSourceTarget | null;
      hostPublishReadiness?: HostPublishReadiness | null;
      hostPublishFailureReason?: string | null;
      resolvedPublishElement?: ResolvedPublishElement | null;
      resolvedPublishStreamKind?: ResolvedPublishStreamKind | null;
      mediaBootstrapState?: "idle" | "bootstrapping" | "recovering" | "failed" | "steady" | null;
      mediaFailureReason?: string | null;
      transportResetReason?: "source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none" | null;
      hostPublishingReady?: boolean;
      listenerRecoveryAttempt?: number | null;
      mediaNegotiationRole?: "publisher" | "listener" | null;
      listenerAwaitingPublisherOffer?: boolean;
      lastIgnoredOfferReason?: "offer-collision" | "stale-generation" | "wrong-role" | "none" | null;
      publisherBootstrapRequestedAt?: string | null;
      publisherBootstrapAttempts?: number | null;
      dataRequiredForPlayback?: boolean;
      firstTransportConnectedAt?: string | null;
      firstAudibleAt?: string | null;
      captureTrackState?: ReturnType<typeof getHostMediaStreamTrackState> | null;
      publishGeneration?: number | null;
      publishKey?: string | null;
      publishStage?: HostPublishStage;
      publishedListenerSet?: string | null;
      attachedTrackId?: string | null;
      negotiatedTrackId?: string | null;
      makingOffer?: boolean | null;
      signalingState?: string | null;
      summary: string;
    }) => {
      recordPeerDiagnosticRef.current({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "host-capture-state",
        summary: inputValue.summary,
        recordEvent: false,
        update: (snapshot) => ({
          ...snapshot,
          progressivePlaybackStatus: {
            ...(
              snapshot.progressivePlaybackStatus ??
              createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
            ),
            hostCaptureRefreshKey: inputValue.refreshKey,
            hostCaptureForcedRefresh: inputValue.forcedRefresh,
            hostCaptureMode: inputValue.captureMode,
            hostCaptureMediaEpoch: inputValue.mediaEpoch,
            mediaTransportState:
              inputValue.mediaTransportState ??
              snapshot.progressivePlaybackStatus?.mediaTransportState ??
              "idle",
            transportEpoch:
              inputValue.transportEpoch ?? snapshot.progressivePlaybackStatus?.transportEpoch ?? null,
            usingSilentPrewarmTrack:
              inputValue.usingSilentPrewarmTrack ??
              snapshot.progressivePlaybackStatus?.usingSilentPrewarmTrack ??
              false,
            publishedTrackKind:
              inputValue.publishedTrackKind ??
              snapshot.progressivePlaybackStatus?.publishedTrackKind ??
              "none",
            hostPublishSource:
              inputValue.hostPublishSource ??
              snapshot.progressivePlaybackStatus?.hostPublishSource ??
              "none",
            hostPublishReadiness:
              inputValue.hostPublishReadiness ??
              snapshot.progressivePlaybackStatus?.hostPublishReadiness ??
              "idle",
            hostPublishFailureReason:
              inputValue.hostPublishFailureReason ??
              snapshot.progressivePlaybackStatus?.hostPublishFailureReason ??
              null,
            resolvedPublishElement:
              inputValue.resolvedPublishElement ??
              snapshot.progressivePlaybackStatus?.resolvedPublishElement ??
              "none",
            resolvedPublishStreamKind:
              inputValue.resolvedPublishStreamKind ??
              snapshot.progressivePlaybackStatus?.resolvedPublishStreamKind ??
              "none",
            mediaBootstrapState:
              inputValue.mediaBootstrapState ??
              snapshot.progressivePlaybackStatus?.mediaBootstrapState ??
              "idle",
            mediaFailureReason:
              inputValue.mediaFailureReason ??
              snapshot.progressivePlaybackStatus?.mediaFailureReason ??
              null,
            transportResetReason:
              inputValue.transportResetReason ??
              snapshot.progressivePlaybackStatus?.transportResetReason ??
              transportResetReasonRef.current,
            hostPublishingReady:
              inputValue.hostPublishingReady ??
              snapshot.progressivePlaybackStatus?.hostPublishingReady ??
              false,
            listenerRecoveryAttempt:
              inputValue.listenerRecoveryAttempt ??
              snapshot.progressivePlaybackStatus?.listenerRecoveryAttempt ??
              null,
            mediaNegotiationRole:
              inputValue.mediaNegotiationRole ??
              snapshot.progressivePlaybackStatus?.mediaNegotiationRole ??
              null,
            listenerAwaitingPublisherOffer:
              inputValue.listenerAwaitingPublisherOffer ??
              snapshot.progressivePlaybackStatus?.listenerAwaitingPublisherOffer ??
              false,
            lastIgnoredOfferReason:
              inputValue.lastIgnoredOfferReason ??
              snapshot.progressivePlaybackStatus?.lastIgnoredOfferReason ??
              "none",
            publisherBootstrapRequestedAt:
              inputValue.publisherBootstrapRequestedAt ??
              snapshot.progressivePlaybackStatus?.publisherBootstrapRequestedAt ??
              null,
            publisherBootstrapAttempts:
              inputValue.publisherBootstrapAttempts ??
              snapshot.progressivePlaybackStatus?.publisherBootstrapAttempts ??
              null,
            dataRequiredForPlayback:
              inputValue.dataRequiredForPlayback ??
              snapshot.progressivePlaybackStatus?.dataRequiredForPlayback ??
              input.enableTrackCaching,
            firstTransportConnectedAt:
              inputValue.firstTransportConnectedAt ??
              snapshot.progressivePlaybackStatus?.firstTransportConnectedAt ??
              null,
            firstAudibleAt:
              inputValue.firstAudibleAt ??
              snapshot.progressivePlaybackStatus?.firstAudibleAt ??
              null,
            hostCaptureTrackId: inputValue.captureTrackState?.trackId ?? null,
            hostCaptureTrackMuted: inputValue.captureTrackState?.trackMuted ?? null,
            hostCaptureTrackEnabled: inputValue.captureTrackState?.trackEnabled ?? null,
            hostCaptureTrackReadyState: inputValue.captureTrackState?.trackReadyState ?? null,
            hostCaptureTrackCount: inputValue.captureTrackState?.trackCount ?? null,
            publishGeneration: inputValue.publishGeneration ?? null,
            hostPublishKey: inputValue.publishKey ?? null,
            hostPublishStage: inputValue.publishStage ?? "idle",
            hostPublishedListenerSet: inputValue.publishedListenerSet ?? null,
            attachedTrackId: inputValue.attachedTrackId ?? null,
            negotiatedTrackId: inputValue.negotiatedTrackId ?? null,
            makingOffer: inputValue.makingOffer ?? null,
            signalingState: inputValue.signalingState ?? null
          }
        })
      });
    },
    [input.enableTrackCaching]
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
    recordPeerDiagnosticRef.current({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "room-recovery-state",
      summary: `恢复阶段 ${input.roomRecoveryState.phase}`,
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          ...(
            snapshot.progressivePlaybackStatus ??
            createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
          ),
          recoveryPhase: input.roomRecoveryState.phase,
          recoveryMode: input.roomRecoveryState.mode,
          recoveryGeneration: input.roomRecoveryState.generation,
          bootstrapStartedAt: input.roomRecoveryState.bootstrapStartedAt,
          bootstrapSourcePeerId: input.roomRecoveryState.bootstrapSourcePeerId,
          pendingSnapshot: input.roomRecoveryState.pendingSnapshot,
          pendingData: input.roomRecoveryState.pendingData,
          pendingMedia: input.roomRecoveryState.pendingMedia,
          dataRequiredForPlayback: input.enableTrackCaching,
          listenerBootstrapAttempts: input.roomRecoveryState.listenerBootstrapAttempts,
          listenerRecoveryAttempt: input.roomRecoveryState.listenerBootstrapAttempts,
          fullLocalRecoveryActive: input.roomRecoveryState.fullLocalRecoveryActive
        }
      })
    });
  }, [input.enableTrackCaching, input.roomRecoveryState]);

  useEffect(() => {
    if (input.roomSnapshot?.room.id) {
      return;
    }

    hostMediaClockSequenceRef.current = 0;
    input.setAuthoritativeMediaClock(null);
  }, [input.roomSnapshot?.room.id, input.setAuthoritativeMediaClock]);

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
    recordPeerDiagnosticRef.current({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "audio-unlock-state",
      summary: input.audioUnlocked ? "房间音频已解锁" : "房间音频尚未解锁",
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          ...(
            snapshot.progressivePlaybackStatus ??
            createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
          ),
          audioUnlocked: input.audioUnlocked,
          sourceStartState: sourceStartStateRef.current,
          lastSourceStartError: lastSourceStartErrorRef.current
        }
      })
    });
  }, [input.audioUnlocked]);

  useEffect(() => {
    uploadedTracksRef.current = input.uploadedTracks;
  }, [input.uploadedTracks]);

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

  useEffect(() => {
    return () => {
      disposeSilentPrewarmHandle();
      clearSocketDisconnectGrace();
    };
  }, [clearSocketDisconnectGrace, disposeSilentPrewarmHandle]);

  return {
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
  };
}
