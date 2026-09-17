import { BilibiliService, extractBilibiliMediaId } from "./bilibili.service";
import { sortBilibiliAudioUrls, scoreBilibiliCdnUrl, type BilibiliApiClient } from "./bilibili-api.client";
import { cleanBilibiliTitle } from "./bilibili-title-cleaner";
import { convertBilibiliSubtitlesToLrc } from "./bilibili-subtitle";
import type { NeteaseApiClient } from "../netease/netease-api.client";
import type { QqMusicApiClient } from "../qqmusic/qqmusic-api.client";

describe("BilibiliService and Utilities", () => {
  let service: BilibiliService;
  let mockClient: {
    getVideoView: jest.Mock;
    getPlayUrl: jest.Mock;
    searchVideo: jest.Mock;
    fetchAudioStream: jest.Mock;
    getVideoSubtitles: jest.Mock;
    fetchSubtitleContent: jest.Mock;
    getFavoriteResources: jest.Mock;
    getMusicRanking: jest.Mock;
  };
  let mockNeteaseClient: {
    searchTracks: jest.Mock;
    getLyrics: jest.Mock;
  };
  let mockQqmusicClient: {
    searchTracks: jest.Mock;
    getLyrics: jest.Mock;
  };

  beforeEach(() => {
    mockClient = {
      getVideoView: jest.fn(),
      getPlayUrl: jest.fn(),
      searchVideo: jest.fn(),
      fetchAudioStream: jest.fn(),
      getVideoSubtitles: jest.fn(),
      fetchSubtitleContent: jest.fn(),
      getFavoriteResources: jest.fn(),
      getMusicRanking: jest.fn()
    };
    mockNeteaseClient = {
      searchTracks: jest.fn(),
      getLyrics: jest.fn()
    };
    mockQqmusicClient = {
      searchTracks: jest.fn(),
      getLyrics: jest.fn()
    };
    service = new BilibiliService(
      mockClient as unknown as BilibiliApiClient,
      mockNeteaseClient as unknown as NeteaseApiClient,
      mockQqmusicClient as unknown as QqMusicApiClient
    );
  });

  describe("CDN scoring and sorting", () => {
    it("deprioritizes MCDN and prioritizes bilivideo / hdslb", () => {
      const backboneUrl = "https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/1.m4a";
      const mcdnUrl = "https://mcdn.bilivideo.cn:4483/upgcxcode/2.m4a";
      const generalUrl = "https://other-cdn.com/upgcxcode/3.m4a";

      expect(scoreBilibiliCdnUrl(backboneUrl)).toBe(10);
      expect(scoreBilibiliCdnUrl(mcdnUrl)).toBe(-10);
      expect(scoreBilibiliCdnUrl(generalUrl)).toBe(0);

      const sorted = sortBilibiliAudioUrls(mcdnUrl, [generalUrl, backboneUrl]);
      expect(sorted[0]).toBe(backboneUrl);
      expect(sorted[1]).toBe(generalUrl);
      expect(sorted[2]).toBe(mcdnUrl);
    });
  });

  describe("bilibili-title-cleaner", () => {
    it("cleans brackets, tags, and noise words", () => {
      const res = cleanBilibiliTitle("【4K60FPS无损】周杰伦 - 晴天 (Official MV)", "周杰伦Official");
      expect(res.songTitle).toBe("晴天");
      expect(res.artist).toBe("周杰伦");
      expect(res.fullQuery).toBe("周杰伦 晴天");
    });

    it("extracts song from book brackets 《...》", () => {
      const res = cleanBilibiliTitle("【纯享】《起风了》 买辣椒也用券 现场版", "音乐UP主");
      expect(res.songTitle).toBe("起风了");
      expect(res.artist).toBe("买辣椒也用券");
      expect(res.fullQuery).toBe("买辣椒也用券 起风了");
    });
  });

  describe("bilibili-subtitle", () => {
    it("converts CC subtitle JSON to standard LRC", () => {
      const lrc = convertBilibiliSubtitlesToLrc([
        { from: 1.5, to: 3.2, content: "第一句歌词" },
        { from: 65.25, to: 68.0, content: "第二句歌词" }
      ]);
      expect(lrc).toContain("[00:01.50] 第一句歌词");
      expect(lrc).toContain("[01:05.25] 第二句歌词");
    });
  });

  describe("getVideoDetail & resolveTrack", () => {
    it("resolves single page track candidate", async () => {
      mockClient.getVideoView!.mockResolvedValueOnce({
        bvid: "BV1xx411c7mD",
        aid: 123456,
        title: "独家单曲",
        pic: "https://i0.hdslb.com/bfs/archive/pic.jpg",
        desc: "",
        duration: 200,
        owner: { mid: 1, name: "原作者", face: "" },
        pages: [{ cid: 8888, page: 1, part: "独家单曲", duration: 200 }]
      });

      const track = await service.resolveTrack("BV1xx411c7mD");
      expect(track.provider).toBe("bilibili");
      expect(track.providerTrackId).toBe("BV1xx411c7mD:8888");
      expect(track.bvid).toBe("BV1xx411c7mD");
      expect(track.cid).toBe(8888);
      expect(track.title).toBe("独家单曲");
      expect(track.artist).toBe("原作者");
      expect(track.durationMs).toBe(200000);
      expect(track.access).toBe("free");
    });
  });

  describe("resolveAudio", () => {
    it("chooses best bandwidth audio and sorts CDN urls", async () => {
      mockClient.getPlayUrl!.mockResolvedValueOnce({
        dash: {
          audio: [
            {
              id: 30280,
              baseUrl: "https://mcdn.bilivideo.cn/320k.m4a",
              backupUrl: ["https://upos-sz-mirrorcos.bilivideo.com/320k.m4a"],
              bandwidth: 320000,
              codecs: "mp4a.40.2"
            }
          ]
        }
      });

      const audio = await service.resolveAudio("BV1xx", 1001);
      // 经过 CDN 排序后，骨干节点排在最前
      expect(audio.url).toBe("https://upos-sz-mirrorcos.bilivideo.com/320k.m4a");
      expect(audio.urls).toEqual([
        "https://upos-sz-mirrorcos.bilivideo.com/320k.m4a",
        "https://mcdn.bilivideo.cn/320k.m4a"
      ]);
      expect(audio.fileType).toBe("m4a");
      expect(audio.mimeType).toBe("audio/mp4");
    });
  });

  describe("getLyrics", () => {
    it("uses native CC subtitles if available", async () => {
      mockClient.getVideoSubtitles.mockResolvedValueOnce([
        {
          id: 1,
          lan: "zh-CN",
          lan_doc: "中文（中国）",
          subtitle_url: "//aisubtitle.hdslb.com/bfs/subtitle/1.json"
        }
      ]);
      mockClient.fetchSubtitleContent.mockResolvedValueOnce([
        { from: 2.0, to: 4.0, content: "天青色等烟雨" }
      ]);

      const lyrics = await service.getLyrics("BV1xx", 1001);
      expect(lyrics.provider).toBe("bilibili");
      expect(lyrics.providerTrackId).toBe("BV1xx:1001");
      expect(lyrics.plainLyric).toContain("[00:02.00] 天青色等烟雨");
    });

    it("falls back to Netease cross-platform matching when no CC subtitles exist", async () => {
      mockClient.getVideoSubtitles.mockResolvedValueOnce([]);
      mockClient.getVideoView.mockResolvedValueOnce({
        bvid: "BV1xx",
        title: "【4K无损】周杰伦 - 青花瓷",
        duration: 240,
        owner: { name: "UP主" },
        pages: [{ cid: 1001, page: 1, part: "青花瓷", duration: 240 }]
      });

      mockNeteaseClient.searchTracks.mockResolvedValueOnce({
        result: {
          songs: [{ id: 186016, name: "青花瓷", dt: 239000 }]
        }
      });
      mockNeteaseClient.getLyrics.mockResolvedValueOnce({
        lrc: { lyric: "[00:02.50]天青色等烟雨 而我在等你" },
        yrc: { lyric: "[2500,3000](2500,500,0)天(3000,500,0)青" }
      });

      const lyrics = await service.getLyrics("BV1xx", 1001);
      expect(lyrics.provider).toBe("bilibili");
      expect(lyrics.plainLyric).toContain("天青色等烟雨 而我在等你");
      expect(lyrics.wordSyncedLyric).toContain("[2500,3000]");
    });
  });

  describe("importFavorite", () => {
    it("extracts mediaId and returns mapped candidate tracks", async () => {
      expect(extractBilibiliMediaId("https://www.bilibili.com/medialist/detail/ml12345678")).toBe("12345678");
      expect(extractBilibiliMediaId("ml87654321")).toBe("87654321");
      expect(extractBilibiliMediaId("99887766")).toBe("99887766");

      mockClient.getFavoriteResources.mockResolvedValueOnce({
        title: "我的宝藏歌单",
        hasMore: false,
        total: 1,
        items: [
          {
            id: 111,
            title: "歌曲A",
            bvid: "BV1SongA",
            cover: "//i0.hdslb.com/cover.jpg",
            duration: 180,
            upper: { name: "歌手A" },
            attr: 0
          },
          {
            id: 222,
            title: "已失效视频",
            bvid: "BV1Dead",
            attr: 9,
            upper: { name: "" }
          }
        ]
      });

      const result = await service.importFavorite("ml12345678", 1, 20);
      expect(result.title).toBe("我的宝藏歌单");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.bvid).toBe("BV1SongA");
      expect(result.items[0]?.title).toBe("歌曲A");
      expect(result.items[0]?.artist).toBe("歌手A");
      expect(result.items[0]?.durationMs).toBe(180000);
    });
  });

  describe("getRanking", () => {
    it("returns ranking candidates", async () => {
      mockClient.getMusicRanking.mockResolvedValueOnce([
        {
          aid: "1",
          bvid: "BV1Rank1",
          title: "热歌榜首",
          pic: "//i0.hdslb.com/pic.jpg",
          desc: "",
          duration: 210,
          owner: { mid: 1, name: "知名歌手", face: "" }
        }
      ]);

      const candidates = await service.getRanking("3");
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.bvid).toBe("BV1Rank1");
      expect(candidates[0]?.title).toBe("热歌榜首");
      expect(candidates[0]?.durationMs).toBe(210000);
    });
  });
});
