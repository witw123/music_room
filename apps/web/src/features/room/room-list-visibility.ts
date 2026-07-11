"use client";

import type { RoomSnapshot, RoomSummary } from "@music-room/shared";

export function filterOpenPublicRooms<T extends RoomSummary | RoomSnapshot>(rooms: T[]): T[] {
  return rooms.filter((item) =>
    "room" in item ? item.room.visibility === "public" : item.visibility === "public"
  );
}
