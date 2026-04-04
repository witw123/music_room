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
import { AuthService } from "../auth/auth.service";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";
import { RoomService } from "../room/room.service";

@Controller("v1/rooms/:roomId/queue")
export class QueueController {
  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimePublisher: RoomRealtimePublisher,
    private readonly authService: AuthService
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
    await this.getCurrentUserId(sessionToken);
    return this.roomService.getQueue(roomId);
  }

  @Post()
  async addQueueItem(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: { trackId: string }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    await this.roomService.addQueueItem(roomId, userId, body.trackId);
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
    @Headers("x-session-token") sessionToken: string | undefined
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
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: { queueItemIds: string[] }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    await this.roomService.reorderQueue(roomId, userId, body.queueItemIds);
    const snapshot = await this.roomRealtimePublisher.emitQueueSnapshot(roomId);
    return {
      queue: snapshot.queue,
      playback: snapshot.room.playback
    };
  }
}
