"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  Playlist,
  RoomMediaConnectionState,
  RoomSnapshot,
  PeerSignalMessage,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import {
  currentTrackChunkRequestLimit,
  getMissingChunkIndexes,
  getWebRTCIceServers,
  RoomMediaMesh,
  selectChunkSource,
  P2PMesh,
  upcomingTrackChunkRequestLimit
} from "@/features/p2p";
import { toUserFacingError } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { createRoomSocket, type RoomSocket } from "@/lib/ws-client";
import { TopBar } from "@/components/TopBar";
import { BottomPlayer } from "@/components/BottomPlayer";
import { RoomDashboardView } from "@/components/room/RoomDashboardView";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { getPlaybackEffectivePositionMs, useRoomPlayback } from "@/features/playback/use-room-playback";
import { captureAudioStream } from "@/features/upload/audio-utils";
import { useTrackUploads } from "@/features/upload/use-track-uploads";
import { useRoomActions } from "@/features/room/hooks/use-room-actions";

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
  const audioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const meshRef = useRef<P2PMesh | null>(null);
  const mediaMeshRef = useRef<RoomMediaMesh | null>(null);
  const hostStreamRef = useRef<MediaStream | null>(null);
  const requestedPiecesRef = useRef<Map<string, number>>(new Map());
  const failedPiecePeersRef = useRef<Map<string, Set<string>>>(new Map());
  const [isPending, startTransition] = useTransition();
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [availableRooms, setAvailableRooms] = useState<RoomSnapshot[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [mediaConnectedPeers, setMediaConnectedPeers] = useState<string[]>([]);
  const [peerId, setPeerId] = useState("");
  const [suppressRoomRecovery, setSuppressRoomRecovery] = useState(false);
  const [mediaConnectionState, setMediaConnectionState] =
    useState<RoomMediaConnectionState>("idle");
  const [availabilityByTrack, setAvailabilityByTrack] = useState<
    Record<string, Record<string, TrackAvailabilityAnnouncement>>
  >({});
  const {
    activeSession,
    hydrated,
    statusMessage,
    setStatusMessage,
    clearIdentity,
    refreshSession
  } = useSessionIdentity({
    initialStatusMessage: "登录后即可进入音乐房工作台。",
    sessionStorageKey: "music-room-session"
  });
  const canControlPlayback = !!activeSession && !!roomSnapshot;
  const canDeleteRoom = !!activeSession && roomSnapshot?.room.hostId === activeSession.id;
  const canReorderQueue = canDeleteRoom;
  const isCurrentSourceOwner =
    !!activeSession && roomSnapshot?.room.playback.sourceSessionId === activeSession.id;
  const currentPlaybackTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;

  async function refreshRoom(roomId: string) {
    const snapshot = await musicRoomApi.getRoom(roomId);
    setRoomSnapshot(snapshot);
  }

  const mergeAvailability = useCallback((announcement: TrackAvailabilityAnnouncement) => {
    setAvailabilityByTrack((current) => ({
      ...current,
      [announcement.trackId]: {
        ...(current[announcement.trackId] ?? {}),
        [announcement.ownerPeerId]: announcement
      }
    }));
  }, []);

  const stableEmitAvailability = useCallback(
    (announcement: TrackAvailabilityAnnouncement) => socketRef.current?.emit("piece.availability", announcement),
    []
  );

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
    setStatusMessage,
    onAvailability: mergeAvailability,
    emitAvailability: stableEmitAvailability,
    refreshRoom
  });
  const shouldUseLocalPlayback = !!(currentPlaybackTrackId && uploadedTracks[currentPlaybackTrackId]);
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
    shouldUseLocalAudio: shouldUseLocalPlayback
  });
  const getCurrentPlaybackPositionMs = () => {
    if (shouldUseLocalPlayback) {
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

    router.replace(`/auth?redirectTo=${encodeURIComponent(`/room/${initialRoomId}`)}` as Route);
  }, [workspaceOnly, initialRoomId, activeSession, hydrated, router]);

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

    void (async () => {
      try {
        const snapshot = await musicRoomApi.recoverRoom(initialRoomId);
        if (!snapshot || cancelled) {
          return;
        }

        setRoomSnapshot(snapshot);
        setStatusMessage(`已进入房间 ${snapshot.room.joinCode}。`);
        await refreshPlaylists();
      } catch {
        if (!cancelled) {
          setStatusMessage("未找到可恢复的房间状态，请返回音乐房重新创建或加入房间。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceOnly, initialRoomId, activeSession?.id, roomSnapshot?.room.id, suppressRoomRecovery]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) {
      return;
    }

    window.localStorage.setItem(lastRoomStorageKey, roomSnapshot.room.id);
  }, [roomSnapshot?.room.id, peerId]);

  useEffect(() => {
    if (!roomSnapshot?.room.id) {
      return;
    }

    const socket = createRoomSocket();
    socketRef.current = socket;
    const roomId = roomSnapshot.room.id;
    const iceServers = getWebRTCIceServers();
    const mesh = new P2PMesh(
      roomId,
      peerId,
      (payload: PeerSignalMessage) => socket.emit("peer.signal", payload),
      {
        onPieceReceived: ({ trackId, totalChunks, mimeType }) => {
          requestedPiecesRef.current.forEach((_startedAt, requestKey) => {
            if (requestKey.startsWith(`${trackId}:`)) {
              requestedPiecesRef.current.delete(requestKey);
              failedPiecePeersRef.current.delete(requestKey);
            }
          });
          void announceLocalCache(trackId, totalChunks);
          void hydrateTrackFromPiecesWithCleanup(trackId, mimeType, totalChunks);
        },
        onPieceRequestTimeout: ({ trackId, chunkIndex, peerId: timedOutPeerId }) => {
          const requestKey = `${trackId}:${chunkIndex}`;
          requestedPiecesRef.current.delete(requestKey);
          const failedPeers = failedPiecePeersRef.current.get(requestKey) ?? new Set<string>();
          failedPeers.add(timedOutPeerId);
          failedPiecePeersRef.current.set(requestKey, failedPeers);
        },
        onPeerConnectionChange: ({ peerId: remotePeerId, state }) => {
          setConnectedPeers((current) => {
            const next = new Set(current);

            if (state === "connected") {
              next.add(remotePeerId);
            } else if (state === "closed" || state === "failed" || state === "disconnected") {
              next.delete(remotePeerId);
            }

            return [...next];
          });
        }
      }
    );
    meshRef.current = mesh;
    const mediaMesh = new RoomMediaMesh(
      roomId,
      peerId,
      (payload: PeerSignalMessage) => socket.emit("peer.signal", payload),
      iceServers,
      {
        onRemoteStream: (stream) => {
          const remoteAudio = remoteAudioRef.current;
          if (!remoteAudio) {
            return;
          }

          if (remoteAudio.srcObject !== stream) {
            remoteAudio.srcObject = stream;
          }

          if (stream) {
            void remoteAudio.play().catch(() => {
              setStatusMessage("浏览器阻止了远端音频自动播放，请再次点击页面继续。");
            });
          }
        },
        onConnectionStateChange: ({ state, connectedPeerIds }) => {
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
        }
      }
    );
    mediaMeshRef.current = mediaMesh;

    const subscribeToRoom = () => {
      socket.emit("room.subscribe", {
        roomId,
        sessionId: activeSession?.id,
        peerId
      });
    };

    socket.on("connect", () => {
      subscribeToRoom();
      setStatusMessage(`已连接到房间 ${roomSnapshot.room.joinCode}。`);
    });
    socket.on("room.snapshot", (snapshot: RoomSnapshot) => {
      setRoomSnapshot((current) => ({
        ...snapshot,
        playlists: snapshot.playlists.length > 0 ? snapshot.playlists : (current?.playlists ?? [])
      }));
    });
    socket.on("peer.signal", (payload: PeerSignalMessage) => {
      if (payload.channelKind === "media") {
        void mediaMesh.handleSignal(payload);
        return;
      }

      void mesh.handleSignal(payload);
    });
    socket.on("piece.availability", (announcement: TrackAvailabilityAnnouncement) => {
      setAvailabilityByTrack((current) => ({
        ...current,
        [announcement.trackId]: {
          ...(current[announcement.trackId] ?? {}),
          [announcement.ownerPeerId]: announcement
        }
      }));
    });
    socket.on("room.deleted", ({ roomId: deletedRoomId, trackIds }) => {
      if (deletedRoomId !== roomId) {
        return;
      }

      void Promise.allSettled(trackIds.map((trackId) => deleteUploadedTrackArtifacts(trackId)));
      setSuppressRoomRecovery(true);
      resetPlayerSurface();
      setRoomSnapshot(null);
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage("房间已解散，当前房间的歌单和本地缓存已清理。");
      if (workspaceOnly) {
        router.push("/rooms" as Route);
      }
    });
    socket.on("room.snapshot.missing", () => {
      resetPlayerSurface();
      setRoomSnapshot(null);
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage("这个房间已不可用，请返回音乐房重新加入。");
    });
    socket.on("disconnect", () => {
      setStatusMessage("实时连接已断开，正在尝试重新连接…");
    });

    return () => {
      socket.emit("room.unsubscribe", { roomId });
      socket.disconnect();
      socketRef.current = null;
      mesh.destroy();
      meshRef.current = null;
      mediaMesh.destroy();
      mediaMeshRef.current = null;
      hostStreamRef.current = null;
      setConnectedPeers([]);
      setMediaConnectedPeers([]);
      setMediaConnectionState("idle");
    };
  }, [
    roomSnapshot?.room.id,
    roomSnapshot?.room.joinCode,
    peerId,
    activeSession?.id,
    deleteUploadedTrackArtifacts,
    workspaceOnly,
    router
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !activeSession?.id || !peerId || !socketRef.current) {
      return;
    }

    const emitPresence = () => {
      socketRef.current?.emit("room.presence", {
        roomId: roomSnapshot.room.id,
        sessionId: activeSession.id,
        peerId
      });
    };

    emitPresence();
    const intervalId = window.setInterval(emitPresence, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [roomSnapshot?.room.id, activeSession?.id, peerId]);

  useEffect(() => {
    requestedPiecesRef.current.clear();
    failedPiecePeersRef.current.clear();
  }, [roomSnapshot?.room.id, peerId]);

  const playback = roomSnapshot?.room.playback;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!playback?.currentTrackId) {
      audio.pause();
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

    if (uploaded) {
      if (remoteAudio) {
        remoteAudio.pause();
        remoteAudio.srcObject = null;
        remoteAudio.load();
      }

      if (audio.src !== uploaded.objectUrl) {
        audio.src = uploaded.objectUrl;
        audio.load();
      }

      const expectedSeconds =
        getPlaybackEffectivePositionMs(playback, progressTrack?.durationMs ?? 0) / 1000;
      if (Math.abs(audio.currentTime - expectedSeconds) > 0.35) {
        audio.currentTime = expectedSeconds;
      }

      if (playback.status === "playing") {
        void audio.play().catch(() => {
          setStatusMessage("浏览器阻止了自动播放，请手动点击播放恢复。");
        });
        setMediaConnectionState("live");
      }

      if (playback.status === "paused") {
        audio.pause();
        setMediaConnectionState("idle");
      }
      return;
    }

    if (!isCurrentSourceOwner) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();

      if (remoteAudio) {
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
    }
  }, [
    playback?.currentTrackId,
    playback?.status,
    playback?.positionMs,
    playback?.startedAt,
    playback?.mediaEpoch,
    progressTrack?.durationMs,
    uploadedTracks,
    isCurrentSourceOwner
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

  const currentTrack = progressTrack;

  const upcomingTrack = useMemo(() => {
    if (!roomSnapshot || !currentTrack) {
      return null;
    }

    const currentQueueIndex = roomSnapshot.room.playback.currentQueueItemId
      ? roomSnapshot.queue.findIndex(
          (item) => item.id === roomSnapshot.room.playback.currentQueueItemId
        )
      : roomSnapshot.queue.findIndex((item) => item.trackId === currentTrack.id);
    if (currentQueueIndex < 0) {
      return null;
    }

    const nextQueueItem = roomSnapshot.queue[currentQueueIndex + 1];
    if (!nextQueueItem) {
      return null;
    }

    return roomSnapshot.tracks.find((track) => track.id === nextQueueItem.trackId) ?? null;
  }, [currentTrack, roomSnapshot]);

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
    const remotePeerIds =
      roomSnapshot?.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId) ?? [];

    void meshRef.current?.syncPeers(remotePeerIds);
  }, [roomSnapshot?.room.members, peerId]);

  useEffect(() => {
    const requestPlan = [
      { track: currentTrack, limit: currentTrackChunkRequestLimit },
      { track: upcomingTrack, limit: upcomingTrackChunkRequestLimit }
    ];

    for (const plan of requestPlan) {
      if (!plan.track || uploadedTracks[plan.track.id]) {
        continue;
      }

      const announcements = Object.values(availabilityByTrack[plan.track.id] ?? {});
      const localChunks = availabilityByTrack[plan.track.id]?.[peerId]?.availableChunks ?? [];
      const totalChunks = announcements.reduce((max, entry) => Math.max(max, entry.totalChunks), 0);
      const missingChunkIndexes = getMissingChunkIndexes(totalChunks, localChunks, plan.limit);

      for (const chunkIndex of missingChunkIndexes) {
        const requestKey = `${plan.track.id}:${chunkIndex}`;
        if (requestedPiecesRef.current.has(requestKey)) {
          continue;
        }

        const excludedPeerIds = [...(failedPiecePeersRef.current.get(requestKey) ?? new Set())];
        const connectedPeerIds = meshRef.current?.getConnectedPeerIds() ?? [];
        const preferredSource = selectChunkSource(
          announcements.filter((announcement) => announcement.availableChunks.includes(chunkIndex)),
          connectedPeerIds,
          peerId,
          excludedPeerIds
        );
        if (!preferredSource) {
          continue;
        }

        const didRequest = meshRef.current?.requestPiece(
          preferredSource.ownerPeerId,
          plan.track.id,
          chunkIndex,
          totalChunks
        );

        if (didRequest) {
          requestedPiecesRef.current.set(requestKey, Date.now());
        }
      }
    }
  }, [availabilityByTrack, currentTrack, upcomingTrack, peerId, uploadedTracks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();

      for (const [requestKey, startedAt] of requestedPiecesRef.current.entries()) {
        if (now - startedAt > 8000) {
          requestedPiecesRef.current.delete(requestKey);
        }
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  function resetPlayerSurface() {
    const localAudio = audioRef.current;
    const remoteAudio = remoteAudioRef.current;

    if (localAudio) {
      localAudio.pause();
      localAudio.removeAttribute("src");
      localAudio.load();
    }

    if (remoteAudio) {
      remoteAudio.pause();
      remoteAudio.srcObject = null;
      remoteAudio.load();
    }

    hostStreamRef.current = null;
    setProgressMs(0);
    setAudioDurationMs(0);
    setSeekDraft(null);
    setMediaConnectionState("idle");
    setMediaConnectedPeers([]);
  }

  function handleClearIdentity() {
    setSuppressRoomRecovery(true);
    resetPlayerSurface();
    clearIdentity();
    setRoomSnapshot(null);
    setPlaylists([]);
    window.localStorage.removeItem(lastRoomStorageKey);
  }

  async function handleLeaveRoomAction() {
    const didLeave = await leaveRoom();
    if (!didLeave) {
      return;
    }

    setSuppressRoomRecovery(true);
    if (workspaceOnly) {
      router.push("/rooms" as Route);
    }
  }

  async function handleDeleteRoomAction() {
    const didDelete = await deleteRoom();
    if (!didDelete) {
      return;
    }

    setSuppressRoomRecovery(true);
    if (workspaceOnly) {
      router.push("/rooms" as Route);
    }
  }

  async function handleLogout() {
    try {
      await musicRoomApi.logout();
    } catch {
      // Keep local logout behavior even if the server session is already gone.
    }

    handleClearIdentity();
    router.replace(`/auth?redirectTo=${encodeURIComponent(initialRoomId ? `/room/${initialRoomId}` : "/rooms")}` as Route);
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

  async function handleFilesSelected(files: FileList | null) {
    try {
      await handleTrackFilesSelected(files);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function hydrateTrackFromPiecesWithCleanup(
    trackId: string,
    mimeType: string,
    totalChunks: number
  ) {
    await hydrateTrackFromPieces(trackId, mimeType, totalChunks);
    requestedPiecesRef.current.forEach((_startedAt, requestKey) => {
      if (requestKey.startsWith(`${trackId}:`)) {
        requestedPiecesRef.current.delete(requestKey);
      }
    });
    failedPiecePeersRef.current.forEach((_failedPeers, requestKey) => {
      if (requestKey.startsWith(`${trackId}:`)) {
        failedPiecePeersRef.current.delete(requestKey);
      }
    });
  }

  async function syncHostMediaStream() {
    if (!roomSnapshot?.room.id || !peerId || !isCurrentSourceOwner) {
      return;
    }

    const audio = audioRef.current;
    if (!audio || !roomSnapshot.room.playback.currentTrackId) {
      await mediaMeshRef.current?.syncHostPeers([], null, roomSnapshot.room.playback.mediaEpoch);
      return;
    }

    const listenerPeerIds =
      roomSnapshot.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId) ?? [];

    const capture = captureAudioStream(audio);
    if (!capture) {
      setStatusMessage("当前浏览器不支持音频直播推送，请使用最新版 Chrome 或 Edge。");
      return;
    }

    hostStreamRef.current = capture;
    await mediaMeshRef.current?.syncHostPeers(
      listenerPeerIds,
      capture,
      roomSnapshot.room.playback.mediaEpoch
    );
  }

  const host = roomSnapshot?.room.members.find((member) => member.role === "host");
  const canDisbandRoom =
    !!roomSnapshot &&
    canDeleteRoom &&
    (() => {
      const uploaderIds = new Set(roomSnapshot.tracks.map((t) => t.ownerSessionId));
      return !roomSnapshot.room.members.some((member) => uploaderIds.has(member.id) && !member.peerId);
    })();
  const currentTrackDuration = audioDurationMs || currentTrack?.durationMs || 0;
  const isPlaying = roomSnapshot?.room.playback?.status === "playing";
  const availabilitySummary =
    roomSnapshot?.tracks.map((track) => {
      const peers = Object.values(availabilityByTrack[track.id] ?? {});
      const local = peers.find((peer) => peer.ownerPeerId === peerId);
      return {
        track,
        peerCount: peers.length,
        localChunkCount: local?.availableChunks.length ?? 0,
        totalChunks: local?.totalChunks ?? peers[0]?.totalChunks ?? 0,
        sources: peers.map((peer) => `${peer.nickname} (${peer.source})`)
      };
    }) ?? [];
  const currentTrackAvailability = currentTrack
    ? availabilitySummary.find((entry) => entry.track.id === currentTrack.id) ?? null
    : null;
  const memberTransferSummaries = useMemo(() => {
    if (!roomSnapshot) {
      return [];
    }

    return roomSnapshot.room.members.map((member) => {
      const announcements = member.peerId
        ? Object.values(availabilityByTrack).flatMap((trackAvailability) =>
            Object.values(trackAvailability).filter(
              (announcement) => announcement.ownerPeerId === member.peerId
            )
          )
        : [];
      const currentTrackAnnouncements = currentTrack
        ? announcements.filter((announcement) => announcement.trackId === currentTrack.id)
        : [];

      return {
        memberId: member.id,
        announcedTrackCount: new Set(announcements.map((announcement) => announcement.trackId)).size,
        totalChunkCount: announcements.reduce(
          (total, announcement) => total + announcement.availableChunks.length,
          0
        ),
        currentTrackChunkCount: currentTrackAnnouncements.reduce(
          (total, announcement) => total + announcement.availableChunks.length,
          0
        ),
        currentTrackTotalChunks: currentTrackAnnouncements[0]?.totalChunks ?? 0,
        currentTrackSources: [...new Set(currentTrackAnnouncements.map((announcement) => announcement.source))]
      };
    });
  }, [availabilityByTrack, currentTrack, roomSnapshot]);
  const statusTone =
    statusMessage.includes("失败") || statusMessage.includes("不可用")
      ? "warning"
      : statusMessage.includes("已")
        ? "success"
        : "neutral";

  return (
    <main className="min-h-screen bg-background relative flex flex-col pb-32">
      <TopBar activeSession={activeSession} roomSnapshot={roomSnapshot} onLogout={handleLogout} />

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
            />
          ) : (
            <section className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 animate-fade-in pt-12">
              <div className="w-16 h-16 rounded-full bg-surface border border-surface-border flex items-center justify-center mb-6 text-foreground-muted">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              </div>
              <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-foreground-muted mb-3">Room page</p>
              <h2 className="text-2xl font-bold text-foreground mb-4">当前没有可用的房间工作台</h2>
              <p className="text-sm text-foreground-muted max-w-sm mb-8 leading-relaxed">
                {activeSession
                  ? "这个地址没有恢复到有效房间。请回到音乐房入口页，重新创建或通过房间码加入。"
                  : "你还没有登录。先进入登录页，再回到房间或音乐房入口页继续。"}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Link href={"/rooms" as Route}>
                  <Button size="lg">返回音乐房入口</Button>
                </Link>
                {activeSession ? (
                  <Button variant="ghost" onClick={handleClearIdentity} type="button">
                    清除当前会话状态
                  </Button>
                ) : (
                  <Link href={"/auth?redirectTo=/rooms" as Route}>
                    <Button variant="ghost">去登录</Button>
                  </Link>
                )}
              </div>
            </section>
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
        onRemotePlaying={() => setMediaConnectionState("live")}
        onRemoteWaiting={() => setMediaConnectionState("buffering")}
        onRemotePause={() =>
          setMediaConnectionState((current) =>
            roomSnapshot?.room.playback.status === "paused" ? current : "buffering"
          )
        }
        onRemoteError={() => setMediaConnectionState("failed")}
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
