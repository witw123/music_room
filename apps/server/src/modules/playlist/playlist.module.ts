import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RoomModule } from "../room/room.module";
import { SignalingModule } from "../signaling/signaling.module";
import { PlaylistController } from "./playlist.controller";
import { PlaylistService } from "./playlist.service";

@Module({
  imports: [AuthModule, forwardRef(() => RoomModule), SignalingModule],
  controllers: [PlaylistController],
  providers: [PlaylistService],
  exports: [PlaylistService]
})
export class PlaylistModule {}
