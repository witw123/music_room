import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { RoomService } from "../room/room.service";
import { SignalingGateway } from "../signaling/signaling.gateway";

@Controller("v1/rooms/:roomId/queue")
export class QueueController {
  constructor(
    private readonly roomService: RoomService,
    private readonly signalingGateway: SignalingGateway
  ) {}

  @Get()
  async listQueue(@Param("roomId") roomId: string) {
    return this.roomService.getQueue(roomId);
  }

  @Post()
  async addQueueItem(
    @Param("roomId") roomId: string,
    @Body() body: { sessionId: string; trackId: string }
  ) {
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
    @Query("sessionId") sessionId: string
  ) {
    const queue = await this.roomService.removeQueueItem(roomId, queueItemId, sessionId);
    this.signalingGateway.emitRoomSnapshot(
      roomId,
      await this.roomService.getRoomSnapshot(roomId, [])
    );
    return queue;
  }
}
