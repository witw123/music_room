"use client";

import type { RoomSnapshot } from "@music-room/shared";

export function filterOpenPublicRooms(rooms: RoomSnapshot[]) {
  return rooms.filter((room) => room.room.visibility === "public");
}

export function filterRoomsForSession(rooms: RoomSnapshot[], sessionId: string) {
  return rooms.filter(
    (room) =>
      room.room.members.some((member) => member.id === sessionId) ||
      room.room.visibility === "public"
  );
}
