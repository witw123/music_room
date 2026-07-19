import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { RoomCoreModule } from "../../room/room-core.module";
import { NeteaseAccountService } from "./netease-account.service";
import { NeteaseApiClient } from "./netease-api.client";
import { NeteaseController } from "./netease.controller";
import { NeteaseCryptoService } from "./netease-crypto.service";
import { NeteaseService } from "./netease.service";

@Module({
  imports: [AuthModule, RoomCoreModule],
  controllers: [NeteaseController],
  providers: [
    NeteaseAccountService,
    NeteaseApiClient,
    NeteaseCryptoService,
    NeteaseService
  ],
  exports: [NeteaseService]
})
export class NeteaseModule {}
