import { ConflictException } from "@nestjs/common";
import { errorCodes } from "@music-room/shared";
import { RoomDownloadLockService } from "./room-download-lock.service";

describe("RoomDownloadLockService", () => {
  it("allows one member to claim a room download lease", async () => {
    const redis = {
      setJsonIfAbsent: jest.fn().mockResolvedValue(true),
      getJson: jest.fn(),
      deleteJsonIfValue: jest.fn().mockResolvedValue(true),
      refreshJsonLease: jest.fn().mockResolvedValue(true)
    };
    const roomService = { assertRoomMember: jest.fn().mockResolvedValue(undefined) };
    const service = new RoomDownloadLockService(roomService as never, redis as never);

    const lease = await service.acquire("room_1", "member_1", {
      provider: "netease",
      trackId: "123"
    });

    expect(lease.payload).toMatchObject({
      roomId: "room_1",
      sessionId: "member_1",
      provider: "netease",
      trackId: "123"
    });
    expect(redis.setJsonIfAbsent).toHaveBeenCalledWith(
      "music-room:provider-download:room_1",
      lease.payload,
      expect.any(Number)
    );
  });

  it("rejects a second member while the room lease is held", async () => {
    const current = {
      leaseId: "existing",
      roomId: "room_1",
      sessionId: "member_1",
      provider: "qqmusic",
      trackId: "song-mid",
      startedAt: "2026-07-19T00:00:00.000Z"
    } as const;
    const redis = {
      setJsonIfAbsent: jest.fn().mockResolvedValue(false),
      getJson: jest.fn().mockResolvedValue(current)
    };
    const roomService = { assertRoomMember: jest.fn().mockResolvedValue(undefined) };
    const service = new RoomDownloadLockService(roomService as never, redis as never);

    await expect(
      service.acquire("room_1", "member_2", { provider: "netease", trackId: "456" })
    ).rejects.toBeInstanceOf(ConflictException);

    try {
      await service.acquire("room_1", "member_2", { provider: "netease", trackId: "456" });
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: errorCodes.roomDownloadBusy,
        details: {
          provider: "qqmusic",
          trackId: "song-mid"
        }
      });
    }
  });

  it("releases only its own lease payload", async () => {
    const redis = {
      setJsonIfAbsent: jest.fn().mockResolvedValue(true),
      deleteJsonIfValue: jest.fn().mockResolvedValue(true)
    };
    const roomService = { assertRoomMember: jest.fn().mockResolvedValue(undefined) };
    const service = new RoomDownloadLockService(roomService as never, redis as never);
    const lease = await service.acquire("room_1", "member_1", {
      provider: "qqmusic",
      trackId: "song-mid"
    });

    await service.release(lease);
    await service.release(lease);

    expect(redis.deleteJsonIfValue).toHaveBeenCalledTimes(1);
    expect(redis.deleteJsonIfValue).toHaveBeenCalledWith(lease.key, lease.payload);
  });
});
