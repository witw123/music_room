"use client";

import type { RoomSnapshot } from "@music-room/shared";
import { getOnlineMemberCount } from "@/lib/music-room-ui";

export function filterOpenPublicRooms(rooms: RoomSnapshot[]) {
  return rooms.filter(
    (room) => room.room.visibility === "public" && getOnlineMemberCount(room.room.members) > 0
  );
}
