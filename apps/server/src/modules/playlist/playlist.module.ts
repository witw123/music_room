import { Module } from "@nestjs/common";
import { RoomModule } from "../room/room.module";
import { SignalingModule } from "../signaling/signaling.module";
import { PlaylistController } from "./playlist.controller";
import { PlaylistService } from "./playlist.service";

@Module({
  imports: [RoomModule, SignalingModule],
  controllers: [PlaylistController],
  providers: [PlaylistService],
  exports: [PlaylistService]
})
export class PlaylistModule {}
