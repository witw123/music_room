import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Patch,
  Param,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import { addQueueItemRequestSchema, reorderQueueRequestSchema } from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";
import { RoomService } from "../room/room.service";
import { getSessionTokenFromCookie } from "../../common/auth/session-cookie";

@Controller("v1/rooms/:roomId/queue")
export class QueueController {
  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimePublisher: RoomRealtimePublisher,
    private readonly authService: AuthService
  ) {}

  private async getCurrentUserId(cookieHeader?: string) {
    try {
      const session = await this.authService.getAuthSessionByTokenOrThrow(getSessionTokenFromCookie(cookieHeader));
      return session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @Get()
  async listQueue(
    @Param("roomId") roomId: string,
    @Headers("cookie") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.getAccessibleQueue(roomId, userId);
  }

  @Post()
  async addQueueItem(
    @Param("roomId") roomId: string,
    @Headers("cookie") sessionToken: string | undefined,
    @Body() body: { trackId: string }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
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
    @Headers("cookie") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
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
    @Headers("cookie") sessionToken: string | undefined,
    @Body() body: { queueItemIds: string[] }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(reorderQueueRequestSchema, body);
    await this.roomService.reorderQueue(roomId, userId, payload.queueItemIds);
    const snapshot = await this.roomRealtimePublisher.emitQueueSnapshot(roomId);
    return {
      queue: snapshot.queue,
      playback: snapshot.room.playback
    };
  }
}
