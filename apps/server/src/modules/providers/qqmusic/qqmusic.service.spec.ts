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

  it("exposes normalized lyrics, playlists, and albums", async () => {
    process.env.QQMUSIC_ENABLED = "true";
    const api = {
      getLyrics: jest.fn().mockResolvedValue({ lyric: "plain", trans: "translated" }),
      searchTracks: jest.fn().mockResolvedValue([{ albumMID: "alb1", albumName: "Album", singerName: "Artist" }]),
      getUserPlaylists: jest.fn().mockResolvedValue({ data: { playlists: [{ dissid: "1", dissname: "Favorites", songnum: 1 }] } }),
      getPlaylist: jest.fn().mockResolvedValue({ cdlist: [{ disstid: "1", dissname: "Favorites", songlist: [{ songmid: "song1", songname: "Song", singername: "Artist" }] }] }),
      getAlbum: jest.fn().mockResolvedValue({ info: { albumMid: "alb1", albumName: "Album", singerName: "Artist" }, songs: { albumSonglist: { data: { songList: [{ songInfo: { mid: "song1", name: "Song", singer: [{ name: "Artist" }], album: { mid: "alb1", name: "Album" } } }] } } } })
    };
    const accounts = {
      getCookieOrThrow: jest.fn().mockResolvedValue("cookie"),
      getStatus: jest.fn().mockResolvedValue({ qqMusicUserId: "123" })
    };
    const service = new QqMusicService(api as never, accounts as never, {} as never);

    await expect(service.getLyrics("user_1", "song1")).resolves.toEqual({
      provider: "qqmusic",
      providerTrackId: "song1",
      plainLyric: "plain",
      translatedLyric: "translated",
      romanizedLyric: null
    });
    await expect(service.searchAlbums("user_1", { keywords: "Album", limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [{ providerAlbumId: "alb1", title: "Album", artist: "Artist" }]
    });
    await expect(service.listPlaylists("user_1", { limit: 30, offset: 0 })).resolves.toMatchObject({ items: [{ providerPlaylistId: "1", title: "Favorites" }] });
    await expect(service.getPlaylist("user_1", "1")).resolves.toMatchObject({ tracks: [{ providerTrackId: "song1", title: "Song" }] });
    await expect(service.getAlbum("user_1", "alb1")).resolves.toMatchObject({ providerAlbumId: "alb1", tracks: [{ providerTrackId: "song1" }] });
    expect(api.getUserPlaylists).toHaveBeenCalledWith({ userId: "123", limit: 30, offset: 0, cookie: "cookie" });
  });

  it("does not replace a missing QQ track with an unrelated search result", async () => {
    process.env.QQMUSIC_ENABLED = "true";
    const api = {
      searchTracks: jest.fn().mockResolvedValue([
        { songmid: "different-mid", songname: "Different Song", singername: "Other Artist" }
      ])
    };
    const accounts = { getCookieOrThrow: jest.fn().mockResolvedValue("cookie") };
    const service = new QqMusicService(api as never, accounts as never, {} as never);

    await expect(service.getTrack("user_1", "requested-mid")).rejects.toMatchObject({
      response: expect.objectContaining({ code: "QQMUSIC_TRACK_NOT_FOUND" })
    });
  });
});
