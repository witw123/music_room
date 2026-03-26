import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Room } from "@music-room/shared";

@Injectable()
export class RoomService {
  buildRoomSnapshot(hostId: string): Room {
    return {
      id: `room_${randomUUID()}`,
      hostId,
      joinCode: "ABCD12",
      visibility: "private",
      members: [],
      playback: {
        status: "paused",
        currentTrackId: null,
        positionMs: 0,
        startedAt: null,
        queueVersion: 1
      }
    };
  }
}

