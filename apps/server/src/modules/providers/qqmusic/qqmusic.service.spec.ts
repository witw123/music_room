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

  it("recovers QQ albums from song search results when album search is empty", async () => {
    process.env.QQMUSIC_ENABLED = "true";
    const api = {
      searchTracks: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ albummid: "alb1", albumname: "Album", singername: "Artist" }])
    };
    const accounts = { getCookieOrThrow: jest.fn().mockResolvedValue("cookie") };
    const service = new QqMusicService(api as never, accounts as never, {} as never);

    await expect(service.searchAlbums("user_1", { keywords: "Album", limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [{ providerAlbumId: "alb1", title: "Album", artist: "Artist" }]
    });
    expect(api.searchTracks.mock.calls.map(([input]) => input.kind)).toEqual(["album", "song"]);
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

  it("normalizes public QQ discovery catalogs", async () => {
    process.env.QQMUSIC_ENABLED = "true";
    const api = {
      getPlaylistCategories: jest.fn().mockResolvedValue({ data: { categories: [{ categoryGroupName: "热门", items: [{ categoryId: 10000000, categoryName: "全部", allsorts: [{ sortId: 5, sortName: "最热" }] }] }] } }),
      getCategoryPlaylists: jest.fn().mockResolvedValue({ data: { list: [
        { dissid: "playlist-1", dissname: "歌单", imgurl: "http://img.qq.com/cover.jpg" },
        { dissid: "playlist-2", dissname: "备用封面字段", coverImgUrl: "//img.qq.com/cover-field.jpg" }
      ] } }),
      getToplists: jest.fn().mockResolvedValue({ data: { topList: [{ topId: 4, topTitle: "巅峰榜", picUrl: "http://img.qq.com/rank.jpg" }] } }),
      getDigitalAlbums: jest.fn().mockResolvedValue({ data: { content: [{ albumlist: [{ album_mid: "album-1", album_name: "数字专辑", picurl: "http://img.qq.com/album.jpg" }] }] } }),
      getBanners: jest.fn().mockResolvedValue({ focus: { list: [{ id: "banner-1", title: "推荐", picurl: "http://img.qq.com/banner.jpg" }] } })
    };
    const service = new QqMusicService(api as never, {} as never, {} as never);

    await expect(service.getPlaylistCategories("user_1")).resolves.toMatchObject({
      items: [{ id: "10000000", name: "全部", sortOptions: [{ id: "5", label: "最热" }] }]
    });
    await expect(service.getCategoryPlaylists("user_1", { categoryId: 10000000, sortId: 5, limit: 10, offset: 0 })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ providerPlaylistId: "playlist-1", artworkUrl: "https://img.qq.com/cover.jpg" }),
        expect.objectContaining({ providerPlaylistId: "playlist-2", artworkUrl: "https://img.qq.com/cover-field.jpg" })
      ])
    });
    await expect(service.getToplists("user_1")).resolves.toMatchObject({ items: [{ providerPlaylistId: "4", title: "巅峰榜" }] });
    await expect(service.getDigitalAlbums("user_1", { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ providerAlbumId: "album-1", title: "数字专辑", artworkUrl: "https://img.qq.com/album.jpg" }]
    });
    await expect(service.getBanners("user_1")).resolves.toMatchObject({
      items: [{ id: "banner-1", title: "推荐", artworkUrl: "https://img.qq.com/banner.jpg" }]
    });
    expect(api.getCategoryPlaylists).toHaveBeenCalledTimes(1);
    await service.getCategoryPlaylists("user_1", { categoryId: 10000000, sortId: 5, limit: 10, offset: 0 });
    expect(api.getCategoryPlaylists).toHaveBeenCalledTimes(2);
  });

  it("accepts alternate QQ ranking and digital album list keys", async () => {
    process.env.QQMUSIC_ENABLED = "true";
    const api = {
      getToplists: jest.fn().mockResolvedValue({ data: { toplist: [{ topId: 7, topTitle: "榜单" }] } }),
      getDigitalAlbums: jest.fn().mockResolvedValue({ data: { content: [{ albumList: [{ album_mid: "album-2", album_name: "专辑", singername: "歌手" }] }] } })
    };
    const service = new QqMusicService(api as never, {} as never, {} as never);

    await expect(service.getToplists("user_1")).resolves.toMatchObject({
      items: [{ providerPlaylistId: "7", title: "榜单" }]
    });
    await expect(service.getDigitalAlbums("user_1", { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ providerAlbumId: "album-2", title: "专辑" }]
    });
  });
});
