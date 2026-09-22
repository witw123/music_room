import { Module } from "@nestjs/common";
import { PrismaModule } from "../../infra/prisma/prisma.module";
import { AnnouncementController } from "./announcement.controller";
import { AnnouncementService } from "./announcement.service";

@Module({
  imports: [PrismaModule],
  controllers: [AnnouncementController],
  providers: [AnnouncementService],
  exports: [AnnouncementService]
})
export class AnnouncementModule {}
