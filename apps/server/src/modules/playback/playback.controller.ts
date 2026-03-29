import { Body, Controller, Param, Patch } from "@nestjs/common";
import { RoomService } from "../room/room.service";
import { SignalingGateway } from "../signaling/signaling.gateway";

@Controller("v1/rooms/:roomId/playback")
export class PlaybackController {
  constructor(
    private readonly roomService: RoomService,
    private readonly signalingGateway: SignalingGateway
  ) {}

  @Patch()
  async updatePlayback(
    @Param("roomId") roomId: string,
    @Body()
    body: {
      action: "play" | "pause" | "seek" | "next";
      trackId?: string;
      positionMs?: number;
      sessionId?: string;
    }
  ) {
    const playback = await this.roomService.updatePlayback(roomId, {
      ...body,
      actorSessionId: body.sessionId
    });
    this.signalingGateway.emitRoomSnapshot(
      roomId,
      await this.roomService.getRoomSnapshot(roomId, [])
    );
    return playback;
  }
}
