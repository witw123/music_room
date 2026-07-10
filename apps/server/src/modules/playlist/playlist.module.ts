import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RoomCoreModule } from "../room/room-core.module";
import { PlaylistController } from "./playlist.controller";
import { PlaylistService } from "./playlist.service";

@Module({
  imports: [AuthModule, RoomCoreModule],
  controllers: [PlaylistController],
  providers: [PlaylistService],
  exports: [PlaylistService]
})
export class PlaylistModule {}
