"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type SyntheticEvent } from "react";
import type {
  GuestSession,
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
import {
  cacheTrackAsset,
  getCachedTrackAssetCount,
  getCachedPiecesForTrack,
  getCachedTrackAssets,
  pruneCachedTracks
} from "@/lib/indexeddb";
import { removeTracksFromUploads } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { createRoomSocket, type RoomSocket } from "@/lib/ws-client";
import { TopBar } from "@/components/TopBar";
import { BottomPlayer } from "@/components/BottomPlayer";
import { LobbyView } from "@/components/LobbyView";
import { RoomDashboardView } from "@/components/room/RoomDashboardView";

type UploadedTrack = {
  file: File;
  objectUrl: string;
};

const sessionStorageKey = "music-room-session";
const lastRoomStorageKey = "music-room-last-room";
const peerStorageKey = "music-room-peer-id";
const maxCachedTracks = 24;
const capturedAudioGraphs = new WeakMap<
  HTMLAudioElement,
  {
    context: AudioContext;
    stream: MediaStream;
  }
>();

function toUserFacingError(error: unknown) {
  const message = error instanceof Error ? error.message : "请求失败。";

  if (message.includes("Only the host can control playback")) {
    return "只有房主可以控制当前房间的播放。";
  }

  if (message.includes("Only the host or the requester can remove this queue item")) {
    return "只有房主或点歌者可以移除这首歌。";
  }

  if (message.includes("Only room members can perform this action")) {
    return "加入房间后才能执行这个操作。";
  }

  if (message.includes("Room not found")) {
    return "房间不存在或已经被删除。";
  }

  if (message.includes("No tracks from this playlist are available")) {
    return "这个歌单和当前房间曲库不匹配。";
  }

  if (message.includes("Nickname is required")) {
    return "请输入昵称后再继续。";
  }

  if (message.includes("Nickname already exists in this room")) {
    return "这个昵称已经在房间里被使用了，请换一个再加入。";
  }

  if (message.includes("Only the host can delete this room")) {
    return "只有房主可以删除房间。";
  }

  return message;
}

export function MusicRoomApp() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const meshRef = useRef<P2PMesh | null>(null);
  const mediaMeshRef = useRef<RoomMediaMesh | null>(null);
  const hostStreamRef = useRef<MediaStream | null>(null);
  const requestedPiecesRef = useRef<Map<string, number>>(new Map());
  const failedPiecePeersRef = useRef<Map<string, Set<string>>>(new Map());
  const uploadedTrackUrlsRef = useRef<Map<string, string>>(new Map());
  const [isPending, startTransition] = useTransition();
  const [nickname, setNickname] = useState("");
  const [activeSession, setActiveSession] = useState<GuestSession | null>(null);
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [availableRooms, setAvailableRooms] = useState<RoomSnapshot[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [progressMs, setProgressMs] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [volume, setVolume] = useState(0.72);
  const [cachedTrackCount, setCachedTrackCount] = useState(0);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [mediaConnectedPeers, setMediaConnectedPeers] = useState<string[]>([]);
  const [peerId, setPeerId] = useState("");
  const [mediaConnectionState, setMediaConnectionState] =
    useState<RoomMediaConnectionState>("idle");
  const [availabilityByTrack, setAvailabilityByTrack] = useState<
    Record<string, Record<string, TrackAvailabilityAnnouncement>>
  >({});
  const [statusMessage, setStatusMessage] = useState("请输入昵称并确认身份。");
  const [uploadedTracks, setUploadedTracks] = useState<Record<string, UploadedTrack>>({});
  const canControlPlayback = !!activeSession && roomSnapshot?.room.hostId === activeSession.id;
  const canDeleteRoom = canControlPlayback;

  useEffect(() => {
    const storedSession = window.localStorage.getItem(sessionStorageKey);
    if (!storedSession) {
      return;
    }

    try {
      const parsed = JSON.parse(storedSession) as GuestSession;
      if (parsed.id && parsed.nickname && parsed.token) {
        setActiveSession(parsed);
        setNickname(parsed.nickname);
        setStatusMessage(`已恢复身份：${parsed.nickname}。`);
      }
    } catch {
      window.localStorage.removeItem(sessionStorageKey);
    }
  }, []);

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
    window.localStorage.setItem(sessionStorageKey, JSON.stringify(activeSession));
    void refreshAvailableRooms();
    void refreshPlaylists(activeSession.id);
  }, [activeSession]);

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
          void hydrateTrackFromPieces(trackId, mimeType, totalChunks);
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
    requestedPiecesRef.current.clear();
    failedPiecePeersRef.current.clear();
  }, [roomSnapshot?.room.id, peerId]);

  useEffect(() => {
    const nextUrls = new Map(
      Object.entries(uploadedTracks).map(([trackId, upload]) => [trackId, upload.objectUrl])
    );

    for (const [trackId, objectUrl] of uploadedTrackUrlsRef.current.entries()) {
      if (nextUrls.get(trackId) !== objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }

    uploadedTrackUrlsRef.current = nextUrls;
  }, [uploadedTracks]);

  useEffect(() => {
    return () => {
      for (const objectUrl of uploadedTrackUrlsRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      uploadedTrackUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!roomSnapshot) {
      return;
    }

    void trimLocalCache(roomSnapshot.tracks.map((track) => track.id));
  }, [roomSnapshot?.tracks]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const track = roomSnapshot?.tracks.find((item) => item.id === playback?.currentTrackId);
    const audio = audioRef.current;

    if (!playback || !track) {
      setProgressMs(0);
      return;
    }

    const tick = () => {
      if (audio && !audio.paused && Number.isFinite(audio.currentTime)) {
        setProgressMs(Math.floor(audio.currentTime * 1000));
        return;
      }

      if (playback.status !== "playing" || !playback.startedAt) {
        setProgressMs(playback.positionMs);
        return;
      }

      const elapsed = Date.now() - new Date(playback.startedAt).getTime();
      setProgressMs(Math.min(track.durationMs, playback.positionMs + elapsed));
    };

    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [roomSnapshot]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
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

    if (!canControlPlayback) {
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
  }, [roomSnapshot?.room.playback, uploadedTracks, canControlPlayback, volume]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) {
      return;
    }

    remoteAudio.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) {
      return;
    }

    if (!canControlPlayback) {
      return;
    }

    void syncHostMediaStream();
  }, [
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status,
    canControlPlayback,
    peerId
  ]);

  useEffect(() => {
    if (!roomSnapshot?.tracks.length) {
      setCachedTrackCount(0);
      return;
    }

    let disposed = false;

    const restoreCachedAssets = async () => {
      const uncachedTrackIds = roomSnapshot.tracks
        .filter((track) => !uploadedTracks[track.id])
        .map((track) => track.id);

      if (uncachedTrackIds.length === 0) {
        if (!disposed) {
          setCachedTrackCount(Object.keys(uploadedTracks).length);
        }
        return;
      }

      const cachedAssets = await getCachedTrackAssets(uncachedTrackIds);
      if (disposed || cachedAssets.length === 0) {
        if (!disposed) {
          setCachedTrackCount(Object.keys(uploadedTracks).length);
        }
        return;
      }

      setUploadedTracks((current) => {
        const next = { ...current };
        for (const asset of cachedAssets) {
          if (!next[asset.trackId]) {
            next[asset.trackId] = {
              file: new File([asset.file], `${asset.title}.bin`, {
                type: asset.mimeType || "audio/mpeg"
              }),
              objectUrl: URL.createObjectURL(asset.file)
            };
          }
        }

        setCachedTrackCount(Object.keys(next).length);
        return next;
      });

      if (roomSnapshot && peerId && activeSession) {
        for (const asset of cachedAssets) {
          const availability = await buildTrackAvailabilityFromFile({
            roomId: roomSnapshot.room.id,
            trackId: asset.trackId,
            fileHash: asset.fileHash,
            file: asset.file,
            peerId,
            nickname: activeSession.nickname,
            source: "local_cache"
          });
          mergeAvailability(availability);
          socketRef.current?.emit("piece.availability", availability);
        }
      }
    };

    void restoreCachedAssets();

    return () => {
      disposed = true;
    };
  }, [roomSnapshot, uploadedTracks, peerId, activeSession]);

  const currentTrack = useMemo(() => {
    const currentTrackId = roomSnapshot?.room.playback.currentTrackId;
    if (!currentTrackId) return null;
    return roomSnapshot?.tracks.find((track) => track.id === currentTrackId) ?? null;
  }, [roomSnapshot]);

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

    if (canControlPlayback) {
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
  }, [roomSnapshot?.room.playback, canControlPlayback, mediaConnectedPeers.length]);

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

  async function ensureSession(requiredNickname: string, actionLabel: string) {
    const trimmedNickname = requiredNickname.trim();
    if (!trimmedNickname) {
      setStatusMessage("请输入昵称。");
      return null;
    }

    setNickname(trimmedNickname);

    if (activeSession && activeSession.nickname === trimmedNickname) {
      return activeSession;
    }

    try {
      const nextSession = await musicRoomApi.createGuestSession(trimmedNickname);
      setActiveSession(nextSession);
      return nextSession;
    } catch (error) {
      const message = toUserFacingError(error);
      setStatusMessage(
        message === "请求失败。"
          ? `${actionLabel}失败，请检查网络后重试。`
          : `${actionLabel}失败：${message}`
      );
      return null;
    }
  }

  async function handleConfirmIdentity() {
    const sessionForAction = await ensureSession(nickname, "确认昵称");
    if (!sessionForAction) return;
    setStatusMessage(`已确认身份：${sessionForAction.nickname}。现在可以创建或加入房间。`);
    await refreshAvailableRooms();
  }

  async function handleCreateRoom() {
    if (!activeSession) {
      setStatusMessage("请先输入昵称并确认身份。");
      return;
    }
    await doCreateRoom(activeSession);
  }

  async function handleJoinRoom(code: string) {
    if (!activeSession) {
      setStatusMessage("请先输入昵称并确认身份。");
      return;
    }
    if (!code.trim()) {
      setStatusMessage("请输入房间码。");
      return;
    }
    await doJoinRoom(activeSession, code);
  }

  function handleClearIdentity() {
    setActiveSession(null);
    setNickname("");
    setRoomSnapshot(null);
    setPlaylists([]);
    window.localStorage.removeItem(sessionStorageKey);
    window.localStorage.removeItem(lastRoomStorageKey);
    setStatusMessage("请输入昵称并确认身份。");
  }

  async function doCreateRoom(activeSession: GuestSession) {
    if (!activeSession) return;

    try {
      const snapshot = await musicRoomApi.createRoom(activeSession.id, "public");
      setRoomSnapshot(snapshot);
      setAvailableRooms((current) => {
        const next = current.filter((room) => room.room.id !== snapshot.room.id);
        return [snapshot, ...next];
      });
      setStatusMessage(`房间已创建，分享码 ${snapshot.room.joinCode} 邀请他人加入。`);
      await refreshPlaylists(activeSession.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function doJoinRoom(activeSession: GuestSession, code: string) {
    if (!activeSession || !code.trim()) return;

    try {
      const snapshot = await musicRoomApi.joinRoomByCode(activeSession.id, code.trim());
      setRoomSnapshot(snapshot);
      await refreshAvailableRooms();
      setStatusMessage(`已加入房间 ${snapshot.room.joinCode}。`);
      await refreshPlaylists(activeSession.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function refreshRoom(roomId: string) {
    const snapshot = await musicRoomApi.getRoom(roomId, activeSession?.id);
    setRoomSnapshot(snapshot);
  }

  async function refreshAvailableRooms() {
    try {
      const rooms = await musicRoomApi.listRooms(activeSession?.id);
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

  async function leaveRoom() {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.leaveRoom(roomSnapshot.room.id, activeSession.id);
      setRoomSnapshot(null);
      window.localStorage.removeItem(lastRoomStorageKey);
      await refreshAvailableRooms();
      setStatusMessage("已离开房间。创建新房间或加入其他房间。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function deleteRoom() {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.deleteRoom(roomSnapshot.room.id, activeSession.id);
      setRoomSnapshot(null);
      window.localStorage.removeItem(lastRoomStorageKey);
      await refreshAvailableRooms();
      setStatusMessage("房间已删除。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || !activeSession || !roomSnapshot) return;

    try {
      const nextUploads: Record<string, UploadedTrack> = {};

      for (const file of Array.from(files)) {
        const objectUrl = URL.createObjectURL(file);
        const track = await buildTrackMeta(file, objectUrl);
        const registered = await musicRoomApi.registerTrack(roomSnapshot.room.id, {
          sessionId: activeSession.id,
          ...track
        });

        nextUploads[registered.id] = {
          file,
          objectUrl
        };
        await cacheTrackAsset({
          trackId: registered.id,
          fileHash: registered.fileHash,
          title: registered.title,
          mimeType: file.type || "audio/mpeg",
          file
        });

        if (peerId) {
          const availability = await buildTrackAvailabilityFromFile({
            roomId: roomSnapshot.room.id,
            trackId: registered.id,
            fileHash: registered.fileHash,
            file,
            peerId,
            nickname: activeSession.nickname,
            source: "live_upload"
          });
          mergeAvailability(availability);
          socketRef.current?.emit("piece.availability", availability);
        }
      }

      setUploadedTracks((current) => ({ ...current, ...nextUploads }));
      await trimLocalCache([
        ...roomSnapshot.tracks.map((track) => track.id),
        ...Object.keys(nextUploads)
      ]);
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage(`${Object.keys(nextUploads).length} 首本地歌曲已导入房间曲库。`);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function addToQueue(trackId: string) {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.addQueueItem(roomSnapshot.room.id, {
        sessionId: activeSession.id,
        trackId
      });
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("曲目已添加到播放队列。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function playTrack(trackId?: string) {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "play",
        trackId,
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function pauseTrack(positionMs = Math.round((audioRef.current?.currentTime ?? 0) * 1000)) {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "pause",
        positionMs,
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function prevTrack() {
    if (!roomSnapshot || !activeSession) return;

    try {
      // Go to previous track - restart current or go to previous in queue
      const playback = roomSnapshot?.room.playback;
      if (playback?.currentTrackId) {
        // If progress > 3s, restart current track; otherwise seek to 0
        if (progressMs > 3000) {
          await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "seek",
            positionMs: 0,
            sessionId: activeSession.id
          });
        } else {
          await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "prev",
            sessionId: activeSession.id
          });
        }
        await refreshRoom(roomSnapshot.room.id);
      }
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function nextTrack() {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "next",
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function savePlaylistFromQueue(title: string) {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.createPlaylistFromRoom({
        ownerId: activeSession.id,
        roomId: roomSnapshot.room.id,
        title,
        description: "从当前房间队列保存"
      });
      await refreshPlaylists(activeSession.id);
      setStatusMessage(`歌单“${title}”已保存。`);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function updatePlaylistTitle(playlistId: string, title: string) {
    if (!activeSession) return;

    try {
      await musicRoomApi.updatePlaylist(playlistId, {
        ownerId: activeSession.id,
        title
      });
      await refreshPlaylists(activeSession.id);
      setStatusMessage("歌单名称已更新。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function deletePlaylist(playlistId: string) {
    if (!activeSession) return;

    try {
      await musicRoomApi.deletePlaylist(playlistId, activeSession.id);
      await refreshPlaylists(activeSession.id);
      setStatusMessage("歌单已从个人存档中删除。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function loadPlaylistIntoRoom(playlistId: string) {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.importPlaylistToRoom(playlistId, {
        roomId: roomSnapshot.room.id,
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("歌单已加载到当前房间的播放队列。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function removeQueueItem(queueItemId: string) {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.removeQueueItemAs(roomSnapshot.room.id, queueItemId, activeSession.id);
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("曲目已从队列中移除。");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function seekTrack(positionMs: number) {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "seek",
        positionMs,
        sessionId: activeSession.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleEnded() {
    if (!roomSnapshot) return;
    await nextTrack();
  }

  function syncProgressFromAudio(event?: SyntheticEvent<HTMLAudioElement>) {
    const audio = event?.currentTarget ?? audioRef.current;
    if (!audio || !Number.isFinite(audio.currentTime)) {
      return;
    }

    const nextProgressMs = Math.floor(audio.currentTime * 1000);
    setProgressMs(
      currentTrackDuration > 0 ? Math.min(nextProgressMs, currentTrackDuration) : nextProgressMs
    );
  }

  function syncDurationFromAudio(event?: SyntheticEvent<HTMLAudioElement>) {
    const audio = event?.currentTarget ?? audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }

    setAudioDurationMs(Math.round(audio.duration * 1000));
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

  async function announceLocalCache(trackId: string, totalChunks?: number) {
    if (!roomSnapshot || !activeSession || !peerId) {
      return;
    }

    const availability = await buildTrackAvailabilityFromCache({
      roomId: roomSnapshot.room.id,
      trackId,
      peerId,
      nickname: activeSession.nickname,
      totalChunks
    });

    if (!availability) {
      return;
    }

    mergeAvailability(availability);
    socketRef.current?.emit("piece.availability", availability);
  }

  async function hydrateTrackFromPieces(trackId: string, mimeType: string, totalChunks: number) {
    if (!roomSnapshot) {
      return;
    }

    const pieces = await getCachedPiecesForTrack(trackId, peerId);
    if (pieces.length < totalChunks) {
      return;
    }

    const track = roomSnapshot.tracks.find((entry) => entry.id === trackId);
    if (!track || uploadedTracks[trackId]) {
      return;
    }

    const assembled = await assembleTrackFileFromPieces({
      pieces,
      totalChunks,
      mimeType: mimeType || "audio/mpeg",
      title: track.title,
      expectedFileHash: track.fileHash
    });

    if (!assembled) {
      setStatusMessage(`曲目 ${track.title} 的下载分片不完整或校验失败。`);
      return;
    }

    const objectUrl = URL.createObjectURL(assembled.blob);

    await cacheTrackAsset({
      trackId,
      fileHash: track.fileHash,
      title: track.title,
      mimeType: mimeType || "audio/mpeg",
      file: assembled.blob
    });

    setUploadedTracks((current) => ({
      ...current,
      [trackId]: {
        file: assembled.file,
        objectUrl
      }
    }));
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
    await trimLocalCache(roomSnapshot.tracks.map((entry) => entry.id));
    setStatusMessage(`已从房间其他成员恢复曲目 ${track.title} 的本地缓存。`);
  }

  async function trimLocalCache(protectedTrackIds: string[]) {
    const removedTrackIds = await pruneCachedTracks(maxCachedTracks, protectedTrackIds);
    const nextCount = await getCachedTrackAssetCount();
    setCachedTrackCount(nextCount);

    if (removedTrackIds.length === 0) {
      return;
    }

    setUploadedTracks((current) => {
      return removeTracksFromUploads(current, removedTrackIds);
    });
  }

  async function syncHostMediaStream() {
    if (!roomSnapshot?.room.id || !peerId || !canControlPlayback) {
      return;
    }

    const audio = audioRef.current;
    if (!audio || !roomSnapshot.room.playback.currentTrackId) {
      await mediaMeshRef.current?.syncHostPeers([], null);
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
    await mediaMeshRef.current?.syncHostPeers(listenerPeerIds, capture);
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
      <TopBar
        activeSession={activeSession}
        roomSnapshot={roomSnapshot}
        connectedPeersCount={connectedPeers.length}
        mediaConnectedPeersCount={mediaConnectedPeers.length}
      />

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
              onRemoveQueueItem={(itemId) => removeQueueItem(itemId)}
              onPlayTrack={(trackId) => playTrack(trackId)}
              onSavePlaylistFromQueue={(title) => savePlaylistFromQueue(title)}
              onLoadPlaylistIntoRoom={(playlistId) => loadPlaylistIntoRoom(playlistId)}
              onUpdatePlaylistTitle={(playlistId, title) => updatePlaylistTitle(playlistId, title)}
              onDeletePlaylist={(playlistId) => deletePlaylist(playlistId)}
            />
          ) : (
            <LobbyView
              nickname={nickname}
              setNickname={setNickname}
              activeSession={activeSession}
              visibleRooms={visibleRooms}
              statusMessage={statusMessage}
              onConfirmIdentity={handleConfirmIdentity}
              onCreateRoom={handleCreateRoom}
              onJoinRoom={handleJoinRoom}
              onLeaveRoom={handleClearIdentity}
              onRefreshRooms={refreshAvailableRooms}
            />
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
      />

      {isPending ? <div className="pending-indicator">正在同步房间状态…</div> : null}
    </main>
  );
}

async function buildTrackMeta(file: File, objectUrl: string) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const fileHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const durationMs = await readDuration(objectUrl);
  const title = file.name.replace(/\.[^/.]+$/, "");

  return {
    title,
    artist: "本地上传",
    album: null,
    durationMs,
    bitrate: null,
    fileHash,
    artworkUrl: null,
    sourceType: "local_upload" as const
  };
}

function readDuration(objectUrl: string) {
  return new Promise<number>((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = objectUrl;

    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
      audio.pause();
      audio.src = "";
      audio.load();
    };

    const handleLoadedMetadata = () => {
      cleanup();
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    };

    const handleError = () => {
      cleanup();
      resolve(0);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("error", handleError);
    audio.load();
  });
}

function captureAudioStream(audio: HTMLAudioElement) {
  const cachedGraph = capturedAudioGraphs.get(audio);
  if (cachedGraph) {
    if (cachedGraph.context.state === "suspended") {
      void cachedGraph.context.resume().catch(() => undefined);
    }

    return cachedGraph.stream;
  }

  if (typeof window !== "undefined") {
    const AudioContextCtor = window.AudioContext;
    if (AudioContextCtor) {
      const context = new AudioContextCtor();
      const source = context.createMediaElementSource(audio);
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      source.connect(context.destination);
      capturedAudioGraphs.set(audio, {
        context,
        stream: destination.stream
      });
      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
      return destination.stream;
    }
  }

  const mediaAudio = audio as HTMLAudioElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };

  if (typeof mediaAudio.captureStream === "function") {
    return mediaAudio.captureStream();
  }

  if (typeof mediaAudio.mozCaptureStream === "function") {
    return mediaAudio.mozCaptureStream();
  }

  return null;
}

