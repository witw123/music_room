import { RoomLifecycleService } from "./room-lifecycle.service";

function createHarness(input?: { online?: boolean; archivedCandidates?: boolean }) {
  const online = input?.online ?? false;
  const prisma = {
    isAvailable: jest.fn(() => true),
    $queryRawUnsafe: jest
      .fn()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]),
    roomState: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: "room_archive" }])
        .mockResolvedValueOnce(input?.archivedCandidates === false ? [] : [{ id: "room_delete" }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    }
  };
  const roomService = {
    getRoomSnapshot: jest.fn(async (roomId: string) => ({
      room: {
        members: [{ presenceState: roomId === "room_archive" && online ? "online" : "offline" }]
      }
    })),
    deleteArchivedRoom: jest.fn().mockResolvedValue(["track_1"])
  };
  const playlistService = { clearCachedPlaylistsForRoom: jest.fn() };
  const publisher = { emitRoomDeleted: jest.fn(), emitRoomMissing: jest.fn() };
  const service = new RoomLifecycleService(
    prisma as never,
    roomService as never,
    playlistService as never,
    publisher as never
  );
  return { service, prisma, roomService, playlistService, publisher };
}

describe("RoomLifecycleService", () => {
  it("archives inactive public rooms and deletes rooms archived for 30 days", async () => {
    const harness = createHarness();
    const now = new Date("2026-07-11T00:00:00.000Z");

    await harness.service.runOnce(now);

    expect(harness.prisma.roomState.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        visibility: "public",
        archivedAt: null,
        lastActiveAt: { lte: new Date("2026-07-10T00:00:00.000Z") }
      },
      select: { id: true }
    });
    expect(harness.prisma.roomState.updateMany).toHaveBeenCalledWith({
      where: { id: "room_archive", archivedAt: null },
      data: { archivedAt: now }
    });
    expect(harness.prisma.roomState.findMany).toHaveBeenNthCalledWith(2, {
      where: { archivedAt: { lte: new Date("2026-06-11T00:00:00.000Z") } },
      select: { id: true }
    });
    expect(harness.roomService.deleteArchivedRoom).toHaveBeenCalledWith("room_delete");
    expect(harness.playlistService.clearCachedPlaylistsForRoom).toHaveBeenCalledWith("room_delete");
    expect(harness.publisher.emitRoomDeleted).toHaveBeenCalledWith("room_delete", ["track_1"]);
  });

  it("does not archive a room while a member is online", async () => {
    const harness = createHarness({ online: true, archivedCandidates: false });

    await harness.service.runOnce(new Date("2026-07-11T00:00:00.000Z"));

    expect(harness.prisma.roomState.updateMany).not.toHaveBeenCalled();
    expect(harness.roomService.deleteArchivedRoom).not.toHaveBeenCalled();
  });
});
