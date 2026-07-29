import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Optional,
  Patch,
  Param,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import {
  addQueueItemRequestSchema,
  reorderQueueRequestSchema,
  setNextQueueItemRequestSchema
} from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AbuseProtectionService } from "../../common/security/abuse-protection.service";
import { AuthService } from "../auth/auth.service";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";
import { RoomService } from "../room/room.service";

@Controller("v1/rooms/:roomId/queue")
export class QueueController {
  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimePublisher: RoomRealtimePublisher,
    private readonly authService: AuthService,
    @Optional()
    private readonly abuseProtection?: AbuseProtectionService
  ) {}

  private async getCurrentUserId(sessionToken?: string) {
    try {
      const session = await this.authService.getAuthSessionByTokenOrThrow(sessionToken);
      return session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @Get()
  async listQueue(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.getAccessibleQueue(roomId, userId);
  }

  @Post()
  async addQueueItem(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: { trackId: string },
    @Ip() ipAddress?: string
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    await this.limitQueueWrites(userId, ipAddress);
    const payload = parseRequestBody(addQueueItemRequestSchema, body);
    await this.roomService.addQueueItem(roomId, userId, payload.trackId);
    const snapshot = await this.roomRealtimePublisher.emitQueueSnapshot(roomId);
    return {
      queue: snapshot.queue,
      playback: snapshot.room.playback
    };
  }

  @Delete(":queueItemId")
  async removeQueueItem(
    @Param("roomId") roomId: string,
    @Param("queueItemId") queueItemId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Ip() ipAddress?: string
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    await this.limitQueueWrites(userId, ipAddress);
    await this.roomService.removeQueueItem(roomId, queueItemId, userId);
    const snapshot = await this.roomRealtimePublisher.emitQueueSnapshot(roomId);
    return {
      queue: snapshot.queue,
      playback: snapshot.room.playback
    };
  }

  @Patch("reorder")
  async reorderQueue(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: { queueItemIds: string[] },
    @Ip() ipAddress?: string
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    await this.limitQueueWrites(userId, ipAddress);
    const payload = parseRequestBody(reorderQueueRequestSchema, body);
    await this.roomService.reorderQueue(roomId, userId, payload.queueItemIds);
    const snapshot = await this.roomRealtimePublisher.emitQueueSnapshot(roomId);
    return {
      queue: snapshot.queue,
      playback: snapshot.room.playback
    };
  }

  @Patch("next")
  async setNextQueueItem(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: { queueItemId: string },
    @Ip() ipAddress?: string
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    await this.limitQueueWrites(userId, ipAddress);
    const payload = parseRequestBody(setNextQueueItemRequestSchema, body);
    await this.roomService.setNextQueueItem(roomId, userId, payload.queueItemId);
    const snapshot = await this.roomRealtimePublisher.emitQueueSnapshot(roomId);
    return {
      queue: snapshot.queue,
      playback: snapshot.room.playback
    };
  }

  private async limitQueueWrites(userId: string, ipAddress?: string) {
    await this.abuseProtection?.enforce("room:queue-write", [
      { name: "ip", value: ipAddress },
      { name: "user", value: userId }
    ], { limit: 180, windowMs: 10 * 60 * 1000 });
  }
}
