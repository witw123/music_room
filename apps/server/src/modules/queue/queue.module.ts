import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RoomModule } from "../room/room.module";
import { QueueController } from "./queue.controller";

@Module({
  imports: [AuthModule, RoomModule],
  controllers: [QueueController],
})
export class QueueModule {}
