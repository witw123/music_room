import { Module } from "@nestjs/common";
import { NeteaseModule } from "../netease/netease.module";
import { QqMusicModule } from "../qqmusic/qqmusic.module";
import { BilibiliApiClient } from "./bilibili-api.client";
import { BilibiliController } from "./bilibili.controller";
import { BilibiliService } from "./bilibili.service";

@Module({
  imports: [NeteaseModule, QqMusicModule],
  controllers: [BilibiliController],
  providers: [BilibiliApiClient, BilibiliService],
  exports: [BilibiliService, BilibiliApiClient]
})
export class BilibiliModule {}
