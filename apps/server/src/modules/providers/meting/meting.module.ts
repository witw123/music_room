import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { MetingApiClient } from "./meting-api.client";
import { MetingController } from "./meting.controller";
import { MetingService } from "./meting.service";

@Module({
  imports: [AuthModule],
  controllers: [MetingController],
  providers: [MetingApiClient, MetingService],
  exports: [MetingService]
})
export class MetingModule {}
