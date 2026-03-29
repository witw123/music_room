import { Module } from "@nestjs/common";
import { RoomModule } from "../room/room.module";
import { SignalingModule } from "../signaling/signaling.module";
import { PlaybackController } from "./playback.controller";
import { PlaybackService } from "./playback.service";

@Module({
  imports: [RoomModule, SignalingModule],
  controllers: [PlaybackController],
  providers: [PlaybackService],
  exports: [PlaybackService]
})
export class PlaybackModule {}
