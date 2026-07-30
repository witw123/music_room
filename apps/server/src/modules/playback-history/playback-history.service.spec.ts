import { PlaybackHistoryService } from "./playback-history.service";

describe("PlaybackHistoryService", () => {
  it("aggregates tracks across days and returns the five longest listening durations", async () => {
    const records = Array.from({ length: 6 }, (_, index) => ({
      provider: "netease",
      providerTrackId: `track_${index + 1}`,
      title: `歌曲 ${index + 1}`,
      artist: "歌手",
      album: "专辑",
      durationMs: 240_000,
      listenedMs: (index + 1) * 60_000,
      lastPlayedAt: new Date(`2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`)
    }));
    records.push({
      ...records[0],
      title: "歌曲 1（新标题）",
      listenedMs: 5 * 60_000,
      lastPlayedAt: new Date("2026-07-30T12:00:00.000Z")
    });
    const prisma = {
      isAvailable: jest.fn().mockReturnValue(true),
      userPlaybackDaily: {
        findMany: jest.fn().mockResolvedValue(records)
      }
    };
    const service = new PlaybackHistoryService(prisma as never);

    const stats = await service.getStats("user_1");

    expect(stats.topTracks).toHaveLength(5);
    expect(stats.topTracks[0]).toMatchObject({
      providerTrackId: "track_1",
      title: "歌曲 1（新标题）",
      listenedMs: 6 * 60_000
    });
    expect(stats.topTracks.map((track) => track.providerTrackId)).toEqual([
      "track_1",
      "track_6",
      "track_5",
      "track_4",
      "track_3"
    ]);
  });
});
