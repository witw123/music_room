import { TrackAvailabilityRegistry } from "./track-availability.registry";

function createRedisServiceMock() {
  return {
    setJson: jest.fn(),
    getJson: jest.fn().mockResolvedValue(null),
    delete: jest.fn()
  };
}

describe("TrackAvailabilityRegistry", () => {
  it("merges compatible partial announcements so persisted room availability never regresses", () => {
    const registry = new TrackAvailabilityRegistry(createRedisServiceMock() as never);

    registry.setAnnouncement("room_1", {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_listener",
      nickname: "Listener",
      assetKind: "relay",
      assetHash: "hash_1",
      totalChunks: 8,
      chunkSize: 128 * 1024,
      availableChunks: [0, 1, 2, 3],
      source: "local_cache",
      announcedAt: "2026-06-29T10:00:00.000Z"
    });
    const merged = registry.setAnnouncement("room_1", {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_listener",
      nickname: "Listener",
      assetKind: "relay",
      assetHash: "hash_1",
      totalChunks: 8,
      chunkSize: 128 * 1024,
      availableChunks: [4],
      source: "local_cache",
      announcedAt: "2026-06-29T10:00:01.000Z"
    });

    expect(merged.availableChunks).toEqual([0, 1, 2, 3, 4]);
    expect(registry.getTrackAnnouncements("room_1", "track_1")[0]).toMatchObject({
      availableChunks: [0, 1, 2, 3, 4],
      announcedAt: "2026-06-29T10:00:01.000Z"
    });
  });

  it("replaces incompatible geometry instead of merging stale chunk indexes", () => {
    const registry = new TrackAvailabilityRegistry(createRedisServiceMock() as never);

    registry.setAnnouncement("room_1", {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_listener",
      nickname: "Listener",
      assetKind: "relay",
      assetHash: "hash_old",
      totalChunks: 8,
      chunkSize: 128 * 1024,
      availableChunks: [0, 1, 2, 3],
      source: "local_cache",
      announcedAt: "2026-06-29T10:00:00.000Z"
    });
    registry.setAnnouncement("room_1", {
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_listener",
      nickname: "Listener",
      assetKind: "relay",
      assetHash: "hash_new",
      totalChunks: 16,
      chunkSize: 64 * 1024,
      availableChunks: [4],
      source: "local_cache",
      announcedAt: "2026-06-29T10:00:01.000Z"
    });

    expect(registry.getTrackAnnouncements("room_1", "track_1")[0]).toMatchObject({
      availableChunks: [4],
      totalChunks: 16,
      chunkSize: 64 * 1024
    });
  });

  it("emits merged announcements while replaying duplicate persisted snapshots", async () => {
    const redis = createRedisServiceMock();
    redis.getJson.mockResolvedValue([
      {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_listener",
        nickname: "Listener",
        assetKind: "relay",
        assetHash: "hash_1",
        totalChunks: 8,
        chunkSize: 128 * 1024,
        availableChunks: [0, 1, 2, 3],
        source: "local_cache",
        announcedAt: "2026-06-29T10:00:00.000Z"
      },
      {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_listener",
        nickname: "Listener",
        assetKind: "relay",
        assetHash: "hash_1",
        totalChunks: 8,
        chunkSize: 128 * 1024,
        availableChunks: [4],
        source: "local_cache",
        announcedAt: "2026-06-29T10:00:01.000Z"
      }
    ]);
    const registry = new TrackAvailabilityRegistry(redis as never);
    const emit = jest.fn();

    await registry.emitSnapshot("room_1", emit);

    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        availableChunks: [0, 1, 2, 3, 4]
      })
    );
  });

  it("skips invalid persisted availability snapshots when replaying to subscribers", async () => {
    const redis = createRedisServiceMock();
    redis.getJson.mockResolvedValue([
      {
        roomId: "room_1",
        trackId: "track_bad",
        ownerPeerId: "peer_bad",
        nickname: "Bad",
        totalChunks: 8,
        chunkSize: 0,
        availableChunks: [0],
        source: "local_cache",
        announcedAt: "2026-06-29T10:00:00.000Z"
      },
      {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_listener",
        nickname: "Listener",
        totalChunks: 8,
        chunkSize: 128 * 1024,
        availableChunks: [0, 1],
        source: "local_cache",
        announcedAt: "2026-06-29T10:00:01.000Z"
      }
    ]);
    const registry = new TrackAvailabilityRegistry(redis as never);
    const emit = jest.fn();

    await registry.emitSnapshot("room_1", emit);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: "track_1",
        chunkSize: 128 * 1024
      })
    );
    expect(registry.getTrackAnnouncements("room_1", "track_bad")).toEqual([]);
  });
});
