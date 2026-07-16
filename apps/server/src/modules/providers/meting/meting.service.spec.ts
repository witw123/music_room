import { HttpException } from "@nestjs/common";
import { errorCodes } from "@music-room/shared";
import { MetingService } from "./meting.service";

describe("MetingService", () => {
  const previousMaxImportBytes = process.env.METING_MAX_IMPORT_BYTES;
  const previousFlags = {
    qqmusic: process.env.QQMUSIC_ENABLED,
    kugou: process.env.KUGOU_ENABLED,
    kuwo: process.env.KUWO_ENABLED,
    baidu: process.env.BAIDU_ENABLED
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
