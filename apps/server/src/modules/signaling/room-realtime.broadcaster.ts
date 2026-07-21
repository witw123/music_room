import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  RoomLibraryPatchPayload,
  RoomPlaybackPatchPayload,
  RoomPresencePatchPayload,
  RoomQueuePatchPayload,
  RoomSnapshot,
  RoomTrackDeletedPayload
} from "@music-room/shared";
import type { Server } from "socket.io";
import { RedisService } from "../../infra/redis/redis.service";
import {
  roomDeletedChannel,
  roomLibraryPatchChannel,
  roomPlaybackPatchChannel,
  roomPresencePatchChannel,
  roomQueuePatchChannel,
  roomSnapshotChannel,
  roomSnapshotMissingChannel,
  roomTrackDeletedChannel
} from "./room-realtime.channels";

@Injectable()
export class RoomRealtimeBroadcaster {
  readonly instanceId = randomUUID();
  private server: Server | null = null;

  constructor(private readonly redisService: RedisService) {}

  setServer(server: Server) {
    this.server = server;
  }

  emitRoomSnapshot(roomId: string, snapshot: RoomSnapshot) {
    this.server?.to(roomId).emit("room.snapshot", snapshot);
    this.publish(roomSnapshotChannel, {
      sourceId: this.instanceId,
      roomId,
      snapshot
    });
  }

  emitRoomMissing(roomId: string) {
    this.server?.to(roomId).emit("room.snapshot.missing", { roomId });
    this.publish(roomSnapshotMissingChannel, {
      sourceId: this.instanceId,
      roomId
    });
  }

  emitRoomDeleted(roomId: string, trackIds: string[]) {
    this.server?.to(roomId).emit("room.deleted", { roomId, trackIds });
    this.publish(roomDeletedChannel, {
      sourceId: this.instanceId,
      roomId,
      trackIds
    });
  }

  emitPlaybackPatch(
    roomId: string,
    payload: Omit<RoomPlaybackPatchPayload, "roomId" | "updatedAt">
  ) {
    const message: RoomPlaybackPatchPayload = {
      roomId,
      playback: payload.playback,
      updatedAt: new Date().toISOString()
    };
    this.server?.to(roomId).emit("room.playback.patch", message);
    this.publish(roomPlaybackPatchChannel, {
      sourceId: this.instanceId,
      roomId,
      payload: message
    });
  }

  emitQueuePatch(
    roomId: string,
    payload: Omit<RoomQueuePatchPayload, "roomId" | "updatedAt">
  ) {
    const message: RoomQueuePatchPayload = {
      roomId,
      queue: payload.queue,
      playback: payload.playback,
      roomRevision: payload.roomRevision,
      updatedAt: new Date().toISOString()
    };
    this.server?.to(roomId).emit("room.queue.patch", message);
    this.publish(roomQueuePatchChannel, {
      sourceId: this.instanceId,
      roomId,
      payload: message
    });
  }

  emitPresencePatch(
    roomId: string,
    payload: Omit<RoomPresencePatchPayload, "roomId" | "updatedAt">
  ) {
    const message: RoomPresencePatchPayload = {
      roomId,
      members: payload.members,
      playback: payload.playback,
      presenceRevision: payload.presenceRevision,
      roomRevision: payload.roomRevision,
      updatedAt: new Date().toISOString()
    };
    this.server?.to(roomId).emit("room.presence.patch", message);
    this.publish(roomPresencePatchChannel, {
      sourceId: this.instanceId,
      roomId,
      payload: message
    });
  }

  emitLibraryPatch(
    roomId: string,
    payload: Omit<RoomLibraryPatchPayload, "roomId" | "updatedAt">
  ) {
    const message: RoomLibraryPatchPayload = {
      roomId,
      tracks: payload.tracks,
      queue: payload.queue,
      playback: payload.playback,
      roomRevision: payload.roomRevision,
      updatedAt: new Date().toISOString()
    };
    this.server?.to(roomId).emit("room.library.patch", message);
    this.publish(roomLibraryPatchChannel, {
      sourceId: this.instanceId,
      roomId,
      payload: message
    });
  }

  emitTrackDeleted(roomId: string, payload: Omit<RoomTrackDeletedPayload, "roomId">) {
    const message: RoomTrackDeletedPayload = { roomId, ...payload };
    this.server?.to(roomId).emit("room.track.deleted", message);
    this.publish(roomTrackDeletedChannel, {
      sourceId: this.instanceId,
      roomId,
      payload: message
    });
  }

  private publish(channel: string, payload: unknown) {
    void (async () => {
      for (const delayMs of [0, 100, 250, 500, 1_000, 2_000]) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        try {
          await this.redisService.publish(channel, payload);
          return;
        } catch {
          // Room snapshots and patches can be recovered; retry short outages first.
        }
      }
    })();
  }
}
