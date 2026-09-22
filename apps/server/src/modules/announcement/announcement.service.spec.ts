import { AnnouncementService } from "./announcement.service";

describe("AnnouncementService", () => {
  it("returns active announcements ordered by createdAt desc", async () => {
    const mockFindMany = jest.fn().mockResolvedValue([
      {
        id: "anno_1",
        title: "系统升级通知",
        content: "今晚 23:00 进行升级维护",
        isActive: true,
        createdAt: new Date("2026-09-22T10:00:00.000Z"),
        updatedAt: new Date("2026-09-22T10:00:00.000Z")
      }
    ]);

    const mockPrisma = {
      ensureAvailable: jest.fn().mockResolvedValue(true),
      systemAnnouncement: {
        findMany: mockFindMany
      }
    };

    const service = new AnnouncementService(mockPrisma as never);
    const result = await service.listActive();

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { createdAt: "desc" }
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe("系统升级通知");
    expect(result.data[0].isActive).toBe(true);
  });

  it("returns empty array when prisma is unavailable", async () => {
    const mockPrisma = {
      ensureAvailable: jest.fn().mockResolvedValue(false),
      systemAnnouncement: {
        findMany: jest.fn()
      }
    };

    const service = new AnnouncementService(mockPrisma as never);
    const result = await service.listActive();

    expect(result.data).toEqual([]);
    expect(mockPrisma.systemAnnouncement.findMany).not.toHaveBeenCalled();
  });
});
