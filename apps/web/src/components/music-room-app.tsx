"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type SyntheticEvent } from "react";
import type {
  GuestSession,
  Playlist,
  RoomSnapshot,
  PeerSignalMessage,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import {
  assembleTrackFileFromPieces,
  buildTrackAvailabilityFromCache,
  buildTrackAvailabilityFromFile,
  getMissingChunkIndexes,
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
import { musicRoomApi } from "@/lib/music-room-api";
import { createRoomSocket, type RoomSocket } from "@/lib/ws-client";

type UploadedTrack = {
  file: File;
  objectUrl: string;
};

const sessionStorageKey = "music-room-session";
const lastRoomStorageKey = "music-room-last-room";
const peerStorageKey = "music-room-peer-id";
const maxCachedTracks = 24;

function toUserFacingError(error: unknown) {
  const message = error instanceof Error ? error.message : "请求失败。";

  if (message.includes("Only the host can control playback")) {
    return "只有房主可以控制该房间的播放。";
  }

  if (message.includes("Only the host or the requester can remove this queue item")) {
    return "只有房主或点歌者可以移除该曲目。";
  }

  if (message.includes("Only room members can perform this action")) {
    return "该操作需要在加入房间后才能使用。";
  }

  if (message.includes("Room not found")) {
    return "该房间已不存在。";
  }

  if (message.includes("No tracks from this playlist are available")) {
    return "该歌单与当前房间的曲目不匹配。";
  }

  return message;
}

export function MusicRoomApp() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const meshRef = useRef<P2PMesh | null>(null);
  const requestedPiecesRef = useRef<Map<string, number>>(new Map());
  const failedPiecePeersRef = useRef<Map<string, Set<string>>>(new Map());
  const uploadedTrackUrlsRef = useRef<Map<string, string>>(new Map());
  const [isPending, startTransition] = useTransition();
  const [nickname, setNickname] = useState("");
  const [activeSession, setActiveSession] = useState<GuestSession | null>(null);
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [availableRooms, setAvailableRooms] = useState<RoomSnapshot[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistTitle, setPlaylistTitle] = useState("Tonight Selects");
  const [playlistEditId, setPlaylistEditId] = useState<string | null>(null);
  const [playlistEditTitle, setPlaylistEditTitle] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [progressMs, setProgressMs] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [volume, setVolume] = useState(0.72);
  const [cachedTrackCount, setCachedTrackCount] = useState(0);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [peerId, setPeerId] = useState("");
  const [availabilityByTrack, setAvailabilityByTrack] = useState<
    Record<string, Record<string, TrackAvailabilityAnnouncement>>
  >({});
  const [statusMessage, setStatusMessage] = useState(
    "输入昵称后即可创建或加入房间。"
  );
  const [uploadedTracks, setUploadedTracks] = useState<Record<string, UploadedTrack>>({});
  const [activeTab, setActiveTab] = useState<"room" | "library" | "queue" | "playlist">("room");

  useEffect(() => {
    const storedPeerId = window.localStorage.getItem(peerStorageKey);
    if (storedPeerId) {
      setPeerId(storedPeerId);
      return;
    }

    const nextPeerId = `peer_${crypto.randomUUID()}`;
    window.localStorage.setItem(peerStorageKey, nextPeerId);
    setPeerId(nextPeerId);
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    window.localStorage.setItem(sessionStorageKey, JSON.stringify(activeSession));
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
      setStatusMessage("该房间已不可用。创建新房间或加入其他房间。");
    });
    socket.on("disconnect", () => {
      setStatusMessage("实时连接中断，正在重新连接...");
    });

    return () => {
      socket.emit("room.unsubscribe", { roomId });
      socket.disconnect();
      socketRef.current = null;
      mesh.destroy();
      meshRef.current = null;
      setConnectedPeers([]);
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
      setProgressMs(0);
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
        setStatusMessage("浏览器已阻止自动播放，请点击播放以恢复本地音频。");
      });
    }

    if (playback.status === "paused") {
      audio.pause();
    }
  }, [roomSnapshot?.room.playback, uploadedTracks]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

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
      const totalChunks = announcements[0]?.totalChunks ?? 0;
      const missingChunkIndexes = getMissingChunkIndexes(totalChunks, localChunks, plan.limit);

      for (const chunkIndex of missingChunkIndexes) {
        const requestKey = `${plan.track.id}:${chunkIndex}`;
        if (requestedPiecesRef.current.has(requestKey)) {
          continue;
        }

        const excludedPeerIds = [...(failedPiecePeersRef.current.get(requestKey) ?? new Set())];
        const preferredSource = selectChunkSource(
          announcements.filter((announcement) => announcement.availableChunks.includes(chunkIndex)),
          connectedPeers,
          peerId,
          excludedPeerIds
        );
        if (!preferredSource) {
          continue;
        }

        const didRequest = meshRef.current?.requestPiece(
          preferredSource.ownerPeerId,
          plan.track.id,
          chunkIndex
        );

        if (didRequest) {
          requestedPiecesRef.current.set(requestKey, Date.now());
        }
      }
    }
  }, [availabilityByTrack, connectedPeers, currentTrack, upcomingTrack, peerId, uploadedTracks]);

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

  function handleCreateRoom() {
    void (async () => {
      const sessionForAction = await ensureSession(nickname, "创建房间");
      if (!sessionForAction) return;
      await doCreateRoom(sessionForAction);
    })();
  }

  function handleJoinRoom(code: string) {
    if (!code.trim()) {
      setStatusMessage("请输入房间码。");
      return;
    }

    void (async () => {
      const sessionForAction = await ensureSession(nickname, "加入房间");
      if (!sessionForAction) return;
      await doJoinRoom(sessionForAction, code);
    })();
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
    const snapshot = await musicRoomApi.getRoom(roomId);
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
    const nextPlaylists = await musicRoomApi.listPlaylists(ownerId);
    setPlaylists(nextPlaylists);
  }

  async function leaveRoom() {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.leaveRoom(roomSnapshot.room.id, activeSession.id);
      setRoomSnapshot(null);
      setJoinCode("");
      window.localStorage.removeItem(lastRoomStorageKey);
      await refreshAvailableRooms();
      setStatusMessage("已离开房间。创建新房间或加入其他房间。");
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
      setStatusMessage(`${Object.keys(nextUploads).length} 首本地曲目已导入房间曲目库。`);
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

  async function pauseTrack() {
    if (!roomSnapshot || !activeSession) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "pause",
        positionMs: Math.round((audioRef.current?.currentTime ?? 0) * 1000),
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

  async function savePlaylistFromQueue() {
    if (!activeSession || !roomSnapshot) return;

    try {
      await musicRoomApi.createPlaylistFromRoom({
        ownerId: activeSession.id,
        roomId: roomSnapshot.room.id,
        title: playlistTitle,
        description: "从当前房间队列保存。"
      });
      await refreshPlaylists(activeSession.id);
      setStatusMessage(`歌单"${playlistTitle}"已从当前房间队列保存。`);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function updatePlaylistTitle() {
    if (!activeSession || !playlistEditId || !playlistEditTitle.trim()) return;

    try {
      await musicRoomApi.updatePlaylist(playlistEditId, {
        ownerId: activeSession.id,
        title: playlistEditTitle.trim()
      });
      await refreshPlaylists(activeSession.id);
      setPlaylistEditId(null);
      setPlaylistEditTitle("");
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
      if (playlistEditId === playlistId) {
        setPlaylistEditId(null);
        setPlaylistEditTitle("");
      }
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
      const next = { ...current };
      for (const trackId of removedTrackIds) {
        delete next[trackId];
      }
      return next;
    });
  }

  const host = roomSnapshot?.room.members.find((member) => member.role === "host");
  const currentTrackDuration = currentTrack?.durationMs ?? 0;
  const effectiveProgressMs = seekDraft ?? progressMs;
  const progressRatio =
    currentTrackDuration > 0 ? Math.min(effectiveProgressMs / currentTrackDuration, 1) : 0;
  const canControlPlayback = !!activeSession && roomSnapshot?.room.hostId === activeSession.id;
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
  const nextTrackAvailability = upcomingTrack
    ? availabilitySummary.find((entry) => entry.track.id === upcomingTrack.id) ?? null
    : null;
  const statusTone = statusMessage.includes("失败") || statusMessage.includes("不可用")
    ? "warning"
    : statusMessage.includes("已")
      ? "success"
      : "neutral";
  const hasArtwork = Boolean(currentTrack?.artworkUrl);
  const visibleRooms = availableRooms.filter((item) => item.room.id !== roomSnapshot?.room.id);

  return (
    <main className="music-room-shell">
      {/* ── Top Bar ── */}
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="top-bar-appname">🎵 音乐房间</span>
          {roomSnapshot ? (
            <span className="top-bar-room-info">
              <span className={`signal-dot${roomSnapshot ? " live" : ""}`} />
              房间码 <strong>{roomSnapshot.room.joinCode}</strong>
              <span className="top-bar-sep">·</span>
              {roomSnapshot.room.members.length} 人在线
              <span className="top-bar-sep">·</span>
              Mesh {connectedPeers.length} 已连接
            </span>
          ) : null}
        </div>
        <nav className="tab-bar" role="tablist">
          {(["room", "library", "queue", "playlist"] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              className={`tab-btn${activeTab === tab ? " active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "room" && "房间"}
              {tab === "library" && "曲库"}
              {tab === "queue" && "队列"}
              {tab === "playlist" && "歌单"}
            </button>
          ))}
        </nav>
        <div className="top-bar-right">
          {activeSession?.nickname ? (
            <span className="identity-badge">{activeSession.nickname}</span>
          ) : null}
        </div>
      </header>

      <div className="status-toast-wrap" aria-live="polite">
        <div className={`status-toast ${statusTone}`}>{statusMessage}</div>
      </div>

      {/* ── Main Content ── */}
      <div className="main-content" role="tabpanel">

        {/* ── Tab: 房间 ── */}
        {activeTab === "room" && (
          <div className="panel-room">
            {roomSnapshot ? (
              /* In a room */
              <div className="room-section">
                {/* Identity card */}
                <div className="identity-card">
                  <div className="identity-info">
                    <span className="field-label">当前身份</span>
                    <strong>{activeSession?.nickname ?? "—"}</strong>
                  </div>
                  <div className="room-controls">
                    <button
                      className="ghost-action"
                      onClick={() => startTransition(() => void leaveRoom())}
                    >
                      离开房间
                    </button>
                  </div>
                </div>

                {/* Room info */}
                <>
                  <div className="room-info-grid">
                    <div className="room-info-card">
                      <span className="field-label">房间码</span>
                      <strong className="room-code-display">{roomSnapshot.room.joinCode}</strong>
                      <p className="room-info-hint">分享给朋友，让他们加入</p>
                    </div>
                    <div className="room-info-card">
                      <span className="field-label">房主</span>
                      <strong>{host?.nickname ?? "—"}</strong>
                    </div>
                    <div className="room-info-card">
                      <span className="field-label">曲目</span>
                      <strong>{roomSnapshot.tracks.length}</strong>
                    </div>
                    <div className="room-info-card">
                      <span className="field-label">队列</span>
                      <strong>{roomSnapshot.queue.length}</strong>
                    </div>
                    <div className="room-info-card">
                      <span className="field-label">在线成员</span>
                      <strong>{roomSnapshot.room.members.length}</strong>
                    </div>
                    <div className="room-info-card">
                      <span className="field-label">Mesh 连接</span>
                      <strong>{connectedPeers.length} 节点</strong>
                    </div>
                  </div>

                  {/* Members list */}
                  <section className="workspace-block">
                    <div className="block-heading">
                      <div>
                        <p className="block-kicker">成员</p>
                        <h2>房间里的人</h2>
                      </div>
                      <span>{roomSnapshot.room.members.length} 人</span>
                    </div>
                    <div className="member-rail">
                      {roomSnapshot.room.members.length ? (
                        roomSnapshot.room.members.map((member) => (
                          <div key={member.id} className="member-pill">
                            <strong>{member.nickname}</strong>
                            <span>{member.role === "host" ? "👑 房主" : "🎧 听众"}</span>
                          </div>
                        ))
                      ) : (
                        <p className="placeholder-copy">暂无成员</p>
                      )}
                    </div>
                  </section>

                  {/* P2P Mesh status */}
                  <section className="workspace-block">
                    <div className="block-heading">
                      <div>
                        <p className="block-kicker">Mesh</p>
                        <h2>P2P 缓存状态</h2>
                      </div>
                      <span>{availabilitySummary.length} 曲目</span>
                    </div>
                    <div className="playlist-list">
                      {availabilitySummary.length ? (
                        availabilitySummary.slice(0, 6).map(({ track, peerCount, localChunkCount, totalChunks }) => (
                          <div key={track.id} className="playlist-line">
                            <div>
                              <strong>{track.title}</strong>
                              <p>
                                本地 {localChunkCount}/{totalChunks || 0} 分片 · {peerCount} 个节点
                              </p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="placeholder-copy">导入曲目后，这里显示分片缓存状态。</p>
                      )}
                    </div>
                  </section>
                </>
              </div>
            ) : (
              /* Not in a room - show create/join controls */
              <div className="room-section">
                <section className="workspace-block lobby-card">
                  <div className="block-heading">
                    <div>
                      <p className="block-kicker">房间</p>
                      <h2>创建或加入房间</h2>
                    </div>
                  </div>

                  <div className="field-stack compact-field">
                    <span className="field-label">昵称</span>
                    <input
                      className="hero-input subtle"
                      value={nickname}
                      onChange={(event) => setNickname(event.target.value)}
                      placeholder="输入你的昵称"
                    />
                  </div>

                  <div className="room-actions-row">
                    <div className="field-stack compact-field">
                      <span className="field-label">房间码</span>
                      <div className="join-inline">
                        <input
                          className="hero-input subtle"
                          value={joinCode}
                          onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                          placeholder="输入房间码"
                        />
                        <button
                          className="ghost-action ghost-action-emphasis"
                          disabled={!nickname.trim() || !joinCode.trim()}
                          onClick={() => handleJoinRoom(joinCode)}
                        >
                          加入
                        </button>
                      </div>
                    </div>
                    <button
                      className="solid-action"
                      disabled={!nickname.trim()}
                      onClick={handleCreateRoom}
                    >
                      创建房间
                    </button>
                  </div>

                  <div className="lobby-room-list">
                    <div className="block-heading lobby-room-list-heading">
                      <div>
                        <p className="block-kicker">实时房间</p>
                        <h2>可加入的房间</h2>
                      </div>
                      <button
                        className="ghost-action lobby-refresh"
                        onClick={() => startTransition(() => void refreshAvailableRooms())}
                      >
                        刷新
                      </button>
                    </div>

                    {visibleRooms.length ? (
                      <div className="room-list">
                        {visibleRooms.map((item) => {
                          const roomHost =
                            item.room.members.find((member) => member.role === "host")?.nickname ?? "—";

                          return (
                            <button
                              key={item.room.id}
                              type="button"
                              className="room-card room-card-button"
                              onClick={() => handleJoinRoom(item.room.joinCode)}
                            >
                              <div className="room-card-info">
                                <div className="room-card-code-row">
                                  <span className="room-card-code">{item.room.joinCode}</span>
                                  <span
                                    className="room-code-copy"
                                    onClick={async (event) => {
                                      event.stopPropagation();
                                      try {
                                        await navigator.clipboard.writeText(item.room.joinCode);
                                        setStatusMessage(`已复制房间码 ${item.room.joinCode}。`);
                                      } catch {
                                        setStatusMessage("复制房间码失败，请手动复制。");
                                      }
                                    }}
                                  >
                                    复制
                                  </span>
                                </div>
                                <span className="room-card-host">房主：{roomHost}</span>
                              </div>
                              <span className="room-card-members">
                                {item.room.members.length} 人在线
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="placeholder-copy">暂无可用房间</p>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: 曲库 ── */}
        {activeTab === "library" && (
          <div className="panel-library">
            <section className="workspace-block">
              <div className="block-heading">
                <div>
                  <p className="block-kicker">曲库</p>
                  <h2>导入本地音乐</h2>
                </div>
                <span>{roomSnapshot?.tracks.length ?? 0} 首曲目</span>
              </div>

              <label className="drop-zone">
                <span>拖放音频文件到此处，或从设备中选择。</span>
                <input
                  type="file"
                  accept="audio/*"
                  multiple
                  className="hidden"
                  disabled={!roomSnapshot}
                  onChange={(event) =>
                    startTransition(() => void handleFilesSelected(event.target.files))
                  }
                />
              </label>
              {!roomSnapshot && (
                <p className="player-note">请先在「房间」标签页创建或加入一个房间。</p>
              )}

              <div className="track-list">
                {roomSnapshot?.tracks.length ? (
                  roomSnapshot.tracks.map((track) => (
                    <article key={track.id} className="track-row">
                      <div className="track-row-copy">
                        <h3>{track.title}</h3>
                        <p>
                          {track.artist} · {formatDuration(track.durationMs)}
                        </p>
                      </div>
                      <div className="track-row-actions">
                        <button
                          className="ghost-action"
                          disabled={!roomSnapshot}
                          onClick={() => startTransition(() => void addToQueue(track.id))}
                        >
                          入队
                        </button>
                        <button
                          className="solid-action compact"
                          disabled={!canControlPlayback}
                          onClick={() => startTransition(() => void playTrack(track.id))}
                        >
                          立即播放
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="placeholder-copy">暂无曲目。打开房间后，拖放或选择本地音频文件导入。</p>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ── Tab: 队列 ── */}
        {activeTab === "queue" && (
          <div className="panel-queue">
            <section className="workspace-block">
              <div className="block-heading">
                <div>
                  <p className="block-kicker">队列</p>
                  <h2>共享播放顺序</h2>
                </div>
                <span>{roomSnapshot?.queue.length ?? 0} 首在队列</span>
              </div>

              <div className="queue-stack">
                {roomSnapshot?.queue.length ? (
                  roomSnapshot.queue.map((item, index) => {
                    const track = roomSnapshot.tracks.find((entry) => entry.id === item.trackId);
                    const canRemoveQueueItem =
                      !!activeSession &&
                      (roomSnapshot.room.hostId === activeSession.id ||
                        item.requestedById === activeSession.id);

                    return (
                      <div key={item.id} className="queue-line">
                        <span className="queue-index">{String(index + 1).padStart(2, "0")}</span>
                        <div className="queue-copy">
                          <strong>{track?.title ?? "未知曲目"}</strong>
                          <p>点歌人：{item.requestedBy}</p>
                        </div>
                        <button
                          className="queue-remove"
                          disabled={!canRemoveQueueItem}
                          onClick={() => startTransition(() => void removeQueueItem(item.id))}
                        >
                          移除
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <p className="placeholder-copy">队列为空。从曲库选择曲目入队开始播放。</p>
                )}
              </div>
            </section>

            {/* Quick track add when queue is empty */}
            {roomSnapshot && roomSnapshot.tracks.length > 0 && (
              <section className="workspace-block">
                <div className="block-heading">
                  <div>
                    <p className="block-kicker">快速添加</p>
                    <h2>从曲库入队</h2>
                  </div>
                </div>
                <div className="track-list">
                  {roomSnapshot.tracks.slice(0, 8).map((track) => (
                    <article key={track.id} className="track-row">
                      <div className="track-row-copy">
                        <h3>{track.title}</h3>
                        <p>{track.artist} · {formatDuration(track.durationMs)}</p>
                      </div>
                      <div className="track-row-actions">
                        <button
                          className="ghost-action"
                          onClick={() => startTransition(() => void addToQueue(track.id))}
                        >
                          入队
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ── Tab: 歌单 ── */}
        {activeTab === "playlist" && (
          <div className="panel-playlist">
            <section className="workspace-block">
              <div className="block-heading">
                <div>
                  <p className="block-kicker">存档</p>
                  <h2>保存今晚的歌</h2>
                </div>
                <span>{playlists.length} 个歌单</span>
              </div>

              <div className="playlist-create">
                <label className="field-stack">
                  <span className="field-label">歌单名称</span>
                  <input
                    className="hero-input subtle"
                    value={playlistTitle}
                    onChange={(event) => setPlaylistTitle(event.target.value)}
                    placeholder="例如：今晚的歌"
                  />
                </label>
                <button
                  className="solid-action"
                  disabled={!activeSession || !roomSnapshot || roomSnapshot.queue.length === 0}
                  onClick={() => startTransition(() => void savePlaylistFromQueue())}
                >
                  保存当前队列为歌单
                </button>
              </div>

              <div className="playlist-list">
                {playlists.length ? (
                  playlists.map((playlist) => (
                    <div key={playlist.id} className="playlist-line">
                      {playlistEditId === playlist.id ? (
                        <>
                          <label className="field-stack">
                            <span className="field-label">重命名歌单</span>
                            <input
                              className="hero-input subtle"
                              value={playlistEditTitle}
                              onChange={(event) => setPlaylistEditTitle(event.target.value)}
                            />
                          </label>
                          <div className="track-row-actions">
                            <button
                              className="solid-action compact"
                              disabled={!playlistEditTitle.trim()}
                              onClick={() => startTransition(() => void updatePlaylistTitle())}
                            >
                              保存
                            </button>
                            <button
                              className="ghost-action"
                              onClick={() => {
                                setPlaylistEditId(null);
                                setPlaylistEditTitle("");
                              }}
                            >
                              取消
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <strong>{playlist.title}</strong>
                            <p>
                              {playlist.trackIds.length} 首曲目 ·{" "}
                              {playlist.isCollaborative ? "协作" : "个人"}
                            </p>
                          </div>
                          <div className="track-row-actions">
                            <button
                              className="solid-action compact"
                              disabled={!roomSnapshot}
                              onClick={() => startTransition(() => void loadPlaylistIntoRoom(playlist.id))}
                            >
                              加载到房间
                            </button>
                            <button
                              className="ghost-action"
                              onClick={() => {
                                setPlaylistEditId(playlist.id);
                                setPlaylistEditTitle(playlist.title);
                              }}
                            >
                              重命名
                            </button>
                            <button
                              className="queue-remove"
                              onClick={() => startTransition(() => void deletePlaylist(playlist.id))}
                            >
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="placeholder-copy">把今晚的队列保存为歌单，开始建立你的收藏。</p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* ── Bottom Player ── */}
      <footer className={`bottom-player${isPlaying ? " playing" : ""}`}>
        {/* Track info */}
        <div className="bp-track-info">
          <div className={`bp-artwork${hasArtwork ? "" : " is-placeholder"}`}>
            {hasArtwork ? (
              <img src={currentTrack?.artworkUrl ?? ""} alt="" className="bp-artwork-image" />
            ) : (
              <div className="bp-artwork-fallback" aria-hidden="true">
                <span className="bp-artwork-disc" />
                <span className="bp-artwork-note">♪</span>
              </div>
            )}
          </div>
          <div className="bp-track-copy">
            <p className="player-caption">正在播放</p>
            <h3 className="bp-track-title">{currentTrack?.title ?? "等待播放"}</h3>
            <p className="bp-track-artist">{currentTrack?.artist ?? "从曲库或队列选择曲目"}</p>
          </div>
        </div>

        {/* Playback controls */}
        <div className="bp-controls">
          <button
            className="bp-btn ghost-action inverse"
            disabled={!canControlPlayback || !roomSnapshot?.room.playback?.currentTrackId}
            onClick={() => startTransition(() => void prevTrack())}
            title="前一首"
          >
            ⏮
          </button>
          <button
            className={`bp-btn bp-btn-main ${isPlaying ? "bp-btn-playing" : "bp-btn-paused"}`}
            disabled={!canControlPlayback}
            onClick={() =>
              startTransition(() => void (isPlaying ? pauseTrack() : playTrack()))
            }
            title={isPlaying ? "暂停" : "播放"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            className="bp-btn ghost-action inverse"
            disabled={!canControlPlayback || !roomSnapshot?.room.playback?.currentTrackId}
            onClick={() => startTransition(() => void nextTrack())}
            title="下一首"
          >
            ⏭
          </button>
        </div>

        {/* Progress bar */}
        <div className="bp-progress-area">
          <span className="bp-time">{formatDuration(effectiveProgressMs)}</span>
          <div className="progress-shell bp-progress-shell">
            <div className="progress-track-gray" />
            <div
              className="progress-fill"
              style={{ width: `${progressRatio * 100}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={currentTrackDuration || 1}
            step={1000}
            value={effectiveProgressMs}
            className="progress-slider bp-slider"
            disabled={!currentTrackDuration || !canControlPlayback}
            onChange={(event) => setSeekDraft(Number(event.target.value))}
            onMouseUp={() => {
              if (seekDraft !== null && canControlPlayback) {
                startTransition(() => void seekTrack(seekDraft));
                setSeekDraft(null);
              }
            }}
            onTouchEnd={() => {
              if (seekDraft !== null && canControlPlayback) {
                startTransition(() => void seekTrack(seekDraft));
                setSeekDraft(null);
              }
            }}
          />
          <span className="bp-time">{formatDuration(currentTrackDuration)}</span>
        </div>

        {/* Status notes */}
        <div className="bp-status">
          {!canControlPlayback && roomSnapshot && (
            <span className="bp-note">仅房主可控制播放</span>
          )}
          {!uploadedTracks[currentTrack?.id ?? ""] && currentTrack && (
            <span className="bp-note">本地无文件 · P2P传输中</span>
          )}
          {!uploadedTracks[currentTrack?.id ?? ""] && currentTrackAvailability ? (
            <span className="bp-note">
              缓存 {currentTrackAvailability.localChunkCount}/{currentTrackAvailability.totalChunks || 0} 分片
            </span>
          ) : null}
          <label className="bp-volume" aria-label="音量">
            <span className="bp-volume-icon">🔊</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </label>
        </div>

        <audio
          ref={audioRef}
          className="player-audio hidden"
          onEnded={() => void handleEnded()}
          onTimeUpdate={syncProgressFromAudio}
          onLoadedMetadata={syncProgressFromAudio}
          onPlay={syncProgressFromAudio}
          onPause={syncProgressFromAudio}
          onSeeked={syncProgressFromAudio}
        />
      </footer>

      {isPending ? <div className="pending-indicator">正在同步房间状态...</div> : null}
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
  });
}

function formatDuration(durationMs: number) {
  if (!durationMs) {
    return "0:00";
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
