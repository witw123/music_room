import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RoomModule } from "../room/room.module";
import { SignalingModule } from "../signaling/signaling.module";
import { PlaybackController } from "./playback.controller";
import { PlaybackService } from "./playback.service";

@Module({
  imports: [AuthModule, RoomModule, SignalingModule],
  controllers: [PlaybackController],
  providers: [PlaybackService],
  exports: [PlaybackService]
})
export class PlaybackModule {}
