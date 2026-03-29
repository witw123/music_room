import { AuthService } from "../auth/auth.service";
import { RoomService } from "./room.service";

function createPrismaMock() {
  return {
    isAvailable: jest.fn(() => false),
    guestSessions: {
      upsert: jest.fn(),
      findUnique: jest.fn()
    },
    roomStates: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn()
    },
    playlists: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn()
    }
  };
}

function createRedisMock() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    setJson: jest.fn(async (key: string, payload: unknown) => {
      store.set(key, JSON.stringify(payload));
    }),
    getJson: jest.fn(async (key: string) => {
      const value = store.get(key);
      return value ? JSON.parse(value) : null;
    }),
    setString: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getString: jest.fn(async (key: string) => store.get(key) ?? null),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    addToSet: jest.fn(async (key: string, value: string) => {
      const existing = sets.get(key) ?? new Set<string>();
      existing.add(value);
      sets.set(key, existing);
    }),
    removeFromSet: jest.fn(async (key: string, value: string) => {
      const existing = sets.get(key);
      existing?.delete(value);
    }),
    getSetMembers: jest.fn(async (key: string) => [...(sets.get(key) ?? new Set<string>())]),
    publish: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined)
  };
}

describe("RoomService", () => {
  it("only allows the host to control playback", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track One",
      artist: "Local Upload",
      album: null,
      durationMs: 120000,
      bitrate: null,
      fileHash: "abc123",
      artworkUrl: null,
      sourceType: "local_upload"
    });
    await roomService.addQueueItem(snapshot.room.id, member.id, track.id);

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "pause",
        actorSessionId: member.id
      })
    ).rejects.toThrow("Only the host can control playback.");

    await expect(
      roomService.updatePlayback(snapshot.room.id, {
        action: "pause",
        actorSessionId: host.id,
        positionMs: 5000
      })
    ).resolves.toMatchObject({
      status: "paused",
      positionMs: 5000
    });
  });

  it("only allows the host or requester to remove a queue item", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const requester = await authService.createGuestSession("Requester");
    const otherMember = await authService.createGuestSession("Other");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, requester.id);
    await roomService.joinRoom(snapshot.room.id, otherMember.id);

    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track Two",
      artist: "Local Upload",
      album: null,
      durationMs: 90000,
      bitrate: null,
      fileHash: "def456",
      artworkUrl: null,
      sourceType: "local_upload"
    });

    const queueItem = await roomService.addQueueItem(snapshot.room.id, requester.id, track.id);

    await expect(
      roomService.removeQueueItem(snapshot.room.id, queueItem.id, otherMember.id)
    ).rejects.toThrow("Only the host or the requester can remove this queue item.");

    await expect(
      roomService.removeQueueItem(snapshot.room.id, queueItem.id, requester.id)
    ).resolves.toEqual([]);
  });

  it("promotes the next member to host when the host leaves", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    const roomAfterLeave = await roomService.leaveRoom(snapshot.room.id, host.id);

    expect(roomAfterLeave.hostId).toBe(member.id);
    expect(roomAfterLeave.members).toHaveLength(1);
    expect(roomAfterLeave.members[0]).toMatchObject({
      id: member.id,
      role: "host"
    });
  });

  it("imports a playlist back into the room queue when tracks exist in the room", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const member = await authService.createGuestSession("Member");
    const snapshot = await roomService.createRoom(host.id);

    await roomService.joinRoom(snapshot.room.id, member.id);
    const track = await roomService.registerTrack(snapshot.room.id, host.id, {
      title: "Track Three",
      artist: "Local Upload",
      album: null,
      durationMs: 180000,
      bitrate: null,
      fileHash: "ghi789",
      artworkUrl: null,
      sourceType: "local_upload"
    });

    const queue = await roomService.importPlaylistToQueue(snapshot.room.id, member.id, [track.id]);

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      trackId: track.id,
      requestedById: member.id
    });
  });

  it("restores the recent active room for a session from redis", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);

    const restored = await roomService.getRecentRoomSnapshotForSession(host.id);

    expect(restored).not.toBeNull();
    expect(restored?.room.id).toBe(snapshot.room.id);
    expect(redis.setString).toHaveBeenCalled();
  });

  it("creates a six-character uppercase join code", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);
    const host = await authService.createGuestSession("Host");

    const snapshot = await roomService.createRoom(host.id);

    expect(snapshot.room.joinCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("lists rooms from the redis registry when memory state is empty", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const snapshot = await roomService.createRoom(host.id);
    const restoredService = new RoomService(authService, prisma as never, redis as never);

    const rooms = await restoredService.listRoomsForSession(host.id);

    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.room.id).toBe(snapshot.room.id);
    expect(redis.addToSet).toHaveBeenCalled();
  });

  it("only recovers a room for members of that room", async () => {
    const prisma = createPrismaMock();
    const redis = createRedisMock();
    const authService = new AuthService(prisma as never);
    const roomService = new RoomService(authService, prisma as never, redis as never);

    const host = await authService.createGuestSession("Host");
    const outsider = await authService.createGuestSession("Outsider");
    const snapshot = await roomService.createRoom(host.id);

    await expect(
      roomService.getRecoverableRoomSnapshot(snapshot.room.id, outsider.id)
    ).resolves.toBeNull();
    await expect(
      roomService.getRecoverableRoomSnapshot(snapshot.room.id, host.id)
    ).resolves.toMatchObject({
      room: { id: snapshot.room.id }
    });
  });
});
