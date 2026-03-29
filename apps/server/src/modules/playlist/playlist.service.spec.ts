import { PlaylistService } from "./playlist.service";

function createPrismaMock() {
  return {
    isAvailable: jest.fn(() => false),
    playlists: {
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
});
