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
    setJson: jest.fn(),
    setString: jest.fn()
  };
}

describe("RoomRecordRepository", () => {
  it("rejects same-revision database writes before refreshing caches", async () => {
    const storedRoomRevision = 2;
    const prisma = {
      isAvailable: jest.fn(() => true),
      roomState: {
        findUnique: jest.fn(async () => ({ id: "room_1" })),
        create: jest.fn(),
        updateMany: jest.fn(async (input: { where: { roomRevision: { lt?: number; lte?: number } } }) => {
          const revisionGuard = input.where.roomRevision;
          const acceptsWrite =
            typeof revisionGuard.lt === "number"
              ? storedRoomRevision < revisionGuard.lt
              : storedRoomRevision <= (revisionGuard.lte ?? Number.NEGATIVE_INFINITY);
          return { count: acceptsWrite ? 1 : 0 };
        })
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
});
