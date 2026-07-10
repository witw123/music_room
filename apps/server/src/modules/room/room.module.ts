import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PlaylistModule } from "../playlist/playlist.module";
import { RoomController } from "./room.controller";
import { RoomCoreModule } from "./room-core.module";

@Module({
  imports: [AuthModule, RoomCoreModule, PlaylistModule],
  controllers: [RoomController],
  exports: [RoomCoreModule]
})
export class RoomModule {}
