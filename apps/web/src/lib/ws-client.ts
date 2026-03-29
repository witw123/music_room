import { io } from "socket.io-client";

export const wsBaseUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws";

export function createRoomSocket() {
  return io(wsBaseUrl, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000
  });
}
