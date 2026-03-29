"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { createRoomSocket } from "@/lib/ws-client";

type UploadedTrack = {
  file: File;
  objectUrl: string;
};

const sessionStorageKey = "music-room-session";
const lastRoomStorageKey = "music-room-last-room";
const peerStorageKey = "music-room-peer-id";
const maxCachedTracks = 24;

function toUserFacingError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";

  if (message.includes("Only the host can control playback")) {
    return "Only the host can control playback for this room.";
  }

  if (message.includes("Only the host or the requester can remove this queue item")) {
    return "Only the host or the member who queued this track can remove it.";
  }

  if (message.includes("Only room members can perform this action")) {
    return "This action is only available after joining the room.";
  }

  if (message.includes("Room not found")) {
    return "That room is no longer available.";
  }

  if (message.includes("No tracks from this playlist are available")) {
    return "This playlist does not match any tracks in the current room.";
  }

  return message;
}

export function MusicRoomApp() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<ReturnType<typeof createRoomSocket> | null>(null);
  const meshRef = useRef<P2PMesh | null>(null);
  const requestedPiecesRef = useRef<Map<string, number>>(new Map());
  const failedPiecePeersRef = useRef<Map<string, Set<string>>>(new Map());
  const [isPending, startTransition] = useTransition();
  const [nickname, setNickname] = useState("Host");
  const [session, setSession] = useState<GuestSession | null>(null);
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistTitle, setPlaylistTitle] = useState("Tonight Selects");
  const [playlistEditId, setPlaylistEditId] = useState<string | null>(null);
  const [playlistEditTitle, setPlaylistEditTitle] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [progressMs, setProgressMs] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [cachedTrackCount, setCachedTrackCount] = useState(0);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [peerId, setPeerId] = useState("");
  const [availabilityByTrack, setAvailabilityByTrack] = useState<
    Record<string, Record<string, TrackAvailabilityAnnouncement>>
  >({});
  const [statusMessage, setStatusMessage] = useState(
    "Create a guest identity, open a room, import local tracks, and turn the queue into a sharable playlist."
  );
  const [uploadedTracks, setUploadedTracks] = useState<Record<string, UploadedTrack>>({});

  useEffect(() => {
    const raw = window.localStorage.getItem(sessionStorageKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as GuestSession;
      setSession(parsed);
      setNickname(parsed.nickname);
    } catch {
      window.localStorage.removeItem(sessionStorageKey);
    }
  }, []);

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
    if (!session) return;
    window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) return;
    window.localStorage.setItem(lastRoomStorageKey, roomSnapshot.room.id);
  }, [roomSnapshot?.room.id]);

  useEffect(() => {
    if (!session) return;

    const restore = async () => {
      try {
        const snapshot = await musicRoomApi.getRecentRoom(session.id);
        if (snapshot) {
          setRoomSnapshot(snapshot);
          window.localStorage.setItem(lastRoomStorageKey, snapshot.room.id);
          setStatusMessage(`Restored active room ${snapshot.room.joinCode}.`);
          await refreshPlaylists(session.id);
          return;
        }
      } catch {
        // Fall through to room-specific recovery when the recent-room index is missing.
      }

      const lastRoomId = window.localStorage.getItem(lastRoomStorageKey);

      if (lastRoomId) {
        try {
          const snapshot = await musicRoomApi.recoverRoom(lastRoomId, session.id);
          if (snapshot) {
            setRoomSnapshot(snapshot);
            setStatusMessage(`Restored room ${snapshot.room.joinCode}.`);
            await refreshPlaylists(session.id);
            return;
          }
        } catch {
          // Continue to broader room listing below.
        }

        window.localStorage.removeItem(lastRoomStorageKey);
      }

      const rooms = await musicRoomApi.listRooms(session.id);
      if (rooms.length > 0) {
        setRoomSnapshot(rooms[0]);
        window.localStorage.setItem(lastRoomStorageKey, rooms[0].room.id);
        setStatusMessage(`Rejoined recent room ${rooms[0].room.joinCode}.`);
        await refreshPlaylists(session.id);
      }
    };

    void restore();
  }, [session]);

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
        sessionId: session?.id,
        peerId
      });
    };

    socket.on("connect", () => {
      subscribeToRoom();
      setStatusMessage(`Socket connected to room ${roomSnapshot.room.joinCode}.`);
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
      setStatusMessage("The room is no longer available. Open a new room or join another one.");
    });
    socket.on("disconnect", () => {
      setStatusMessage("Realtime link lost. Reconnecting to room state...");
    });

    return () => {
      socket.emit("room.unsubscribe", { roomId });
      socket.disconnect();
      socketRef.current = null;
      mesh.destroy();
      meshRef.current = null;
      setConnectedPeers([]);
    };
  }, [roomSnapshot?.room.id, peerId, session?.id]);

  useEffect(() => {
    requestedPiecesRef.current.clear();
    failedPiecePeersRef.current.clear();
  }, [roomSnapshot?.room.id, peerId]);

  useEffect(() => {
    if (!roomSnapshot) {
      return;
    }

    void trimLocalCache(roomSnapshot.tracks.map((track) => track.id));
  }, [roomSnapshot?.tracks]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const track = roomSnapshot?.tracks.find((item) => item.id === playback?.currentTrackId);

    if (!playback || !track) {
      setProgressMs(0);
      return;
    }

    const tick = () => {
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
    if (!audio || !playback?.currentTrackId) return;

    const uploaded = uploadedTracks[playback.currentTrackId];

    if (uploaded && audio.src !== uploaded.objectUrl) {
      audio.src = uploaded.objectUrl;
    }

    const expectedSeconds = playback.positionMs / 1000;
    if (Math.abs(audio.currentTime - expectedSeconds) > 1.2) {
      audio.currentTime = expectedSeconds;
    }

    if (uploaded && playback.status === "playing") {
      void audio.play().catch(() => {
        setStatusMessage("Autoplay was blocked by the browser. Press play to resume local audio.");
      });
    }

    if (playback.status === "paused") {
      audio.pause();
    }
  }, [roomSnapshot?.room.playback, uploadedTracks]);

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

      if (roomSnapshot && peerId && session) {
        for (const asset of cachedAssets) {
          const availability = await buildTrackAvailabilityFromFile({
            roomId: roomSnapshot.room.id,
            trackId: asset.trackId,
            fileHash: asset.fileHash,
            file: asset.file,
            peerId,
            nickname: session.nickname,
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
  }, [roomSnapshot, uploadedTracks, peerId, session]);

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

  async function createSession() {
    try {
      const nextSession = await musicRoomApi.createGuestSession(nickname);
      setSession(nextSession);
      setStatusMessage(`Signed in as ${nextSession.nickname}.`);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function createRoom() {
    if (!session) return;

    try {
      const snapshot = await musicRoomApi.createRoom(session.id);
      setRoomSnapshot(snapshot);
      setStatusMessage(`Room opened. Share code ${snapshot.room.joinCode} to invite others.`);
      await refreshPlaylists(session.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function joinRoomByCode() {
    if (!session || !joinCode.trim()) return;

    try {
      const snapshot = await musicRoomApi.joinRoomByCode(session.id, joinCode.trim());
      setRoomSnapshot(snapshot);
      setStatusMessage(`Joined room ${snapshot.room.joinCode}.`);
      await refreshPlaylists(session.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function refreshRoom(roomId: string) {
    const snapshot = await musicRoomApi.getRoom(roomId);
    setRoomSnapshot(snapshot);
  }

  async function refreshPlaylists(ownerId: string) {
    const nextPlaylists = await musicRoomApi.listPlaylists(ownerId);
    setPlaylists(nextPlaylists);
  }

  async function leaveRoom() {
    if (!session || !roomSnapshot) return;

    try {
      await musicRoomApi.leaveRoom(roomSnapshot.room.id, session.id);
      setRoomSnapshot(null);
      setJoinCode("");
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage("Left the room. Open a new room or join another one.");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || !session || !roomSnapshot) return;

    try {
      const nextUploads: Record<string, UploadedTrack> = {};

      for (const file of Array.from(files)) {
        const objectUrl = URL.createObjectURL(file);
        const track = await buildTrackMeta(file, objectUrl);
        const registered = await musicRoomApi.registerTrack(roomSnapshot.room.id, {
          sessionId: session.id,
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
            nickname: session.nickname,
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
      setStatusMessage(`${Object.keys(nextUploads).length} local track(s) imported into the room crate.`);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function addToQueue(trackId: string) {
    if (!session || !roomSnapshot) return;

    try {
      await musicRoomApi.addQueueItem(roomSnapshot.room.id, {
        sessionId: session.id,
        trackId
      });
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("Track added to the live queue.");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function playTrack(trackId?: string) {
    if (!roomSnapshot || !session) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "play",
        trackId,
        sessionId: session.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function pauseTrack() {
    if (!roomSnapshot || !session) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "pause",
        positionMs: Math.round((audioRef.current?.currentTime ?? 0) * 1000),
        sessionId: session.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function nextTrack() {
    if (!roomSnapshot || !session) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "next",
        sessionId: session.id
      });
      await refreshRoom(roomSnapshot.room.id);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function savePlaylistFromQueue() {
    if (!session || !roomSnapshot) return;

    try {
      await musicRoomApi.createPlaylistFromRoom({
        ownerId: session.id,
        roomId: roomSnapshot.room.id,
        title: playlistTitle,
        description: "Saved from the current room queue."
      });
      await refreshPlaylists(session.id);
      setStatusMessage(`Playlist "${playlistTitle}" saved from the current room flow.`);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function updatePlaylistTitle() {
    if (!session || !playlistEditId || !playlistEditTitle.trim()) return;

    try {
      await musicRoomApi.updatePlaylist(playlistEditId, {
        ownerId: session.id,
        title: playlistEditTitle.trim()
      });
      await refreshPlaylists(session.id);
      setPlaylistEditId(null);
      setPlaylistEditTitle("");
      setStatusMessage("Playlist title updated.");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function deletePlaylist(playlistId: string) {
    if (!session) return;

    try {
      await musicRoomApi.deletePlaylist(playlistId, session.id);
      await refreshPlaylists(session.id);
      if (playlistEditId === playlistId) {
        setPlaylistEditId(null);
        setPlaylistEditTitle("");
      }
      setStatusMessage("Playlist removed from your archive.");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function loadPlaylistIntoRoom(playlistId: string) {
    if (!session || !roomSnapshot) return;

    try {
      await musicRoomApi.importPlaylistToRoom(playlistId, {
        roomId: roomSnapshot.room.id,
        sessionId: session.id
      });
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("Playlist loaded back into the live room queue.");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function removeQueueItem(queueItemId: string) {
    if (!roomSnapshot || !session) return;

    try {
      await musicRoomApi.removeQueueItemAs(roomSnapshot.room.id, queueItemId, session.id);
      await refreshRoom(roomSnapshot.room.id);
      setStatusMessage("Track removed from the queue.");
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function seekTrack(positionMs: number) {
    if (!roomSnapshot || !session) return;

    try {
      await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
        action: "seek",
        positionMs,
        sessionId: session.id
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
    if (!roomSnapshot || !session || !peerId) {
      return;
    }

    const availability = await buildTrackAvailabilityFromCache({
      roomId: roomSnapshot.room.id,
      trackId,
      peerId,
      nickname: session.nickname,
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
      setStatusMessage(`Downloaded chunks for ${track.title} are incomplete or failed validation.`);
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
    setStatusMessage(`Recovered playable local cache for ${track.title} from room peers.`);
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
  const canControlPlayback = !!session && roomSnapshot?.room.hostId === session.id;
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

  return (
    <main className="stage-shell">
      <section className="hero-stage">
        <div className="hero-copy reveal-up">
          <p className="hero-kicker">Music Room</p>
          <h1 className="hero-title">A listening room that feels live, local, and under your control.</h1>
          <p className="hero-body">
            The server handles identity, room state, and coordination. The tracks stay with the host and the listeners.
          </p>
          <div className="hero-actions">
            <label className="field-stack">
              <span className="field-label">Alias</span>
              <input
                className="hero-input"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Pick a room name"
              />
            </label>
            <div className="hero-buttons">
              <button className="solid-action" onClick={() => startTransition(() => void createSession())}>
                {session ? `Signed in as ${session.nickname}` : "Create guest identity"}
              </button>
              <button
                className="ghost-action"
                disabled={!session}
                onClick={() => startTransition(() => void createRoom())}
              >
                Open room
              </button>
              <button
                className="ghost-action"
                disabled={!roomSnapshot || !session}
                onClick={() => startTransition(() => void leaveRoom())}
              >
                Leave room
              </button>
            </div>
            <div className="join-cluster">
              <label className="field-stack">
                <span className="field-label">Join by room code</span>
                <input
                  className="hero-input subtle"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="Enter room code"
                />
              </label>
              <button
                className="ghost-action"
                disabled={!session || !joinCode.trim()}
                onClick={() => startTransition(() => void joinRoomByCode())}
              >
                Join room
              </button>
            </div>
          </div>
        </div>

        <div className="hero-display reveal-up delay-1">
          <div className="display-glow" />
          <div className="display-label-row">
            <span>Now hosting</span>
            <span className={`signal-dot${roomSnapshot ? " live" : ""}`}>Live state</span>
          </div>
          <div className="display-roomcode">
            <span className="display-caption">Room code</span>
            <strong>{roomSnapshot?.room.joinCode ?? "------"}</strong>
          </div>
          <div className="display-track">
            <p className="display-caption">Current selection</p>
            <h2>{currentTrack?.title ?? "No track on air yet"}</h2>
            <p>{currentTrack?.artist ?? "Import local files to start the set."}</p>
          </div>
          <div className="display-meta">
            <div>
              <span>Members</span>
              <strong>{roomSnapshot?.room.members.length ?? 0}</strong>
            </div>
            <div>
              <span>Tracks</span>
              <strong>{roomSnapshot?.tracks.length ?? 0}</strong>
            </div>
            <div>
              <span>Queue</span>
              <strong>{roomSnapshot?.queue.length ?? 0}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="status-ribbon reveal-up delay-2">
        <div>
          <span className="ribbon-label">Host</span>
          <strong>{host?.nickname ?? "No host yet"}</strong>
        </div>
        <div>
          <span className="ribbon-label">Playback</span>
          <strong>{roomSnapshot?.room.playback.status ?? "idle"}</strong>
        </div>
        <div>
          <span className="ribbon-label">Presence</span>
          <strong>{roomSnapshot?.room.members.map((member) => member.nickname).join(", ") || "No listeners yet"}</strong>
        </div>
        <div>
          <span className="ribbon-label">Local cache</span>
          <strong>{cachedTrackCount} ready</strong>
        </div>
        <div>
          <span className="ribbon-label">Mesh links</span>
          <strong>{connectedPeers.length} connected</strong>
        </div>
        <p>{statusMessage}</p>
      </section>

      <section className="workspace-grid">
        <div className="workspace-main">
          <section className="workspace-block reveal-up">
            <div className="block-heading">
              <div>
                <p className="block-kicker">Crate</p>
                <h2>Import local music</h2>
              </div>
              <span>{roomSnapshot?.tracks.length ?? 0} files</span>
            </div>

            <label className="drop-zone">
              <span>Drop audio files here or browse from your device.</span>
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
                        onClick={() => startTransition(() => void addToQueue(track.id))}
                      >
                        Queue
                      </button>
                      <button
                        className="solid-action compact"
                        disabled={!canControlPlayback}
                        onClick={() => startTransition(() => void playTrack(track.id))}
                      >
                        Play now
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="placeholder-copy">No local tracks yet. Open a room, then import music from this browser.</p>
              )}
            </div>
          </section>

          <section className="workspace-block reveal-up delay-1">
            <div className="block-heading">
              <div>
                <p className="block-kicker">Queue</p>
                <h2>Shared room order</h2>
              </div>
              <span>{roomSnapshot?.queue.length ?? 0} queued</span>
            </div>

            <div className="queue-stack">
              {roomSnapshot?.queue.length ? (
                roomSnapshot.queue.map((item, index) => {
                  const track = roomSnapshot.tracks.find((entry) => entry.id === item.trackId);
                  const canRemoveQueueItem =
                    !!session &&
                    (roomSnapshot.room.hostId === session.id || item.requestedById === session.id);

                  return (
                    <div key={item.id} className="queue-line">
                      <span className="queue-index">{String(index + 1).padStart(2, "0")}</span>
                      <div className="queue-copy">
                        <strong>{track?.title ?? "Unknown track"}</strong>
                        <p>Requested by {item.requestedBy}</p>
                      </div>
                      <button
                        className="queue-remove"
                        disabled={!canRemoveQueueItem}
                        onClick={() => startTransition(() => void removeQueueItem(item.id))}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })
              ) : (
                <p className="placeholder-copy">The room queue is empty. Add tracks from the crate to start the session.</p>
              )}
            </div>
          </section>
        </div>

        <aside className="workspace-side">
          <section className="player-panel reveal-up">
            <div className="block-heading invert">
              <div>
                <p className="block-kicker">Player</p>
                <h2>Deck control</h2>
              </div>
              <span>{roomSnapshot?.room.playback.status ?? "idle"}</span>
            </div>

            <div className="player-current">
              <p className="player-caption">On air</p>
              <h3>{currentTrack?.title ?? "Waiting for a lead track"}</h3>
              <p>{currentTrack?.artist ?? "Choose a track from the crate or queue."}</p>
            </div>

            <div className="progress-shell" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${progressRatio * 100}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={currentTrackDuration || 1}
              step={1000}
              value={effectiveProgressMs}
              className="progress-slider"
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
            <div className="progress-meta">
              <span>{formatDuration(effectiveProgressMs)}</span>
              <span>{formatDuration(currentTrackDuration)}</span>
            </div>

            <audio ref={audioRef} controls className="player-audio" onEnded={() => void handleEnded()} />

            <div className="player-actions">
              <button
                className="solid-action"
                disabled={!canControlPlayback}
                onClick={() => startTransition(() => void playTrack())}
              >
                Play
              </button>
              <button
                className="ghost-action inverse"
                disabled={!canControlPlayback}
                onClick={() => startTransition(() => void pauseTrack())}
              >
                Pause
              </button>
              <button
                className="ghost-action inverse"
                disabled={!canControlPlayback}
                onClick={() => startTransition(() => void nextTrack())}
              >
                Next
              </button>
            </div>

            {!canControlPlayback && roomSnapshot ? (
              <p className="player-note">Only the host can seek or control transport for the room.</p>
            ) : null}

            {!uploadedTracks[currentTrack?.id ?? ""] && currentTrack ? (
              <p className="player-note">
                This browser does not hold the local file for the current track, so it can follow room state without playing the audio payload.
              </p>
            ) : null}

            {!uploadedTracks[currentTrack?.id ?? ""] && currentTrackAvailability ? (
              <p className="player-note">
                P2P download progress: {currentTrackAvailability.localChunkCount}/
                {currentTrackAvailability.totalChunks || 0} chunks from {currentTrackAvailability.peerCount} peer source(s).
              </p>
            ) : null}

            {!uploadedTracks[upcomingTrack?.id ?? ""] && nextTrackAvailability ? (
              <p className="player-note">
                Next up prefetch: {nextTrackAvailability.localChunkCount}/
                {nextTrackAvailability.totalChunks || 0} chunks ready for {upcomingTrack?.title}.
              </p>
            ) : null}
          </section>

          <section className="workspace-block reveal-up delay-2">
            <div className="block-heading">
              <div>
                <p className="block-kicker">Archive</p>
                <h2>Save the night</h2>
              </div>
              <span>{playlists.length} playlists</span>
            </div>

            <div className="playlist-create">
              <label className="field-stack">
                <span className="field-label">Playlist title</span>
                <input
                  className="hero-input subtle"
                  value={playlistTitle}
                  onChange={(event) => setPlaylistTitle(event.target.value)}
                />
              </label>
              <button
                className="solid-action"
                disabled={!session || !roomSnapshot || roomSnapshot.queue.length === 0}
                onClick={() => startTransition(() => void savePlaylistFromQueue())}
              >
                Save current queue
              </button>
            </div>

            <div className="playlist-list">
              {playlists.length ? (
                playlists.map((playlist) => (
                  <div key={playlist.id} className="playlist-line">
                    {playlistEditId === playlist.id ? (
                      <>
                        <label className="field-stack">
                          <span className="field-label">Rename playlist</span>
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
                            Save
                          </button>
                          <button
                            className="ghost-action"
                            onClick={() => {
                              setPlaylistEditId(null);
                              setPlaylistEditTitle("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <strong>{playlist.title}</strong>
                          <p>
                            {playlist.trackIds.length} tracks ·{" "}
                            {playlist.isCollaborative ? "Collaborative" : "Personal"}
                          </p>
                        </div>
                        <div className="track-row-actions">
                          <button
                            className="solid-action compact"
                            disabled={!roomSnapshot}
                            onClick={() => startTransition(() => void loadPlaylistIntoRoom(playlist.id))}
                          >
                            Load to room
                          </button>
                          <button
                            className="ghost-action"
                            onClick={() => {
                              setPlaylistEditId(playlist.id);
                              setPlaylistEditTitle(playlist.title);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="queue-remove"
                            onClick={() => startTransition(() => void deletePlaylist(playlist.id))}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              ) : (
                <p className="placeholder-copy">Save the current queue to start building your archive.</p>
              )}
            </div>
          </section>

          <section className="workspace-block reveal-up delay-2">
            <div className="block-heading">
              <div>
                <p className="block-kicker">Mesh</p>
                <h2>P2P cache status</h2>
              </div>
              <span>{availabilitySummary.length} tracks</span>
            </div>

            <div className="playlist-list">
              {availabilitySummary.length ? (
                availabilitySummary.map(({ track, peerCount, localChunkCount, totalChunks, sources }) => (
                  <div key={track.id} className="playlist-line">
                    <div>
                      <strong>{track.title}</strong>
                      <p>
                        Local {localChunkCount}/{totalChunks || 0} chunks · {peerCount} peer source(s)
                      </p>
                    </div>
                    <div className="playlist-sources">
                      <span>{sources.slice(0, 2).join(", ") || "Awaiting availability"}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="placeholder-copy">Import local tracks to build the first chunk availability map.</p>
              )}
            </div>
          </section>

          <section className="workspace-block reveal-up delay-2">
            <div className="block-heading">
              <div>
                <p className="block-kicker">Members</p>
                <h2>Who is inside</h2>
              </div>
              <span>{roomSnapshot?.room.members.length ?? 0} live</span>
            </div>

            <div className="member-rail">
              {roomSnapshot?.room.members.length ? (
                roomSnapshot.room.members.map((member) => (
                  <div key={member.id} className="member-pill">
                    <strong>{member.nickname}</strong>
                    <span>{member.role === "host" ? "Host" : "Listener"}</span>
                  </div>
                ))
              ) : (
                <p className="placeholder-copy">Members will appear here as soon as someone joins by room code.</p>
              )}
            </div>
          </section>
        </aside>
      </section>

      {isPending ? <div className="pending-indicator">Syncing room state...</div> : null}
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
    artist: "Local Upload",
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
    audio.addEventListener("loadedmetadata", () => {
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    });
    audio.addEventListener("error", () => resolve(0));
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
