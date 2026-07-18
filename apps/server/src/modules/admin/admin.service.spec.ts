import { AdminService } from "./admin.service";

function buildService(prisma: Record<string, unknown>, redis: Record<string, unknown>, presence: Record<string, unknown>) {
  return new AdminService(
    prisma as never,
    redis as never,
    {} as never,
    {} as never,
    presence as never,
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
});
