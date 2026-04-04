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
  RoomMediaMesh
} from "@/features/p2p";
import {
  createRoomSnapshotResyncController,
  type RoomSnapshotResyncReason
} from "@/features/room/room-snapshot-resync";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import {
  getPresenceRevision,
  mergeRoomSnapshot,
  shouldAcceptPresenceSnapshot,
  shouldReplacePlaybackSnapshot,
  toUserFacingError
} from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { queueTrackPieceManifestUpsert } from "@/lib/indexeddb";
import { captureAudioStream } from "@/features/upload/audio-utils";
import { hasHostMediaStreamTrack } from "@/features/playback/host-media-sync";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import { roomAudioOutput } from "@/features/playback/room-audio-output";

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
  setRoomSnapshot: Dispatch<SetStateAction<RoomSnapshot | null>>;
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
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveSchedulerPolicy:
    | "startup"
    | "steady"
    | "catchup"
    | "pause-fill"
    | "background"
    | null;
  isCurrentSourceOwner: boolean;
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
};

type PieceTransferSample = {
  timestampMs: number;
  bytes: number;
};

type PieceTransferWindow = {
  downloads: PieceTransferSample[];
  uploads: PieceTransferSample[];
};

const pieceTransferWindowMs = 8_000;
const hostMediaSyncRetryDelayMs = 75;
const remotePlaybackRetryDelayMs = 160;
const maxRemotePlaybackRetryAttempts = 16;

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
  const oldestTimestampMs = samples[0]?.timestampMs ?? now;
  const durationMs = Math.max(1_000, now - oldestTimestampMs);
  return Math.round((totalBytes * 8) / durationMs);
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
  setRoomSnapshot,
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
  activePlaybackSource,
  progressiveSchedulerPolicy,
  isCurrentSourceOwner,
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
  const previousInitialRoomIdRef = useRef<string | null>(initialRoomId);
  const activeRouteRoomIdRef = useRef<string | null>(initialRoomId);
  const hostStreamRef = useRef<MediaStream | null>(null);
  const hostMediaSyncRetryRef = useRef<number | null>(null);
  const remotePlaybackRetryRef = useRef<number | null>(null);
  const presenceIntervalRef = useRef<number | null>(null);
  const hostMediaSyncStateRef = useRef<{
    inFlight: boolean;
    lastAppliedKey: string | null;
    pendingKey: string | null;
  }>({
    inFlight: false,
    lastAppliedKey: null,
    pendingKey: null
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
  const pieceTransferRatesRef = useRef<Map<string, PieceTransferWindow>>(new Map());
  const announceLocalCacheRef = useRef(announceLocalCache);
  const deleteUploadedTrackArtifactsRef = useRef(deleteUploadedTrackArtifacts);
  const scheduleTrackHydrationRef = useRef(scheduleTrackHydration);
  const resetPlayerSurfaceRef = useRef(resetPlayerSurface);

  const resetRemoteAudioElement = useCallback(
    (stream: MediaStream | null) => {
      const remoteAudio = remoteAudioRef.current;
      if (!remoteAudio) {
        return;
      }

      remoteAudio.pause();
      if (remoteAudio.srcObject) {
        remoteAudio.srcObject = null;
      }
      remoteAudio.load();

      if (stream) {
        remoteAudio.srcObject = stream;
      }
    },
    [remoteAudioRef]
  );

  const clearHostMediaSyncRetry = useCallback(() => {
    if (hostMediaSyncRetryRef.current !== null) {
      window.clearTimeout(hostMediaSyncRetryRef.current);
      hostMediaSyncRetryRef.current = null;
    }
  }, []);

  const stopPresenceHeartbeat = useCallback(() => {
    if (presenceIntervalRef.current !== null) {
      window.clearInterval(presenceIntervalRef.current);
      presenceIntervalRef.current = null;
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

  const exitCurrentRoom = useCallback(
    (message: string) => {
      setIsNavigatingRoomExit(true);
      setSuppressRoomRecovery(true);
      setRoomSnapshot(null);
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
      setIsNavigatingRoomExit,
      setRoomSnapshot,
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

      setRoomSnapshot((current) =>
        current?.room.id && current.room.id !== expectedRoomId
          ? current
          : mergeRoomSnapshot(current, snapshot)
      );

      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "room-snapshot-resync",
        summary: `房间状态已全量刷新（${reason}）`,
        recordEvent: false
      });
    },
    [recordPeerDiagnostic, setRoomSnapshot]
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
      setRoomSnapshot(null);
    }
  }, [
    workspaceOnly,
    initialRoomId,
    roomSnapshot?.room.id,
    setIsNavigatingRoomExit,
    setIsRecoveringRoom,
    setRoomSnapshot,
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
        if (result.ok) {
          return;
        }

        if (attempt >= maxRemotePlaybackRetryAttempts) {
          setStatusMessage("远端音频连接已建立，但播放未稳定，请点击一次播放继续。");
          return;
        }

        remotePlaybackRetryRef.current = window.setTimeout(() => {
          scheduleRemotePlaybackRetry(attempt + 1);
        }, remotePlaybackRetryDelayMs);
      });
    },
    [currentRoomRef, remoteAudioRef, setStatusMessage]
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
      listenerPeerIds.join(",")
    ].join("|");
    const syncState = hostMediaSyncStateRef.current;

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

    try {
      try {
        const audio = audioRef.current;
        if (!audio || !playback.currentTrackId) {
          await mediaMeshRef.current?.syncHostPeers([], null, playback.mediaEpoch);
          syncState.lastAppliedKey = syncKey;
          return;
        }

        if (playback.status === "playing" && audio.paused) {
          await roomAudioOutput.playElement(audio).catch(() => ({
            ok: false,
            error: "local-host-play-rejected"
          }));
        }

        const capture = captureAudioStream(audio);
        if (!capture) {
          setStatusMessage("当前浏览器不支持音频直播推送，请使用最新版 Chrome 或 Edge。");
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
    audioRef,
    clearHostMediaSyncRetry,
    currentRoomRef,
    isCurrentSourceOwner,
    peerId,
    setStatusMessage
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
          ...snapshot,
          dataCandidateType: input.sample.candidateType ?? snapshot.dataCandidateType,
          currentRoundTripTimeMs:
            snapshot.currentRoundTripTimeMs ?? input.sample.currentRoundTripTimeMs,
          availableOutgoingBitrateKbps:
            snapshot.availableOutgoingBitrateKbps ?? input.sample.availableOutgoingBitrateKbps,
          pieceDownloadRateKbps: pieceTransferRates.downloadRateKbps,
          pieceUploadRateKbps: pieceTransferRates.uploadRateKbps
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
          ...snapshot,
          mediaCandidateType: input.sample.candidateType ?? snapshot.mediaCandidateType,
          mediaProtocol: input.sample.protocol ?? snapshot.mediaProtocol,
          currentRoundTripTimeMs:
            input.sample.currentRoundTripTimeMs ?? snapshot.currentRoundTripTimeMs,
          availableOutgoingBitrateKbps:
            input.sample.availableOutgoingBitrateKbps ??
            snapshot.availableOutgoingBitrateKbps,
          mediaReceiveBitrateKbps:
            input.sample.mediaReceiveBitrateKbps ?? snapshot.mediaReceiveBitrateKbps,
          mediaSendBitrateKbps: input.sample.mediaSendBitrateKbps ?? snapshot.mediaSendBitrateKbps,
          packetsLost: input.sample.packetsLost ?? snapshot.packetsLost,
          jitterMs: input.sample.jitterMs ?? snapshot.jitterMs
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
          ...snapshot,
          pieceDownloadRateKbps: pieceTransferRates.downloadRateKbps,
          pieceUploadRateKbps: pieceTransferRates.uploadRateKbps
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

  useEffect(() => {
    return () => {
      if (remotePlaybackRetryRef.current !== null) {
        window.clearTimeout(remotePlaybackRetryRef.current);
      }
    };
  }, []);

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

        setRoomSnapshot((current) => mergeRoomSnapshot(current, snapshot));
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
    setIsRecoveringRoom,
    setSuppressRoomRecovery,
    setRoomSnapshot,
    setStatusMessage
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) {
      return;
    }

    window.localStorage.setItem(lastRoomStorageKey, roomSnapshot.room.id);
  }, [roomSnapshot?.room.id, peerId, lastRoomStorageKey]);

  useEffect(() => {
    const applyPlaybackPatch = (playback: RoomSnapshot["room"]["playback"]) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      setRoomSnapshot((current) =>
        current &&
        current.room.id === roomId &&
        shouldReplacePlaybackSnapshot(current.room.playback, playback)
          ? {
              ...current,
              room: {
                ...current.room,
                playback
              }
            }
          : current
      );
    };
    const applyPresencePatch = (
      members: RoomSnapshot["room"]["members"],
      playback: RoomSnapshot["room"]["playback"],
      presenceRevision: number
    ) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      setRoomSnapshot((current) => {
        if (
          !current ||
          current.room.id !== roomId ||
          !shouldAcceptPresenceSnapshot(
            current.room.members,
            getPresenceRevision(current.room),
            members,
            presenceRevision
          )
        ) {
          return current;
        }

        return {
          ...current,
          room: {
            ...current.room,
            members,
            presenceRevision,
            playback: shouldReplacePlaybackSnapshot(current.room.playback, playback)
              ? playback
              : current.room.playback
          }
        };
      });
    };

    if (!roomSnapshot?.room.id || !hydrated) {
      return;
    }

    const socket = createRoomSocket();
    socketRef.current = socket;
    const roomId = roomSnapshot.room.id;
    let subscribeRetryId: number | null = null;
    pieceTransferRatesRef.current.clear();
    const iceServers = getWebRTCIceServers(iceConfig);
    const emitPeerSignal = (payload: PeerSignalMessage) => {
      recordPeerDiagnostic({
        peerId: payload.toPeerId,
        channelKind: payload.channelKind,
        direction: "sent",
        event: payload.type,
        summary: `向 ${payload.toPeerId} 发送 ${payload.channelKind} ${payload.type}`,
        update: (snapshot) => ({
          ...snapshot,
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
      reportRealtimeFailure({
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
          recordPieceTransfer({
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
          mergeLocalPieceAvailability(trackId, chunkIndex, totalChunks, chunkSize);
          scheduleTrackHydrationRef.current(trackId, mimeType, totalChunks);
        },
        onPieceSent: ({ peerId: targetPeerId, payloadBytes }) => {
          recordPieceTransfer({
            peerId: targetPeerId,
            direction: "upload",
            bytes: payloadBytes
          });
        },
        onPieceRequestTimeout: ({ trackId, chunkIndex, peerId: timedOutPeerId }) => {
          chunkSchedulerRef.current?.markRequestTimeout(trackId, chunkIndex, timedOutPeerId);
        },
        onPeerConnectionChange: ({ peerId: remotePeerId, state }) => {
          recordPeerDiagnostic({
            peerId: remotePeerId,
            channelKind: "data",
            direction: "local",
            event: "connection-state",
            summary: `Data 连接状态：${state}`,
            update: (snapshot) => ({
              ...snapshot,
              dataConnectionState: state
            })
          });
          setConnectedPeers((current) => {
            const next = new Set(current);

            if (state === "connected") {
              next.add(remotePeerId);
            } else if (state === "closed" || state === "failed" || state === "disconnected") {
              next.delete(remotePeerId);
            }

            return [...next];
          });
        },
        onIceConnectionStateChange: ({ peerId: remotePeerId, state }) => {
          recordPeerDiagnostic({
            peerId: remotePeerId,
            channelKind: "data",
            direction: "local",
            event: "ice-state",
            summary: `Data ICE 状态：${state}`,
            update: (snapshot) => ({
              ...snapshot,
              dataIceState: state
            })
          });
        },
        onDataChannelStateChange: ({ peerId: remotePeerId, state }) => {
          recordPeerDiagnostic({
            peerId: remotePeerId,
            channelKind: "data",
            direction: "local",
            event: "data-channel",
            summary: `DataChannel 状态：${state}`
          });
        },
        onStatsSample: ({ peerId: remotePeerId, sample }) => {
          updateDataTransportStats({
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

          if (remoteAudio.srcObject !== stream) {
            resetRemoteAudioElement(stream);
            recordPeerDiagnostic({
              peerId: "remote-media",
              channelKind: "media",
              direction: "local",
              event: "remote-stream-bound",
              summary: stream ? "远端媒体流已绑定到音频元素" : "远端媒体流已清空",
              update: (snapshot) => ({
                ...snapshot,
                remoteTrackStatus: {
                  ...snapshot.remoteTrackStatus,
                  boundToAudioElement: !!stream,
                  lastBoundAt: stream
                    ? new Date().toISOString()
                    : snapshot.remoteTrackStatus.lastBoundAt
                }
              })
            });
          }

          if (stream) {
            scheduleRemotePlaybackRetry();
          }
        },
        onConnectionStateChange: ({ state, connectedPeerIds }) => {
          recordPeerDiagnostic({
            peerId: connectedPeerIds[0] ?? "remote-media",
            channelKind: "media",
            direction: "local",
            event: "connection-state",
            summary: `Media 连接状态：${state}`,
            update: (snapshot) => ({
              ...snapshot,
              mediaConnectionState: state
            })
          });
          setMediaConnectedPeers(connectedPeerIds);

          if (state === "connected") {
            setMediaConnectionState("buffering");
            scheduleRemotePlaybackRetry();
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
          recordPeerDiagnostic({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "ice-state",
            summary: `Media ICE 状态：${state}`,
            update: (snapshot) => ({
              ...snapshot,
              mediaIceState: state
            })
          });
        },
        onRemoteTrack: ({ peerId: remotePeerId, trackId }) => {
          const now = new Date().toISOString();
          recordPeerDiagnostic({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "remote-track",
            summary: `收到远端 track ${trackId}`,
            update: (snapshot) => ({
              ...snapshot,
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                received: true,
                lastTrackAt: now
              }
            })
          });
        },
        onSourcePeerFailed: ({ peerId: remotePeerId, mediaEpoch }) => {
          recordPeerDiagnostic({
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
          updateMediaTransportStats({
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
        reportRealtimeFailure({
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
      if (!currentSession?.userId || !peerId) {
        if (attempt >= 20) {
          return;
        }

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
          if (currentRoomRef.current?.room.playback.sourceSessionId === activeSessionRef.current?.userId) {
            void syncHostMediaStream();
          }
          void requestRoomSnapshotResync("subscribe-ack", roomId);
        }
      );
    };
    const exitAndStopPresence = (message: string) => {
      stopPresenceHeartbeat();
      exitCurrentRoom(message);
    };

    socket.on("connect", () => {
      subscribeToRoom();
      flushPendingAvailability();
      resyncRealtimePeers();
      if (currentRoomRef.current?.room.playback.sourceSessionId === activeSessionRef.current?.userId) {
        void syncHostMediaStream();
      }
      void requestRoomSnapshotResync("socket-connect", roomId);
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

      setRoomSnapshot((current) =>
        current?.room.id && current.room.id !== roomId
          ? current
          : mergeRoomSnapshot(current, snapshot)
      );

      if (!didReplayLocalAvailability) {
        didReplayLocalAvailability = true;
        for (const trackId of uploadedTrackIdsRef.current) {
          void announceLocalCacheRef.current(trackId);
        }
      }

      flushPendingAvailability();
      resyncRealtimePeers(snapshot.room.members);
      if (snapshot.room.playback.sourceSessionId === activeSessionRef.current?.userId) {
        window.setTimeout(() => {
          if (activeRouteRoomIdRef.current === roomId) {
            void syncHostMediaStream();
          }
        }, 0);
      }
    });
    socket.on("room.playback.patch", ({ playback }) => {
      applyPlaybackPatch(playback);
    });
    socket.on("room.queue.patch", ({ queue, playback }) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      setRoomSnapshot((current) =>
        current && current.room.id === roomId
          ? {
              ...current,
              queue,
              room: {
                ...current.room,
                playback: shouldReplacePlaybackSnapshot(current.room.playback, playback)
                  ? playback
                  : current.room.playback
              }
            }
          : current
      );
    });
    socket.on("room.presence.patch", ({ members, playback, presenceRevision }) => {
      applyPresencePatch(members, playback, presenceRevision);
      resyncRealtimePeers(members);
      if (playback.sourceSessionId === activeSessionRef.current?.userId) {
        window.setTimeout(() => {
          if (activeRouteRoomIdRef.current === roomId) {
            void syncHostMediaStream();
          }
        }, 0);
      }
    });
    socket.on("room.library.patch", ({ tracks, queue, playback }) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      setRoomSnapshot((current) =>
        current && current.room.id === roomId
          ? {
              ...current,
              tracks,
              queue,
              room: {
                ...current.room,
                playback: shouldReplacePlaybackSnapshot(current.room.playback, playback)
                  ? playback
                  : current.room.playback
              }
            }
          : current
      );
    });
    socket.on("peer.signal", (payload) => {
      if (payload.roomId !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      recordPeerDiagnostic({
        peerId: payload.fromPeerId,
        channelKind: payload.channelKind,
        direction: "received",
        event: payload.type,
        summary: `收到 ${payload.fromPeerId} 的 ${payload.channelKind} ${payload.type}`,
        update: (snapshot) => ({
          ...snapshot,
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
      queueAvailability(announcement);
    });
    socket.on("piece.availability.clear", ({ roomId: clearedRoomId, ownerPeerId }) => {
      if (clearedRoomId !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }
      clearAvailabilityForPeer(ownerPeerId);
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
      recordPeerDiagnostic({
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
        pendingKey: null
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
    mergeLocalPieceAvailability,
    recordPeerDiagnostic,
    flushPendingAvailability,
    queueAvailability,
    clearAvailabilityForPeer,
    clearHostMediaSyncRetry,
    requestRoomSnapshotResync,
    scheduleRemotePlaybackRetry,
    syncHostMediaStream,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    chunkSchedulerRef,
    remoteAudioRef,
    resetRemoteAudioElement,
    isNavigatingRoomExit,
    setConnectedPeers,
    setMediaConnectedPeers,
    setMediaConnectionState,
    exitCurrentRoom,
    setStatusMessage,
    updateDataTransportStats,
    updateMediaTransportStats,
    reportRealtimeFailure
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !activeSession?.userId || !peerId) {
      return;
    }

    const socket = socketRef.current;
    if (!socket?.connected) {
      return;
    }

    socket.emit(
      "room.subscribe",
      {
        roomId: roomSnapshot.room.id,
        sessionId: activeSession.userId,
        peerId
      },
      (response?: { ok?: boolean }) => {
        if (!response?.ok) {
          return;
        }

        startPresenceHeartbeat();
        void requestRoomSnapshotResync("subscribe-ack", roomSnapshot.room.id);
      }
    );
  }, [
    roomSnapshot?.room.id,
    activeSession?.userId,
    peerId,
    requestRoomSnapshotResync,
    startPresenceHeartbeat
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId || !isCurrentSourceOwner) {
      return;
    }

    void syncHostMediaStream();
  }, [
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status,
    roomSnapshot?.room.playback.sourceSessionId,
    roomSnapshot?.room.playback.mediaEpoch,
    peerId,
    isCurrentSourceOwner,
    mediaConnectedPeers.length,
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
    chunkSchedulerRef.current?.sync({
      roomSnapshot,
      availabilityByTrack,
      connectedPeerIds: connectedPeers,
      uploadedTrackIds: Object.keys(uploadedTracks),
      playbackPositionMs: schedulerPlaybackBucketMs,
      playbackStatus: roomSnapshot?.room.playback.status ?? null,
      pageVisible: isPageVisible,
      mode: schedulerMode,
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
    playbackClockSource,
    progressiveSchedulerPolicy,
    chunkSchedulerRef
  ]);

  return {
    scheduleRemotePlaybackRetry,
    syncHostMediaStream
  };
}
