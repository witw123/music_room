import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PlaybackHistoryController } from "./playback-history.controller";
import { PlaybackHistoryService } from "./playback-history.service";

@Module({
  imports: [AuthModule],
  controllers: [PlaybackHistoryController],
  providers: [PlaybackHistoryService]
})
export class PlaybackHistoryModule {}
