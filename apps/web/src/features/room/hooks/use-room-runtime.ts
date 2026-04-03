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
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import {
  getPresenceRevision,
  shouldAcceptPlaybackSnapshot,
  shouldAcceptPresenceRevision,
  shouldReplacePlaybackSnapshot,
  toUserFacingError
} from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { queueTrackPieceManifestUpsert } from "@/lib/indexeddb";
import { captureAudioStream } from "@/features/upload/audio-utils";
import { hasHostMediaStreamTrack } from "@/features/playback/host-media-sync";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";

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
  const hostStreamRef = useRef<MediaStream | null>(null);
  const remotePlaybackRetryRef = useRef<number | null>(null);
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
  const announceLocalCacheRef = useRef(announceLocalCache);
  const deleteUploadedTrackArtifactsRef = useRef(deleteUploadedTrackArtifacts);
  const scheduleTrackHydrationRef = useRef(scheduleTrackHydration);
  const resetPlayerSurfaceRef = useRef(resetPlayerSurface);

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

      void remoteAudio.play().catch(() => {
        if (attempt >= 6) {
          setStatusMessage("远端音频连接已建立，但播放未稳定，请点击一次播放继续。");
          return;
        }

        remotePlaybackRetryRef.current = window.setTimeout(() => {
          scheduleRemotePlaybackRetry(attempt + 1);
        }, 800);
      });
    },
    [currentRoomRef, remoteAudioRef, setStatusMessage]
  );

  const syncHostMediaStream = useCallback(async () => {
    const currentRoom = currentRoomRef.current;
    if (!currentRoom?.room.id || !peerId || !isCurrentSourceOwner) {
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
      const audio = audioRef.current;
      if (!audio || !playback.currentTrackId) {
        await mediaMeshRef.current?.syncHostPeers([], null, playback.mediaEpoch);
        syncState.lastAppliedKey = syncKey;
        return;
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
        syncState.lastAppliedKey = syncKey;
      }
    } finally {
      const nextPendingKey = syncState.pendingKey;
      syncState.inFlight = false;

      if (awaitingLocalAudioTrack) {
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
  }, [audioRef, currentRoomRef, isCurrentSourceOwner, peerId, setStatusMessage]);

  const updateDataTransportStats = useCallback(
    (input: {
      peerId: string;
      sample: {
        candidateType: string | null;
        currentRoundTripTimeMs: number | null;
        availableOutgoingBitrateKbps: number | null;
      };
    }) => {
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
            snapshot.availableOutgoingBitrateKbps ?? input.sample.availableOutgoingBitrateKbps
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
          packetsLost: input.sample.packetsLost ?? snapshot.packetsLost,
          jitterMs: input.sample.jitterMs ?? snapshot.jitterMs
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
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [setIsPageVisible, setSchedulerMode]);

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

        setRoomSnapshot((current) => {
          if (
            current &&
            !shouldAcceptPlaybackSnapshot(current.room.playback, snapshot.room.playback)
          ) {
            return current;
          }

          return snapshot;
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
      setRoomSnapshot((current) =>
        current && shouldReplacePlaybackSnapshot(current.room.playback, playback)
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
      setRoomSnapshot((current) => {
        if (!current || presenceRevision <= getPresenceRevision(current.room)) {
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

    if (!roomSnapshot?.room.id || !iceConfigResolved) {
      return;
    }

    const socket = createRoomSocket();
    socketRef.current = socket;
    const roomId = roomSnapshot.room.id;
    let presenceIntervalId: number | null = null;
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

    const mesh = new P2PMesh(
      roomId,
      peerId,
      emitPeerSignal,
      {
        onPieceReceived: ({ trackId, chunkIndex, totalChunks, chunkSize, mimeType }) => {
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
            remoteAudio.srcObject = stream;
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

    const subscribeToRoom = () => {
      socket.emit("room.subscribe", {
        roomId,
        sessionId: activeSessionRef.current?.userId,
        peerId
      });
    };

    const emitPresence = () => {
      const currentSession = activeSessionRef.current;
      if (!currentSession?.userId || !peerId) {
        return;
      }

      socket.emit("room.presence", {
        roomId,
        sessionId: currentSession.userId,
        peerId
      });
    };

    const startPresenceHeartbeat = () => {
      emitPresence();
      if (presenceIntervalId !== null) {
        window.clearInterval(presenceIntervalId);
      }
      presenceIntervalId = window.setInterval(emitPresence, 10_000);
    };
    const exitCurrentRoom = (message: string) => {
      if (presenceIntervalId !== null) {
        window.clearInterval(presenceIntervalId);
        presenceIntervalId = null;
      }

      setIsNavigatingRoomExit(true);
      setSuppressRoomRecovery(true);
      setRoomSnapshot(null);
      resetPlayerSurfaceRef.current();
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage(message);
      if (workspaceOnly) {
        router.push(workspaceEntryHref as Route);
        return;
      }

      setIsNavigatingRoomExit(false);
    };

    socket.on("connect", () => {
      subscribeToRoom();
      startPresenceHeartbeat();
      flushPendingAvailability();
      const joinCode = currentRoomRef.current?.room.joinCode;
      if (joinCode) {
        setStatusMessage(`已连接到房间 ${joinCode}。`);
      }
    });
    let didReplayLocalAvailability = false;

    socket.on("room.snapshot", (snapshot: RoomSnapshot) => {
      setRoomSnapshot((current) => {
        if (
          current &&
          !shouldAcceptPresenceRevision(
            getPresenceRevision(current.room),
            getPresenceRevision(snapshot.room)
          )
        ) {
          return current;
        }

        if (
          current &&
          !shouldAcceptPlaybackSnapshot(current.room.playback, snapshot.room.playback)
        ) {
          return current;
        }

        return {
          ...snapshot,
          playlists: snapshot.playlists.length > 0 ? snapshot.playlists : current?.playlists ?? []
        };
      });

      if (!didReplayLocalAvailability) {
        didReplayLocalAvailability = true;
        for (const trackId of uploadedTrackIdsRef.current) {
          void announceLocalCacheRef.current(trackId);
        }
      }

      flushPendingAvailability();
    });
    socket.on("room.playback.patch", ({ playback }) => {
      applyPlaybackPatch(playback);
    });
    socket.on("room.queue.patch", ({ queue, playback }) => {
      setRoomSnapshot((current) =>
        current
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
    });
    socket.on("room.library.patch", ({ tracks, queue, playback }) => {
      setRoomSnapshot((current) =>
        current
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
        void mediaMesh.handleSignal(payload);
        return;
      }

      void mesh.handleSignal(payload);
    });
    socket.on("piece.availability", (announcement: TrackAvailabilityAnnouncement) => {
      queueAvailability(announcement);
    });
    socket.on("room.session.replaced", ({ roomId: replacedRoomId }) => {
      if (replacedRoomId !== roomId) {
        return;
      }

      socket.disconnect();
      exitCurrentRoom("同一账号已在其他标签页或设备进入这个房间，当前页面已退出房间。");
    });
    socket.on("room.deleted", ({ roomId: deletedRoomId, trackIds }) => {
      if (deletedRoomId !== roomId) {
        return;
      }

      void Promise.allSettled(
        trackIds.map((trackId) => deleteUploadedTrackArtifactsRef.current(trackId))
      );
      exitCurrentRoom("鎴块棿宸茶В鏁ｏ紝褰撳墠鎴块棿鐨勬瓕鍗曞拰鏈湴缂撳瓨宸叉竻鐞嗐€?");
      return;
      setIsNavigatingRoomExit(true);
      setSuppressRoomRecovery(true);
      setRoomSnapshot(null);
      resetPlayerSurfaceRef.current();
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage("房间已解散，当前房间的歌单和本地缓存已清理。");
      if (workspaceOnly) {
        router.push(workspaceEntryHref as Route);
        return;
      }

      setIsNavigatingRoomExit(false);
    });
    socket.on("room.snapshot.missing", () => {
      if (isNavigatingRoomExit) {
        return;
      }

      exitCurrentRoom("杩欎釜鎴块棿宸蹭笉鍙敤锛岃杩斿洖闊充箰鎴块噸鏂板姞鍏ャ€?");
      return;
      setIsNavigatingRoomExit(true);
      setSuppressRoomRecovery(true);
      setRoomSnapshot(null);
      resetPlayerSurfaceRef.current();
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage("这个房间已不可用，请返回音乐房重新加入。");
      if (workspaceOnly) {
        router.push(workspaceEntryHref as Route);
        return;
      }

      setIsNavigatingRoomExit(false);
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
      if (presenceIntervalId !== null) {
        window.clearInterval(presenceIntervalId);
        presenceIntervalId = null;
      }

      if (reason === "io client disconnect") {
        return;
      }
      setStatusMessage("实时连接已断开，正在尝试重新连接…");
    });

    return () => {
      if (presenceIntervalId !== null) {
        window.clearInterval(presenceIntervalId);
      }
      if (remotePlaybackRetryRef.current !== null) {
        window.clearTimeout(remotePlaybackRetryRef.current);
        remotePlaybackRetryRef.current = null;
      }
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
    scheduleRemotePlaybackRetry,
    chunkSchedulerRef,
    remoteAudioRef,
    workspaceOnly,
    isNavigatingRoomExit,
    router,
    lastRoomStorageKey,
    workspaceEntryHref,
    setConnectedPeers,
    setMediaConnectedPeers,
    setMediaConnectionState,
    setRoomSnapshot,
    setIsNavigatingRoomExit,
    setSuppressRoomRecovery,
    setStatusMessage,
    updateDataTransportStats,
    updateMediaTransportStats
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

    void meshRef.current?.syncPeers(remotePeerIds);
  }, [roomSnapshot?.room.members, peerId]);

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
