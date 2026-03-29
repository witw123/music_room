import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { RoomService } from "../room/room.service";
import { SignalingGateway } from "../signaling/signaling.gateway";

@Controller("v1/rooms/:roomId/queue")
export class QueueController {
  constructor(
    private readonly roomService: RoomService,
    private readonly signalingGateway: SignalingGateway,
    private readonly authService: AuthService
  ) {}

  private async assertSession(sessionId: string, sessionToken?: string) {
    try {
      await this.authService.assertSessionToken(sessionId, sessionToken);
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @Get()
  async listQueue(@Param("roomId") roomId: string) {
    return this.roomService.getQueue(roomId);
  }

  @Post()
  async addQueueItem(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: { sessionId: string; trackId: string }
  ) {
    await this.assertSession(body.sessionId, sessionToken);
    const item = await this.roomService.addQueueItem(roomId, body.sessionId, body.trackId);
    this.signalingGateway.emitRoomSnapshot(
      roomId,
      await this.roomService.getRoomSnapshot(roomId, [])
    );
    return item;
  }

  @Delete(":queueItemId")
  async removeQueueItem(
    @Param("roomId") roomId: string,
    @Param("queueItemId") queueItemId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Query("sessionId") sessionId: string
  ) {
    await this.assertSession(sessionId, sessionToken);
    const queue = await this.roomService.removeQueueItem(roomId, queueItemId, sessionId);
    this.signalingGateway.emitRoomSnapshot(
      roomId,
      await this.roomService.getRoomSnapshot(roomId, [])
    );
    return queue;
  }
}
