import { Module } from "@nestjs/common";
import { AlistController } from "./alist.controller";
import { AlistService } from "./alist.service";

@Module({
  controllers: [AlistController],
  providers: [AlistService],
  exports: [AlistService]
})
export class AlistModule {}
