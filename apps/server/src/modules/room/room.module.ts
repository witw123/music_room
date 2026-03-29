import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SignalingModule } from "../signaling/signaling.module";
import { RoomController } from "./room.controller";
import { RoomService } from "./room.service";

@Module({
  imports: [AuthModule, SignalingModule],
  controllers: [RoomController],
  providers: [RoomService],
  exports: [RoomService]
})
export class RoomModule {}
