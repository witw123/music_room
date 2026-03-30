"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  Playlist,
  RoomMediaConnectionState,
  RoomSnapshot,
  PeerSignalMessage,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import {
  assembleTrackFileFromPieces,
  buildTrackAvailabilityFromCache,
  buildTrackAvailabilityFromFile,
  getMissingChunkIndexes,
  getWebRTCIceServers,
  RoomMediaMesh,
  selectChunkSource,
  P2PMesh
} from "@/features/p2p";
import { toUserFacingError } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { createRoomSocket, type RoomSocket } from "@/lib/ws-client";
import { TopBar } from "@/components/TopBar";
import { BottomPlayer } from "@/components/BottomPlayer";
import { RoomDashboardView } from "@/components/room/RoomDashboardView";
import Link from "next/link";
import type { Route } from "next";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { useRoomPlayback } from "@/features/playback/use-room-playback";
import { captureAudioStream } from "@/features/upload/audio-utils";
import { useTrackUploads } from "@/features/upload/use-track-uploads";
import { useRoomActions } from "@/features/room/hooks/use-room-actions";

const sessionStorageKey = "music-room-session";
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
  const [mediaConnectionState, setMediaConnectionState] =
    useState<RoomMediaConnectionState>("idle");
  const [availabilityByTrack, setAvailabilityByTrack] = useState<
    Record<string, Record<string, TrackAvailabilityAnnouncement>>
  >({});
  const {
    nickname,
    setNickname,
    activeSession,
    setActiveSession,
    statusMessage,
    setStatusMessage,
    clearIdentity
  } = useSessionIdentity({
    sessionStorageKey,
    initialStatusMessage: "请输入昵称并确认身份。"
  });
  const canControlPlayback = !!activeSession && !!roomSnapshot;
  const canDeleteRoom = !!activeSession && roomSnapshot?.room.hostId === activeSession.id;
  const canReorderQueue = canDeleteRoom;
  const isCurrentSourceOwner =
    !!activeSession && roomSnapshot?.room.playback.sourceSessionId === activeSession.id;
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
    isCurrentSourceOwner
  });
  const {
    uploadedTracks,
    setUploadedTracks,
    cachedTrackCount,
    handleFilesSelected: handleTrackFilesSelected,
    announceLocalCache,
    hydrateTrackFromPieces,
    trimLocalCache
  } = useTrackUploads({
    maxCachedTracks,
    peerId,
    activeSession,
    roomSnapshot,
    setStatusMessage,
    onAvailability: mergeAvailability,
    emitAvailability: (announcement) => socketRef.current?.emit("piece.availability", announcement),
    refreshRoom
  });
  const {
    handleConfirmIdentity,
    handleCreateRoom,
    handleJoinRoom,
    leaveRoom,
    deleteRoom,
    addToQueue,
    playTrack,
    playQueueItem,
    pauseTrack,
    prevTrack,
    nextTrack,
    savePlaylistFromQueue,
    updatePlaylistTitle,
    deletePlaylist,
    loadPlaylistIntoRoom,
    removeQueueItem,
    reorderQueue,
    seekTrack,
    handleEnded
  } = useRoomActions({
    activeSession,
    nickname,
    roomSnapshot,
    progressMs,
    setNickname,
    setActiveSession,
    setRoomSnapshot,
    setAvailableRooms,
    setPlaylists,
    setStatusMessage,
    refreshAvailableRooms,
    refreshPlaylists,
    resetPlayerSurface,
    lastRoomStorageKey,
    audioRef
  });

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
    if (!activeSession) return;
    void refreshAvailableRooms();
    void refreshPlaylists(activeSession.id);
  }, [activeSession]);

  useEffect(() => {
    if (!activeSession || roomSnapshot || workspaceOnly) {
      return;
    }

    void refreshAvailableRooms();
    const intervalId = window.setInterval(() => {
      void refreshAvailableRooms();
    }, 5000);

    const handleFocus = () => {
      void refreshAvailableRooms();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [activeSession, roomSnapshot, workspaceOnly]);

  useEffect(() => {
    if (!workspaceOnly || !initialRoomId || !activeSession || roomSnapshot?.room.id === initialRoomId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await musicRoomApi.recoverRoom(initialRoomId, activeSession.id);
        if (!snapshot || cancelled) {
          return;
        }

        setRoomSnapshot(snapshot);
        setStatusMessage(`已进入房间 ${snapshot.room.joinCode}。`);
        await refreshPlaylists(activeSession.id);
      } catch {
        if (!cancelled) {
          setStatusMessage("未找到可恢复的房间状态，请返回房间主页重新创建或加入房间。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceOnly, initialRoomId, activeSession?.id, roomSnapshot?.room.id]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) return;
    window.localStorage.setItem(lastRoomStorageKey, roomSnapshot.room.id);
  }, [roomSnapshot?.room.id]);

  useEffect(() => {
    if (!roomSnapshot?.room.id) return;

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
        playlists:
          snapshot.playlists.length > 0 ? snapshot.playlists : (current?.playlists ?? [])
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
    socket.on("room.snapshot.missing", () => {
      resetPlayerSurface();
      setRoomSnapshot(null);
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage("这个房间已不可用，请创建新房间或加入其他房间。");
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
  }, [roomSnapshot?.room.id, peerId, activeSession?.id]);

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
    if (!audio) return;

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

    if (!isCurrentSourceOwner) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();

      const remoteAudio = remoteAudioRef.current;
      if (remoteAudio) {
        remoteAudio.volume = volume;
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

    const uploaded = uploadedTracks[playback.currentTrackId];

    if (uploaded && audio.src !== uploaded.objectUrl) {
      audio.src = uploaded.objectUrl;
      audio.load();
    }

    const expectedSeconds = playback.positionMs / 1000;
    if (uploaded && Math.abs(audio.currentTime - expectedSeconds) > 1.2) {
      audio.currentTime = expectedSeconds;
    }

    if (uploaded && playback.status === "playing") {
      void audio.play().catch(() => {
        setStatusMessage("浏览器阻止了自动播放，请手动点击播放恢复。");
      });
    }

    if (playback.status === "paused") {
      audio.pause();
    }
  }, [playback, uploadedTracks, isCurrentSourceOwner, volume]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) {
      return;
    }

    if (!isCurrentSourceOwner) {
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
    peerId
  ]);
  const currentTrack = progressTrack;

  const upcomingTrack = useMemo(() => {
    if (!roomSnapshot || !currentTrack) {
      return null;
    }

    const currentQueueIndex = roomSnapshot.queue.findIndex(
      (item) => item.trackId === currentTrack.id
    );
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
    const playback = roomSnapshot?.room.playback;

    if (!playback?.currentTrackId) {
      setMediaConnectionState("idle");
      return;
    }

    if (isCurrentSourceOwner) {
      return;
    }

    if (playback.status === "paused") {
      setMediaConnectionState((current) => (current === "live" ? "buffering" : current));
      return;
    }

    setMediaConnectionState((current) => {
      if (current === "live" || current === "buffering") {
        return current;
      }

      return mediaConnectedPeers.length > 0 ? "buffering" : "connecting";
    });
  }, [roomSnapshot?.room.playback, isCurrentSourceOwner, mediaConnectedPeers.length]);

  useEffect(() => {
    const remotePeerIds =
      roomSnapshot?.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId) ?? [];

    void meshRef.current?.syncPeers(remotePeerIds);
  }, [roomSnapshot?.room.members, peerId]);

  useEffect(() => {
    const requestPlan = [
      { track: currentTrack, limit: 8 },
      { track: upcomingTrack, limit: 3 }
    ];

    for (const plan of requestPlan) {
      if (!plan.track || uploadedTracks[plan.track.id]) {
        continue;
      }

      const announcements = Object.values(availabilityByTrack[plan.track.id] ?? {});
      const localChunks = availabilityByTrack[plan.track.id]?.[peerId]?.availableChunks ?? [];
      const totalChunks = announcements.reduce((max, a) => Math.max(max, a.totalChunks), 0);
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
    resetPlayerSurface();
    clearIdentity();
    setRoomSnapshot(null);
    setPlaylists([]);
    window.localStorage.removeItem(lastRoomStorageKey);
  }

  async function refreshRoom(roomId: string) {
    const snapshot = await musicRoomApi.getRoom(roomId, activeSession?.id);
    setRoomSnapshot(snapshot);
  }

  async function refreshAvailableRooms() {
    try {
      const rooms = await musicRoomApi.listRooms();
      setAvailableRooms(rooms);
    } catch {
      setAvailableRooms([]);
    }
  }

  async function refreshPlaylists(ownerId: string) {
    try {
      const nextPlaylists = await musicRoomApi.listPlaylists(ownerId);
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


  function mergeAvailability(announcement: TrackAvailabilityAnnouncement) {
    setAvailabilityByTrack((current) => ({
      ...current,
      [announcement.trackId]: {
        ...(current[announcement.trackId] ?? {}),
        [announcement.ownerPeerId]: announcement
      }
    }));
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
  const currentTrackDuration = audioDurationMs || currentTrack?.durationMs || 0;
  const isPlaying = roomSnapshot?.room.playback?.status === "playing";
  const availabilitySummary = roomSnapshot?.tracks.map((track) => {
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
  const statusTone = statusMessage.includes("失败") || statusMessage.includes("不可用")
    ? "warning"
    : statusMessage.includes("已")
      ? "success"
      : "neutral";
  const visibleRooms = availableRooms.filter((item) => item.room.id !== roomSnapshot?.room.id);
  return (
    <main className="music-room-shell">
      <TopBar activeSession={activeSession} roomSnapshot={roomSnapshot} />

      {roomSnapshot ? (
        <div className="status-toast-wrap" aria-live="polite">
          <div className={`status-toast ${statusTone}`}>{statusMessage}</div>
        </div>
      ) : null}

      <div className="main-content" role="tabpanel">
        <div className="panel-room">
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
              currentSourceOwnerNickname={
                roomSnapshot.tracks.find((track) => track.id === roomSnapshot.room.playback.sourceTrackId)
                  ?.ownerNickname ?? null
              }
              uploadedTracks={uploadedTracks}
              connectedPeersCount={connectedPeers.length}
              mediaConnectionState={mediaConnectionState}
              mediaConnectedPeersCount={mediaConnectedPeers.length}
              cachedTrackCount={cachedTrackCount}
              playlists={playlists}
              availabilitySummary={availabilitySummary}
              onCopyJoinCode={async () => {
                try {
                  await navigator.clipboard.writeText(roomSnapshot.room.joinCode);
                  setStatusMessage(`已复制房间码 ${roomSnapshot.room.joinCode}。`);
                } catch {
                  setStatusMessage("复制房间码失败，请手动复制。");
                }
              }}
              onLeaveRoom={() => leaveRoom()}
              onDeleteRoom={() => deleteRoom()}
              onFilesSelected={(files) => handleFilesSelected(files)}
              onAddToQueue={(trackId) => addToQueue(trackId)}
              onPlayTrack={(trackId) => playTrack(trackId)}
              onSavePlaylistFromQueue={(title) => savePlaylistFromQueue(title)}
              onLoadPlaylistIntoRoom={(playlistId) => loadPlaylistIntoRoom(playlistId)}
              onUpdatePlaylistTitle={(playlistId, title) => updatePlaylistTitle(playlistId, title)}
              onDeletePlaylist={(playlistId) => deletePlaylist(playlistId)}
            />
          ) : (
            <section className="room-empty-state workspace-block">
              <p className="block-kicker">房间页</p>
              <h2>当前没有可用的房间工作台</h2>
              <p className="placeholder-copy">
                {activeSession
                  ? "这个地址没有恢复到有效房间。请回到房间主页，重新创建或通过房间码加入。"
                  : "你还没有确认身份。请先进入房间主页确认昵称，再创建或加入房间。"}
              </p>
              <div className="hero-buttons">
                <Link href={"/rooms" as Route} className="solid-action">
                  返回房间主页
                </Link>
                {activeSession ? (
                  <button className="ghost-action" onClick={handleClearIdentity}>
                    清除当前身份
                  </button>
                ) : null}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* 鈹€鈹€ Bottom Player 鈹€鈹€ */}
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
                totalChunks: currentTrackAvailability.totalChunks,
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
        onPlayQueueItem={playQueueItem}
        onRemoveQueueItem={removeQueueItem}
        onReorderQueue={reorderQueue}
        canReorderQueue={canReorderQueue}
      />

      {isPending ? <div className="pending-indicator">正在同步房间状态…</div> : null}
    </main>
  );
}

