import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RoomCoreModule } from "../room/room-core.module";
import { SignalingGateway } from "./signaling.gateway";

@Module({
  imports: [AuthModule, RoomCoreModule],
  providers: [SignalingGateway],
  exports: [SignalingGateway]
})
export class SignalingModule {}
