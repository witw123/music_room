"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AuthSession, RoomSnapshot } from "@music-room/shared";

type RoomContextValue = {
  roomSnapshot: RoomSnapshot | null;
  availableRooms: RoomSnapshot[];
  statusMessage: string;
  setStatusMessage: (msg: string) => void;
  socketRef: null;
  peerId: string;
  createRoom: (_session: AuthSession) => Promise<void>;
  joinRoomByCode: (_session: AuthSession, _code: string) => Promise<void>;
  leaveRoom: (_session: AuthSession) => Promise<void>;
  deleteRoom: (_session: AuthSession) => Promise<void>;
  refreshRoom: () => Promise<void>;
  refreshAvailableRooms: () => Promise<void>;
  playTrack: (_session: AuthSession, _trackId?: string) => Promise<void>;
  pauseTrack: (_session: AuthSession, _positionMs: number) => Promise<void>;
  seekTrack: (_session: AuthSession, _positionMs: number) => Promise<void>;
  prevTrack: (_session: AuthSession) => Promise<void>;
  nextTrack: (_session: AuthSession) => Promise<void>;
};

const noopAsync = async () => undefined;

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children }: { children: ReactNode }) {
  return (
    <RoomContext.Provider
      value={{
        roomSnapshot: null,
        availableRooms: [],
        statusMessage: "",
        setStatusMessage: () => undefined,
        socketRef: null,
        peerId: "",
        createRoom: noopAsync,
        joinRoomByCode: noopAsync,
        leaveRoom: noopAsync,
        deleteRoom: noopAsync,
        refreshRoom: noopAsync,
        refreshAvailableRooms: noopAsync,
        playTrack: noopAsync,
        pauseTrack: noopAsync,
        seekTrack: noopAsync,
        prevTrack: noopAsync,
        nextTrack: noopAsync
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
