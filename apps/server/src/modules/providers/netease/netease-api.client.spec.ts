import {
  login_qr_check,
  login_qr_create,
  login_qr_key,
  login_status,
  search,
  song_detail,
  song_url
} from "@neteasecloudmusicapienhanced/api";
import { NeteaseApiClient } from "./netease-api.client";

jest.mock("@neteasecloudmusicapienhanced/api", () => ({
  login_qr_check: jest.fn(),
  login_qr_create: jest.fn(),
  login_qr_key: jest.fn(),
  login_status: jest.fn(),
  search: jest.fn(),
  song_detail: jest.fn(),
  song_url: jest.fn()
}));

const mockedLoginQrCheck = login_qr_check as jest.MockedFunction<typeof login_qr_check>;
const mockedLoginQrCreate = login_qr_create as jest.MockedFunction<typeof login_qr_create>;
const mockedLoginQrKey = login_qr_key as jest.MockedFunction<typeof login_qr_key>;
const mockedLoginStatus = login_status as jest.MockedFunction<typeof login_status>;
const mockedSearch = search as jest.MockedFunction<typeof search>;
const mockedSongDetail = song_detail as jest.MockedFunction<typeof song_detail>;
const mockedSongUrl = song_url as jest.MockedFunction<typeof song_url>;

describe("NeteaseApiClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("converts QR responses without exposing the provider envelope", async () => {
    mockedLoginQrKey.mockResolvedValue({
      status: 200,
      body: { code: 200, data: { unikey: "qr-key" }, cookie: "secret" },
      cookie: []
    } as never);
    mockedLoginQrCreate.mockResolvedValue({
      status: 200,
      body: { code: 200, data: { qrimg: "data:image/png;base64,qr" }, raw: "ignored" },
      cookie: []
    } as never);

    await expect(new NeteaseApiClient().createQrCode()).resolves.toEqual({
      key: "qr-key",
      qrimg: "data:image/png;base64,qr"
    });
  });

  it("keeps QR login pending when the provider returns an anonymous cookie", async () => {
    mockedLoginQrCheck.mockResolvedValue({
      status: 200,
      body: { code: 801 },
      cookie: ["NMTID=anonymous"]
    } as never);

    await expect(new NeteaseApiClient().checkQrCode("qr-key")).resolves.toEqual({
      status: "pending",
      cookie: null
    });
  });

  it("falls back to weapi when the default QR transport is unavailable", async () => {
    mockedLoginQrCheck
      .mockRejectedValueOnce(new Error("upstream timeout"))
      .mockResolvedValueOnce({
        status: 200,
        body: { code: 802 },
        cookie: []
      } as never);

    await expect(new NeteaseApiClient().checkQrCode("qr-key")).resolves.toEqual({
      status: "scanned",
      cookie: null
    });
    expect(mockedLoginQrCheck).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: "qr-key", timeout: expect.any(Number) })
    );
    expect(mockedLoginQrCheck).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ key: "qr-key", crypto: "weapi", timeout: expect.any(Number) })
    );
  });

  it("keeps polling when both QR transports are temporarily unavailable", async () => {
    mockedLoginQrCheck
      .mockRejectedValueOnce(new Error("eapi unavailable"))
      .mockRejectedValueOnce(new Error("weapi unavailable"));

    await expect(new NeteaseApiClient().checkQrCode("qr-key")).resolves.toEqual({
      status: "pending",
      cookie: null
    });
  });

  it("strips Set-Cookie attributes from a completed QR login", async () => {
    mockedLoginQrCheck.mockResolvedValue({
      status: 200,
      body: {
        code: 803,
        cookie: "MUSIC_U=music-u; Max-Age=315360000; Path=/; NMTID=nmtid; Path=/"
      },
      cookie: [
        "MUSIC_U=music-u; Max-Age=315360000; Path=/",
        "NMTID=nmtid; Path=/"
      ]
    } as never);

    await expect(new NeteaseApiClient().checkQrCode("qr-key")).resolves.toEqual({
      status: "connected",
      cookie: "MUSIC_U=music-u; NMTID=nmtid"
    });
  });

  it("maps provider auth expiry and rejects malformed search responses", async () => {
    mockedSearch.mockResolvedValue({
      status: 200,
      body: { code: 301 },
      cookie: []
    } as never);
    await expect(
      new NeteaseApiClient().searchTracks({
        keywords: "test",
        limit: 20,
        offset: 0,
        cookie: "secret"
      })
    ).rejects.toMatchObject({ kind: "auth-expired" });

    mockedSearch.mockResolvedValue({
      status: 200,
      body: { code: 200, result: { songs: [{ id: 1 }] } },
      cookie: []
    } as never);
    await expect(
      new NeteaseApiClient().searchTracks({
        keywords: "test",
        limit: 20,
        offset: 0,
        cookie: "secret"
      })
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("validates login profile, song detail, and audio URL shapes", async () => {
    mockedLoginStatus.mockResolvedValue({
      status: 200,
      body: { code: 200, data: { profile: { userId: 7, nickname: "User" } } },
      cookie: []
    } as never);
    mockedSongDetail.mockResolvedValue({
      status: 200,
      body: { code: 200, songs: [{ id: 7, name: "Song" }] },
      cookie: []
    } as never);
    mockedSongUrl.mockResolvedValue({
      status: 200,
      body: { code: 200, data: [{ url: "https://m10.music.126.net/song.mp3", type: "mp3" }] },
      cookie: []
    } as never);

    const client = new NeteaseApiClient();
    await expect(client.validateCookie("secret")).resolves.toMatchObject({
      neteaseUserId: "7",
      nickname: "User"
    });
    await expect(client.getTrack({ trackId: "7", cookie: "secret" })).resolves.toMatchObject({
      code: 200,
      songs: [{ id: 7, name: "Song" }]
    });
    await expect(client.getAudioUrl({ trackId: "7", bitrate: 320_000, cookie: "secret" }))
      .resolves.toMatchObject({
        code: 200,
        data: [{ type: "mp3" }]
      });
  });
});
