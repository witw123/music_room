import { TrackAvailabilityRegistry } from "./track-availability.registry";

function createRedisServiceMock() {
  return {
    setJson: jest.fn(),
    getJson: jest.fn().mockResolvedValue(null),
    delete: jest.fn()
  };
}

function createAssetAvailability(input?: {
  peerId?: string;
  assetId?: string;
  ranges?: Array<{ start: number; end: number }>;
  announcedAt?: string;
}) {
  const ranges = input?.ranges ?? [{ start: 0, end: 0 }];
  return {
    protocolVersion: 4 as const,
    roomId: "room_1",
    assetId: input?.assetId ?? "a".repeat(64),
    assetKind: "playback" as const,
    ownerPeerId: input?.peerId ?? "peer_owner",
    nickname: "Owner",
    totalUnits: 4,
    availableRanges: ranges,
    complete: ranges.length === 1 && ranges[0]?.start === 0 && ranges[0]?.end === 3,
    source: "local_cache" as const,
    announcedAt: input?.announcedAt ?? "2026-07-13T00:00:00.000Z"
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

  it("only reports playback providers that are currently online when presence is supplied", async () => {
    const registry = new TrackAvailabilityRegistry(createRedisServiceMock() as never);
    registry.setAssetAnnouncement("room_1", {
      protocolVersion: 4,
      roomId: "room_1",
      assetId: "a".repeat(64),
      assetKind: "playback",
      ownerPeerId: "peer_offline",
      nickname: "Offline",
      totalUnits: 1,
      availableRanges: [{ start: 0, end: 0 }],
      complete: true,
      source: "local_cache",
      announcedAt: "2026-07-13T00:00:00.000Z"
    });

    await expect(
      registry.hasPlaybackProvider("room_1", "a".repeat(64), new Set())
    ).resolves.toBe(false);
    expect(
      await registry.hasPlaybackProvider(
        "room_1",
        "a".repeat(64),
        new Set(["peer_offline"])
      )
    ).toBe(true);
  });

  it("hydrates persisted playback providers before making a playability decision", async () => {
    const redis = createRedisServiceMock();
    redis.getJson.mockResolvedValue([createAssetAvailability({ peerId: "peer_remote" })]);
    const registry = new TrackAvailabilityRegistry(redis as never);

    await expect(
      registry.hasPlaybackProvider(
        "room_1",
        "a".repeat(64),
        new Set(["peer_remote"])
      )
    ).resolves.toBe(true);
    expect(registry.getAssetAnnouncements("room_1", "a".repeat(64))).toHaveLength(1);
  });

  it("debounces growing asset snapshots into one Redis write", async () => {
    jest.useFakeTimers();
    try {
      const redis = createRedisServiceMock();
      const registry = new TrackAvailabilityRegistry(redis as never);
      registry.setAssetAnnouncement(
        "room_1",
        createAssetAvailability({ ranges: [{ start: 0, end: 0 }] })
      );
      registry.setAssetAnnouncement(
        "room_1",
        createAssetAvailability({
          ranges: [{ start: 1, end: 1 }],
          announcedAt: "2026-07-13T00:00:01.000Z"
        })
      );

      expect(redis.setJson).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(500);

      expect(redis.setJson).toHaveBeenCalledTimes(1);
      expect(redis.setJson).toHaveBeenCalledWith(
        "music-room:asset-availability:v4:room_1",
        [expect.objectContaining({ availableRanges: [{ start: 0, end: 1 }] })],
        15 * 60
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("removes a persisted asset provider even when local memory is empty", async () => {
    const redis = createRedisServiceMock();
    const removed = createAssetAvailability({ peerId: "peer_departed" });
    const retained = createAssetAvailability({ peerId: "peer_active" });
    redis.getJson.mockResolvedValue([removed, retained]);
    const registry = new TrackAvailabilityRegistry(redis as never);

    expect(registry.removeAssetPeer("room_1", "peer_departed")).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(redis.setJson).toHaveBeenCalledWith(
      "music-room:asset-availability:v4:room_1",
      [retained],
      15 * 60
    );
  });
});
