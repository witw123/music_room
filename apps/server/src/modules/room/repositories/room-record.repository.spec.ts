import type { Room } from "@music-room/shared";
import { RoomRecordRepository } from "./room-record.repository";
import type { RoomRecord } from "../room.types";

function createRoomRecord(roomRevision: number): RoomRecord {
  const room: Room = {
    id: "room_1",
    hostId: "host_1",
    joinCode: "ABC123",
    visibility: "public",
    members: [
      {
        id: "host_1",
        nickname: "Host",
        role: "host",
        joinedAt: "2026-01-01T00:00:00.000Z",
        peerId: null,
        presenceState: "offline"
      }
    ],
    presenceRevision: 0,
    roomRevision,
    playback: {
      status: "paused",
      currentTrackId: null,
      currentQueueItemId: null,
      sourceSessionId: "host_1",
      sourcePeerId: null,
      sourceTrackId: null,
      positionMs: 0,
      startedAt: null,
      queueVersion: 1,
      playbackRevision: 1,
      mediaEpoch: 0
    }
  };

  return {
    room,
    tracks: [],
    queue: []
  };
}

function createRedisMock() {
  return {
    addToSet: jest.fn(),
    delete: jest.fn(),
    getSetMembers: jest.fn(async (): Promise<string[]> => []),
    getJson: jest.fn(),
    getString: jest.fn(),
    removeFromSet: jest.fn(),
    setJson: jest.fn(),
    setString: jest.fn()
  };
}

describe("RoomRecordRepository", () => {
  it("keeps the committed revision locally when a Redis projection update fails", async () => {
    const existing = createRoomRecord(1);
    const rooms = new Map<string, RoomRecord>([[existing.room.id, existing]]);
    const prisma = {
      isAvailable: jest.fn(() => true),
      roomState: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const redis = {
      ...createRedisMock(),
      addToSet: jest.fn().mockRejectedValue(new Error("redis unavailable"))
    };
    const repository = new RoomRecordRepository(rooms, prisma as never, redis as never, "music-room:rooms", 0, 60);
    const next = createRoomRecord(2);

    await expect(repository.persistRecord(next)).resolves.toBeUndefined();
    prisma.isAvailable.mockReturnValue(false);
    await expect(repository.getRoomRecord(next.room.id)).resolves.toMatchObject({
      room: { roomRevision: 2 }
    });
  });

  it("persists Redis room projections without expiration when room TTL is disabled", async () => {
    const prisma = {
      isAvailable: jest.fn(() => false)
    };
    const redis = {
      ...createRedisMock(),
      setJsonIfRevisionMatches: jest.fn(async () => true)
    };
    const repository = new RoomRecordRepository(
      new Map<string, RoomRecord>(),
      prisma as never,
      redis as never,
      "music-room:rooms",
      0,
      60
    );

    await repository.persistRecord(createRoomRecord(1));

    expect(redis.setJsonIfRevisionMatches).toHaveBeenCalledWith(
      "music-room:room:room_1",
      expect.any(Object),
      0,
      0
    );
    expect(redis.setJson).toHaveBeenCalledWith(
      "music-room:join-code:ABC123",
      expect.any(Object),
      0
    );
  });

  it("rejects stale Redis-only writes before refreshing cache projections", async () => {
    const prisma = {
      isAvailable: jest.fn(() => false)
    };
    const redis = {
      ...createRedisMock(),
      setJsonIfRevisionMatches: jest.fn(async () => false)
    };
    const rooms = new Map<string, RoomRecord>();
    const repository = new RoomRecordRepository(
      rooms,
      prisma as never,
      redis as never,
      "music-room:rooms",
      60,
      60
    );

    await expect(repository.persistRecord(createRoomRecord(2))).rejects.toThrow(
      "Room state revision conflict."
    );

    expect(redis.setJsonIfRevisionMatches).toHaveBeenCalledWith(
      "music-room:room:room_1",
      expect.any(Object),
      1,
      60
    );
    expect(redis.addToSet).not.toHaveBeenCalled();
    expect(rooms.has("room_1")).toBe(false);
  });

  it("rejects same-revision database writes before refreshing caches", async () => {
    const storedRoomRevision = 2;
    const prisma = {
      isAvailable: jest.fn(() => true),
      roomState: {
        findUnique: jest.fn(async () => ({ id: "room_1" })),
        create: jest.fn(),
        updateMany: jest.fn(async (input: { where: { roomRevision: number } }) => ({
          count: storedRoomRevision === input.where.roomRevision ? 1 : 0
        }))
      }
    };
    const redis = createRedisMock();
    const rooms = new Map<string, RoomRecord>();
    const repository = new RoomRecordRepository(
      rooms,
      prisma as never,
      redis as never,
      "music-room:rooms",
      60,
      60
    );

    await expect(repository.persistRecord(createRoomRecord(storedRoomRevision))).rejects.toThrow(
      "Room state revision conflict."
    );

    expect(redis.addToSet).not.toHaveBeenCalled();
    expect(redis.setJson).not.toHaveBeenCalled();
    expect(redis.setString).not.toHaveBeenCalled();
    expect(rooms.has("room_1")).toBe(false);
  });

  it("keeps the in-memory record unchanged when a persisted clone fails to save", async () => {
    const storedRoomRevision = 1;
    const existingRecord = createRoomRecord(storedRoomRevision);
    const rooms = new Map<string, RoomRecord>([[existingRecord.room.id, existingRecord]]);
    const prisma = {
      isAvailable: jest.fn(() => true),
      roomState: {
        findUnique: jest.fn(async () => ({ id: "room_1" })),
        create: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 0 }))
      }
    };
    const redis = createRedisMock();
    const repository = new RoomRecordRepository(
      rooms,
      prisma as never,
      redis as never,
      "music-room:rooms",
      60,
      60
    );

    const workingCopy = await repository.getRoomRecord("room_1");
    workingCopy.queue.push({
      id: "queue_1",
      trackId: "track_1",
      requestedBy: "Host",
      requestedById: "host_1",
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    workingCopy.room.roomRevision = 2;

    await expect(repository.persistRecord(workingCopy)).rejects.toThrow(
      "Room state revision conflict."
    );

    expect(rooms.get("room_1")?.queue).toHaveLength(0);
    expect(rooms.get("room_1")?.room.roomRevision).toBe(storedRoomRevision);
  });

  it("rejects a unique-create race when the retry update does not write a newer revision", async () => {
    const prisma = {
      isAvailable: jest.fn(() => true),
      roomState: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => {
          const error = new Error("Unique constraint failed");
          Object.assign(error, { code: "P2002" });
          throw error;
        }),
        updateMany: jest.fn(async () => ({ count: 0 }))
      }
    };
    const redis = createRedisMock();
    const rooms = new Map<string, RoomRecord>();
    const repository = new RoomRecordRepository(
      rooms,
      prisma as never,
      redis as never,
      "music-room:rooms",
      60,
      60
    );

    await expect(repository.persistRecord(createRoomRecord(1))).rejects.toThrow(
      "Room state revision conflict."
    );

    expect(prisma.roomState.updateMany).toHaveBeenCalledTimes(2);
    expect(redis.addToSet).not.toHaveBeenCalled();
    expect(rooms.has("room_1")).toBe(false);
  });

  it("keeps the in-memory record when deleting external storage fails", async () => {
    const existingRecord = createRoomRecord(1);
    const rooms = new Map<string, RoomRecord>([[existingRecord.room.id, existingRecord]]);
    const prisma = {
      isAvailable: jest.fn(() => false)
    };
    const redis = createRedisMock();
    redis.removeFromSet.mockRejectedValueOnce(new Error("Redis unavailable"));
    const repository = new RoomRecordRepository(
      rooms,
      prisma as never,
      redis as never,
      "music-room:rooms",
      60,
      60
    );

    await expect(repository.deleteRecord(existingRecord)).rejects.toThrow("Redis unavailable");

    expect(rooms.has("room_1")).toBe(true);
  });

  it("rejects invalid redis room cache records before hydrating memory", async () => {
    const prisma = {
      isAvailable: jest.fn(() => false)
    };
    const redis = createRedisMock();
    redis.getJson.mockResolvedValueOnce({
      room: {
        id: "room_1"
      },
      tracks: [],
      queue: []
    });
    const rooms = new Map<string, RoomRecord>();
    const repository = new RoomRecordRepository(
      rooms,
      prisma as never,
      redis as never,
      "music-room:rooms",
      60,
      60
    );

    await expect(repository.getRoomRecord("room_1")).rejects.toThrow("Room not found: room_1");

    expect(rooms.has("room_1")).toBe(false);
  });

  it("rejects invalid database room records before hydrating memory", async () => {
    const prisma = {
      isAvailable: jest.fn(() => true),
      roomState: {
        findUnique: jest.fn(async () => ({
          id: "room_1",
          hostId: "host_1",
          joinCode: "ABC123",
          visibility: "public",
          presenceRevision: 0,
          roomRevision: 1,
          playback: {
            status: "paused",
            currentTrackId: null,
            currentQueueItemId: null,
            sourceSessionId: "host_1",
            sourcePeerId: null,
            sourceTrackId: null,
            positionMs: 0,
            startedAt: null,
            queueVersion: 1,
            playbackRevision: 1,
            mediaEpoch: 0
          },
          members: [
            {
              id: "host_1",
              nickname: "Host",
              role: "host",
              joinedAt: "2026-01-01T00:00:00.000Z",
              peerId: null,
              presenceState: "offline"
            }
          ],
          tracks: [{ id: "track_bad" }],
          queue: []
        }))
      }
    };
    const redis = createRedisMock();
    const rooms = new Map<string, RoomRecord>();
    const repository = new RoomRecordRepository(
      rooms,
      prisma as never,
      redis as never,
      "music-room:rooms",
      60,
      60
    );

    await expect(repository.getRoomRecord("room_1")).rejects.toThrow("Room not found: room_1");

    expect(rooms.has("room_1")).toBe(false);
  });

  it("removes invalid redis room ids from the recoverable registry", async () => {
    const validRecord = createRoomRecord(2);
    validRecord.room.id = "room_valid";
    const prisma = {
      isAvailable: jest.fn(() => false)
    };
    const redis = createRedisMock();
    redis.getSetMembers.mockResolvedValueOnce(["room_bad", "room_valid"]);
    redis.getJson
      .mockResolvedValueOnce({
        room: { id: "room_bad" },
        tracks: [],
        queue: []
      })
      .mockResolvedValueOnce(validRecord);
    const rooms = new Map<string, RoomRecord>();
    const repository = new RoomRecordRepository(
      rooms,
      prisma as never,
      redis as never,
      "music-room:rooms",
      60,
      60
    );

    await expect(repository.listRecoverableRecords()).resolves.toEqual([validRecord]);

    expect(redis.removeFromSet).toHaveBeenCalledWith("music-room:rooms", "room_bad");
    expect(rooms.has("room_bad")).toBe(false);
    expect(rooms.has("room_valid")).toBe(true);
  });
});
