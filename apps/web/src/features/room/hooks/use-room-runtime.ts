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
  PeerSignalMessage,
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import type { Route } from "next";
import type { RoomSocket } from "@/lib/ws-client";
import { createRoomSocket } from "@/lib/ws-client";
import {
  ChunkScheduler,
  getWebRTCIceServers,
  P2PMesh,
  RoomMediaMesh,
  resolveTransportHealth
} from "@/features/p2p";
import {
  createRoomSnapshotResyncController,
  type RoomSnapshotResyncReason
} from "@/features/room/room-snapshot-resync";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { toUserFacingError } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { queueTrackPieceManifestUpsert } from "@/lib/indexeddb";
import { captureAudioStream, getCapturedAudioStreamMode } from "@/features/upload/audio-utils";
import {
  resolveHostCaptureRefresh,
  hasHostMediaStreamTrack,
  isHostRelayAudioReadyForCapture,
  shouldDeferHostMediaStreamSync
} from "@/features/playback/host-media-sync";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import type { ProgressiveSchedulerPolicy } from "@/features/playback/progressive-playback";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { resolveHostRelayAudioElement } from "@/features/room/host-relay-audio";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";

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
  setAudioUnlocked: Dispatch<SetStateAction<boolean>>;
  sourceStartState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed";
  setSourceStartState: Dispatch<
    SetStateAction<"idle" | "awaiting-unlock" | "starting" | "live" | "failed">
  >;
  lastSourceStartError: string | null;
  setLastSourceStartError: Dispatch<SetStateAction<string | null>>;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  queueAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  mergeLocalPieceAvailability: (
    trackId: string,
    chunkIndex: number,
    totalChunks: number,
    chunkSize: number
  ) => void;
  clearAvailabilityForPeer: (ownerPeerId: string) => void;
  flushPendingAvailability: () => void;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  uploadedTracks: Record<string, { objectUrl: string }>;
  uploadedTrackIds: string[];
  uploadedTrackIdsRef: MutableRefObject<string[]>;
  announceLocalCache: (trackId: string) => Promise<void>;
  deleteUploadedTrackArtifacts: (trackId: string) => Promise<void> | void;
  scheduleTrackHydration: (trackId: string, mimeType: string, totalChunks: number) => void;
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

type PieceTransferSample = {
  timestampMs: number;
  bytes: number;
};

type PieceTransferWindow = {
  downloads: PieceTransferSample[];
  uploads: PieceTransferSample[];
};

const pieceTransferWindowMs = 12_000;
const hostMediaSyncRetryDelayMs = 75;
const remoteStreamSwapGraceMs = 900;
const remotePlaybackRetryBackoffMs = [160, 320, 520, 800, 1_200, 1_600] as const;
const maxRemotePlaybackRetryAttempts = 16;
const listenerMediaRecoveryDelayMs = 1_400;
const listenerMediaRecoveryCooldownMs = 3_000;

type ListenerMediaRecoveryReason =
  | "connected-but-no-track"
  | "track-received-but-not-bound"
  | "bound-but-not-playing";

export function resolveListenerMediaRecoveryReason(input: {
  traceKey: string;
  lastTrackTraceKey: string | null;
  lastBoundTraceKey: string | null;
  lastPlayAttemptTraceKey: string | null;
  lastPlayAttemptResult: "ok" | "rejected" | null;
  lastPlayingTraceKey: string | null;
  remoteAudioPaused: boolean | null;
  hasBoundSrcObject: boolean;
}): ListenerMediaRecoveryReason | null {
  if (input.lastPlayingTraceKey === input.traceKey) {
    return null;
  }

  if (input.lastTrackTraceKey !== input.traceKey) {
    return "connected-but-no-track";
  }

  if (input.lastBoundTraceKey !== input.traceKey || !input.hasBoundSrcObject) {
    return "track-received-but-not-bound";
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

function getPieceTransferRates(
  transferWindows: Map<string, PieceTransferWindow>,
  peerId: string,
  now = Date.now()
) {
  const window = transferWindows.get(peerId);
  if (!window) {
    return {
      downloadRateKbps: null,
      uploadRateKbps: null
    };
  }

  window.downloads = prunePieceTransferSamples(window.downloads, now);
  window.uploads = prunePieceTransferSamples(window.uploads, now);

  return {
    downloadRateKbps: calculatePieceTransferRateKbps(window.downloads, now),
    uploadRateKbps: calculatePieceTransferRateKbps(window.uploads, now)
  };
}

function prunePieceTransferSamples(samples: PieceTransferSample[], now: number) {
  return samples.filter((sample) => now - sample.timestampMs <= pieceTransferWindowMs);
}

function calculatePieceTransferRateKbps(samples: PieceTransferSample[], now: number) {
  if (samples.length === 0) {
    return 0;
  }

  const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);
  const durationMs = pieceTransferWindowMs;
  return Math.round(((totalBytes * 8) / durationMs) * 10) / 10;
}

function withResolvedTransportHealth(snapshot: PeerDiagnosticsSnapshot): PeerDiagnosticsSnapshot {
  return {
    ...snapshot,
    ...resolveTransportHealth(snapshot)
  };
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
  setAudioUnlocked,
  sourceStartState,
  setSourceStartState,
  lastSourceStartError,
  setLastSourceStartError,
  availabilityByTrack,
  queueAvailability,
  mergeLocalPieceAvailability,
  clearAvailabilityForPeer,
  flushPendingAvailability,
  recordPeerDiagnostic,
  uploadedTracks,
  uploadedTrackIds,
  uploadedTrackIdsRef,
  announceLocalCache,
  deleteUploadedTrackArtifacts,
  scheduleTrackHydration,
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
  const meshRef = useRef<P2PMesh | null>(null);
  const mediaMeshRef = useRef<RoomMediaMesh | null>(null);
  const initialRecoveryAttemptRef = useRef<string | null>(null);
  const initialRoomSnapshotResyncKeyRef = useRef<string | null>(null);
  const previousInitialRoomIdRef = useRef<string | null>(initialRoomId);
  const activeRouteRoomIdRef = useRef<string | null>(initialRoomId);
  const hostStreamRef = useRef<MediaStream | null>(null);
  const hostMediaSyncRetryRef = useRef<number | null>(null);
  const remotePlaybackRetryRef = useRef<number | null>(null);
  const remoteStreamClearTimeoutRef = useRef<number | null>(null);
  const presenceIntervalRef = useRef<number | null>(null);
  const roomSnapshotWatchdogIntervalRef = useRef<number | null>(null);
  const presenceRepairKeyRef = useRef<string | null>(null);
  const trackMetadataRepairKeyRef = useRef<string | null>(null);
  const lastRealtimeRoomEventAtRef = useRef<number>(Date.now());
  const hostMediaSyncStateRef = useRef<{
    inFlight: boolean;
    lastAppliedKey: string | null;
    pendingKey: string | null;
    lastCaptureRefreshKey: string | null;
  }>({
    inFlight: false,
    lastAppliedKey: null,
    pendingKey: null,
    lastCaptureRefreshKey: null
  });
  const remoteStreamTrackingRef = useRef<{
    trackKey: string | null;
    accumulatedMs: number;
    segmentStartedAt: number | null;
  }>({
    trackKey: null,
    accumulatedMs: 0,
    segmentStartedAt: null
  });
  const listenerMediaLifecycleRef = useRef<{
    traceKey: string | null;
    lastTrackTraceKey: string | null;
    lastBoundTraceKey: string | null;
    lastPlayAttemptTraceKey: string | null;
    lastPlayAttemptResult: "ok" | "rejected" | null;
    lastPlayAttemptError: string | null;
    lastPlayingTraceKey: string | null;
    lastRecoveryTraceKey: string | null;
    lastRecoveryAt: number | null;
  }>({
    traceKey: null,
    lastTrackTraceKey: null,
    lastBoundTraceKey: null,
    lastPlayAttemptTraceKey: null,
    lastPlayAttemptResult: null,
    lastPlayAttemptError: null,
    lastPlayingTraceKey: null,
    lastRecoveryTraceKey: null,
    lastRecoveryAt: null
  });
  const listenerMediaRecoveryTimeoutRef = useRef<number | null>(null);
  const pieceTransferRatesRef = useRef<Map<string, PieceTransferWindow>>(new Map());
  const dataDegradedSinceRef = useRef<number | null>(null);
  const lastPieceReceivedAtRef = useRef<number>(Date.now());
  const lastAvailabilityGrowthAtRef = useRef<number>(Date.now());
  const currentTrackAvailabilityProgressRef = useRef<string | null>(null);
  const audioUnlockedRef = useRef(audioUnlocked);
  const setAudioUnlockedRef = useRef(setAudioUnlocked);
  const sourceStartStateRef = useRef(sourceStartState);
  const setSourceStartStateRef = useRef(setSourceStartState);
  const lastSourceStartErrorRef = useRef(lastSourceStartError);
  const setLastSourceStartErrorRef = useRef(setLastSourceStartError);
  const announceLocalCacheRef = useRef(announceLocalCache);
  const deleteUploadedTrackArtifactsRef = useRef(deleteUploadedTrackArtifacts);
  const scheduleTrackHydrationRef = useRef(scheduleTrackHydration);
  const resetPlayerSurfaceRef = useRef(resetPlayerSurface);
  const queueAvailabilityRef = useRef(queueAvailability);
  const mergeLocalPieceAvailabilityRef = useRef(mergeLocalPieceAvailability);
  const clearAvailabilityForPeerRef = useRef(clearAvailabilityForPeer);
  const flushPendingAvailabilityRef = useRef(flushPendingAvailability);
  const recordPeerDiagnosticRef = useRef(recordPeerDiagnostic);

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

  const getRemoteAudioDiagnostics = useCallback(() => {
    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) {
      return {
        audioPaused: null,
        audioMuted: null,
        audioReadyState: null,
        hasSrcObject: null,
        currentSrc: null
      };
    }

    return {
      audioPaused: remoteAudio.paused,
      audioMuted: remoteAudio.muted,
      audioReadyState: remoteAudio.readyState,
      hasSrcObject: !!remoteAudio.srcObject,
      currentSrc: remoteAudio.currentSrc || null
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
        traceKey:
          currentTrackId && mediaEpoch !== null
            ? `${currentTrackId}|${mediaEpoch}|${sourcePeerId ?? "none"}|${resolvedRemotePeerId ?? "none"}`
            : null
      };
    },
    [currentRoomRef]
  );

  const updateRemoteMediaDiagnostic = useCallback(
    (
      summary: string,
      update?: (snapshot: PeerDiagnosticsSnapshot) => PeerDiagnosticsSnapshot,
      options?: { event?: string; recordEvent?: boolean; level?: "info" | "warning" | "error" }
    ) => {
      recordPeerDiagnosticRef.current({
        peerId: "remote-media",
        channelKind: "media",
        direction: "local",
        event: options?.event ?? "remote-media-state",
        summary,
        recordEvent: options?.recordEvent ?? false,
        level: options?.level,
        update
      });
    },
    []
  );

  useEffect(() => {
    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) {
      return;
    }

    const syncRemoteAudioEvent = (
      eventName: "playing" | "waiting" | "pause" | "error",
      summary: string
    ) => {
      const traceContext = getRemoteMediaTraceContext();
      if (eventName === "playing") {
        listenerMediaLifecycleRef.current.lastPlayingTraceKey = traceContext.traceKey;
      }
      updateRemoteMediaDiagnostic(
        summary,
        (snapshot) => ({
          ...snapshot,
          mediaConnectionState:
            eventName === "playing"
              ? "live"
              : eventName === "error"
                ? "failed"
                : "buffering",
          remoteTrackStatus: {
            ...snapshot.remoteTrackStatus,
            ...traceContext,
            ...getRemoteAudioDiagnostics(),
            lastAudioEvent: eventName
          }
        }),
        {
          event: `remote-audio-${eventName}`
        }
      );
    };

    const handlePlaying = () => syncRemoteAudioEvent("playing", "远端音频元素开始播放");
    const handleWaiting = () => syncRemoteAudioEvent("waiting", "远端音频元素进入等待");
    const handlePause = () => syncRemoteAudioEvent("pause", "远端音频元素暂停");
    const handleError = () => syncRemoteAudioEvent("error", "远端音频元素播放失败");

    remoteAudio.addEventListener("playing", handlePlaying);
    remoteAudio.addEventListener("waiting", handleWaiting);
    remoteAudio.addEventListener("pause", handlePause);
    remoteAudio.addEventListener("error", handleError);

    return () => {
      remoteAudio.removeEventListener("playing", handlePlaying);
      remoteAudio.removeEventListener("waiting", handleWaiting);
      remoteAudio.removeEventListener("pause", handlePause);
      remoteAudio.removeEventListener("error", handleError);
    };
  }, [getRemoteAudioDiagnostics, getRemoteMediaTraceContext, remoteAudioRef, updateRemoteMediaDiagnostic]);

  const resetRemoteAudioElement = useCallback(
    (stream: MediaStream | null, options?: { deferNullReset?: boolean }) => {
      const remoteAudio = remoteAudioRef.current;
      if (!remoteAudio) {
        return;
      }

      if (stream) {
        clearPendingRemoteStreamClear();
        const traceContext = getRemoteMediaTraceContext();
        if (remoteAudio.srcObject !== stream) {
          remoteAudio.pause();
          if (remoteAudio.srcObject) {
            remoteAudio.srcObject = null;
          }
          remoteAudio.srcObject = stream;
        }
        listenerMediaLifecycleRef.current.lastBoundTraceKey = traceContext.traceKey;
        updateRemoteMediaDiagnostic(
          "远端音频元素已绑定新流",
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: "buffering",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...traceContext,
              ...getRemoteAudioDiagnostics()
            }
          }),
          {
            event: "remote-audio-element-state"
          }
        );
        return;
      }

      const clearStream = () => {
        remoteAudio.pause();
        if (remoteAudio.srcObject) {
          remoteAudio.srcObject = null;
        }
        remoteAudio.load();
        remoteStreamClearTimeoutRef.current = null;
        updateRemoteMediaDiagnostic(
          "远端音频元素已清空媒体流",
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: "idle",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...getRemoteMediaTraceContext(),
              ...getRemoteAudioDiagnostics(),
              boundToAudioElement: false
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

  const clearHostMediaSyncRetry = useCallback(() => {
    if (hostMediaSyncRetryRef.current !== null) {
      window.clearTimeout(hostMediaSyncRetryRef.current);
      hostMediaSyncRetryRef.current = null;
    }
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
            lastSourceStartError: nextError
          }
        })
      });
    },
    []
  );

  const updateHostCaptureDiagnostics = useCallback(
    (input: {
      refreshKey: string | null;
      forcedRefresh: boolean;
      captureMode: "native" | "audio-context" | null;
      mediaEpoch: number | null;
      summary: string;
    }) => {
      recordPeerDiagnosticRef.current({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "host-capture-state",
        summary: input.summary,
        recordEvent: false,
        update: (snapshot) => ({
          ...snapshot,
          progressivePlaybackStatus: {
            ...(
              snapshot.progressivePlaybackStatus ??
              createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
            ),
            hostCaptureRefreshKey: input.refreshKey,
            hostCaptureForcedRefresh: input.forcedRefresh,
            hostCaptureMode: input.captureMode,
            hostCaptureMediaEpoch: input.mediaEpoch
          }
        })
      });
    },
    []
  );

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
    activeSessionRef.current = activeSession;
  }, [activeSession, activeSessionRef]);

  useEffect(() => {
    currentRoomRef.current = roomSnapshot;
  }, [roomSnapshot, currentRoomRef]);

  useEffect(() => {
    uploadedTrackIdsRef.current = uploadedTrackIds;
  }, [uploadedTrackIds, uploadedTrackIdsRef]);

  useEffect(() => {
    audioUnlockedRef.current = audioUnlocked;
  }, [audioUnlocked]);

  useEffect(() => {
    setAudioUnlockedRef.current = setAudioUnlocked;
  }, [setAudioUnlocked]);

  useEffect(() => {
    sourceStartStateRef.current = sourceStartState;
  }, [sourceStartState]);

  useEffect(() => {
    setSourceStartStateRef.current = setSourceStartState;
  }, [setSourceStartState]);

  useEffect(() => {
    lastSourceStartErrorRef.current = lastSourceStartError;
  }, [lastSourceStartError]);

  useEffect(() => {
    setLastSourceStartErrorRef.current = setLastSourceStartError;
  }, [setLastSourceStartError]);

  useEffect(() => {
    recordPeerDiagnosticRef.current({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "audio-unlock-state",
      summary: audioUnlocked ? "房间音频已解锁" : "房间音频尚未解锁",
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          ...(
            snapshot.progressivePlaybackStatus ??
            createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
          ),
          audioUnlocked,
          sourceStartState: sourceStartStateRef.current,
          lastSourceStartError: lastSourceStartErrorRef.current
        }
      })
    });
  }, [audioUnlocked]);

  useEffect(() => {
    announceLocalCacheRef.current = announceLocalCache;
  }, [announceLocalCache]);

  useEffect(() => {
    deleteUploadedTrackArtifactsRef.current = deleteUploadedTrackArtifacts;
  }, [deleteUploadedTrackArtifacts]);

  useEffect(() => {
    scheduleTrackHydrationRef.current = scheduleTrackHydration;
  }, [scheduleTrackHydration]);

  useEffect(() => {
    resetPlayerSurfaceRef.current = resetPlayerSurface;
  }, [resetPlayerSurface]);

  useEffect(() => {
    queueAvailabilityRef.current = queueAvailability;
  }, [queueAvailability]);

  useEffect(() => {
    mergeLocalPieceAvailabilityRef.current = mergeLocalPieceAvailability;
  }, [mergeLocalPieceAvailability]);

  useEffect(() => {
    clearAvailabilityForPeerRef.current = clearAvailabilityForPeer;
  }, [clearAvailabilityForPeer]);

  useEffect(() => {
    flushPendingAvailabilityRef.current = flushPendingAvailability;
  }, [flushPendingAvailability]);

  useEffect(() => {
    recordPeerDiagnosticRef.current = recordPeerDiagnostic;
  }, [recordPeerDiagnostic]);

  useEffect(() => {
    const currentTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;
    if (!currentTrackId) {
      currentTrackAvailabilityProgressRef.current = null;
      return;
    }

    const localAvailability = availabilityByTrack[currentTrackId]?.[peerId];
    const nextProgressKey = [
      currentTrackId,
      localAvailability?.availableChunks.length ?? 0,
      localAvailability?.totalChunks ??
        roomSnapshot?.tracks.find((track) => track.id === currentTrackId)?.pieceManifest?.totalChunks ??
        0
    ].join("|");

    if (currentTrackAvailabilityProgressRef.current !== nextProgressKey) {
      currentTrackAvailabilityProgressRef.current = nextProgressKey;
      lastAvailabilityGrowthAtRef.current = Date.now();
    }
  }, [availabilityByTrack, peerId, roomSnapshot?.room.playback.currentTrackId, roomSnapshot?.tracks]);

  const exitCurrentRoom = useCallback(
    (message: string) => {
      setIsNavigatingRoomExit(true);
      setSuppressRoomRecovery(true);
      dispatchRoomStateEvent({ type: "local-reset" });
      resetPlayerSurface();
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage(message);
      if (workspaceOnly) {
        router.push(workspaceEntryHref as Route);
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

  useEffect(() => {
    activeRouteRoomIdRef.current = initialRoomId;

    if (!workspaceOnly || !initialRoomId) {
      previousInitialRoomIdRef.current = initialRoomId;
      return;
    }

    if (previousInitialRoomIdRef.current === initialRoomId) {
      return;
    }

    previousInitialRoomIdRef.current = initialRoomId;
    initialRecoveryAttemptRef.current = null;
    setSuppressRoomRecovery(false);
    setIsRecoveringRoom(false);
    setIsNavigatingRoomExit(false);
    resetPlayerSurfaceRef.current();

    if (roomSnapshot?.room.id && roomSnapshot.room.id !== initialRoomId) {
      dispatchRoomStateEvent({ type: "local-reset" });
    }
  }, [
    dispatchRoomStateEvent,
    workspaceOnly,
    initialRoomId,
    roomSnapshot?.room.id,
    setIsNavigatingRoomExit,
    setIsRecoveringRoom,
    setSuppressRoomRecovery
  ]);

  const scheduleRemotePlaybackRetry = useCallback(
    (attempt = 0) => {
      if (remotePlaybackRetryRef.current !== null) {
        window.clearTimeout(remotePlaybackRetryRef.current);
        remotePlaybackRetryRef.current = null;
      }

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

      void roomAudioOutput.playElement(remoteAudio).then((result) => {
        const now = new Date().toISOString();
        const traceContext = getRemoteMediaTraceContext();
        listenerMediaLifecycleRef.current.lastPlayAttemptTraceKey = traceContext.traceKey;
        listenerMediaLifecycleRef.current.lastPlayAttemptResult = result.ok ? "ok" : "rejected";
        listenerMediaLifecycleRef.current.lastPlayAttemptError = result.ok
          ? null
          : result.error ?? "play-rejected";
        updateRemoteMediaDiagnostic(
          result.ok ? "远端音频自动拉起成功" : `远端音频自动拉起失败：${result.error ?? "未知错误"}`,
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: result.ok && remoteAudio.paused === false ? "live" : "buffering",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...traceContext,
              ...getRemoteAudioDiagnostics(),
              lastPlayAttemptAt: now,
              lastPlayAttemptResult: result.ok ? "ok" : "rejected",
              lastPlayAttemptError: result.ok ? null : result.error ?? "play-rejected"
            }
          }),
          {
            event: "remote-play-attempt",
            recordEvent: !result.ok,
            level: result.ok ? "info" : "warning"
          }
        );
        if (result.ok) {
          return;
        }

        if (attempt >= maxRemotePlaybackRetryAttempts) {
          setStatusMessage("远端音频连接已建立，但播放未稳定，请点击一次播放继续。");
          return;
        }

        remotePlaybackRetryRef.current = window.setTimeout(() => {
          scheduleRemotePlaybackRetry(attempt + 1);
        }, remotePlaybackRetryBackoffMs[Math.min(attempt, remotePlaybackRetryBackoffMs.length - 1)]);
      });
    },
    [
      currentRoomRef,
      getRemoteAudioDiagnostics,
      getRemoteMediaTraceContext,
      remoteAudioRef,
      setStatusMessage,
      updateRemoteMediaDiagnostic
    ]
  );

  const syncHostMediaStream = useCallback(async () => {
    const currentRoom = currentRoomRef.current;
    if (!currentRoom?.room.id || !peerId || !isCurrentSourceOwner) {
      clearHostMediaSyncRetry();
      return;
    }

    const playback = currentRoom.room.playback;
    const listenerPeerIds =
      currentRoom.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId) ?? [];
    const syncKey = [
      currentRoom.room.id,
      playback.mediaEpoch,
      playback.currentTrackId ?? "none",
      playback.status,
      activePlaybackSource,
      listenerPeerIds.join(",")
    ].join("|");
    const syncState = hostMediaSyncStateRef.current;
    const { captureRefreshKey, forceRefresh: shouldForceCaptureRefresh } = resolveHostCaptureRefresh({
      currentTrackId: playback.currentTrackId,
      mediaEpoch: playback.mediaEpoch,
      activePlaybackSource,
      lastCaptureRefreshKey: syncState.lastCaptureRefreshKey
    });

    if (syncState.lastAppliedKey === syncKey || syncState.pendingKey === syncKey) {
      return;
    }

    if (syncState.inFlight) {
      syncState.pendingKey = syncKey;
      return;
    }

    syncState.inFlight = true;
    syncState.pendingKey = syncKey;
    let awaitingLocalAudioTrack = false;
    let blockedUntilSourcePlaybackReady = false;

    try {
      try {
        const relayAudio = resolveHostRelayAudioElement({
          activePlaybackSource,
          localAudio: audioRef.current,
          remoteAudio: remoteAudioRef.current
        });
        if (!relayAudio || !playback.currentTrackId) {
          syncState.lastCaptureRefreshKey = null;
          updateHostCaptureDiagnostics({
            refreshKey: null,
            forcedRefresh: false,
            captureMode: null,
            mediaEpoch: null,
            summary: "房主推流已停止"
          });
          await mediaMeshRef.current?.syncHostPeers([], null, playback.mediaEpoch);
          syncState.lastAppliedKey = syncKey;
          return;
        }

        const currentTrackObjectUrl = uploadedTracks[playback.currentTrackId]?.objectUrl ?? null;
        if (
          playback.status === "playing" &&
          !isHostRelayAudioReadyForCapture({
            activePlaybackSource,
            relayAudio,
            currentTrackObjectUrl
          })
        ) {
          blockedUntilSourcePlaybackReady = true;
          updateHostCaptureDiagnostics({
            refreshKey: captureRefreshKey,
            forcedRefresh: false,
            captureMode: getCapturedAudioStreamMode(relayAudio),
            mediaEpoch: playback.mediaEpoch,
            summary: "房主推流等待本地音频切到当前曲目"
          });
          return;
        }

        if (playback.status === "playing" && relayAudio.paused) {
          blockedUntilSourcePlaybackReady = true;
          return;
        }

        const preferAudioContextCapture = getCapturedAudioStreamMode(relayAudio) === "audio-context";
        let usedForcedRefresh = shouldForceCaptureRefresh;
        let capture = captureAudioStream(relayAudio, {
          forceRefresh: shouldForceCaptureRefresh,
          preferAudioContext: preferAudioContextCapture
        });
        if (!capture) {
          updateHostCaptureDiagnostics({
            refreshKey: captureRefreshKey,
            forcedRefresh: usedForcedRefresh,
            captureMode: getCapturedAudioStreamMode(relayAudio),
            mediaEpoch: playback.mediaEpoch,
            summary: "房主推流捕获失败，未能生成音频流"
          });
          setStatusMessage("当前浏览器不支持音频直播推送，请使用最新版 Chrome 或 Edge。");
          return;
        }

        if (
          playback.status === "playing" &&
          !relayAudio.paused &&
          relayAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          !hasHostMediaStreamTrack(capture)
        ) {
          usedForcedRefresh = true;
          capture = captureAudioStream(relayAudio, {
            forceRefresh: true,
            preferAudioContext: preferAudioContextCapture
          });
        }

        if (!capture) {
          updateHostCaptureDiagnostics({
            refreshKey: captureRefreshKey,
            forcedRefresh: usedForcedRefresh,
            captureMode: getCapturedAudioStreamMode(relayAudio),
            mediaEpoch: playback.mediaEpoch,
            summary: "房主推流刷新后仍未拿到音频流"
          });
          setStatusMessage("当前浏览器不支持音频直播推送，请使用最新版 Chrome 或 Edge。");
          return;
        }

        syncState.lastCaptureRefreshKey = captureRefreshKey;
        updateHostCaptureDiagnostics({
          refreshKey: captureRefreshKey,
          forcedRefresh: usedForcedRefresh,
          captureMode: getCapturedAudioStreamMode(relayAudio),
          mediaEpoch: playback.mediaEpoch,
          summary: usedForcedRefresh
            ? "房主推流已刷新捕获链路"
            : "房主推流复用现有捕获链路"
        });

        if (
          shouldDeferHostMediaStreamSync({
            stream: capture,
            listenerPeerCount: listenerPeerIds.length,
            playbackStatus: playback.status === "playing" ? "playing" : "idle"
          })
        ) {
          awaitingLocalAudioTrack = true;
          return;
        }

        hostStreamRef.current = capture;
        await mediaMeshRef.current?.syncHostPeers(listenerPeerIds, capture, playback.mediaEpoch);
        awaitingLocalAudioTrack = !hasHostMediaStreamTrack(capture);
        if (!awaitingLocalAudioTrack) {
          clearHostMediaSyncRetry();
          syncState.lastAppliedKey = syncKey;
        }
      } catch (error) {
        const message = toUserFacingError(error);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "host-media-sync-failed",
          level: "error",
          summary: `房主实时音频同步失败：${message}`,
          update: (snapshot) => ({
            ...snapshot,
            lastError: `房主实时音频同步失败：${message}`
          })
        });
        setStatusMessage("房主实时音频同步失败，已停止本次推流重试。");
        await mediaMeshRef.current?.syncHostPeers([], null, playback.mediaEpoch).catch(
          () => undefined
        );
        hostStreamRef.current = null;
        syncState.lastCaptureRefreshKey = null;
      }
    } finally {
      const nextPendingKey = syncState.pendingKey;
      syncState.inFlight = false;

      if (awaitingLocalAudioTrack) {
        clearHostMediaSyncRetry();
        hostMediaSyncRetryRef.current = window.setTimeout(() => {
          hostMediaSyncRetryRef.current = null;
          void syncHostMediaStream();
        }, hostMediaSyncRetryDelayMs);
        syncState.pendingKey = null;
        return;
      }

        if (blockedUntilSourcePlaybackReady) {
          clearHostMediaSyncRetry();
          hostMediaSyncRetryRef.current = window.setTimeout(() => {
            hostMediaSyncRetryRef.current = null;
            void syncHostMediaStream();
          }, hostMediaSyncRetryDelayMs);
          syncState.pendingKey = null;
          return;
        }

      if (nextPendingKey && nextPendingKey !== syncState.lastAppliedKey) {
        syncState.pendingKey = null;
        queueMicrotask(() => {
          void syncHostMediaStream();
        });
        return;
      }

      syncState.pendingKey = null;
    }
  }, [
    activePlaybackSource,
    audioRef,
    clearHostMediaSyncRetry,
    currentRoomRef,
    isCurrentSourceOwner,
    peerId,
    remoteAudioRef,
    setStatusMessage,
    uploadedTracks,
    updateHostCaptureDiagnostics
  ]);

  const ensureSourcePlaybackStarted = useCallback(async () => {
    const currentRoom = currentRoomRef.current;
    if (!currentRoom?.room.id || !peerId || !isCurrentSourceOwner) {
      updateSourceStartState("idle");
      return;
    }

    const playback = currentRoom.room.playback;
    if (playback.status !== "playing" || !playback.currentTrackId) {
      updateSourceStartState("idle");
      await syncHostMediaStream();
      return;
    }

    if (!audioUnlockedRef.current && !roomAudioOutput.isActivated()) {
      updateSourceStartState("awaiting-unlock", {
        summary: "音源端等待本机任意交互后自动启动",
        level: "warning"
      });
      return;
    }

    if (!audioUnlockedRef.current && roomAudioOutput.isActivated()) {
      setAudioUnlockedRef.current(true);
      audioUnlockedRef.current = true;
    }

    const relayAudio = resolveHostRelayAudioElement({
      activePlaybackSource,
      localAudio: audioRef.current,
      remoteAudio: remoteAudioRef.current
    });

    if (!relayAudio) {
      updateSourceStartState("failed", {
        error: "missing-source-audio-element",
        summary: "音源端缺少可用的本地音频元素",
        recordEvent: true,
        level: "error"
      });
      return;
    }

    const isElementPlaying = !relayAudio.paused && relayAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    if (!isElementPlaying) {
      updateSourceStartState("starting", {
        summary: "音源端已解锁，正在等待本机音频真正起播"
      });
      return;
    }

    if (!audioUnlockedRef.current) {
      setAudioUnlockedRef.current(true);
      audioUnlockedRef.current = true;
    }

    setLastSourceStartErrorRef.current(null);
    lastSourceStartErrorRef.current = null;
    await syncHostMediaStream();
    updateSourceStartState("live");
  }, [
    activePlaybackSource,
    audioRef,
    currentRoomRef,
    isCurrentSourceOwner,
    peerId,
    remoteAudioRef,
    setStatusMessage,
    syncHostMediaStream,
    updateSourceStartState
  ]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const traceContext =
      !isCurrentSourceOwner &&
      activePlaybackSource === "remote-stream" &&
      playback?.status === "playing" &&
      playback.currentTrackId
        ? getRemoteMediaTraceContext(playback.sourcePeerId)
        : {
            currentTrackId: null,
            mediaEpoch: null,
            sourcePeerId: null,
            traceKey: null
          };
    const lifecycle = listenerMediaLifecycleRef.current;
    if (lifecycle.traceKey === traceContext.traceKey) {
      return;
    }

    lifecycle.traceKey = traceContext.traceKey;
    lifecycle.lastTrackTraceKey = null;
    lifecycle.lastBoundTraceKey = null;
    lifecycle.lastPlayAttemptTraceKey = null;
    lifecycle.lastPlayAttemptResult = null;
    lifecycle.lastPlayAttemptError = null;
    lifecycle.lastPlayingTraceKey = null;
    clearListenerMediaRecovery();

    updateRemoteMediaDiagnostic(
      traceContext.traceKey ? "监听端播放 trace 已切换" : "监听端播放 trace 已清空",
      (snapshot) => ({
        ...snapshot,
        remoteTrackStatus: {
          ...snapshot.remoteTrackStatus,
          ...traceContext,
          ...getRemoteAudioDiagnostics()
        }
      }),
      {
        event: "remote-media-trace"
      }
    );
  }, [
    activePlaybackSource,
    clearListenerMediaRecovery,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    isCurrentSourceOwner,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.sourcePeerId,
    roomSnapshot?.room.playback.status,
    updateRemoteMediaDiagnostic
  ]);

  useEffect(() => {
    clearListenerMediaRecovery();

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
      return;
    }

    const traceContext = getRemoteMediaTraceContext(playback.sourcePeerId);
    const traceKey = traceContext.traceKey;
    if (!traceKey) {
      return;
    }

    listenerMediaRecoveryTimeoutRef.current = window.setTimeout(() => {
      const latestPlayback = currentRoomRef.current?.room.playback;
      const remoteAudio = remoteAudioRef.current;
      const lifecycle = listenerMediaLifecycleRef.current;

      if (
        !latestPlayback?.currentTrackId ||
        latestPlayback.status !== "playing" ||
        latestPlayback.currentTrackId !== traceContext.currentTrackId ||
        latestPlayback.mediaEpoch !== traceContext.mediaEpoch ||
        latestPlayback.sourcePeerId !== traceContext.sourcePeerId
      ) {
        return;
      }

      if (
        lifecycle.lastRecoveryTraceKey === traceKey &&
        lifecycle.lastRecoveryAt !== null &&
        Date.now() - lifecycle.lastRecoveryAt < listenerMediaRecoveryCooldownMs
      ) {
        return;
      }

      const reason = resolveListenerMediaRecoveryReason({
        traceKey,
        lastTrackTraceKey: lifecycle.lastTrackTraceKey,
        lastBoundTraceKey: lifecycle.lastBoundTraceKey,
        lastPlayAttemptTraceKey: lifecycle.lastPlayAttemptTraceKey,
        lastPlayAttemptResult: lifecycle.lastPlayAttemptResult,
        lastPlayingTraceKey: lifecycle.lastPlayingTraceKey,
        remoteAudioPaused: remoteAudio?.paused ?? null,
        hasBoundSrcObject: !!remoteAudio?.srcObject
      });
      if (!reason) {
        return;
      }

      lifecycle.lastRecoveryTraceKey = traceKey;
      lifecycle.lastRecoveryAt = Date.now();
      updateRemoteMediaDiagnostic(
        `监听端检测到远端播放卡住，正在重建媒体链路：${reason}`,
        (snapshot) => ({
          ...snapshot,
          mediaConnectionState: "reconnecting",
          remoteTrackStatus: {
            ...snapshot.remoteTrackStatus,
            ...traceContext,
            ...getRemoteAudioDiagnostics()
          }
        }),
        {
          event: "remote-media-recover",
          recordEvent: true,
          level: "warning"
        }
      );

      const sourcePeerId = playback.sourcePeerId;
      if (!sourcePeerId) {
        return;
      }

      void mediaMeshRef.current?.restartPeer(sourcePeerId).catch((error) => {
        updateRemoteMediaDiagnostic(
          `监听端媒体重建失败：${toUserFacingError(error)}`,
          (snapshot) => ({
            ...snapshot,
            lastError: `监听端媒体重建失败：${toUserFacingError(error)}`,
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...traceContext,
              ...getRemoteAudioDiagnostics(),
              lastPlayAttemptError: toUserFacingError(error)
            }
          }),
          {
            event: "remote-media-recover-failed",
            recordEvent: true,
            level: "error"
          }
        );
      });
    }, listenerMediaRecoveryDelayMs);

    return () => {
      clearListenerMediaRecovery();
    };
  }, [
    activePlaybackSource,
    clearListenerMediaRecovery,
    currentRoomRef,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    isCurrentSourceOwner,
    peerId,
    remoteAudioRef,
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.sourcePeerId,
    roomSnapshot?.room.playback.status,
    updateRemoteMediaDiagnostic
  ]);

  const updateDataTransportStats = useCallback(
    (input: {
      peerId: string;
      sample: {
        candidateType: string | null;
        currentRoundTripTimeMs: number | null;
        availableOutgoingBitrateKbps: number | null;
      };
    }) => {
      const pieceTransferRates = getPieceTransferRates(pieceTransferRatesRef.current, input.peerId);
      recordPeerDiagnostic({
        peerId: input.peerId,
        channelKind: "data",
        direction: "local",
        event: "transport-stats",
        summary: "Data transport stats updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...withResolvedTransportHealth({
            ...snapshot,
            dataCandidateType: input.sample.candidateType ?? snapshot.dataCandidateType,
            currentRoundTripTimeMs:
              input.sample.currentRoundTripTimeMs ?? snapshot.currentRoundTripTimeMs,
            availableOutgoingBitrateKbps:
              input.sample.availableOutgoingBitrateKbps ??
              snapshot.availableOutgoingBitrateKbps,
            pieceDownloadRateKbps: pieceTransferRates.downloadRateKbps,
            pieceUploadRateKbps: pieceTransferRates.uploadRateKbps
          })
        })
      });
    },
    [recordPeerDiagnostic]
  );

  const updateMediaTransportStats = useCallback(
    (input: {
      peerId: string;
      sample: {
        candidateType: string | null;
        protocol: string | null;
        currentRoundTripTimeMs: number | null;
        availableOutgoingBitrateKbps: number | null;
        targetAudioBitrateKbps?: number | null;
        packetLossRate?: number | null;
        receiverJitterTargetMs?: number | null;
        mediaReceiveBitrateKbps: number | null;
        mediaSendBitrateKbps: number | null;
        packetsLost: number | null;
        jitterMs: number | null;
      };
    }) => {
      recordPeerDiagnostic({
        peerId: input.peerId,
        channelKind: "media",
        direction: "local",
        event: "transport-stats",
        summary: "Media transport stats updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...withResolvedTransportHealth({
            ...snapshot,
            mediaCandidateType: input.sample.candidateType ?? snapshot.mediaCandidateType,
            mediaProtocol: input.sample.protocol ?? snapshot.mediaProtocol,
            currentRoundTripTimeMs:
              input.sample.currentRoundTripTimeMs ?? snapshot.currentRoundTripTimeMs,
            availableOutgoingBitrateKbps:
              input.sample.availableOutgoingBitrateKbps ??
              snapshot.availableOutgoingBitrateKbps,
            targetAudioBitrateKbps:
              input.sample.targetAudioBitrateKbps ?? snapshot.targetAudioBitrateKbps,
            packetLossRate: input.sample.packetLossRate ?? snapshot.packetLossRate,
            receiverJitterTargetMs:
              input.sample.receiverJitterTargetMs ?? snapshot.receiverJitterTargetMs,
            mediaReceiveBitrateKbps:
              input.sample.mediaReceiveBitrateKbps ?? snapshot.mediaReceiveBitrateKbps,
            mediaSendBitrateKbps: input.sample.mediaSendBitrateKbps ?? snapshot.mediaSendBitrateKbps,
            packetsLost: input.sample.packetsLost ?? snapshot.packetsLost,
            jitterMs: input.sample.jitterMs ?? snapshot.jitterMs
          })
        })
      });
    },
    [recordPeerDiagnostic]
  );

  const recordPieceTransfer = useCallback(
    (input: {
      peerId: string;
      direction: "download" | "upload";
      bytes: number;
    }) => {
      if (!input.peerId || input.bytes <= 0) {
        return;
      }

      const window =
        pieceTransferRatesRef.current.get(input.peerId) ??
        (() => {
          const initial: PieceTransferWindow = {
            downloads: [],
            uploads: []
          };
          pieceTransferRatesRef.current.set(input.peerId, initial);
          return initial;
        })();
      const bucket = input.direction === "download" ? window.downloads : window.uploads;
      bucket.push({
        timestampMs: Date.now(),
        bytes: input.bytes
      });

      const pieceTransferRates = getPieceTransferRates(pieceTransferRatesRef.current, input.peerId);
      recordPeerDiagnostic({
        peerId: input.peerId,
        channelKind: "data",
        direction: "local",
        event: "piece-transfer-stats",
        summary: "Piece transfer stats updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...withResolvedTransportHealth({
            ...snapshot,
            pieceDownloadRateKbps: pieceTransferRates.downloadRateKbps,
            pieceUploadRateKbps: pieceTransferRates.uploadRateKbps,
            lastPieceReceivedAt:
              input.direction === "download" ? new Date().toISOString() : snapshot.lastPieceReceivedAt
          })
        })
      });
    },
    [recordPeerDiagnostic]
  );

  const updateRemoteStreamTime = useCallback(
    (timeOnRemoteStreamMs: number | null) => {
      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "remote-stream-time",
        summary: "Remote stream time updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...snapshot,
          timeOnRemoteStreamMs
        })
      });
    },
    [recordPeerDiagnostic]
  );

  const reportRealtimeFailure = useCallback(
    (input: {
      peerId: string;
      channelKind: "data" | "media" | "system";
      event: string;
      summary: string;
      error: unknown;
      mediaConnectionState?: RoomMediaConnectionState;
    }) => {
      const message = toUserFacingError(input.error);
      const nextSummary = `${input.summary}: ${message}`;

      recordPeerDiagnostic({
        peerId: input.peerId,
        channelKind: input.channelKind,
        direction: "local",
        event: input.event,
        level: "error",
        summary: nextSummary,
        update: (snapshot) => ({
          ...snapshot,
          lastError: nextSummary
        })
      });

      if (input.mediaConnectionState) {
        setMediaConnectionState(input.mediaConnectionState);
      }
    },
    [recordPeerDiagnostic, setMediaConnectionState]
  );

  const requestRoomSnapshotResyncRef = useRef(requestRoomSnapshotResync);
  const scheduleRemotePlaybackRetryRef = useRef(scheduleRemotePlaybackRetry);
  const syncHostMediaStreamRef = useRef(syncHostMediaStream);
  const ensureSourcePlaybackStartedRef = useRef(ensureSourcePlaybackStarted);
  const updateDataTransportStatsRef = useRef(updateDataTransportStats);
  const updateMediaTransportStatsRef = useRef(updateMediaTransportStats);
  const reportRealtimeFailureRef = useRef(reportRealtimeFailure);
  const recordPieceTransferRef = useRef(recordPieceTransfer);

  useEffect(() => {
    requestRoomSnapshotResyncRef.current = requestRoomSnapshotResync;
  }, [requestRoomSnapshotResync]);

  useEffect(() => {
    scheduleRemotePlaybackRetryRef.current = scheduleRemotePlaybackRetry;
  }, [scheduleRemotePlaybackRetry]);

  useEffect(() => {
    syncHostMediaStreamRef.current = syncHostMediaStream;
  }, [syncHostMediaStream]);

  useEffect(() => {
    ensureSourcePlaybackStartedRef.current = ensureSourcePlaybackStarted;
  }, [ensureSourcePlaybackStarted]);

  useEffect(
    () => () => {
      clearPendingRemoteStreamClear();
    },
    [clearPendingRemoteStreamClear]
  );

  useEffect(() => {
    updateDataTransportStatsRef.current = updateDataTransportStats;
  }, [updateDataTransportStats]);

  useEffect(() => {
    updateMediaTransportStatsRef.current = updateMediaTransportStats;
  }, [updateMediaTransportStats]);

  useEffect(() => {
    reportRealtimeFailureRef.current = reportRealtimeFailure;
  }, [reportRealtimeFailure]);

  useEffect(() => {
    recordPieceTransferRef.current = recordPieceTransfer;
  }, [recordPieceTransfer]);

  useEffect(() => {
    return () => {
      if (remotePlaybackRetryRef.current !== null) {
        window.clearTimeout(remotePlaybackRetryRef.current);
      }
      stopRoomSnapshotWatchdog();
    };
  }, [stopRoomSnapshotWatchdog]);

  useEffect(() => {
    const currentTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;
    const mediaEpoch = roomSnapshot?.room.playback.mediaEpoch ?? 0;
    const trackingKey = currentTrackId ? `${currentTrackId}:${mediaEpoch}` : null;
    const tracking = remoteStreamTrackingRef.current;

    if (tracking.trackKey !== trackingKey) {
      tracking.trackKey = trackingKey;
      tracking.accumulatedMs = 0;
      tracking.segmentStartedAt = null;
    }

    if (!currentTrackId) {
      updateRemoteStreamTime(null);
      return;
    }

    const shouldTrackRemoteStream =
      roomSnapshot?.room.playback.status === "playing" && activePlaybackSource === "remote-stream";

    if (!shouldTrackRemoteStream) {
      if (tracking.segmentStartedAt !== null) {
        tracking.accumulatedMs += Date.now() - tracking.segmentStartedAt;
        tracking.segmentStartedAt = null;
      }
      updateRemoteStreamTime(Math.max(0, Math.round(tracking.accumulatedMs)));
      return;
    }

    if (tracking.segmentStartedAt === null) {
      tracking.segmentStartedAt = Date.now();
    }

    const syncRemoteStreamTime = () => {
      const activeSegmentMs =
        tracking.segmentStartedAt === null ? 0 : Date.now() - tracking.segmentStartedAt;
      updateRemoteStreamTime(Math.max(0, Math.round(tracking.accumulatedMs + activeSegmentMs)));
    };

    syncRemoteStreamTime();
    const timerId = window.setInterval(syncRemoteStreamTime, 1_000);

    return () => {
      window.clearInterval(timerId);
      if (tracking.segmentStartedAt !== null) {
        tracking.accumulatedMs += Date.now() - tracking.segmentStartedAt;
        tracking.segmentStartedAt = null;
      }
      updateRemoteStreamTime(Math.max(0, Math.round(tracking.accumulatedMs)));
    };
  }, [
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.status,
    activePlaybackSource,
    updateRemoteStreamTime
  ]);

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
    if (!activeSession) {
      return;
    }

    void refreshSession();
  }, [activeSession, refreshSession]);

  useEffect(() => {
    if (!workspaceOnly || !initialRoomId || !hydrated || activeSession) {
      return;
    }

    router.replace(authEntryHref as Route);
  }, [workspaceOnly, initialRoomId, hydrated, activeSession, router, authEntryHref]);

  useEffect(() => {
    const storedPeerId = window.sessionStorage.getItem(peerStorageKey);
    if (storedPeerId) {
      setPeerId(storedPeerId);
      return;
    }

    const nextPeerId = `peer_${crypto.randomUUID()}`;
    window.sessionStorage.setItem(peerStorageKey, nextPeerId);
    setPeerId(nextPeerId);
  }, [peerStorageKey, setPeerId]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshAvailableRooms();
    void refreshPlaylists();
  }, [activeSession, refreshAvailableRooms, refreshPlaylists]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const nextVisible = !document.hidden;
      setIsPageVisible(nextVisible);
      if (nextVisible) {
        setSchedulerMode((current) => (current === "idle" ? "normal" : current));
        emitPresence();
        void requestRoomSnapshotResync(
          "visibility-visible",
          currentRoomRef.current?.room.id ?? null
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [currentRoomRef, emitPresence, requestRoomSnapshotResync, setIsPageVisible, setSchedulerMode]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !activeSession) {
      setIceConfig(null);
      setIceConfigResolved(false);
      return;
    }

    let cancelled = false;
    setIceConfigResolved(false);

    void (async () => {
      try {
        const nextIceConfig = await musicRoomApi.getIceConfig();
        if (cancelled) {
          return;
        }

        setIceConfig(nextIceConfig);
        setIceConfigResolved(true);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "ice-config",
          summary: `ICE 配置来源：${nextIceConfig.source}`,
          update: (snapshot) => ({
            ...snapshot,
            mediaConnectionState: nextIceConfig.source
          })
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIceConfig(null);
        setIceConfigResolved(true);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "ice-config-fallback",
          level: "warning",
          summary: `ICE 配置获取失败，已回退静态配置：${toUserFacingError(error)}`,
          update: (snapshot) => ({
            ...snapshot,
            lastError: toUserFacingError(error)
          })
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    roomSnapshot?.room.id,
    activeSession?.userId,
    setIceConfig,
    setIceConfigResolved,
    recordPeerDiagnostic
  ]);

  useEffect(() => {
    if (
      suppressRoomRecovery ||
      !workspaceOnly ||
      !initialRoomId ||
      !hydrated ||
      !activeSession ||
      isNavigatingRoomExit
    ) {
      return;
    }

    const recoveryKey = `${activeSession.userId}:${initialRoomId}`;
    if (initialRecoveryAttemptRef.current === recoveryKey) {
      return;
    }
    initialRecoveryAttemptRef.current = recoveryKey;

    let cancelled = false;
    setIsRecoveringRoom(true);

    void (async () => {
      try {
        const snapshot = await musicRoomApi.recoverRoom(initialRoomId);
        if (!snapshot || cancelled) {
          if (!cancelled) {
            setSuppressRoomRecovery(true);
            setStatusMessage("未找到可恢复的房间状态，请返回音乐房重新创建或加入房间。");
            setIsRecoveringRoom(false);
          }
          return;
        }

        dispatchRoomStateEvent({
          type: "recover-snapshot",
          snapshot
        });
        setStatusMessage(`已进入房间 ${snapshot.room.joinCode}。`);
        await refreshPlaylists();
      } catch {
        if (!cancelled) {
          setStatusMessage("未找到可恢复的房间状态，请返回音乐房重新创建或加入房间。");
        }
      } finally {
        if (!cancelled) {
          setIsRecoveringRoom(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    workspaceOnly,
    initialRoomId,
    hydrated,
    activeSession?.userId,
    suppressRoomRecovery,
    isNavigatingRoomExit,
    refreshPlaylists,
    dispatchRoomStateEvent,
    setIsRecoveringRoom,
    setSuppressRoomRecovery,
    setStatusMessage
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) {
      return;
    }

    window.localStorage.setItem(lastRoomStorageKey, roomSnapshot.room.id);
  }, [roomSnapshot?.room.id, peerId, lastRoomStorageKey]);

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
      if (!activeRoomId || activeRoomId !== roomSnapshot.room.id || !socket?.connected) {
        return;
      }

      if (Date.now() - lastRealtimeRoomEventAtRef.current < 8_000) {
        return;
      }

      lastRealtimeRoomEventAtRef.current = Date.now();
      void requestRoomSnapshotResyncRef.current("stale-watchdog", roomSnapshot.room.id);
    }, 4_000);

    return () => {
      stopRoomSnapshotWatchdog();
    };
  }, [
    roomSnapshot?.room.id,
    roomSnapshot?.room.members.length,
    hydrated,
    activeSession?.userId,
    isNavigatingRoomExit,
    stopRoomSnapshotWatchdog
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !hydrated || !iceConfigResolved) {
      return;
    }

    const socket = createRoomSocket();
    socketRef.current = socket;
    const roomId = roomSnapshot.room.id;
    let subscribeRetryId: number | null = null;
    pieceTransferRatesRef.current.clear();
    const iceServers = getWebRTCIceServers(iceConfig);
    const emitPeerSignal = (payload: PeerSignalMessage) => {
      const traceContext =
        payload.channelKind === "media" ? getRemoteMediaTraceContext(payload.toPeerId) : null;
      recordPeerDiagnosticRef.current({
        peerId: payload.toPeerId,
        channelKind: payload.channelKind,
        direction: "sent",
        event: payload.type,
        summary:
          payload.channelKind === "media" && traceContext?.traceKey
            ? `向 ${payload.toPeerId} 发送 ${payload.channelKind} ${payload.type} · ${traceContext.traceKey}`
            : `向 ${payload.toPeerId} 发送 ${payload.channelKind} ${payload.type}`,
        update: (snapshot) => ({
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
            sentOffers:
              snapshot.signalStats.sentOffers + (payload.type === "offer" ? 1 : 0),
            sentAnswers:
              snapshot.signalStats.sentAnswers + (payload.type === "answer" ? 1 : 0),
            sentCandidates:
              snapshot.signalStats.sentCandidates + (payload.type === "candidate" ? 1 : 0)
          }
        })
      });
      socket.emit("peer.signal", payload);
    };
    const handleSignalFailure = (payload: PeerSignalMessage, error: unknown) => {
      reportRealtimeFailureRef.current({
        peerId: payload.fromPeerId,
        channelKind: payload.channelKind,
        event: "signal-handle-failed",
        summary: `Failed to apply ${payload.channelKind} ${payload.type} from ${payload.fromPeerId}`,
        error,
        mediaConnectionState: payload.channelKind === "media" ? "reconnecting" : undefined
      });
    };

    const mesh = new P2PMesh(
      roomId,
      peerId,
      emitPeerSignal,
      {
        onPieceReceived: ({ peerId: sourcePeerId, trackId, chunkIndex, totalChunks, chunkSize, mimeType, payloadBytes }) => {
          lastPieceReceivedAtRef.current = Date.now();
          recordPieceTransferRef.current({
            peerId: sourcePeerId,
            direction: "download",
            bytes: payloadBytes
          });
          const currentTrack =
            currentRoomRef.current?.tracks.find((entry) => entry.id === trackId) ?? null;
          if (currentTrack) {
            void queueTrackPieceManifestUpsert({
              trackId,
              fileHash: currentTrack.fileHash,
              mimeType: currentTrack.mimeType || mimeType || "audio/mpeg",
              codec: currentTrack.codec ?? null,
              sizeBytes: currentTrack.sizeBytes ?? null,
              durationMs: currentTrack.durationMs,
              totalChunks,
              chunkSize
            });
          }
          chunkSchedulerRef.current?.markPieceReceived(trackId, chunkIndex, totalChunks);
          mergeLocalPieceAvailabilityRef.current(trackId, chunkIndex, totalChunks, chunkSize);
          scheduleTrackHydrationRef.current(trackId, mimeType, totalChunks);
        },
        onPieceSent: ({ peerId: targetPeerId, payloadBytes }) => {
          recordPieceTransferRef.current({
            peerId: targetPeerId,
            direction: "upload",
            bytes: payloadBytes
          });
        },
        onPieceRequestTimeout: ({ trackId, chunkIndex, peerId: timedOutPeerId }) => {
          chunkSchedulerRef.current?.markRequestTimeout(trackId, chunkIndex, timedOutPeerId);
        },
        onPeerConnectionChange: ({ peerId: remotePeerId, state }) => {
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "data",
            direction: "local",
            event: "connection-state",
            summary: `Data 连接状态：${state}`,
            update: (snapshot) => ({
              ...withResolvedTransportHealth({
                ...snapshot,
                dataConnectionState: state
              })
            })
          });
          if (state === "closed" || state === "failed" || state === "disconnected") {
            setConnectedPeers((current) => current.filter((peer) => peer !== remotePeerId));
          }
        },
        onIceConnectionStateChange: ({ peerId: remotePeerId, state }) => {
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "data",
            direction: "local",
            event: "ice-state",
            summary: `Data ICE 状态：${state}`,
            update: (snapshot) => ({
              ...withResolvedTransportHealth({
                ...snapshot,
                dataIceState: state
              })
            })
          });
        },
        onDataChannelStateChange: ({ peerId: remotePeerId, state }) => {
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "data",
            direction: "local",
            event: "data-channel",
            summary: `DataChannel 状态：${state}`,
            update: (snapshot) => ({
              ...withResolvedTransportHealth({
                ...snapshot,
                dataChannelState: state
              })
            })
          });
          setConnectedPeers((current) => {
            const next = new Set(current);
            if (state === "open") {
              next.add(remotePeerId);
            } else {
              next.delete(remotePeerId);
            }
            return [...next];
          });
          if (state === "open") {
            flushPendingAvailabilityRef.current();
            for (const trackId of uploadedTrackIdsRef.current) {
              void announceLocalCacheRef.current(trackId);
            }
          }
        },
        onStatsSample: ({ peerId: remotePeerId, sample }) => {
          updateDataTransportStatsRef.current({
            peerId: remotePeerId,
            sample
          });
        }
      },
      iceServers
    );
    meshRef.current = mesh;
    chunkSchedulerRef.current = new ChunkScheduler(peerId, {
      requestPiece: ({ peerId: remotePeerId, trackId, chunkIndex, totalChunks, timeoutMs }) =>
        mesh.requestPiece(remotePeerId, trackId, chunkIndex, totalChunks, timeoutMs)
    });

    const mediaMesh = new RoomMediaMesh(
      roomId,
      peerId,
      emitPeerSignal,
      iceServers,
      {
        onRemoteStream: (stream) => {
          const remoteAudio = remoteAudioRef.current;
          if (!remoteAudio) {
            return;
          }
          const traceContext = getRemoteMediaTraceContext();

          if (remoteAudio.srcObject !== stream) {
            resetRemoteAudioElement(stream, {
              deferNullReset:
                !stream && currentRoomRef.current?.room.playback.status === "playing"
            });
            updateRemoteMediaDiagnostic(
              stream ? "远端媒体流已绑定到音频元素" : "远端媒体流已清空",
              (snapshot) => ({
                ...snapshot,
                remoteTrackStatus: {
                  ...snapshot.remoteTrackStatus,
                  ...traceContext,
                  ...getRemoteAudioDiagnostics(),
                  boundToAudioElement: !!stream,
                  lastBoundAt: stream
                    ? new Date().toISOString()
                    : snapshot.remoteTrackStatus.lastBoundAt
                }
              }),
              {
                event: "remote-stream-bound"
              }
            );
          }

          if (stream) {
            scheduleRemotePlaybackRetryRef.current();
          }
        },
        onConnectionStateChange: ({ state, connectedPeerIds }) => {
          recordPeerDiagnosticRef.current({
            peerId: connectedPeerIds[0] ?? "remote-media",
            channelKind: "media",
            direction: "local",
            event: "connection-state",
            summary: `Media 连接状态：${state}`,
            update: (snapshot) => ({
              ...withResolvedTransportHealth({
                ...snapshot,
                mediaConnectionState: state
              })
            })
          });
          setMediaConnectedPeers(connectedPeerIds);

          if (state === "connected") {
            setMediaConnectionState("buffering");
            scheduleRemotePlaybackRetryRef.current();
            return;
          }

          if (state === "connecting" || state === "new") {
            setMediaConnectionState("connecting");
            return;
          }

          if (state === "failed") {
            setMediaConnectionState("reconnecting");
            return;
          }

          if (state === "disconnected" || state === "closed") {
            setMediaConnectionState((current) => (current === "live" ? "reconnecting" : "idle"));
          }
        },
        onIceConnectionStateChange: ({ peerId: remotePeerId, state }) => {
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "ice-state",
            summary: `Media ICE 状态：${state}`,
            update: (snapshot) => ({
              ...withResolvedTransportHealth({
                ...snapshot,
                mediaIceState: state
              })
            })
          });
        },
        onRemoteTrack: ({ peerId: remotePeerId, trackId }) => {
          const now = new Date().toISOString();
          const traceContext = getRemoteMediaTraceContext(remotePeerId);
          listenerMediaLifecycleRef.current.lastTrackTraceKey = traceContext.traceKey;
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "remote-track",
            summary: traceContext.traceKey
              ? `收到远端 track ${trackId} · ${traceContext.traceKey}`
              : `收到远端 track ${trackId}`,
            update: (snapshot) => ({
              ...snapshot,
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                ...traceContext,
                received: true,
                lastTrackAt: now
              }
            })
          });
          updateRemoteMediaDiagnostic(
            `成员端收到远端 track ${trackId}`,
            (snapshot) => ({
              ...snapshot,
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                ...traceContext,
                received: true,
                lastTrackAt: now
              }
            }),
            {
              event: "remote-track"
            }
          );
        },
        onSourcePeerFailed: ({ peerId: remotePeerId, mediaEpoch }) => {
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "source-peer-failed",
            level: "warning",
            summary: `媒体源 ${remotePeerId} 失效，mediaEpoch=${mediaEpoch}`,
            update: (snapshot) => ({
              ...snapshot,
              lastError: `媒体源 ${remotePeerId} 已失效`
            })
          });
          setMediaConnectionState("reconnecting");
        },
        onStatsSample: ({ peerId: remotePeerId, sample }) => {
          updateMediaTransportStatsRef.current({
            peerId: remotePeerId,
            sample
          });
        }
      }
    );
    mediaMeshRef.current = mediaMesh;

    const resyncRealtimePeers = (members = currentRoomRef.current?.room.members ?? []) => {
      const remotePeerIds = members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId);

      void mesh.syncPeers(remotePeerIds).catch((error) => {
        reportRealtimeFailureRef.current({
          peerId: "system",
          channelKind: "system",
          event: "mesh-resync-failed",
          summary: "Failed to resync data peers",
          error
        });
      });
    };

    const subscribeToRoom = (attempt = 0) => {
      const currentSession = activeSessionRef.current;
      if (!socket.connected || !currentSession?.userId || !peerId) {
        if (subscribeRetryId !== null) {
          window.clearTimeout(subscribeRetryId);
        }
        subscribeRetryId = window.setTimeout(() => {
          subscribeRetryId = null;
          subscribeToRoom(attempt + 1);
        }, 100);
        return;
      }

      socket.emit(
        "room.subscribe",
        {
          roomId,
          sessionId: currentSession.userId,
          peerId
        },
        (response?: { ok?: boolean }) => {
          if (!response?.ok) {
            return;
          }

          startPresenceHeartbeat();
          resyncRealtimePeers();
          flushPendingAvailabilityRef.current();
          for (const trackId of uploadedTrackIdsRef.current) {
            void announceLocalCacheRef.current(trackId);
          }
          if (currentRoomRef.current?.room.playback.sourceSessionId === activeSessionRef.current?.userId) {
            void ensureSourcePlaybackStartedRef.current();
          }
          void requestRoomSnapshotResyncRef.current("subscribe-ack", roomId);
        }
      );
    };
    const exitAndStopPresence = (message: string) => {
      stopPresenceHeartbeat();
      exitCurrentRoom(message);
    };

    socket.on("connect", () => {
      subscribeToRoom();
      flushPendingAvailabilityRef.current();
      for (const trackId of uploadedTrackIdsRef.current) {
        void announceLocalCacheRef.current(trackId);
      }
      resyncRealtimePeers();
      if (currentRoomRef.current?.room.playback.sourceSessionId === activeSessionRef.current?.userId) {
        void ensureSourcePlaybackStartedRef.current();
      }
      void requestRoomSnapshotResyncRef.current("socket-connect", roomId);
      const joinCode = currentRoomRef.current?.room.joinCode;
      if (joinCode) {
        setStatusMessage(`已连接到房间 ${joinCode}。`);
      }
    });
    let didReplayLocalAvailability = false;

    socket.on("room.snapshot", (snapshot: RoomSnapshot) => {
      if (snapshot.room.id !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      lastRealtimeRoomEventAtRef.current = Date.now();
      dispatchRoomStateEvent({
        type: "server-snapshot",
        snapshot
      });
      void requestRoomSnapshotResyncRef.current("realtime-room-event", roomId);

      if (!didReplayLocalAvailability) {
        didReplayLocalAvailability = true;
        for (const trackId of uploadedTrackIdsRef.current) {
          void announceLocalCacheRef.current(trackId);
        }
      }

      flushPendingAvailabilityRef.current();
      resyncRealtimePeers(snapshot.room.members);
      if (snapshot.room.playback.sourceSessionId === activeSessionRef.current?.userId) {
        window.setTimeout(() => {
          if (activeRouteRoomIdRef.current === roomId) {
            void ensureSourcePlaybackStartedRef.current();
          }
        }, 0);
      }
    });
    socket.on("room.playback.patch", ({ playback }) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      dispatchRoomStateEvent({
        type: "server-playback-patch",
        roomId,
        playback
      });
    });
    socket.on("room.queue.patch", ({ queue, playback, roomRevision }) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      lastRealtimeRoomEventAtRef.current = Date.now();
      dispatchRoomStateEvent({
        type: "server-queue-patch",
        roomId,
        queue,
        playback,
        roomRevision
      });
      void requestRoomSnapshotResyncRef.current("realtime-room-event", roomId);
    });
    socket.on("room.presence.patch", ({ members, playback, presenceRevision, roomRevision }) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      lastRealtimeRoomEventAtRef.current = Date.now();
      dispatchRoomStateEvent({
        type: "server-presence-patch",
        roomId,
        members,
        playback,
        presenceRevision,
        roomRevision
      });
      void requestRoomSnapshotResyncRef.current("realtime-room-event", roomId);
      resyncRealtimePeers(members);
      if (playback.sourceSessionId === activeSessionRef.current?.userId) {
        window.setTimeout(() => {
          if (activeRouteRoomIdRef.current === roomId) {
            void ensureSourcePlaybackStartedRef.current();
          }
        }, 0);
      }
    });
    socket.on("room.library.patch", ({ tracks, queue, playback, roomRevision }) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      lastRealtimeRoomEventAtRef.current = Date.now();
      dispatchRoomStateEvent({
        type: "server-library-patch",
        roomId,
        tracks,
        queue,
        playback,
        roomRevision
      });
      void requestRoomSnapshotResyncRef.current("realtime-room-event", roomId);
    });
    socket.on("peer.signal", (payload) => {
      if (payload.roomId !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      const traceContext =
        payload.channelKind === "media" ? getRemoteMediaTraceContext(payload.fromPeerId) : null;
      recordPeerDiagnosticRef.current({
        peerId: payload.fromPeerId,
        channelKind: payload.channelKind,
        direction: "received",
        event: payload.type,
        summary:
          payload.channelKind === "media" && traceContext?.traceKey
            ? `收到 ${payload.fromPeerId} 的 ${payload.channelKind} ${payload.type} · ${traceContext.traceKey}`
            : `收到 ${payload.fromPeerId} 的 ${payload.channelKind} ${payload.type}`,
        update: (snapshot) => ({
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
            receivedOffers:
              snapshot.signalStats.receivedOffers + (payload.type === "offer" ? 1 : 0),
            receivedAnswers:
              snapshot.signalStats.receivedAnswers + (payload.type === "answer" ? 1 : 0),
            receivedCandidates:
              snapshot.signalStats.receivedCandidates + (payload.type === "candidate" ? 1 : 0)
          }
        })
      });
      if (payload.channelKind === "media") {
        void mediaMesh.handleSignal(payload).catch((error) => {
          handleSignalFailure(payload, error);
        });
        return;
      }

      void mesh.handleSignal(payload).catch((error) => {
        handleSignalFailure(payload, error);
      });
    });
    socket.on("piece.availability", (announcement: TrackAvailabilityAnnouncement) => {
      if (announcement.roomId !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }
      recordPeerDiagnosticRef.current({
        peerId: announcement.ownerPeerId,
        channelKind: "data",
        direction: "received",
        event: "piece-availability",
        summary: `收到 ${announcement.ownerPeerId} 的分片公告`,
        recordEvent: false,
        update: (snapshot) => ({
          ...withResolvedTransportHealth({
            ...snapshot,
            lastAvailabilitySeenAt: new Date().toISOString()
          })
        })
      });
      queueAvailabilityRef.current(announcement);
    });
    socket.on("piece.availability.clear", ({ roomId: clearedRoomId, ownerPeerId }) => {
      if (clearedRoomId !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }
      clearAvailabilityForPeerRef.current(ownerPeerId);
    });
    socket.on("room.session.replaced", ({ roomId: replacedRoomId }) => {
      if (replacedRoomId !== roomId) {
        return;
      }

      socket.disconnect();
      exitAndStopPresence("同一账号已在其他标签页或设备进入这个房间，当前页面已退出房间。");
    });
    socket.on("room.deleted", ({ roomId: deletedRoomId, trackIds }) => {
      if (deletedRoomId !== roomId) {
        return;
      }

      void Promise.allSettled(
        trackIds.map((trackId) => deleteUploadedTrackArtifactsRef.current(trackId))
      );
      exitAndStopPresence("房间已解散，当前房间的歌单和本地缓存已清理。");
    });
    socket.on("room.snapshot.missing", () => {
      if (isNavigatingRoomExit) {
        return;
      }

      exitAndStopPresence("这个房间已不可用，请返回音乐房重新加入。");
    });
    socket.on("connect_error", (error) => {
      recordPeerDiagnosticRef.current({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "socket-connect-error",
        level: "error",
        summary: `实时连接失败：${toUserFacingError(error)}`,
        update: (snapshot) => ({
          ...snapshot,
          lastError: toUserFacingError(error)
        })
      });
      setStatusMessage(`实时连接失败：${toUserFacingError(error)}`);
    });
    socket.on("disconnect", (reason) => {
      stopPresenceHeartbeat();
      setConnectedPeers([]);
      setMediaConnectedPeers([]);
      resetRemoteAudioElement(null);
      setMediaConnectionState(
        currentRoomRef.current?.room.playback.status === "playing" ? "reconnecting" : "idle"
      );

      if (reason === "io client disconnect") {
        return;
      }
      setStatusMessage("实时连接已断开，正在尝试重新连接…");
    });

    return () => {
      stopPresenceHeartbeat();
      if (subscribeRetryId !== null) {
        window.clearTimeout(subscribeRetryId);
      }
      if (remotePlaybackRetryRef.current !== null) {
        window.clearTimeout(remotePlaybackRetryRef.current);
        remotePlaybackRetryRef.current = null;
      }
      clearListenerMediaRecovery();
      clearHostMediaSyncRetry();
      socket.emit("room.unsubscribe", { roomId });
      socket.disconnect();
      socketRef.current = null;
      mesh.destroy();
      meshRef.current = null;
      chunkSchedulerRef.current = null;
      mediaMesh.destroy();
      mediaMeshRef.current = null;
      hostStreamRef.current = null;
      hostMediaSyncStateRef.current = {
        inFlight: false,
        lastAppliedKey: null,
        pendingKey: null,
        lastCaptureRefreshKey: null
      };
      setConnectedPeers([]);
      setMediaConnectedPeers([]);
      setMediaConnectionState("idle");
    };
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
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    chunkSchedulerRef,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    remoteAudioRef,
    resetRemoteAudioElement,
    isNavigatingRoomExit,
    setConnectedPeers,
    setMediaConnectedPeers,
    setMediaConnectionState,
    exitCurrentRoom,
    setStatusMessage,
    updateRemoteMediaDiagnostic
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !activeSession?.userId || !peerId) {
      presenceRepairKeyRef.current = null;
      return;
    }

    const localMember =
      roomSnapshot.room.members.find((member) => member.id === activeSession.userId) ?? null;
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

    const socket = socketRef.current;
    if (!socket?.connected) {
      return;
    }

    startPresenceHeartbeat();
    emitPresence();
    void requestRoomSnapshotResync("subscribe-ack", roomSnapshot.room.id);
  }, [
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.presenceRevision,
    activeSession?.userId,
    peerId,
    emitPresence,
    requestRoomSnapshotResync,
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
    initialRoomId,
    hydrated,
    activeSession?.userId,
    isNavigatingRoomExit,
    roomSnapshot?.room.id,
    requestRoomSnapshotResync
  ]);

  useEffect(() => {
    const roomId = roomSnapshot?.room.id ?? null;
    const currentTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;
    const playbackQueueVersion = roomSnapshot?.room.playback.queueVersion ?? 0;

    if (!roomId || !currentTrackId) {
      trackMetadataRepairKeyRef.current = null;
      return;
    }

    if (roomSnapshot?.tracks.some((track) => track.id === currentTrackId)) {
      trackMetadataRepairKeyRef.current = null;
      return;
    }

    const repairKey = [
      roomId,
      currentTrackId,
      playbackQueueVersion
    ].join("|");
    if (trackMetadataRepairKeyRef.current === repairKey) {
      return;
    }
    trackMetadataRepairKeyRef.current = repairKey;

    void requestRoomSnapshotResync("subscribe-ack", roomId);
  }, [
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.queueVersion,
    roomSnapshot?.tracks,
    requestRoomSnapshotResync
  ]);

  useEffect(() => {
    const currentTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;
    if (!currentTrackId) {
      return;
    }

    if (!uploadedTracks[currentTrackId]) {
      return;
    }

    void announceLocalCacheRef.current(currentTrackId);
  }, [roomSnapshot?.room.playback.currentTrackId, uploadedTracks]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId || !isCurrentSourceOwner) {
      updateSourceStartState("idle");
      return;
    }

    void ensureSourcePlaybackStarted();
  }, [
    audioUnlocked,
    ensureSourcePlaybackStarted,
    isCurrentSourceOwner,
    peerId,
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.sourceSessionId,
    roomSnapshot?.room.playback.status,
    updateSourceStartState,
    activePlaybackSource,
    mediaConnectedPeers.length
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId || !isCurrentSourceOwner) {
      return;
    }

    if (
      !audioUnlocked ||
      roomSnapshot.room.playback.status !== "playing" ||
      sourceStartState !== "live"
    ) {
      return;
    }

    void syncHostMediaStream();
  }, [
    audioUnlocked,
    isCurrentSourceOwner,
    peerId,
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status,
    roomSnapshot?.room.playback.sourceSessionId,
    roomSnapshot?.room.playback.mediaEpoch,
    activePlaybackSource,
    mediaConnectedPeers.length,
    sourceStartState,
    syncHostMediaStream
  ]);

  useEffect(() => {
    const remotePeerIds =
      roomSnapshot?.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId) ?? [];

    const syncPromise = meshRef.current?.syncPeers(remotePeerIds);
    if (!syncPromise) {
      return;
    }

    void syncPromise.catch((error) => {
      reportRealtimeFailure({
        peerId: "system",
        channelKind: "system",
        event: "mesh-sync-failed",
        summary: "Failed to sync data peers",
        error
      });
    });
  }, [roomSnapshot?.room.members, peerId, reportRealtimeFailure]);

  useEffect(() => {
    if (mediaConnectedPeers.length > 0 && connectedPeers.length === 0) {
      if (dataDegradedSinceRef.current === null) {
        dataDegradedSinceRef.current = Date.now();
      }
      return;
    }

    dataDegradedSinceRef.current = null;
  }, [connectedPeers.length, mediaConnectedPeers.length]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId || isCurrentSourceOwner) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const remotePeerIds =
        currentRoomRef.current?.room.members
          .map((member) => member.peerId)
          .filter(
            (memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId
          ) ?? [];

      if (remotePeerIds.length === 0) {
        return;
      }

      const degradedSince = dataDegradedSinceRef.current;
      if (degradedSince && Date.now() - degradedSince >= 6_000) {
        void meshRef.current?.syncPeers(remotePeerIds, { forceReconnectDegraded: true }).catch((error) => {
          reportRealtimeFailure({
            peerId: "system",
            channelKind: "system",
            event: "mesh-watchdog-resync-failed",
            summary: "Failed to recover degraded data peers",
            error
          });
        });
        dataDegradedSinceRef.current = Date.now();
        return;
      }

      const playback = currentRoomRef.current?.room.playback;
      if (playback?.status !== "playing" || !playback.currentTrackId) {
        return;
      }

      const lastActivityAt = Math.max(
        lastPieceReceivedAtRef.current,
        lastAvailabilityGrowthAtRef.current
      );
      if (Date.now() - lastActivityAt < 10_000) {
        return;
      }

      void meshRef.current?.syncPeers(remotePeerIds, { forceReconnectDegraded: true }).catch((error) => {
        reportRealtimeFailure({
          peerId: "system",
          channelKind: "system",
          event: "mesh-activity-watchdog-failed",
          summary: "Failed to recover stalled piece sync",
          error
        });
      });
      lastPieceReceivedAtRef.current = Date.now();
      lastAvailabilityGrowthAtRef.current = Date.now();
    }, 2_000);

    return () => window.clearInterval(intervalId);
  }, [currentRoomRef, isCurrentSourceOwner, peerId, reportRealtimeFailure, roomSnapshot?.room.id]);

  const playbackClockSource = useMemo(
    () =>
      roomSnapshot?.room.playback.status === "playing"
        ? activePlaybackSource !== "remote-stream"
          ? "local"
          : "remote"
        : "snapshot",
    [roomSnapshot?.room.playback.status, activePlaybackSource]
  );

  useEffect(() => {
    const effectiveSchedulerMode =
      playbackClockSource === "remote" && transportGovernorMode === "bootstrap"
        ? schedulerMode === "idle"
          ? "idle"
          : "conservative"
        : schedulerMode;

    chunkSchedulerRef.current?.sync({
      roomSnapshot,
      availabilityByTrack,
      connectedPeerIds: connectedPeers,
      uploadedTrackIds: Object.keys(uploadedTracks),
      playbackPositionMs: schedulerPlaybackBucketMs,
      playbackStatus: roomSnapshot?.room.playback.status ?? null,
      pageVisible: isPageVisible,
      mode: effectiveSchedulerMode,
      bufferHealth,
      playbackClockSource,
      policy: progressiveSchedulerPolicy ?? "startup"
    });
  }, [
    availabilityByTrack,
    connectedPeers,
    uploadedTracks,
    roomSnapshot,
    schedulerPlaybackBucketMs,
    isPageVisible,
    schedulerMode,
    bufferHealth,
    transportGovernorMode,
    playbackClockSource,
    progressiveSchedulerPolicy,
    chunkSchedulerRef
  ]);

  return {
    scheduleRemotePlaybackRetry,
    syncHostMediaStream,
    ensureSourcePlaybackStarted
  };
}
