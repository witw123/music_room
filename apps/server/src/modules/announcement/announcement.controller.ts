import { Controller, Get } from "@nestjs/common";
import { AnnouncementService } from "./announcement.service";

@Controller("v1/announcements")
export class AnnouncementController {
  constructor(private readonly announcement: AnnouncementService) {}

  @Get("active")
  async active() {
    return this.announcement.listActive();
  }
}
