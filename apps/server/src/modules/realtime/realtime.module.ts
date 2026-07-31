import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeController } from "./realtime.controller";
import { RealtimeService } from "./realtime.service";
import { RoomRealtimeBroadcaster } from "./room-realtime.broadcaster";

@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [RealtimeService, RoomRealtimeBroadcaster],
  exports: [RealtimeService, RoomRealtimeBroadcaster]
})
export class RealtimeModule {}
