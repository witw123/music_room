import { RoomActivityService } from "./room-activity.service";

describe("RoomActivityService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts a new interval from confirmed presence instead of an old member timestamp", async () => {
    const prisma = createPrismaMock({ current: null });
    const service = new RoomActivityService(prisma as never);
    const now = new Date("2026-07-30T12:00:00.000Z");
    jest.useFakeTimers().setSystemTime(now);

    await service.startOrTouch("user_1", room);

    expect(prisma.userRoomActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        activeStartedAt: now,
        lastPresenceAt: now,
        lastJoinedAt: now
      })
    });
  });

  it("does not count time after the last valid heartbeat", async () => {
    const current = {
      id: "activity_1",
      activeStartedAt: new Date("2026-07-30T12:00:00.000Z"),
      lastPresenceAt: new Date("2026-07-30T12:01:00.000Z")
    };
    const prisma = createPrismaMock({ current });
    const service = new RoomActivityService(prisma as never);
    jest.useFakeTimers().setSystemTime(new Date("2026-07-30T12:03:00.000Z"));

    await service.stop("user_1", "room_1", room);

    expect(prisma.userRoomActivity.update).toHaveBeenCalledWith({
      where: { id: "activity_1" },
      data: expect.objectContaining({
        totalDurationMs: { increment: 60_000n },
        activeStartedAt: null
      })
    });
  });
});

const room = {
  id: "room_1",
  name: "测试房间",
  joinCode: "ABC123"
};

function createPrismaMock({ current }: { current: unknown }) {
  return {
    isAvailable: jest.fn().mockReturnValue(true),
    userRoomActivity: {
      findUnique: jest.fn().mockResolvedValue(current),
      create: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([])
    }
  };
}
