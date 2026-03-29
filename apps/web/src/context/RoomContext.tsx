"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { GuestSession, RoomSnapshot } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";
import { createRoomSocket, type RoomSocket } from "@/lib/ws-client";

type RoomContextValue = {
  roomSnapshot: RoomSnapshot | null;
  availableRooms: RoomSnapshot[];
  statusMessage: string;
  setStatusMessage: (msg: string) => void;
  socketRef: RoomSocket | null;
  peerId: string;
  createRoom: (session: GuestSession) => Promise<void>;
  joinRoomByCode: (session: GuestSession, code: string) => Promise<void>;
  leaveRoom: (session: GuestSession) => Promise<void>;
  deleteRoom: (session: GuestSession) => Promise<void>;
  refreshRoom: () => Promise<void>;
  refreshAvailableRooms: () => Promise<void>;
  playTrack: (session: GuestSession, trackId?: string) => Promise<void>;
  pauseTrack: (session: GuestSession, positionMs: number) => Promise<void>;
  seekTrack: (session: GuestSession, positionMs: number) => Promise<void>;
  prevTrack: (session: GuestSession) => Promise<void>;
  nextTrack: (session: GuestSession) => Promise<void>;
};

const RoomContext = createContext<RoomContextValue | null>(null);

const lastRoomStorageKey = "music-room-last-room";
const peerStorageKey = "music-room-peer-id";

export function RoomProvider({ children }: { children: ReactNode }) {
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [availableRooms, setAvailableRooms] = useState<RoomSnapshot[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("请先输入昵称并确认身份。");

  const socketRef = useRef<RoomSocket | null>(null);
  const peerIdRef = useRef<string>("");

  // Initialize peerId
  useEffect(() => {
    const stored = window.localStorage.getItem(peerStorageKey);
    if (stored) {
      peerIdRef.current = stored;
    } else {
      const nextPeerId = `peer_${crypto.randomUUID()}`;
      window.localStorage.setItem(peerStorageKey, nextPeerId);
      peerIdRef.current = nextPeerId;
    }
  }, []);

  // Persist last room ID
  useEffect(() => {
    if (roomSnapshot?.room.id) {
      window.localStorage.setItem(lastRoomStorageKey, roomSnapshot.room.id);
    }
  }, [roomSnapshot?.room.id, activeSessionId]);

  // WebSocket lifecycle
  useEffect(() => {
    if (!roomSnapshot?.room.id) {
      return;
    }

    const roomId = roomSnapshot.room.id;
    const socket = createRoomSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("room.subscribe", {
        roomId,
        sessionId: activeSessionId ?? undefined,
        peerId: peerIdRef.current
      });
      setStatusMessage(`已连接到房间 ${roomSnapshot?.room.joinCode}。`);
    });

    socket.on("room.snapshot", (snapshot: RoomSnapshot) => {
      setRoomSnapshot((current) => ({
        ...snapshot,
        playlists:
          snapshot.playlists.length > 0 ? snapshot.playlists : (current?.playlists ?? [])
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
    };
  }, [roomSnapshot?.room.id]);

  const createRoom = useCallback(async (session: GuestSession) => {
    const snapshot = await musicRoomApi.createRoom(session.id, "public");
    setActiveSessionId(session.id);
    setRoomSnapshot(snapshot);
    setAvailableRooms((current) => {
      const next = current.filter((room) => room.room.id !== snapshot.room.id);
      return [snapshot, ...next];
    });
    setStatusMessage(`房间已创建，分享码 ${snapshot.room.joinCode} 邀请他人加入。`);
  }, []);

  const joinRoomByCode = useCallback(async (session: GuestSession, code: string) => {
    const snapshot = await musicRoomApi.joinRoomByCode(session.id, code.trim());
    setActiveSessionId(session.id);
    setRoomSnapshot(snapshot);
    await refreshAvailableRoomsRef();
    setStatusMessage(`已加入房间 ${snapshot.room.joinCode}。`);
  }, []);

  const leaveRoom = useCallback(async (session: GuestSession) => {
    if (!roomSnapshot) return;
    await musicRoomApi.leaveRoom(roomSnapshot.room.id, session.id);
    setActiveSessionId(null);
    setRoomSnapshot(null);
    window.localStorage.removeItem(lastRoomStorageKey);
    await refreshAvailableRoomsRef();
    setStatusMessage("已离开房间。创建新房间或加入其他房间。");
  }, [roomSnapshot]);

  const deleteRoom = useCallback(async (session: GuestSession) => {
    if (!roomSnapshot) return;
    await musicRoomApi.deleteRoom(roomSnapshot.room.id, session.id);
    setActiveSessionId(null);
    setRoomSnapshot(null);
    window.localStorage.removeItem(lastRoomStorageKey);
    await refreshAvailableRoomsRef();
    setStatusMessage("房间已删除。");
  }, [roomSnapshot]);

  const refreshRoom = useCallback(async () => {
    if (!roomSnapshot) return;
    const snapshot = await musicRoomApi.getRoom(roomSnapshot.room.id);
    setRoomSnapshot(snapshot);
  }, [roomSnapshot]);

  const refreshAvailableRoomsRef = useCallback(async () => {
    try {
      const rooms = await musicRoomApi.listRooms();
      setAvailableRooms(rooms);
    } catch {
      setAvailableRooms([]);
    }
  }, []);

  const playTrack = useCallback(async (session: GuestSession, trackId?: string) => {
    if (!roomSnapshot) return;
    await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
      action: "play",
      trackId,
      sessionId: session.id
    });
    await refreshRoom();
  }, [roomSnapshot, refreshRoom]);

  const pauseTrack = useCallback(async (session: GuestSession, positionMs: number) => {
    if (!roomSnapshot) return;
    await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
      action: "pause",
      positionMs,
      sessionId: session.id
    });
    await refreshRoom();
  }, [roomSnapshot, refreshRoom]);

  const seekTrack = useCallback(async (session: GuestSession, positionMs: number) => {
    if (!roomSnapshot) return;
    await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
      action: "seek",
      positionMs,
      sessionId: session.id
    });
    await refreshRoom();
  }, [roomSnapshot, refreshRoom]);

  const prevTrack = useCallback(async (session: GuestSession) => {
    if (!roomSnapshot) return;
    await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
      action: "prev",
      sessionId: session.id
    });
    await refreshRoom();
  }, [roomSnapshot, refreshRoom]);

  const nextTrack = useCallback(async (session: GuestSession) => {
    if (!roomSnapshot) return;
    await musicRoomApi.updatePlayback(roomSnapshot.room.id, {
      action: "next",
      sessionId: session.id
    });
    await refreshRoom();
  }, [roomSnapshot, refreshRoom]);

  return (
    <RoomContext.Provider
      value={{
        roomSnapshot,
        availableRooms,
        statusMessage,
        setStatusMessage,
        socketRef: socketRef.current,
        peerId: peerIdRef.current,
        createRoom,
        joinRoomByCode,
        leaveRoom,
        deleteRoom,
        refreshRoom,
        refreshAvailableRooms: refreshAvailableRoomsRef,
        playTrack,
        pauseTrack,
        seekTrack,
        prevTrack,
        nextTrack
      }}
    >
      {children}
    </RoomContext.Provider>
  );
}

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) {
    throw new Error("useRoom must be used within RoomProvider");
  }
  return ctx;
}
