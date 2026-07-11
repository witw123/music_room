import { PlaylistService } from "./playlist.service";

function createPrismaMock() {
  return {
    isAvailable: jest.fn(() => false),
    playlist: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn()
    }
  };
}

describe("PlaylistService", () => {
  it("returns an empty list when ownerId is missing", async () => {
    const prisma = createPrismaMock();
    const roomService = {
      getTracks: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([])
    };
    const service = new PlaylistService(roomService as never, prisma as never);

    await expect(service.listPlaylists()).resolves.toEqual([]);
  });

  it("only allows the owner to fetch a playlist by id", async () => {
    const prisma = createPrismaMock();
    const roomService = {
      getTracks: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([])
    };
    const service = new PlaylistService(roomService as never, prisma as never);
    const playlist = await service.createPlaylist({
      ownerId: "guest_owner",
      title: "Tonight",
      trackIds: ["track_1"]
    });

    await expect(
      service.getPlaylistForOwner(playlist.id, "guest_other")
    ).rejects.toThrow("Only the playlist owner can access this playlist.");

    await expect(
      service.getPlaylistForOwner(playlist.id, "guest_owner")
    ).resolves.toMatchObject({
      id: playlist.id
    });
  });

  it("sanitizes persisted playlist JSON arrays before returning them", async () => {
    const prisma = createPrismaMock();
    prisma.isAvailable.mockReturnValue(true);
    prisma.playlist.findMany.mockResolvedValue([
      {
        id: "playlist_1",
        ownerId: "guest_owner",
        roomId: "room_1",
        title: "Persisted",
        description: null,
        coverUrl: null,
        tags: "bad-tags",
        isCollaborative: false,
        trackIds: ["track_1", 123, "", "track_2"],
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-01T00:00:01.000Z")
      }
    ]);
    const roomService = {
      getTracks: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([])
    };
    const service = new PlaylistService(roomService as never, prisma as never);

    await expect(service.listPlaylists()).resolves.toEqual([
      expect.objectContaining({
        tags: [],
        trackIds: ["track_1", "track_2"]
      })
    ]);
  });

  it("checks room membership before copying a room queue", async () => {
    const prisma = createPrismaMock();
    const roomService = {
      getAccessibleQueue: jest.fn().mockRejectedValue(new Error("Only room members can perform this action."))
    };
    const service = new PlaylistService(roomService as never, prisma as never);

    await expect(service.createPlaylistFromRoom({
      ownerId: "guest_outsider",
      roomId: "room_private",
      title: "Stolen queue"
    })).rejects.toThrow("Only room members can perform this action.");
  });

  it("only exposes playlists explicitly associated with the room", async () => {
    const prisma = createPrismaMock();
    const service = new PlaylistService({} as never, prisma as never);
    await service.createPlaylist({ ownerId: "owner_1", roomId: "room_1", title: "Shared", trackIds: ["track_1"] });
    await service.createPlaylist({ ownerId: "owner_2", title: "Private", trackIds: ["track_1"] });

    await expect(service.listPlaylistsForRoom("room_1")).resolves.toEqual([
      expect.objectContaining({ title: "Shared" })
    ]);
  });
});
