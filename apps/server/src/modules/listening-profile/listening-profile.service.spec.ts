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
      listeningAudioFeature: {
        findMany: jest.fn().mockResolvedValue([
          {
            trackKey: "netease:1",
            features: {
              danceability: 0.74,
              energy: 0.79,
              valence: 0.68,
              acousticness: 0.1,
              instrumentalness: 0.02,
              speechiness: 0.08,
              liveness: 0.15,
              tempo: 126
            }
          }
        ])
      }
    };
    const service = new ListeningProfileService(prisma as never);

    const profile = await service.getProfile("user_1");

    expect(profile.totalListenedMs).toBe(1_200_000);
    expect(profile.totalPlayCount).toBe(7);
    expect(profile.trackCount).toBe(2);
    expect(profile.artistCount).toBe(2);
    expect(profile.topPlayedTracks[0]).toMatchObject({ key: "netease:1" });
    expect(profile.favoriteTracks[0]).toMatchObject({ key: "netease:1", isFavorite: true });
    expect(profile.topArtists[0]).toMatchObject({ name: "歌手 A" });
    expect(profile.tasteTags).toEqual(expect.arrayContaining(["高能量", "律动感", "明朗"]));
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
    const service = new ListeningProfileService(prisma as never);

    await expect(service.clearProfile("user_1")).resolves.toEqual({ ok: true });
    expect(prisma.userListeningEvent.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(prisma.userListeningTrack.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
  });
});
