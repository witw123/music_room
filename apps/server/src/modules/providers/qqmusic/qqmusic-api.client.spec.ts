import { checkQQLoginQr, getAlbumInfo, getAlbumSongs, getLyric, getQQLoginQr, getSearchByKey, getUserPlaylists, songListDetail } from "@sansenjian/qq-music-api/services";
import { QqMusicApiClient } from "./qqmusic-api.client";

jest.mock("@sansenjian/qq-music-api/services", () => ({
  checkQQLoginQr: jest.fn(),
  getMusicPlay: jest.fn(),
  getQQLoginQr: jest.fn(),
  getSearchByKey: jest.fn(),
  getLyric: jest.fn(),
  getUserPlaylists: jest.fn(),
  songListDetail: jest.fn(),
  getAlbumInfo: jest.fn(),
  getAlbumSongs: jest.fn()
}));

const mockedGetQQLoginQr = getQQLoginQr as jest.MockedFunction<typeof getQQLoginQr>;
const mockedCheckQQLoginQr = checkQQLoginQr as jest.MockedFunction<typeof checkQQLoginQr>;
const mockedGetSearchByKey = getSearchByKey as jest.MockedFunction<typeof getSearchByKey>;
const mockedGetLyric = getLyric as jest.MockedFunction<typeof getLyric>;
const mockedGetUserPlaylists = getUserPlaylists as jest.MockedFunction<typeof getUserPlaylists>;
const mockedSongListDetail = songListDetail as jest.MockedFunction<typeof songListDetail>;
const mockedGetAlbumInfo = getAlbumInfo as jest.MockedFunction<typeof getAlbumInfo>;
const mockedGetAlbumSongs = getAlbumSongs as jest.MockedFunction<typeof getAlbumSongs>;

describe("QqMusicApiClient", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("reads the flat QR payload returned by qq-music-api", async () => {
    mockedGetQQLoginQr.mockResolvedValue({
      status: 200,
      body: {
        img: "data:image/png;base64,qr",
        qrsig: "qr-signature",
        ptqrtoken: "qr-token"
      }
    } as never);

    await expect(new QqMusicApiClient().createQrCode()).resolves.toEqual({
      qrimg: "data:image/png;base64,qr",
      qrsig: "qr-signature",
      ptqrtoken: "qr-token"
    });
  });

  it("accepts the nested QR payload used by older provider versions", async () => {
    mockedGetQQLoginQr.mockResolvedValue({
      status: 200,
      body: {
        response: {
          img: "data:image/png;base64:qr",
          qrsig: "qr-signature",
          ptqrtoken: "qr-token"
        }
      }
    } as never);

    await expect(new QqMusicApiClient().createQrCode()).resolves.toEqual({
      qrimg: "data:image/png;base64:qr",
      qrsig: "qr-signature",
      ptqrtoken: "qr-token"
    });
  });

  it("keeps polling when the flat QR status says the code is not scanned", async () => {
    mockedCheckQQLoginQr.mockResolvedValue({
      status: 200,
      body: { isOk: false, refresh: false, message: "未扫描二维码" }
    } as never);

    await expect(new QqMusicApiClient().checkQrCode({ qrsig: "qr-signature", ptqrtoken: "qr-token" })).resolves.toEqual({
      status: "pending",
      session: null,
      message: "未扫描二维码"
    });
    expect(mockedCheckQQLoginQr).toHaveBeenCalledWith({ params: { qrsig: "qr-signature", ptqrtoken: "qr-token" } });
  });

  it("returns a session when the flat QR status reports a completed login", async () => {
    mockedCheckQQLoginQr.mockResolvedValue({
      status: 200,
      body: {
        isOk: true,
        refresh: false,
        message: "登录成功",
        session: {
          uin: "123456",
          cookie: "uin=o123456; skey=secret"
        }
      }
    } as never);

    await expect(new QqMusicApiClient().checkQrCode({ qrsig: "qr-signature", ptqrtoken: "qr-token" })).resolves.toEqual({
      status: "connected",
      session: {
        cookie: "uin=o123456; skey=secret",
        userId: "123456",
        nickname: null,
        avatarUrl: null
      }
    });
  });

  it("normalizes lyric, playlist, and album SDK envelopes", async () => {
    mockedGetLyric.mockResolvedValue({ status: 200, body: { response: { lyric: "[00:01]Line" } } } as never);
    mockedGetUserPlaylists.mockResolvedValue({ status: 200, body: { response: { code: 0, data: { playlists: [{ dissid: "1", dissname: "Favorites" }] } } } } as never);
    mockedSongListDetail.mockResolvedValue({ status: 200, body: { response: { cdlist: [{ disstid: "1", dissname: "Favorites", songlist: [] }] } } } as never);
    mockedGetAlbumInfo.mockResolvedValue({ status: 200, body: { data: { albumMid: "alb1", albumName: "Album" } } } as never);
    mockedGetAlbumSongs.mockResolvedValue({ status: 200, body: { data: { songList: [] } } } as never);

    const client = new QqMusicApiClient();
    await expect(client.getLyrics({ trackId: "song1", cookie: "secret" })).resolves.toMatchObject({ lyric: "[00:01]Line" });
    await expect(client.getUserPlaylists({ userId: "123", limit: 30, offset: 0, cookie: "secret" })).resolves.toMatchObject({ data: { playlists: [{ dissid: "1" }] } });
    await expect(client.getPlaylist({ playlistId: "1", cookie: "secret" })).resolves.toMatchObject({ cdlist: [{ disstid: "1" }] });
    await expect(client.getAlbum({ albumId: "alb1", cookie: "secret" })).resolves.toMatchObject({ info: { data: { albumMid: "alb1" } }, songs: { data: { songList: [] } } });
  });

  it("reads both nested and flat QQ search envelopes", async () => {
    mockedGetSearchByKey
      .mockResolvedValueOnce({ status: 200, body: { response: { data: { song: { list: [{ songmid: "song-mid" }] } } } } } as never)
      .mockResolvedValueOnce({ status: 200, body: { data: { song: { list: [{ songmid: "song-mid-2" }] } } } } as never);

    const client = new QqMusicApiClient();
    await expect(client.searchTracks({ keywords: "song", limit: 20, offset: 0, cookie: "secret" })).resolves.toEqual([{ songmid: "song-mid" }]);
    await expect(client.searchTracks({ keywords: "song", limit: 20, offset: 20, cookie: "secret" })).resolves.toEqual([{ songmid: "song-mid-2" }]);
  });

  it("uses QQ search types and reads a result envelope", async () => {
    mockedGetSearchByKey.mockResolvedValue({
      status: 200,
      body: { response: { data: { result: { albumList: [{ albumMID: "album-mid", albumName: "Album" }] } } } }
    } as never);

    await expect(new QqMusicApiClient().searchTracks({ keywords: "album", limit: 20, offset: 0, cookie: "secret", kind: "album" }))
      .resolves.toEqual([{ albumMID: "album-mid", albumName: "Album" }]);
    expect(mockedGetSearchByKey).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ t: 8, remoteplace: "txt.yqq.album" })
    }));
  });

  it("reads QQ albumList search results", async () => {
    mockedGetSearchByKey.mockResolvedValue({
      status: 200,
      body: { response: { data: { albumList: [{ albumMID: "album-mid", albumName: "Album" }] } } }
    } as never);

    await expect(new QqMusicApiClient().searchTracks({ keywords: "album", limit: 20, offset: 0, cookie: "secret", kind: "album" }))
      .resolves.toEqual([{ albumMID: "album-mid", albumName: "Album" }]);
  });

  it("does not turn QQ upstream playlist errors into an empty playlist", async () => {
    mockedGetUserPlaylists.mockResolvedValue({ status: 502, body: { error: "获取用户歌单失败" } } as never);
    await expect(new QqMusicApiClient().getUserPlaylists({ userId: "123", limit: 30, offset: 0, cookie: "secret" })).rejects.toMatchObject({ kind: "unavailable" });
  });
});
