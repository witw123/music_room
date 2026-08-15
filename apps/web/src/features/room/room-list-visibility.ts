"use client";

import type { RoomDirectoryItem } from "@music-room/shared";

export function filterOpenPublicRooms(rooms: RoomDirectoryItem[]) {
  return rooms.filter((room) => room.room.visibility === "public");
}

export function filterRoomsForSession(rooms: RoomDirectoryItem[], _sessionId: string) {
  return rooms.filter(
    (room) =>
      room.room.directoryIsMember === true ||
      room.room.visibility === "public"
  );
}
