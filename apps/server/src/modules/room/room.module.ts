import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PlaylistModule } from "../playlist/playlist.module";
import { RoomController } from "./room.controller";
import { RoomCoreModule } from "./room-core.module";
import { RoomLifecycleService } from "./services/room-lifecycle.service";

@Module({
  imports: [AuthModule, RoomCoreModule, PlaylistModule],
  controllers: [RoomController],
  providers: [RoomLifecycleService],
  exports: [RoomCoreModule]
})
export class RoomModule {}
