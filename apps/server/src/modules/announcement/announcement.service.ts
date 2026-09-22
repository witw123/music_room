import { Injectable } from "@nestjs/common";
import type { SystemAnnouncement } from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class AnnouncementService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<{ data: SystemAnnouncement[] }> {
    if (!(await this.prisma.ensureAvailable())) {
      return { data: [] };
    }
    const items = await this.prisma.systemAnnouncement.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" }
    });
    return {
      data: items.map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        isActive: item.isActive,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString()
      }))
    };
  }
}
