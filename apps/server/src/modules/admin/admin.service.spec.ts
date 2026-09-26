import { AdminService } from "./admin.service";

function buildService(prisma: Record<string, unknown>, redis: Record<string, unknown>, presence: Record<string, unknown>) {
  return new AdminService(
    prisma as never,
    redis as never,
    {} as never,
    {} as never,
    presence as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
}

describe("AdminService directories", () => {
  it("applies room search in the database before taking the page", async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "room_old-match",
        joinCode: "ABCD12",
        visibility: "public",
        hostId: "user_1",
        members: [],
        playback: { status: "paused" },
        updatedAt: new Date("2026-07-01T00:00:00.000Z")
      }
    ]);
    const service = buildService(
      { roomState: { findMany } },
      { isAvailable: () => false },
      { getPresenceSnapshot: jest.fn().mockResolvedValue(new Map()) }
    );

    const result = await service.listRooms({ q: "old-match", limit: 1 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { id: { contains: "old-match", mode: "insensitive" } },
          { joinCode: { contains: "old-match", mode: "insensitive" } }
        ]
      },
      take: 1
    }));
    expect(result.data.map((room) => room.id)).toEqual(["room_old-match"]);
  });

  it("applies user search in the database before taking the page", async () => {
    const userFindMany = jest.fn().mockResolvedValue([
      {
        id: "user_old-match",
        username: "old-user",
        nickname: "Old Match",
        role: "USER",
        status: "ACTIVE",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        lastLoginAt: null,
        userSessions: []
      }
    ]);
    const service = buildService(
      {
        user: { findMany: userFindMany },
        roomState: { findMany: jest.fn().mockResolvedValue([]) }
      },
      { isAvailable: () => false },
      { getPresenceSnapshot: jest.fn().mockResolvedValue(new Map()) }
    );

    const result = await service.listUsers({ q: "old match", limit: 1 });

    expect(userFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { username: { contains: "old match", mode: "insensitive" } },
          { nickname: { contains: "old match", mode: "insensitive" } }
        ]
      },
      take: 1
    }));
    expect(result.data.map((user) => user.id)).toEqual(["user_old-match"]);
  });

  it("creates, lists, updates, and deletes announcements with audit logging", async () => {
    const mockCreated = {
      id: "anno_test",
      title: "新功能通知",
      content: "测试内容说明",
      isActive: true,
      createdAt: new Date("2026-09-22T10:00:00.000Z"),
      updatedAt: new Date("2026-09-22T10:00:00.000Z")
    };
    const mockAuditCreate = jest.fn().mockResolvedValue({});
    const service = buildService(
      {
        ensureAvailable: jest.fn().mockResolvedValue(true),
        systemAnnouncement: {
          create: jest.fn().mockResolvedValue(mockCreated),
          findMany: jest.fn().mockResolvedValue([mockCreated]),
          findUnique: jest.fn().mockResolvedValue(mockCreated),
          update: jest.fn().mockResolvedValue({ ...mockCreated, title: "更新标题", isActive: false }),
          delete: jest.fn().mockResolvedValue(mockCreated)
        },
        adminAuditLog: {
          create: mockAuditCreate
        }
      },
      { isAvailable: () => false },
      { getPresenceSnapshot: jest.fn().mockResolvedValue(new Map()) }
    );

    const admin = { userId: "admin_1", username: "admin", nickname: "Admin", role: "ADMIN" as const, csrfToken: "csrf123456789012", expiresAt: new Date() };
    const fakeReq = { ip: "127.0.0.1", headers: {} } as never;

    // Create
    const created = await service.createAnnouncement(admin, { title: "新功能通知", content: "测试内容说明" }, fakeReq);
    expect(created.title).toBe("新功能通知");
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "announcement.create" })
    }));

    // List
    const list = await service.listAnnouncements();
    expect(list.data).toHaveLength(1);

    // Update
    const updated = await service.updateAnnouncement(admin, "anno_test", { title: "更新标题", isActive: false }, fakeReq);
    expect(updated.title).toBe("更新标题");
    expect(updated.isActive).toBe(false);

    // Delete
    const deleted = await service.deleteAnnouncement(admin, "anno_test", fakeReq);
    expect(deleted.ok).toBe(true);
  });
});
