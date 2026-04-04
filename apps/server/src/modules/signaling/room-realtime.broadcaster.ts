import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  RoomLibraryPatchPayload,
  RoomPlaybackPatchPayload,
  RoomPresencePatchPayload,
  RoomQueuePatchPayload,
  RoomSnapshot
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
  roomSnapshotMissingChannel
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
    void this.redisService.publish(roomSnapshotChannel, {
      sourceId: this.instanceId,
      roomId,
      snapshot
    });
  }

  emitRoomMissing(roomId: string) {
    this.server?.to(roomId).emit("room.snapshot.missing", { roomId });
    void this.redisService.publish(roomSnapshotMissingChannel, {
      sourceId: this.instanceId,
      roomId
    });
  }

  emitRoomDeleted(roomId: string, trackIds: string[]) {
    this.server?.to(roomId).emit("room.deleted", { roomId, trackIds });
    void this.redisService.publish(roomDeletedChannel, {
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
    void this.redisService.publish(roomPlaybackPatchChannel, {
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
    void this.redisService.publish(roomQueuePatchChannel, {
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
    void this.redisService.publish(roomPresencePatchChannel, {
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
    void this.redisService.publish(roomLibraryPatchChannel, {
      sourceId: this.instanceId,
      roomId,
      payload: message
    });
  }
}
