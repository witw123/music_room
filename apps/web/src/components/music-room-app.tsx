"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type {
  IceConfigResponse,
  Playlist,
  RoomMediaConnectionState,
  RoomSnapshot,
  PeerSignalMessage,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import {
  ChunkScheduler,
  getWebRTCIceServers,
  RoomMediaMesh,
  P2PMesh,
  useAvailabilityAnnouncements,
  usePeerDiagnostics
} from "@/features/p2p";
import { shouldAcceptPlaybackSnapshot, toUserFacingError } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { createRoomSocket, type RoomSocket } from "@/lib/ws-client";
import { TopBar } from "@/components/TopBar";
import { BottomPlayer } from "@/components/BottomPlayer";
import { RoomDashboardView } from "@/components/room/RoomDashboardView";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { getPlaybackEffectivePositionMs, useRoomPlayback } from "@/features/playback/use-room-playback";
import { syncLocalPlaybackWindow } from "@/features/playback/playback-sync";
import { hasHostMediaStreamTrack } from "@/features/playback/host-media-sync";
import {
  buildProgressiveHealthSnapshot,
  buildProgressiveTrackManifest,
  canUseProgressivePlayback,
  getEffectivePlaybackPositionMs,
  getCriticalBufferThresholdMs,
  getProgressiveEngineType,
  type ProgressivePlaybackSource
} from "@/features/playback/progressive-playback";
import { ProgressiveMseEngine } from "@/features/playback/progressive-mse-engine";
import { ProgressivePcmEngine } from "@/features/playback/progressive-pcm-engine";
import {
  getInitialProgressivePlaybackSource,
  resolveFullLocalWarmupDecision,
  resolveProgressiveWarmupDecision
} from "@/features/playback/progressive-source-controller";
import { captureAudioStream } from "@/features/upload/audio-utils";
import { useTrackUploads } from "@/features/upload/use-track-uploads";
import { useRoomActions } from "@/features/room/hooks/use-room-actions";
import { buildAppEntryHref, buildWorkspaceAuthHref } from "@/lib/client-shell";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";
import { EmptyRoomState, RoomTransitionState } from "@/components/room/RoomPageStates";
import { useTrackHydrationQueue } from "@/components/room/hooks/use-track-hydration-queue";
import { useRoomDerivedState } from "@/components/room/hooks/use-room-derived-state";
import { useRoomLifecycleActions } from "@/components/room/hooks/use-room-lifecycle-actions";
import { upsertTrackPieceManifest } from "@/lib/indexeddb";

const lastRoomStorageKey = "music-room-last-room";
const peerStorageKey = "music-room-peer-id";
const maxCachedTracks = 24;

type MusicRoomAppProps = {
  workspaceOnly?: boolean;
  initialRoomId?: string | null;
};

export function MusicRoomApp({
  workspaceOnly = true,
  initialRoomId = null
}: MusicRoomAppProps) {
  const router = useRouter();
  const clientPlatform = getClientPlatformFromBrowser();
  const workspaceEntryHref = buildAppEntryHref(clientPlatform);
  const authEntryHref = buildWorkspaceAuthHref({
    clientPlatform,
    redirectTo: initialRoomId ? `/room/${initialRoomId}` : workspaceEntryHref
  });
  const audioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const meshRef = useRef<P2PMesh | null>(null);
  const chunkSchedulerRef = useRef<ChunkScheduler | null>(null);
  const mediaMeshRef = useRef<RoomMediaMesh | null>(null);
  const progressiveEngineRef = useRef<ProgressiveMseEngine | null>(null);
  const progressivePcmEngineRef = useRef<ProgressivePcmEngine | null>(null);
  const progressiveWarmupReadyAtRef = useRef<number | null>(null);
  const fullLocalWarmupReadyAtRef = useRef<number | null>(null);
  const remoteHoldTimeoutRef = useRef<number | null>(null);
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
  const [isPending, startTransition] = useTransition();
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [availableRooms, setAvailableRooms] = useState<RoomSnapshot[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [mediaConnectedPeers, setMediaConnectedPeers] = useState<string[]>([]);
  const [peerId, setPeerId] = useState("");
  const [suppressRoomRecovery, setSuppressRoomRecovery] = useState(false);
  const [isRecoveringRoom, setIsRecoveringRoom] = useState(false);
  const [isNavigatingRoomExit, setIsNavigatingRoomExit] = useState(false);
  const [mediaConnectionState, setMediaConnectionState] =
    useState<RoomMediaConnectionState>("idle");
  const [iceConfig, setIceConfig] = useState<IceConfigResponse | null>(null);
  const [iceConfigResolved, setIceConfigResolved] = useState(false);
  const [activeDashboardTab, setActiveDashboardTab] = useState<"queue" | "library" | "members">("queue");
  const [isPageVisible, setIsPageVisible] = useState(
    typeof document === "undefined" ? true : !document.hidden
  );
  const [schedulerMode, setSchedulerMode] = useState<"normal" | "conservative" | "idle">("normal");
  const [bufferHealth, setBufferHealth] = useState<"healthy" | "low" | "critical">("healthy");
  const [activePlaybackSource, setActivePlaybackSource] =
    useState<ProgressivePlaybackSource>("remote-stream");
  const [progressiveFallbackReason, setProgressiveFallbackReason] = useState<string | null>(null);
  const [progressiveTickAt, setProgressiveTickAt] = useState(() => Date.now());
  const {
    activeSession,
    hydrated,
    statusMessage,
    setStatusMessage,
    clearIdentity,
    refreshSession
  } = useSessionIdentity({
    initialStatusMessage: "登录后即可进入你的音乐房。",
    sessionStorageKey: "music-room-session"
  });
  const activeSessionRef = useRef(activeSession);
  const currentRoomRef = useRef<RoomSnapshot | null>(null);
  const uploadedTrackIdsRef = useRef<string[]>([]);
  const {
    availabilityByTrack,
    queueAvailability,
    mergeAvailability,
    mergeLocalPieceAvailability,
    emitAvailability: stableEmitAvailability,
    flushPendingAvailability
  } = useAvailabilityAnnouncements({
    peerId,
    socketRef,
    activeSessionRef,
    currentRoomRef
  });
  const {
    peerDiagnostics,
    peerRecentEvents,
    recordPeerDiagnostic
  } = usePeerDiagnostics();
  const canControlPlayback = !!activeSession && !!roomSnapshot;
  const canDeleteRoom = !!activeSession && roomSnapshot?.room.hostId === activeSession.userId;
  const canReorderQueue = canDeleteRoom;
  const isCurrentSourceOwner =
    !!activeSession && roomSnapshot?.room.playback.sourceSessionId === activeSession.userId;
  const currentPlaybackTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;

  const {
    uploadedTracks,
    cachedTrackCount,
    handleFilesSelected: handleTrackFilesSelected,
    announceLocalCache,
    hydrateTrackFromPieces,
    deleteUploadedTrackArtifacts
  } = useTrackUploads({
    maxCachedTracks,
    peerId,
    activeSession,
    roomSnapshot,
    setRoomSnapshot,
    setStatusMessage,
    onAvailability: mergeAvailability,
    emitAvailability: stableEmitAvailability
  });
  const announceLocalCacheRef = useRef(announceLocalCache);
  const shouldUseLocalPlayback = activePlaybackSource !== "remote-stream";
  const getLocalPlaybackPositionMs = useCallback(() => {
    if (activePlaybackSource !== "progressive-local") {
      return null;
    }

    const pcmEngine = progressivePcmEngineRef.current;
    if (!pcmEngine) {
      return null;
    }

    const currentTimeSeconds = pcmEngine.getCurrentTimeSeconds();
    return Number.isFinite(currentTimeSeconds) ? Math.round(currentTimeSeconds * 1000) : null;
  }, [activePlaybackSource]);
  const {
    progressTrack,
    progressMs,
    setProgressMs,
    seekDraft,
    setSeekDraft,
    audioDurationMs,
    setAudioDurationMs,
    volume,
    setVolume,
    syncProgressFromAudio,
    syncDurationFromAudio
  } = useRoomPlayback({
    audioRef,
    remoteAudioRef,
    playback: roomSnapshot?.room.playback,
    tracks: roomSnapshot?.tracks ?? [],
    shouldUseLocalAudio: shouldUseLocalPlayback,
    getLocalPlaybackPositionMs
  });
  const { scheduleTrackHydration, resetHydrationQueue } = useTrackHydrationQueue({
    isPageVisible,
    uploadedTrackIdsRef,
    chunkSchedulerRef,
    canHydrateTrack: (trackId) => {
      if (trackId !== currentPlaybackTrackId) {
        return true;
      }

      return (
        roomSnapshot?.room.playback.status !== "playing" ||
        progressiveSchedulerPolicy === "steady" ||
        progressiveSchedulerPolicy === "background"
      );
    },
    hydrateTrackFromPieces
  });
  const getCurrentPlaybackPositionMs = () => {
    if (shouldUseLocalPlayback) {
      const pcmPlaybackPositionMs = getLocalPlaybackPositionMs();
      if (pcmPlaybackPositionMs !== null) {
        return pcmPlaybackPositionMs;
      }

      const audio = audioRef.current;
      if (audio && Number.isFinite(audio.currentTime)) {
        return Math.round(audio.currentTime * 1000);
      }
    }

    return progressMs;
  };
  const {
    leaveRoom,
    deleteRoom,
    deleteTrack,
    addToQueue,
    playTrack,
    playQueueItem,
    pauseTrack,
    prevTrack,
    nextTrack,
    savePlaylistFromQueue,
    updatePlaylistTitle,
    updatePlaylistTracks,
    deletePlaylist,
    loadPlaylistIntoRoom,
    removeQueueItem,
    reorderQueue,
    seekTrack,
    handleEnded
  } = useRoomActions({
    activeSession,
    roomSnapshot,
    progressMs,
    setRoomSnapshot,
    setAvailableRooms,
    setPlaylists,
    setStatusMessage,
    refreshAvailableRooms,
    refreshPlaylists,
    resetPlayerSurface,
    lastRoomStorageKey,
    getCurrentPlaybackPositionMs,
    onTrackDeleted: (trackId) => deleteUploadedTrackArtifacts(trackId),
    onRoomDeleted: async (trackIds) => {
      await Promise.all(trackIds.map((trackId) => deleteUploadedTrackArtifacts(trackId)));
    }
  });
  const {
    handleClearIdentity,
    handleLeaveRoomAction,
    handleDeleteRoomAction,
    handleLogout
  } = useRoomLifecycleActions({
    workspaceOnly,
    workspaceEntryHref,
    authEntryHref,
    router,
    clearIdentity,
    resetPlayerSurface,
    setSuppressRoomRecovery,
    setRoomSnapshot,
    setPlaylists,
    leaveRoom,
    deleteRoom,
    setIsNavigatingRoomExit
  });

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    currentRoomRef.current = roomSnapshot;
  }, [roomSnapshot]);

  useEffect(() => {
    uploadedTrackIdsRef.current = Object.keys(uploadedTracks);
  }, [uploadedTracks]);

  useEffect(() => {
    announceLocalCacheRef.current = announceLocalCache;
  }, [announceLocalCache]);

  useEffect(() => {
    if (!currentPlaybackTrackId) {
      setActivePlaybackSource("remote-stream");
      setProgressiveFallbackReason(null);
      progressiveWarmupReadyAtRef.current = null;
      fullLocalWarmupReadyAtRef.current = null;
      return;
    }

    setActivePlaybackSource(
      getInitialProgressivePlaybackSource(!!uploadedTracks[currentPlaybackTrackId])
    );
    setProgressiveFallbackReason(null);
    progressiveWarmupReadyAtRef.current = null;
    fullLocalWarmupReadyAtRef.current = null;
  }, [currentPlaybackTrackId]);

  useEffect(() => {
    if (!currentPlaybackTrackId) {
      return;
    }

    const tick = window.setInterval(() => {
      setProgressiveTickAt(Date.now());
    }, 500);

    return () => window.clearInterval(tick);
  }, [currentPlaybackTrackId]);

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
  }, []);

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
    [setStatusMessage]
  );

  useEffect(() => {
    return () => {
      if (remotePlaybackRetryRef.current !== null) {
        window.clearTimeout(remotePlaybackRetryRef.current);
      }
      if (remoteHoldTimeoutRef.current !== null) {
        window.clearTimeout(remoteHoldTimeoutRef.current);
      }
      progressiveEngineRef.current?.destroy();
      progressivePcmEngineRef.current?.destroy();
    };
  }, []);

  const applyPlaybackPatch = useCallback((playback: RoomSnapshot["room"]["playback"]) => {
    setRoomSnapshot((current) =>
      current && shouldAcceptPlaybackSnapshot(current.room.playback, playback)
        ? {
            ...current,
            room: {
              ...current.room,
              playback
            }
          }
        : current
    );
  }, []);

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
  }, [roomSnapshot?.room.id, activeSession?.userId, recordPeerDiagnostic]);

  useEffect(() => {
    if (!statusMessage) return;
    const t = setTimeout(() => {
      setStatusMessage("");
    }, 4000);
    return () => clearTimeout(t);
  }, [statusMessage, setStatusMessage]);

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
  }, [workspaceOnly, initialRoomId, activeSession, hydrated, router, authEntryHref]);

  useEffect(() => {
    const storedPeerId = window.sessionStorage.getItem(peerStorageKey);
    if (storedPeerId) {
      setPeerId(storedPeerId);
      return;
    }

    const nextPeerId = `peer_${crypto.randomUUID()}`;
    window.sessionStorage.setItem(peerStorageKey, nextPeerId);
    setPeerId(nextPeerId);
  }, []);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshAvailableRooms();
    void refreshPlaylists();
  }, [activeSession]);

  useEffect(() => {
    if (
      suppressRoomRecovery ||
      !workspaceOnly ||
      !initialRoomId ||
      !activeSession ||
      roomSnapshot?.room.id === initialRoomId
    ) {
      return;
    }

    let cancelled = false;
    setIsRecoveringRoom(true);

    void (async () => {
      try {
        const snapshot = await musicRoomApi.recoverRoom(initialRoomId);
        if (!snapshot || cancelled) {
          if (!cancelled) {
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
  }, [workspaceOnly, initialRoomId, activeSession?.userId, roomSnapshot?.room.id, suppressRoomRecovery]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) {
      return;
    }

    window.localStorage.setItem(lastRoomStorageKey, roomSnapshot.room.id);
  }, [roomSnapshot?.room.id, peerId]);

  useEffect(() => {
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
          const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
          if (track) {
            void upsertTrackPieceManifest({
              trackId,
              fileHash: track.fileHash,
              mimeType: track.mimeType || mimeType || "audio/mpeg",
              codec: track.codec ?? null,
              sizeBytes: track.sizeBytes ?? null,
              durationMs: track.durationMs,
              totalChunks,
              chunkSize
            });
          }
          chunkSchedulerRef.current?.markPieceReceived(trackId, chunkIndex, totalChunks);
          mergeLocalPieceAvailability(trackId, chunkIndex, totalChunks, chunkSize);
          void announceLocalCacheRef.current(trackId, totalChunks);
          scheduleTrackHydration(trackId, mimeType, totalChunks);
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
                  lastBoundAt: stream ? new Date().toISOString() : snapshot.remoteTrackStatus.lastBoundAt
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
        }
      }
    );
    mediaMeshRef.current = mediaMesh;

    const subscribeToRoom = () => {
      socket.emit("room.subscribe", {
        roomId,
        sessionId: activeSession?.userId,
        peerId
      });
    };

    const emitPresence = () => {
      if (!activeSession?.userId || !peerId) {
        return;
      }

      socket.emit("room.presence", {
        roomId,
        sessionId: activeSession.userId,
        peerId
      });
    };

    const startPresenceHeartbeat = () => {
      emitPresence();
      if (presenceIntervalId !== null) {
        window.clearInterval(presenceIntervalId);
      }
      presenceIntervalId = window.setInterval(emitPresence, 10000);
    };

    socket.on("connect", () => {
      subscribeToRoom();
      startPresenceHeartbeat();
      flushPendingAvailability();
      setStatusMessage(`已连接到房间 ${roomSnapshot.room.joinCode}。`);
    });
    let didReplayLocalAvailability = false;

    socket.on("room.snapshot", (snapshot: RoomSnapshot) => {
      setRoomSnapshot((current) => {
        if (
          current &&
          !shouldAcceptPlaybackSnapshot(current.room.playback, snapshot.room.playback)
        ) {
          return current;
        }

        return {
          ...snapshot,
          playlists: snapshot.playlists.length > 0 ? snapshot.playlists : (current?.playlists ?? [])
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
                playback: shouldAcceptPlaybackSnapshot(current.room.playback, playback)
                  ? playback
                  : current.room.playback
              }
            }
          : current
      );
    });
    socket.on("room.presence.patch", ({ members, playback }) => {
      setRoomSnapshot((current) =>
        current
          ? {
              ...current,
              room: {
                ...current.room,
                members,
                playback: shouldAcceptPlaybackSnapshot(current.room.playback, playback)
                  ? playback
                  : current.room.playback
              }
            }
          : current
      );
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
                playback: shouldAcceptPlaybackSnapshot(current.room.playback, playback)
                  ? playback
                  : current.room.playback
              }
            }
          : current
      );
    });
    socket.on("peer.signal", (payload: PeerSignalMessage) => {
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
    socket.on("room.deleted", ({ roomId: deletedRoomId, trackIds }) => {
      if (deletedRoomId !== roomId) {
        return;
      }

      void Promise.allSettled(trackIds.map((trackId) => deleteUploadedTrackArtifacts(trackId)));
      setIsNavigatingRoomExit(true);
      setSuppressRoomRecovery(true);
      resetPlayerSurface();
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage("房间已解散，当前房间的歌单和本地缓存已清理。");
      if (workspaceOnly) {
        router.push(workspaceEntryHref as Route);
      }
    });
    socket.on("room.snapshot.missing", () => {
      if (isNavigatingRoomExit) {
        return;
      }

      setIsNavigatingRoomExit(true);
      setSuppressRoomRecovery(true);
      resetPlayerSurface();
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage("这个房间已不可用，请返回音乐房重新加入。");
      if (workspaceOnly) {
        router.push(workspaceEntryHref as Route);
      }
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
    roomSnapshot?.room.joinCode,
    iceConfig,
    iceConfigResolved,
    peerId,
    activeSession?.userId,
    mergeLocalPieceAvailability,
    deleteUploadedTrackArtifacts,
    recordPeerDiagnostic,
    applyPlaybackPatch,
    flushPendingAvailability,
    queueAvailability,
    scheduleRemotePlaybackRetry,
    workspaceOnly,
    isNavigatingRoomExit,
    router
  ]);

  const playback = roomSnapshot?.room.playback;

  useEffect(() => {
    if (!playback?.currentTrackId || playback.status !== "playing") {
      setSchedulerMode(isPageVisible ? "normal" : "idle");
    }
  }, [isPageVisible, playback?.currentTrackId, playback?.status]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!playback?.currentTrackId) {
      progressiveEngineRef.current?.destroy();
      progressiveEngineRef.current = null;
      progressivePcmEngineRef.current?.destroy();
      progressivePcmEngineRef.current = null;
      audio.pause();
      audio.srcObject = null;
      audio.removeAttribute("src");
      audio.load();
      remoteAudioRef.current?.pause();
      setAudioDurationMs(0);
      setProgressMs(0);
      setMediaConnectionState("idle");
      return;
    }

    const remoteAudio = remoteAudioRef.current;
    const uploaded = uploadedTracks[playback.currentTrackId];
    const shouldWarmBufferedFullLocal =
      !!uploaded &&
      !isCurrentSourceOwner &&
      !progressiveEngineRef.current &&
      !progressivePcmEngineRef.current;
    const expectedSeconds =
      getPlaybackEffectivePositionMs(playback, progressTrack?.durationMs ?? 0) / 1000;

    if (activePlaybackSource === "full-local" && uploaded) {
      if (remoteAudio) {
        remoteAudio.pause();
        remoteAudio.srcObject = null;
        remoteAudio.load();
      }

      if (audio.srcObject) {
        audio.srcObject = null;
      }
      if (audio.src !== uploaded.objectUrl) {
        audio.src = uploaded.objectUrl;
        audio.load();
      }

      syncLocalPlaybackWindow(audio, expectedSeconds, playback.status === "playing");

      if (playback.status === "playing") {
        void audio.play().catch(() => {
          setStatusMessage("浏览器阻止了自动播放，请手动点击播放恢复。");
        });
        setMediaConnectionState(isCurrentSourceOwner ? "live" : "buffering");
      }

      if (playback.status === "paused") {
        audio.pause();
        audio.playbackRate = 1;
        setMediaConnectionState("idle");
      }
      return;
    }

    if (activePlaybackSource === "progressive-local") {
      const pcmEngine = progressivePcmEngineRef.current;
      if (pcmEngine) {
        audio.muted = false;
        void pcmEngine
          .syncPlayback(expectedSeconds, playback.status === "playing")
          .then((result) => {
            if (playback.status === "playing" && !result.localReady) {
              setProgressiveFallbackReason("buffer-underrun");
              setActivePlaybackSource("remote-stream");
            }
          })
          .catch(() => {
            setProgressiveFallbackReason("progressive-init-failed");
            setActivePlaybackSource("remote-stream");
          });
        return;
      }

      audio.muted = false;
      syncLocalPlaybackWindow(audio, expectedSeconds, playback.status === "playing", {
        softDriftMs: 120,
        hardDriftMs: 900
      });

      if (playback.status === "playing") {
        void audio.play().catch(() => {
          setStatusMessage("浏览器阻止了自动播放，请手动点击播放恢复。");
        });
      } else {
        audio.pause();
        audio.playbackRate = 1;
      }

      return;
    }

    if (activePlaybackSource === "remote-stream") {
      if (!shouldWarmBufferedFullLocal) {
        audio.pause();
        audio.muted = false;
      }
      if (!progressiveEngineRef.current && !progressivePcmEngineRef.current && !shouldWarmBufferedFullLocal) {
        if (audio.srcObject) {
          audio.srcObject = null;
        }
        audio.removeAttribute("src");
        audio.load();
      } else if (
        shouldWarmBufferedFullLocal &&
        uploaded &&
        audio.src !== uploaded.objectUrl
      ) {
        if (audio.srcObject) {
          audio.srcObject = null;
        }
        audio.src = uploaded.objectUrl;
        audio.load();
      }

      if (remoteAudio) {
        remoteAudio.muted = false;
        if (playback.status === "playing") {
          void remoteAudio.play().catch(() => {
            setStatusMessage("浏览器阻止了远端音频自动播放，请再次点击页面继续。");
          });
        } else if (playback.status === "paused") {
          remoteAudio.pause();
        }
      }
      return;
    }

    if (playback.status === "paused") {
      audio.pause();
      audio.playbackRate = 1;
    }
  }, [
    playback?.currentTrackId,
    playback?.status,
    playback?.positionMs,
    playback?.startedAt,
    playback?.mediaEpoch,
    progressTrack?.durationMs,
    uploadedTracks,
    activePlaybackSource,
    isCurrentSourceOwner
  ]);

  const currentTrack = progressTrack;
  const currentBufferedFullLocalTrack =
    currentTrack?.id ? uploadedTracks[currentTrack.id] ?? null : null;
  const currentTrackAvailabilityAnnouncement =
    currentTrack?.id ? availabilityByTrack[currentTrack.id]?.[peerId] ?? null : null;
  const currentProgressiveManifest = buildProgressiveTrackManifest(
    currentTrack,
    currentTrackAvailabilityAnnouncement
  );
  const currentProgressiveEngineType = getProgressiveEngineType(currentProgressiveManifest);
  const progressiveHealthSnapshot = buildProgressiveHealthSnapshot({
    playback: roomSnapshot?.room.playback,
    activeSource: activePlaybackSource,
    manifest: currentProgressiveManifest,
    localAvailability: currentTrackAvailabilityAnnouncement,
    fallbackReason: progressiveFallbackReason
  });
  const progressiveSchedulerPolicy = progressiveHealthSnapshot.schedulerPolicy;
  const canPrepareProgressiveLocal =
    !isCurrentSourceOwner &&
    activePlaybackSource !== "full-local" &&
    !!currentProgressiveManifest &&
    canUseProgressivePlayback() &&
    currentProgressiveEngineType !== "none";
  const canWarmBufferedFullLocal =
    !isCurrentSourceOwner &&
    activePlaybackSource !== "full-local" &&
    activePlaybackSource !== "progressive-local" &&
    !!currentBufferedFullLocalTrack &&
    currentProgressiveEngineType === "none";

  useEffect(() => {
    const localAudio = audioRef.current;
    const remoteAudio = remoteAudioRef.current;

    const handlePlaying = () => {
      setSchedulerMode("normal");
      setBufferHealth("healthy");
      setMediaConnectionState((current) =>
        current === "idle" && !(roomSnapshot?.room.playback.currentTrackId) ? current : "live"
      );
    };
    const handleWaiting = () => {
      setSchedulerMode("conservative");
      setBufferHealth("low");
      if (activePlaybackSource === "progressive-local") {
        setProgressiveFallbackReason("buffer-underrun");
        setActivePlaybackSource("remote-stream");
      }
      setMediaConnectionState((current) => (current === "failed" ? current : "buffering"));
    };
    const handleStalled = () => {
      setSchedulerMode("conservative");
      setBufferHealth("critical");
      if (activePlaybackSource === "progressive-local") {
        setProgressiveFallbackReason("stalled");
        setActivePlaybackSource("remote-stream");
      }
      setMediaConnectionState((current) => (current === "failed" ? current : "buffering"));
    };
    const handlePause = () => {
      if (roomSnapshot?.room.playback.status !== "playing") {
        setSchedulerMode(isPageVisible ? "normal" : "idle");
        setBufferHealth("healthy");
      }
    };
    const handleLocalSeeked = () => {
      if (activePlaybackSource !== "progressive-local" || !localAudio || !currentProgressiveManifest) {
        return;
      }

      const soughtPositionMs = Math.round(localAudio.currentTime * 1000);
      if (soughtPositionMs <= progressiveHealthSnapshot.contiguousBufferedMs) {
        return;
      }

      setSchedulerMode("conservative");
      setBufferHealth("critical");
      setProgressiveFallbackReason("seek-outside-buffer");
      setActivePlaybackSource("remote-stream");
    };

    localAudio?.addEventListener("playing", handlePlaying);
    remoteAudio?.addEventListener("playing", handlePlaying);
    localAudio?.addEventListener("waiting", handleWaiting);
    remoteAudio?.addEventListener("waiting", handleWaiting);
    localAudio?.addEventListener("stalled", handleStalled);
    remoteAudio?.addEventListener("stalled", handleStalled);
    localAudio?.addEventListener("pause", handlePause);
    remoteAudio?.addEventListener("pause", handlePause);
    localAudio?.addEventListener("seeked", handleLocalSeeked);

    return () => {
      localAudio?.removeEventListener("playing", handlePlaying);
      remoteAudio?.removeEventListener("playing", handlePlaying);
      localAudio?.removeEventListener("waiting", handleWaiting);
      remoteAudio?.removeEventListener("waiting", handleWaiting);
      localAudio?.removeEventListener("stalled", handleStalled);
      remoteAudio?.removeEventListener("stalled", handleStalled);
      localAudio?.removeEventListener("pause", handlePause);
      remoteAudio?.removeEventListener("pause", handlePause);
      localAudio?.removeEventListener("seeked", handleLocalSeeked);
    };
  }, [
    activePlaybackSource,
    currentProgressiveManifest,
    isPageVisible,
    progressiveHealthSnapshot.contiguousBufferedMs,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status
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
    isCurrentSourceOwner,
    peerId,
    mediaConnectedPeers.length
  ]);

  useEffect(() => {
    const nextPlayback = roomSnapshot?.room.playback;

    if (!nextPlayback?.currentTrackId) {
      setMediaConnectionState("idle");
      return;
    }

    if (isCurrentSourceOwner) {
      return;
    }

    if (shouldUseLocalPlayback) {
      setMediaConnectionState(nextPlayback.status === "playing" ? "live" : "idle");
      return;
    }

    if (nextPlayback.status === "paused") {
      setMediaConnectionState((current) => (current === "live" ? "buffering" : current));
      return;
    }

    setMediaConnectionState((current) => {
      if (current === "live" || current === "buffering") {
        return current;
      }

      return mediaConnectedPeers.length > 0 ? "buffering" : "connecting";
    });
  }, [roomSnapshot?.room.playback, isCurrentSourceOwner, mediaConnectedPeers.length, shouldUseLocalPlayback]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!canPrepareProgressiveLocal || !currentProgressiveManifest) {
      progressiveEngineRef.current?.destroy();
      progressiveEngineRef.current = null;
      progressivePcmEngineRef.current?.destroy();
      progressivePcmEngineRef.current = null;
      return;
    }

    progressiveEngineRef.current?.destroy();
    progressiveEngineRef.current = null;
    progressivePcmEngineRef.current?.destroy();
    progressivePcmEngineRef.current = null;

    const engine =
      currentProgressiveEngineType === "pcm"
        ? new ProgressivePcmEngine(audio, peerId, currentProgressiveManifest)
        : new ProgressiveMseEngine(audio, peerId, currentProgressiveManifest);

    if (engine instanceof ProgressivePcmEngine) {
      progressivePcmEngineRef.current = engine;
      engine.setVolume(volume);
    } else {
      progressiveEngineRef.current = engine;
    }

    void engine
      .attach()
      .then((attached) => {
        if (!attached) {
          setProgressiveFallbackReason("progressive-init-failed");
          setActivePlaybackSource("remote-stream");
          return;
        }

        return engine.sync();
      })
      .catch(() => {
        setProgressiveFallbackReason("progressive-init-failed");
        setActivePlaybackSource("remote-stream");
      });

    return () => {
      if (progressiveEngineRef.current === engine) {
        progressiveEngineRef.current = null;
      }
      if (progressivePcmEngineRef.current === engine) {
        progressivePcmEngineRef.current = null;
      }
      engine.destroy();
    };
  }, [
    canPrepareProgressiveLocal,
    currentProgressiveManifest?.trackId,
    currentProgressiveManifest?.mimeType,
    currentProgressiveManifest?.totalChunks,
    currentProgressiveManifest?.chunkSize,
    currentProgressiveEngineType,
    peerId
  ]);

  useEffect(() => {
    if (!currentProgressiveManifest) {
      return;
    }

    void progressiveEngineRef.current?.sync();
    void progressivePcmEngineRef.current?.sync();
  }, [currentProgressiveManifest?.trackId, currentTrackAvailabilityAnnouncement?.availableChunks]);

  useEffect(() => {
    progressivePcmEngineRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const audio = audioRef.current;
    const mseEngine = progressiveEngineRef.current;
    const pcmEngine = progressivePcmEngineRef.current;
    if (
      !playback?.currentTrackId ||
      !audio ||
      (!mseEngine && !pcmEngine) ||
      !currentProgressiveManifest ||
      activePlaybackSource === "full-local"
    ) {
      progressiveWarmupReadyAtRef.current = null;
      return;
    }

    const expectedSeconds =
      getEffectivePlaybackPositionMs(playback, currentProgressiveManifest.durationMs, progressiveTickAt) /
      1000;

    if (playback.status !== "playing") {
      if (pcmEngine) {
        void pcmEngine.syncPlayback(expectedSeconds, false);
      }
      audio.pause();
      audio.muted = false;
      progressiveWarmupReadyAtRef.current = null;
      return;
    }

    let cancelled = false;

    void (async () => {
      const startupReady =
        progressiveHealthSnapshot.startupReady &&
        progressiveHealthSnapshot.fallbackReason === null;
      let engineReady = false;
      let localReady = false;
      let driftMs = Number.POSITIVE_INFINITY;

      if (pcmEngine) {
        const syncResult = await pcmEngine.syncPlayback(expectedSeconds, true);
        if (cancelled) {
          return;
        }

        engineReady = pcmEngine.engineStatus === "ready";
        localReady = syncResult.localReady;
        driftMs = syncResult.driftMs;
        audio.muted = activePlaybackSource !== "progressive-local";
      } else if (mseEngine) {
        engineReady = mseEngine.engineStatus === "ready";
        localReady = engineReady;

        if (engineReady && startupReady) {
          syncLocalPlaybackWindow(audio, expectedSeconds, true, {
            softDriftMs: 120,
            hardDriftMs: 900
          });
          audio.muted = activePlaybackSource !== "progressive-local";
          void audio.play().catch(() => undefined);
          driftMs = Math.abs(expectedSeconds * 1000 - audio.currentTime * 1000);
        }
      }

      if (!engineReady || !startupReady || !localReady) {
        if (pcmEngine) {
          await pcmEngine.syncPlayback(expectedSeconds, false).catch(() => undefined);
          if (cancelled) {
            return;
          }
        } else {
          audio.pause();
        }
        audio.muted = false;
        progressiveWarmupReadyAtRef.current = null;
        return;
      }

      const warmupDecision = resolveProgressiveWarmupDecision({
        currentSource: activePlaybackSource,
        engineReady: localReady,
        startupReady: progressiveHealthSnapshot.startupReady,
        fallbackReason: progressiveHealthSnapshot.fallbackReason,
        driftMs,
        warmupReadyAt: progressiveWarmupReadyAtRef.current,
        now: Date.now()
      });
      progressiveWarmupReadyAtRef.current = warmupDecision.nextWarmupReadyAt;
      if (warmupDecision.clearFallbackReason) {
        setProgressiveFallbackReason(null);
      }
      if (warmupDecision.nextSource !== activePlaybackSource) {
        setActivePlaybackSource(warmupDecision.nextSource);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    roomSnapshot?.room.playback,
    currentProgressiveManifest,
    activePlaybackSource,
    progressiveHealthSnapshot.startupReady,
    progressiveHealthSnapshot.fallbackReason,
    progressiveTickAt
  ]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const audio = audioRef.current;
    if (
      !playback?.currentTrackId ||
      !audio ||
      !currentBufferedFullLocalTrack ||
      !canWarmBufferedFullLocal
    ) {
      fullLocalWarmupReadyAtRef.current = null;
      return;
    }

    if (playback.status !== "playing") {
      audio.pause();
      audio.muted = false;
      fullLocalWarmupReadyAtRef.current = null;
      return;
    }

    if (audio.srcObject) {
      audio.srcObject = null;
    }
    if (audio.src !== currentBufferedFullLocalTrack.objectUrl) {
      audio.src = currentBufferedFullLocalTrack.objectUrl;
      audio.load();
    }

    const expectedSeconds =
      getEffectivePlaybackPositionMs(playback, progressTrack?.durationMs ?? 0, progressiveTickAt) /
      1000;
    syncLocalPlaybackWindow(audio, expectedSeconds, true, {
      softDriftMs: 120,
      hardDriftMs: 900
    });
    audio.muted = true;
    void audio.play().catch(() => undefined);

    const localReady = audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    const driftMs = Math.abs(expectedSeconds * 1000 - audio.currentTime * 1000);
    const warmupDecision = resolveFullLocalWarmupDecision({
      currentSource: activePlaybackSource,
      localReady,
      driftMs,
      warmupReadyAt: fullLocalWarmupReadyAtRef.current,
      now: Date.now()
    });
    fullLocalWarmupReadyAtRef.current = warmupDecision.nextWarmupReadyAt;
    if (warmupDecision.nextSource !== activePlaybackSource) {
      setActivePlaybackSource(warmupDecision.nextSource);
    }
  }, [
    roomSnapshot?.room.playback,
    currentBufferedFullLocalTrack?.objectUrl,
    canWarmBufferedFullLocal,
    activePlaybackSource,
    progressTrack?.durationMs,
    progressiveTickAt
  ]);

  useEffect(() => {
    if (activePlaybackSource !== "progressive-local" && activePlaybackSource !== "full-local") {
      if (remoteHoldTimeoutRef.current !== null) {
        window.clearTimeout(remoteHoldTimeoutRef.current);
        remoteHoldTimeoutRef.current = null;
      }
      return;
    }

    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) {
      return;
    }

    remoteAudio.muted = true;
    if (remoteHoldTimeoutRef.current !== null) {
      window.clearTimeout(remoteHoldTimeoutRef.current);
    }

    remoteHoldTimeoutRef.current = window.setTimeout(() => {
      remoteAudio.pause();
      remoteAudio.muted = false;
      remoteHoldTimeoutRef.current = null;
    }, 1_000);

    return () => {
      if (remoteHoldTimeoutRef.current !== null) {
        window.clearTimeout(remoteHoldTimeoutRef.current);
        remoteHoldTimeoutRef.current = null;
      }
      remoteAudio.muted = false;
    };
  }, [activePlaybackSource, roomSnapshot?.room.playback.currentTrackId]);

  useEffect(() => {
    if (activePlaybackSource !== "progressive-local") {
      return;
    }

    if (progressiveHealthSnapshot.aheadBufferedMs >= getCriticalBufferThresholdMs()) {
      return;
    }

    setProgressiveFallbackReason("seek-outside-buffer");
    setActivePlaybackSource("remote-stream");
  }, [activePlaybackSource, progressiveHealthSnapshot.aheadBufferedMs]);

  useEffect(() => {
    if (activePlaybackSource !== "remote-stream") {
      return;
    }

    if (!progressiveFallbackReason || !progressiveHealthSnapshot.startupReady) {
      return;
    }

    setProgressiveFallbackReason(null);
  }, [activePlaybackSource, progressiveFallbackReason, progressiveHealthSnapshot.startupReady]);

  useEffect(() => {
    recordPeerDiagnostic({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "progressive-status",
      summary: `播放源 ${progressiveHealthSnapshot.activeSource} / 策略 ${progressiveHealthSnapshot.schedulerPolicy}`,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          activeSource: progressiveHealthSnapshot.activeSource,
          engineType: progressiveHealthSnapshot.engineType,
          contiguousBufferedMs: progressiveHealthSnapshot.contiguousBufferedMs,
          aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
          schedulerPolicy: progressiveHealthSnapshot.schedulerPolicy,
          startupReady: progressiveHealthSnapshot.startupReady,
          fallbackReason: progressiveHealthSnapshot.fallbackReason
        }
      })
    });
  }, [
    progressiveHealthSnapshot.activeSource,
    progressiveHealthSnapshot.engineType,
    progressiveHealthSnapshot.contiguousBufferedMs,
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.schedulerPolicy,
    progressiveHealthSnapshot.startupReady,
    progressiveHealthSnapshot.fallbackReason,
    recordPeerDiagnostic
  ]);

  useEffect(() => {
    const remotePeerIds =
      roomSnapshot?.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId) ?? [];

    void meshRef.current?.syncPeers(remotePeerIds);
  }, [roomSnapshot?.room.members, peerId]);

  const schedulerPlaybackPositionMs = Math.floor(progressMs / 4_000) * 4_000;
  const playbackClockSource =
    roomSnapshot?.room.playback.status === "playing"
      ? shouldUseLocalPlayback
        ? "local"
        : "remote"
      : "snapshot";

  useEffect(() => {
    chunkSchedulerRef.current?.sync({
      roomSnapshot,
      availabilityByTrack,
      connectedPeerIds: connectedPeers,
      uploadedTrackIds: Object.keys(uploadedTracks),
      playbackPositionMs: schedulerPlaybackPositionMs,
      playbackStatus: roomSnapshot?.room.playback.status ?? null,
      pageVisible: isPageVisible,
      mode: schedulerMode,
      bufferHealth,
      playbackClockSource,
      policy: progressiveSchedulerPolicy
    });
  }, [
    availabilityByTrack,
    connectedPeers,
    roomSnapshot,
    uploadedTracks,
    schedulerPlaybackPositionMs,
    isPageVisible,
    schedulerMode,
    bufferHealth,
    playbackClockSource,
    progressiveSchedulerPolicy
  ]);

  function resetPlayerSurface() {
    const localAudio = audioRef.current;
    const remoteAudio = remoteAudioRef.current;

    if (localAudio) {
      localAudio.pause();
      localAudio.srcObject = null;
      localAudio.removeAttribute("src");
      localAudio.load();
    }

    if (remoteAudio) {
      remoteAudio.pause();
      remoteAudio.srcObject = null;
      remoteAudio.load();
    }

    progressiveEngineRef.current?.destroy();
    progressiveEngineRef.current = null;
    progressivePcmEngineRef.current?.destroy();
    progressivePcmEngineRef.current = null;
    hostStreamRef.current = null;
    progressiveWarmupReadyAtRef.current = null;
    fullLocalWarmupReadyAtRef.current = null;
    resetHydrationQueue();
    setProgressMs(0);
    setAudioDurationMs(0);
    setSeekDraft(null);
    setBufferHealth("healthy");
    setMediaConnectionState("idle");
    setMediaConnectedPeers([]);
    setActivePlaybackSource("remote-stream");
    setProgressiveFallbackReason(null);
  }

  async function refreshAvailableRooms() {
    try {
      const rooms = await musicRoomApi.listRooms();
      setAvailableRooms(rooms);
    } catch {
      setAvailableRooms([]);
    }
  }

  async function refreshPlaylists() {
    try {
      const nextPlaylists = await musicRoomApi.listMyPlaylists();
      setPlaylists(nextPlaylists);
    } catch {
      setPlaylists([]);
    }
  }

  async function handleFilesSelected(files: FileList | File[] | null) {
    try {
      await handleTrackFilesSelected(files);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function syncHostMediaStream() {
    if (!roomSnapshot?.room.id || !peerId || !isCurrentSourceOwner) {
      return;
    }

    const playback = roomSnapshot.room.playback;
    const listenerPeerIds =
      roomSnapshot.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId) ?? [];
    const syncKey = [
      roomSnapshot.room.id,
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
  }

  const host = roomSnapshot?.room.members.find((member) => member.role === "host");
  const currentTrackDuration = audioDurationMs || currentTrack?.durationMs || 0;
  const isPlaying = roomSnapshot?.room.playback?.status === "playing";
  const {
    canDisbandRoom,
    availabilitySummary,
    currentTrackAvailability,
    memberTransferSummaries,
    statusTone,
    iceConfigStatus,
    iceConfigSource,
    isRoomTransitionPending,
    showRoomTransitionState
  } = useRoomDerivedState({
    roomSnapshot,
    peerId,
    activeDashboardTab,
    currentTrack,
    availabilityByTrack,
    canDeleteRoom,
    statusMessage,
    iceConfig,
    iceConfigResolved,
    workspaceOnly,
    initialRoomId,
    activeSessionUserId: activeSession?.userId,
    suppressRoomRecovery,
    isNavigatingRoomExit,
    isRecoveringRoom
  });

  return (
    <main className="min-h-screen bg-background relative flex flex-col pb-32">
      <TopBar activeSession={activeSession} onLogout={handleLogout} />

      {roomSnapshot && statusMessage ? (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-4" aria-live="polite">
          <div className={`pointer-events-auto px-5 py-2.5 rounded-full text-sm font-medium shadow-xl backdrop-blur-md transition-all duration-300 animate-slide-up ${
            statusTone === "warning" ? "bg-red-500/10 border border-red-500/20 text-red-400" :
            statusTone === "success" ? "bg-green-500/10 border border-green-500/20 text-green-400" :
            "bg-surface/80 border border-surface-border text-foreground"
          }`}>
            {statusMessage}
          </div>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 relative" role="tabpanel">
        <div className="w-full h-full">
          {roomSnapshot ? (
            <RoomDashboardView
              roomSnapshot={roomSnapshot}
              currentTrack={currentTrack}
              currentTrackDuration={currentTrackDuration}
              isPlaying={isPlaying}
              activeSession={activeSession}
              host={host}
              canControlPlayback={canControlPlayback}
              canDeleteRoom={canDeleteRoom}
              canDisbandRoom={canDisbandRoom}
              canReorderQueue={canReorderQueue}
              currentSourceOwnerNickname={
                roomSnapshot.tracks.find(
                  (track) => track.id === roomSnapshot.room.playback.sourceTrackId
                )?.ownerNickname ?? null
              }
              uploadedTracks={uploadedTracks}
              connectedPeersCount={connectedPeers.length}
              mediaConnectionState={mediaConnectionState}
              mediaConnectedPeersCount={mediaConnectedPeers.length}
              cachedTrackCount={cachedTrackCount}
              playlists={playlists}
              tracks={roomSnapshot.tracks}
              availabilitySummary={availabilitySummary}
              memberTransferSummaries={memberTransferSummaries}
              peerDiagnostics={peerDiagnostics}
              peerRecentEvents={peerRecentEvents}
              iceConfigSource={iceConfigSource}
              iceConfigStatus={iceConfigStatus}
              onCopyJoinCode={async () => {
                try {
                  await navigator.clipboard.writeText(roomSnapshot.room.joinCode);
                  setStatusMessage(`已复制房间码 ${roomSnapshot.room.joinCode}。`);
                } catch {
                  setStatusMessage("复制房间码失败，请手动复制。");
                }
              }}
              onLeaveRoom={handleLeaveRoomAction}
              onDeleteRoom={handleDeleteRoomAction}
              onFilesSelected={(files) => handleFilesSelected(files)}
              onAddToQueue={(trackId) => addToQueue(trackId)}
              onDeleteTrack={(trackId) => deleteTrack(trackId)}
              onPlayTrack={(trackId) => playTrack(trackId)}
              onPlayQueueItem={(queueItemId) => playQueueItem(queueItemId)}
              onRemoveQueueItem={(queueItemId) => removeQueueItem(queueItemId)}
              onReorderQueue={(queueItemIds) => reorderQueue(queueItemIds)}
              onSavePlaylistFromQueue={(title) => savePlaylistFromQueue(title)}
              onLoadPlaylistIntoRoom={(playlistId) => loadPlaylistIntoRoom(playlistId)}
              onUpdatePlaylistTitle={(playlistId, title) => updatePlaylistTitle(playlistId, title)}
              onUpdatePlaylistTracks={(playlistId, trackIds) =>
                updatePlaylistTracks(playlistId, trackIds)
              }
              onDeletePlaylist={(playlistId) => deletePlaylist(playlistId)}
              socket={socketRef.current}
              onTabChange={setActiveDashboardTab}
            />
          ) : showRoomTransitionState ? (
            <RoomTransitionState
              isNavigatingRoomExit={isNavigatingRoomExit}
              isRecoveringRoom={isRecoveringRoom || isRoomTransitionPending}
            />
          ) : (
            <EmptyRoomState
              activeSession={activeSession}
              workspaceEntryHref={workspaceEntryHref}
              authEntryHref={authEntryHref}
              onClearIdentity={handleClearIdentity}
            />
          )}
        </div>
      </div>

      <BottomPlayer
        audioRef={audioRef}
        remoteAudioRef={remoteAudioRef}
        progressMs={progressMs}
        seekDraft={seekDraft}
        setSeekDraft={setSeekDraft}
        audioDurationMs={currentTrackDuration}
        volume={volume}
        setVolume={setVolume}
        syncProgressFromAudio={syncProgressFromAudio}
        syncDurationFromAudio={syncDurationFromAudio}
        roomSnapshot={roomSnapshot}
        activeSession={activeSession}
        uploadedTracks={uploadedTracks}
        currentTrack={currentTrack}
        currentTrackAvailability={
          currentTrackAvailability
            ? {
                localChunkCount: currentTrackAvailability.localChunkCount,
                totalChunks: currentTrackAvailability.totalChunks
              }
            : null
        }
        mediaConnectionState={mediaConnectionState}
        mediaConnectedPeersCount={mediaConnectedPeers.length}
        onPlay={playTrack}
        onPause={pauseTrack}
        onSeek={seekTrack}
        onPrev={prevTrack}
        onNext={nextTrack}
        onEnded={handleEnded}
        onLocalPlaybackReady={() => {
          void syncHostMediaStream();
        }}
        onRemotePlaying={() => {
          recordPeerDiagnostic({
            peerId: "remote-media",
            channelKind: "media",
            direction: "local",
            event: "audio-playing",
            summary: "远端音频元素开始播放",
            update: (snapshot) => ({
              ...snapshot,
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                lastAudioEvent: "playing"
              }
            })
          });
          setMediaConnectionState("live");
        }}
        onRemoteWaiting={() => {
          scheduleRemotePlaybackRetry();
          recordPeerDiagnostic({
            peerId: "remote-media",
            channelKind: "media",
            direction: "local",
            event: "audio-waiting",
            summary: "远端音频元素进入缓冲",
            update: (snapshot) => ({
              ...snapshot,
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                lastAudioEvent: "waiting"
              }
            })
          });
          setMediaConnectionState("buffering");
        }}
        onRemotePause={() => {
          scheduleRemotePlaybackRetry();
          recordPeerDiagnostic({
            peerId: "remote-media",
            channelKind: "media",
            direction: "local",
            event: "audio-pause",
            summary: "远端音频元素暂停",
            update: (snapshot) => ({
              ...snapshot,
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                lastAudioEvent: "pause"
              }
            })
          });
          setMediaConnectionState((current) =>
            roomSnapshot?.room.playback.status === "paused" ? current : "buffering"
          );
        }}
        onRemoteError={() => {
          recordPeerDiagnostic({
            peerId: "remote-media",
            channelKind: "media",
            direction: "local",
            event: "audio-error",
            level: "error",
            summary: "远端音频元素播放失败",
            update: (snapshot) => ({
              ...snapshot,
              lastError: "远端音频元素播放失败",
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                lastAudioEvent: "error"
              }
            })
          });
          setMediaConnectionState("failed");
        }}
      />

      {isPending ? (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-surface backdrop-blur-md rounded-full px-4 py-1.5 border border-surface-border shadow-lg flex items-center gap-2 z-50 animate-fade-in">
           <div className="w-2 h-2 rounded-full bg-accent animate-ping" />
           <span className="text-xs text-foreground">正在同步房间状态…</span>
        </div>
      ) : null}
    </main>
  );
}
