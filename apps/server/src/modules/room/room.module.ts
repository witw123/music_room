import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PlaylistModule } from "../playlist/playlist.module";
import { SignalingModule } from "../signaling/signaling.module";
import { RoomController } from "./room.controller";
import { RoomService } from "./room.service";
import { RoomRealtimePublisher } from "./services/room-realtime.publisher";

@Module({
  imports: [AuthModule, forwardRef(() => PlaylistModule), forwardRef(() => SignalingModule)],
  controllers: [RoomController],
  providers: [RoomService, RoomRealtimePublisher],
  exports: [RoomService, RoomRealtimePublisher]
})
export class RoomModule {}
