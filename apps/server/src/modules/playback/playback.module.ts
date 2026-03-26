import { Module } from "@nestjs/common";
import { PlaybackService } from "./playback.service";

@Module({
  providers: [PlaybackService],
  exports: [PlaybackService]
})
export class PlaybackModule {}

