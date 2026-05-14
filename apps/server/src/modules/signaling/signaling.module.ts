import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RoomModule } from "../room/room.module";
import { RoomRealtimeBroadcaster } from "./room-realtime.broadcaster";
import { SignalingGateway } from "./signaling.gateway";
import { TrackAvailabilityRegistry } from "./track-availability.registry";

@Module({
  imports: [AuthModule, forwardRef(() => RoomModule)],
  providers: [SignalingGateway, RoomRealtimeBroadcaster, TrackAvailabilityRegistry],
  exports: [SignalingGateway, RoomRealtimeBroadcaster]
})
export class SignalingModule {}
