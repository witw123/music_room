import { ListeningProfileService } from "./listening-profile.service";

describe("ListeningProfileService", () => {
  it("builds a permanent profile from persisted track aggregates and playback events", async () => {
    const prisma = {
      isAvailable: jest.fn().mockReturnValue(true),
      userListeningTrack: {
        findMany: jest.fn().mockResolvedValue([
          {
            candidateKey: "netease:1",
            provider: "netease",
            providerTrackId: "1",
            title: "夜航",
            artist: "歌手 A",
            album: "专辑 A",
            durationMs: 240_000,
            artworkUrl: null,
            playCount: 5,
            listenedMs: 900_000n,
            completionCount: 4,
            quickSkipCount: 0,
            isFavorite: true,
            firstPlayedAt: new Date("2026-08-01T00:00:00.000Z"),
            lastPlayedAt: new Date("2026-08-15T15:00:00.000Z")
          },
          {
            candidateKey: "qqmusic:2",
            provider: "qqmusic",
            providerTrackId: "2",
            title: "晨光",
            artist: "歌手 B",
            album: null,
            durationMs: 200_000,
            artworkUrl: null,
            playCount: 2,
            listenedMs: 300_000n,
            completionCount: 1,
            quickSkipCount: 1,
            isFavorite: false,
            firstPlayedAt: new Date("2026-08-02T00:00:00.000Z"),
            lastPlayedAt: new Date("2026-08-16T00:00:00.000Z")
          }
        ])
      },
      userListeningEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            candidateKey: "qqmusic:2",
            provider: "qqmusic",
            providerTrackId: "2",
            title: "晨光",
            artist: "歌手 B",
            album: null,
            durationMs: 200_000,
            listenedMs: 120_000n,
            timezoneOffsetMinutes: -480,
            occurredAt: new Date("2026-08-16T00:00:00.000Z")
          },
          {
            candidateKey: "netease:1",
            provider: "netease",
            providerTrackId: "1",
            title: "夜航",
            artist: "歌手 A",
            album: "专辑 A",
            durationMs: 240_000,
            listenedMs: 240_000n,
            timezoneOffsetMinutes: -480,
            occurredAt: new Date("2026-08-15T15:00:00.000Z")
          }
        ])
      },
      listeningTrackMetadata: {
        findMany: jest.fn().mockResolvedValue([
          {
            trackKey: "netease:1",
            tags: [
              { name: "pop", weight: 100 },
              { name: "dance", weight: 80 },
              { name: "love", weight: 60 }
            ]
          }
        ])
      },
      $transaction: jest.fn()
    };
    const service = new ListeningProfileService(prisma as never, {} as never);

    const profile = await service.getProfile("user_1");

    expect(profile.totalListenedMs).toBe(1_200_000);
    expect(profile.totalPlayCount).toBe(7);
    expect(profile.trackCount).toBe(2);
    expect(profile.artistCount).toBe(2);
    expect(profile.topPlayedTracks[0]).toMatchObject({ key: "netease:1" });
    expect(profile.favoriteTracks[0]).toMatchObject({ key: "netease:1", isFavorite: true });
    expect(profile.topArtists[0]).toMatchObject({ name: "歌手 A" });
    expect(profile.tasteTags).toEqual(expect.arrayContaining(["流行", "电子", "浪漫"]));
    expect(profile.timeBands.find((band) => band.id === "morning")?.listenedMs).toBe(120_000);
    expect(profile.timeBands.find((band) => band.id === "late-night")?.listenedMs).toBe(240_000);
  });

  it("clears only the current user's listening events and aggregates", async () => {
    const prisma = {
      isAvailable: jest.fn().mockReturnValue(true),
      userListeningEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      userListeningTrack: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn().mockResolvedValue([])
    };
    const service = new ListeningProfileService(prisma as never, {} as never);

    await expect(service.clearProfile("user_1")).resolves.toEqual({ ok: true });
    expect(prisma.userListeningEvent.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(prisma.userListeningTrack.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
  });

  it("builds discover seeds and recently heard exclusions from the full profile", async () => {
    const prisma = {
      isAvailable: jest.fn().mockReturnValue(true),
      userListeningTrack: {
        findMany: jest.fn().mockResolvedValue([
          {
            candidateKey: "netease:favorite",
            provider: "netease",
            providerTrackId: "favorite",
            title: "收藏的歌",
            artist: "歌手 A",
            album: null,
            durationMs: 180_000,
            artworkUrl: null,
            playCount: 3,
            listenedMs: 400_000n,
            completionCount: 2,
            quickSkipCount: 0,
            isFavorite: true,
            lastPlayedAt: new Date("2026-08-17T09:00:00.000Z")
          },
          {
            candidateKey: "qqmusic:recent",
            provider: "qqmusic",
            providerTrackId: "recent",
            title: "最近的歌",
            artist: "歌手 B",
            album: null,
            durationMs: 200_000,
            artworkUrl: null,
            playCount: 1,
            listenedMs: 120_000n,
            completionCount: 0,
            quickSkipCount: 0,
            isFavorite: false,
            lastPlayedAt: new Date("2026-08-17T10:00:00.000Z")
          },
          {
            candidateKey: "local_upload:local",
            provider: "local_upload",
            providerTrackId: "local",
            title: "本地歌曲",
            artist: "歌手 C",
            album: null,
            durationMs: 180_000,
            artworkUrl: null,
            playCount: 5,
            listenedMs: 900_000n,
            completionCount: 5,
            quickSkipCount: 0,
            isFavorite: false,
            lastPlayedAt: new Date("2026-08-17T11:00:00.000Z")
          }
        ])
      },
      listeningTrackMetadata: {
        findMany: jest.fn().mockResolvedValue([
          { trackKey: "netease:favorite", tags: [{ name: "pop", weight: 100 }] }
        ])
      }
    };
    const service = new ListeningProfileService(prisma as never, {} as never);

    const context = await service.getDiscoverContext("user_1");

    expect(context.seedTracks.map((track) => track.key)).toEqual(["netease:favorite", "qqmusic:recent"]);
    expect(context.excludedTrackKeys).toEqual([
      "local_upload:local",
      "qqmusic:recent",
      "netease:favorite"
    ]);
    expect(context.topArtists.map((artist) => artist.name)).toEqual(expect.arrayContaining(["歌手 A", "歌手 B", "歌手 C"]));
    expect(context.tasteTags).toEqual(["流行"]);
  });

  it("retries deferred metadata after an upstream recovery", async () => {
    const prisma = {
      isAvailable: jest.fn().mockReturnValue(true),
      listeningTrackMetadata: {
        findUnique: jest.fn().mockResolvedValue({ status: "deferred" }),
        upsert: jest.fn().mockResolvedValue({
          trackKey: "netease:provider_track",
          provider: "netease",
          providerTrackId: "provider_track",
          title: "平台歌曲",
          artist: "歌手",
          album: "专辑",
          tags: [{ name: "pop", weight: 100 }],
          status: "resolved",
          createdAt: new Date("2026-08-16T00:00:00.000Z"),
          updatedAt: new Date("2026-08-16T00:00:00.000Z")
        })
      }
    };
    const recommendations = {
      getLastFmTrackTags: jest.fn().mockResolvedValue([{ name: "pop", weight: 100 }])
    };
    const service = new ListeningProfileService(prisma as never, recommendations as never);

    await expect(service.resolveTrackMetadata("user_1", {
      track: {
        key: "netease:provider_track",
        provider: "netease",
        providerTrackId: "provider_track",
        title: "平台歌曲",
        artist: "歌手",
        album: "专辑",
        durationMs: 180_000,
        artworkUrl: null
      }
    })).resolves.toMatchObject({ status: "resolved", tags: [{ name: "pop" }] });
    expect(recommendations.getLastFmTrackTags).toHaveBeenCalledTimes(1);
  });

  it("resolves metadata from a provider track without requiring local audio", async () => {
    const prisma = {
      isAvailable: jest.fn().mockReturnValue(true),
      listeningTrackMetadata: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          trackKey: "netease:provider_track",
          provider: "netease",
          providerTrackId: "provider_track",
          title: "平台歌曲",
          artist: "歌手",
          album: "专辑",
          tags: [{ name: "pop", weight: 100 }],
          status: "resolved",
          createdAt: new Date("2026-08-16T00:00:00.000Z"),
          updatedAt: new Date("2026-08-16T00:00:00.000Z")
        })
      }
    };
    const recommendations = {
      getLastFmTrackTags: jest.fn().mockResolvedValue([{ name: "pop", weight: 100 }])
    };
    const service = new ListeningProfileService(prisma as never, recommendations as never);

    await expect(service.resolveTrackMetadata("user_1", {
      track: {
        key: "netease:provider_track",
        provider: "netease",
        providerTrackId: "provider_track",
        title: "平台歌曲",
        artist: "歌手",
        album: "专辑",
        durationMs: 180_000,
        artworkUrl: null
      }
    })).resolves.toMatchObject({ status: "resolved", tags: [{ name: "pop" }] });
    expect(recommendations.getLastFmTrackTags).toHaveBeenCalledWith("user_1", {
      artist: "歌手",
      track: "平台歌曲",
      limit: 1
    });
  });
});
