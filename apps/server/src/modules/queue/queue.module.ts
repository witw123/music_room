import { Module } from "@nestjs/common";
import { RoomModule } from "../room/room.module";
import { SignalingModule } from "../signaling/signaling.module";
import { QueueController } from "./queue.controller";
import { QueueService } from "./queue.service";

@Module({
  imports: [RoomModule, SignalingModule],
  controllers: [QueueController],
  providers: [QueueService],
  exports: [QueueService]
})
export class QueueModule {}
