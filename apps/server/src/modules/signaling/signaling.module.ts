import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RoomModule } from "../room/room.module";
import { RoomRealtimeBroadcaster } from "./room-realtime.broadcaster";
import { SignalingGateway } from "./signaling.gateway";

@Module({
  imports: [AuthModule, forwardRef(() => RoomModule)],
  providers: [SignalingGateway, RoomRealtimeBroadcaster],
  exports: [SignalingGateway, RoomRealtimeBroadcaster]
})
export class SignalingModule {}
