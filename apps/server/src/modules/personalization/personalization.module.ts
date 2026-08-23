import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NeteaseModule } from "../providers/netease/netease.module";
import { QqMusicModule } from "../providers/qqmusic/qqmusic.module";
import { RoomModule } from "../room/room.module";
import { PersonalizationController } from "./personalization.controller";
import { PersonalizationService } from "./personalization.service";

@Module({
  imports: [AuthModule, NeteaseModule, QqMusicModule, RoomModule],
  controllers: [PersonalizationController],
  providers: [PersonalizationService],
  exports: [PersonalizationService]
})
export class PersonalizationModule {}
