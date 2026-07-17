import { HttpException } from "@nestjs/common";
import { errorCodes } from "@music-room/shared";
import { MetingService } from "./meting.service";

describe("MetingService", () => {
  const previousMaxImportBytes = process.env.METING_MAX_IMPORT_BYTES;
  const previousFlags = {
    qqmusic: process.env.QQMUSIC_ENABLED,
    kugou: process.env.KUGOU_ENABLED,
    kuwo: process.env.KUWO_ENABLED,
    baidu: process.env.BAIDU_ENABLED,
    taihe: process.env.TAIHE_ENABLED,
    migu: process.env.MIGU_ENABLED
  };

  afterEach(() => {
    for (const [provider, value] of Object.entries(previousFlags)) {
      const key = `${provider === "qqmusic" ? "QQMUSIC" : provider.toUpperCase()}_ENABLED`;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousMaxImportBytes === undefined) delete process.env.METING_MAX_IMPORT_BYTES;
    else process.env.METING_MAX_IMPORT_BYTES = previousMaxImportBytes;
    jest.restoreAllMocks();
  });

  it("rejects disabled providers with a stable error", async () => {
    process.env.QQMUSIC_ENABLED = "false";
    const service = new MetingService({} as never, { isAvailable: () => false } as never);

    await expect(service.searchTracks("qqmusic", "user_1", {
      keywords: "test",
      limit: 20,
      offset: 0
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: errorCodes.metingDisabled })
    });
  });

  it("normalizes formatted Meting search records", async () => {
    process.env.KUGOU_ENABLED = "true";
    const api = {
      searchTracks: jest.fn().mockResolvedValue([
        {
          id: "abc123",
          name: "Test Song",
          artist: ["Artist A", "Artist B"],
          album: "Album",
          interval: 180
        }
      ])
    };
    const service = new MetingService(api as never, { isAvailable: () => false } as never);

    await expect(service.searchTracks("kugou", "user_1", {
      keywords: "test",
      limit: 20,
      offset: 0
    })).resolves.toEqual({
      items: [{
        provider: "kugou",
        providerTrackId: "abc123",
        access: "unknown",
        quality: null,
        title: "Test Song",
        artist: "Artist A / Artist B",
        album: "Album",
        durationMs: 180000,
        artworkUrl: null
      }],
      limit: 20,
      offset: 0
    });
  });

  it("normalizes live QQ, Qianqian, and Migu field names", async () => {
    const api = {
      searchTracks: jest.fn()
    };
    const service = new MetingService(api as never, { isAvailable: () => false } as never);

    process.env.QQMUSIC_ENABLED = "true";
    api.searchTracks.mockResolvedValueOnce([{
      songmid: "003abc",
      songname: "QQ歌曲",
      albumname: "QQ专辑",
      albummid: "003album",
      singer: [{ name: "QQ歌手" }],
      interval: 200,
      size128: 100,
      pay: { payplay: 0 }
    }]);
    await expect(service.searchTracks("qqmusic", "qq-user", {
      keywords: "QQ歌曲",
      limit: 20,
      offset: 0
    })).resolves.toMatchObject({
      items: [{
        providerTrackId: "003abc",
        title: "QQ歌曲",
        artist: "QQ歌手",
        album: "QQ专辑",
        access: "free",
        quality: "standard"
      }]
    });

    process.env.TAIHE_ENABLED = "true";
    api.searchTracks.mockResolvedValueOnce([{
      id: "T123",
      title: "千千歌曲",
      albumTitle: "千千专辑",
      artist: [{ name: "千千歌手" }],
      duration: 180
    }]);
    await expect(service.searchTracks("taihe", "taihe-user", {
      keywords: "千千歌曲",
      limit: 20,
      offset: 0
    })).resolves.toMatchObject({
      items: [{
        providerTrackId: "T123",
        title: "千千歌曲",
        artist: "千千歌手",
        album: "千千专辑"
      }]
    });

    process.env.MIGU_ENABLED = "true";
    api.searchTracks.mockResolvedValueOnce([{
      _providerTrackId: "C123__M123",
      songName: "咪咕歌曲",
      album: "咪咕专辑",
      singerList: [{ name: "咪咕歌手" }],
      duration: 210
    }]);
    await expect(service.searchTracks("migu", "migu-user", {
      keywords: "咪咕歌曲",
      limit: 20,
      offset: 0
    })).resolves.toMatchObject({
      items: [{
        providerTrackId: "C123__M123",
        title: "咪咕歌曲",
        artist: "咪咕歌手",
        album: "咪咕专辑"
      }]
    });
  });

  it("streams allowed MP3 audio and rejects untrusted hosts", async () => {
    process.env.KUWO_ENABLED = "true";
    const api = {
      getAudioUrl: jest.fn().mockResolvedValue({ url: "https://kwcdn.kuwo.cn/song.mp3" })
    };
    const service = new MetingService(api as never, { isAvailable: () => false } as never);
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { "content-type": "audio/mpeg", "content-length": "2" }
      })
    );

    await expect(service.openAudio("kuwo", "user_1", "123", "high"))
      .resolves.toMatchObject({ mimeType: "audio/mpeg", fileType: "mp3" });

    api.getAudioUrl.mockResolvedValue({ url: "https://example.com/song.mp3" });
    await expect(service.openAudio("kuwo", "user_2", "123", "high"))
      .rejects.toMatchObject({
        response: expect.objectContaining({ code: errorCodes.metingUnavailable })
      });
  });

  it("maps oversized upstream content to the import size error", async () => {
    process.env.BAIDU_ENABLED = "true";
    process.env.METING_MAX_IMPORT_BYTES = "1";
    const api = {
      getAudioUrl: jest.fn().mockResolvedValue({ url: "https://audio.taihe.com/song.mp3" })
    };
    const service = new MetingService(api as never, { isAvailable: () => false } as never);
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { "content-type": "audio/mpeg", "content-length": "2" }
      })
    );

    try {
      await service.openAudio("baidu", "user_1", "123", "standard");
      throw new Error("Expected oversized audio to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: errorCodes.metingImportTooLarge
      });
    }
  });
});
