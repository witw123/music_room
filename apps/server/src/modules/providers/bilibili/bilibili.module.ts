import { Module } from "@nestjs/common";
import { BilibiliApiClient } from "./bilibili-api.client";
import { BilibiliController } from "./bilibili.controller";
import { BilibiliService } from "./bilibili.service";

@Module({
  controllers: [BilibiliController],
  providers: [BilibiliApiClient, BilibiliService],
  exports: [BilibiliService]
})
export class BilibiliModule {}
