import { HttpException } from "@nestjs/common";
import type { NeteaseAccountStatus } from "@music-room/shared";
import { errorCodes } from "@music-room/shared";
import { fetchProviderUrl } from "../provider-fetch";
import { NeteaseApiError } from "./netease-api.client";
import { NeteaseService } from "./netease.service";

jest.mock("../provider-fetch", () => ({
  fetchProviderUrl: jest.fn()
}));

const mockedFetchProviderUrl = fetchProviderUrl as jest.MockedFunction<typeof fetchProviderUrl>;

describe("NeteaseService", () => {
  const previousEnabled = process.env.NETEASE_ENABLED;

  afterEach(() => {
    mockedFetchProviderUrl.mockReset();
    if (previousEnabled === undefined) delete process.env.NETEASE_ENABLED;
    else process.env.NETEASE_ENABLED = previousEnabled;
  });

  it("normalizes search results and requires a bound account", async () => {
    process.env.NETEASE_ENABLED = "true";
    const api = {
      searchTracks: jest.fn().mockResolvedValue({
        code: 200,
        result: {
          songs: [
            {
              id: 123,
              name: "Test Song",
              fee: 1,
              dt: 123000,
              artists: [{ name: "Artist A" }, { name: "Artist B" }],
              album: { name: "Album", picUrl: "https://example.com/cover.jpg" },
              h: { br: 320000 }
            }
          ]
        }
      }),
      getTracks: jest.fn().mockResolvedValue({ songs: [] })
    };
    const accounts = {
      getCookieOrThrow: jest.fn().mockResolvedValue("cookie"),
      getStatus: jest.fn().mockResolvedValue({
        connected: true,
        neteaseUserId: "1",
        nickname: "User",
        avatarUrl: null,
        lastValidatedAt: null
      } satisfies NeteaseAccountStatus)
    };
    const redis = {};
    const service = new NeteaseService(api as never, accounts as never, redis as never);

    await expect(
      service.searchTracks("user_1", { keywords: "test", limit: 20, offset: 0 })
    ).resolves.toEqual({
      items: [
        {
          provider: "netease",
          providerTrackId: "123",
          access: "vip",
          quality: "exhigh",
          title: "Test Song",
          artist: "Artist A / Artist B",
          album: "Album",
          durationMs: 123000,
          artworkUrl: "https://example.com/cover.jpg"
        }
      ],
      limit: 20,
      offset: 0
    });
    expect(api.searchTracks).toHaveBeenCalledWith({
      keywords: "test",
      limit: 20,
      offset: 0,
      cookie: "cookie"
    });
  });

  it("returns a stable disabled error when the feature is off", async () => {
    process.env.NETEASE_ENABLED = "false";
    const service = new NeteaseService({} as never, {} as never, {} as never);

    try {
      await service.getAccountStatus("user_1");
      throw new Error("Expected getAccountStatus to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse() as { code: string };
      expect(response.code).toBe(errorCodes.neteaseDisabled);
    }
  });

  it("limits QR login starts to three attempts per minute", async () => {
    process.env.NETEASE_ENABLED = "true";
    const api = {
      createQrCode: jest.fn().mockResolvedValue({
        key: "qr-key",
        qrimg: "data:image/png;base64,qr"
      })
    };
    const redis = {
      setJson: jest.fn().mockResolvedValue(undefined)
    };
    const service = new NeteaseService(api as never, {} as never, redis as never);

    await service.startQrLogin("user_1");
    await service.startQrLogin("user_1");
    await service.startQrLogin("user_1");

    await expect(service.startQrLogin("user_1")).rejects.toMatchObject({
      response: expect.objectContaining({ code: errorCodes.rateLimited })
    });
  });

  it("returns a recoverable QR failure when login validation is unavailable", async () => {
    process.env.NETEASE_ENABLED = "true";
    const api = {
      checkQrCode: jest.fn().mockResolvedValue({
        status: "connected",
        cookie: "MUSIC_U=music-u"
      }),
      validateCookie: jest.fn().mockRejectedValue(new NeteaseApiError("unavailable"))
    };
    const redis = {
      getJson: jest.fn().mockResolvedValue({ userId: "user_1", key: "qr-key" }),
      delete: jest.fn().mockResolvedValue(undefined)
    };
    const service = new NeteaseService(api as never, {} as never, redis as never);

    await expect(service.checkQrLogin("user_1", "attempt_1")).resolves.toEqual({
      status: "failed",
      message: "二维码已扫码，但网易云登录验证失败，请重新生成二维码。"
    });
    expect(redis.delete).toHaveBeenCalledWith("music-room:netease:qr:attempt_1");
  });

  it("upgrades NetEase CDN HTTP links before the HTTPS-only provider fetch", async () => {
    process.env.NETEASE_ENABLED = "true";
    const api = {
      getAudioUrl: jest.fn().mockResolvedValue({
        code: 200,
        data: [{
          url: "http://m10.music.126.net/song.mp3",
          type: "mp3"
        }]
      })
    };
    const accounts = {
      getCookieOrThrow: jest.fn().mockResolvedValue("cookie")
    };
    mockedFetchProviderUrl.mockResolvedValue(
      new Response(Uint8Array.of(1, 2, 3), {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "content-length": "3"
        }
      })
    );
    const service = new NeteaseService(api as never, accounts as never, {} as never);

    await expect(service.openAudio("user_1", "123", "exhigh")).resolves.toMatchObject({
      mimeType: "audio/mpeg",
      fileType: "mp3",
      contentLength: 3
    });
    expect(mockedFetchProviderUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "https:",
        hostname: "m10.music.126.net",
        pathname: "/song.mp3"
      }),
      expect.anything(),
      expect.any(Number),
      expect.any(Function),
      { allowSyntheticDns: true }
    );
  });
});
