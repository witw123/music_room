import type { ClientToServerEvents, ServerToClientEvents } from "@music-room/shared";
import { io, type Socket } from "socket.io-client";

export const wsBaseUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws";
export const socketPath = process.env.NEXT_PUBLIC_SOCKET_PATH ?? "/ws/socket.io";
const sessionStorageKey = "music-room-session";

function getSessionToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(sessionStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw) as { token?: string };
    return session.token ?? null;
  } catch {
    return null;
  }
}

export function createRoomSocket() {
  const sessionToken = getSessionToken();

  return io(wsBaseUrl, {
    path: socketPath,
    auth: sessionToken ? { sessionToken } : undefined,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000
  }) as RoomSocket;
}

export type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
