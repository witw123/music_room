import {
  Body,
  Controller,
  Headers,
  Param,
  Patch,
  UnauthorizedException
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { RoomService } from "../room/room.service";
import { SignalingGateway } from "../signaling/signaling.gateway";

@Controller("v1/rooms/:roomId/playback")
export class PlaybackController {
  constructor(
    private readonly roomService: RoomService,
    private readonly signalingGateway: SignalingGateway,
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

  @Patch()
  async updatePlayback(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      action: "play" | "pause" | "seek" | "next" | "prev";
      trackId?: string;
      queueItemId?: string;
      positionMs?: number;
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const playback = await this.roomService.updatePlayback(roomId, {
      ...body,
      actorSessionId: userId
    });
    this.signalingGateway.emitRoomSnapshot(
      roomId,
      await this.roomService.getRoomSnapshot(roomId, [])
    );
    return playback;
  }
}
