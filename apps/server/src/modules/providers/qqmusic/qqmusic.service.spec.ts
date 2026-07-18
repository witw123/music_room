import { fetchProviderUrl } from "../provider-fetch";
import { QqMusicService } from "./qqmusic.service";

jest.mock("../provider-fetch", () => ({
  fetchProviderUrl: jest.fn()
}));

const mockedFetchProviderUrl = fetchProviderUrl as jest.MockedFunction<typeof fetchProviderUrl>;

describe("QqMusicService", () => {
  const previousEnabled = process.env.QQMUSIC_ENABLED;

  afterEach(() => {
    mockedFetchProviderUrl.mockReset();
    if (previousEnabled === undefined) delete process.env.QQMUSIC_ENABLED;
    else process.env.QQMUSIC_ENABLED = previousEnabled;
  });

  it("upgrades QQ Music CDN HTTP links before the HTTPS-only provider fetch", async () => {
    process.env.QQMUSIC_ENABLED = "true";
    const api = {
      getAudioUrl: jest.fn().mockResolvedValue({
        url: "http://dl.stream.qqmusic.qq.com/song.mp3"
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
    const service = new QqMusicService(api as never, accounts as never, {} as never);

    await expect(service.openAudio("user_1", "song-mid", "exhigh")).resolves.toMatchObject({
      mimeType: "audio/mpeg",
      fileType: "mp3",
      contentLength: 3
    });
    expect(mockedFetchProviderUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "https:",
        hostname: "dl.stream.qqmusic.qq.com",
        pathname: "/song.mp3"
      }),
      expect.anything(),
      expect.any(Number),
      expect.any(Function),
      { allowSyntheticDns: true }
    );
  });

  it("falls back from lossless to available MP3 quality", async () => {
    process.env.QQMUSIC_ENABLED = "true";
    const api = {
      getAudioUrl: jest.fn()
        .mockResolvedValueOnce({ url: null })
        .mockResolvedValueOnce({ url: "https://dl.stream.qqmusic.qq.com/song.mp3" })
    };
    const accounts = {
      getCookieOrThrow: jest.fn().mockResolvedValue("cookie")
    };
    mockedFetchProviderUrl.mockResolvedValue(
      new Response(Uint8Array.of(1), {
        status: 200,
        headers: { "content-type": "audio/mpeg", "content-length": "1" }
      })
    );
    const service = new QqMusicService(api as never, accounts as never, {} as never);

    await expect(service.openAudio("user_1", "song-mid", "exhigh")).resolves.toMatchObject({
      mimeType: "audio/mpeg"
    });
    expect(api.getAudioUrl.mock.calls.map(([input]) => input.quality)).toEqual(["exhigh", "high"]);
  });
});
