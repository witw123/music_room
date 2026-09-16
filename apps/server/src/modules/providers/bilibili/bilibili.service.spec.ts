import { BilibiliService } from "./bilibili.service";
import type { BilibiliApiClient } from "./bilibili-api.client";

describe("BilibiliService", () => {
  let service: BilibiliService;
  let mockClient: {
    getVideoView: jest.Mock;
    getPlayUrl: jest.Mock;
    searchVideo: jest.Mock;
    fetchAudioStream: jest.Mock;
  };

  beforeEach(() => {
    mockClient = {
      getVideoView: jest.fn(),
      getPlayUrl: jest.fn(),
      searchVideo: jest.fn(),
      fetchAudioStream: jest.fn()
    };
    service = new BilibiliService(mockClient as unknown as BilibiliApiClient);
  });

  describe("getVideoDetail", () => {
    it("parses video info and pages correctly", async () => {
      mockClient.getVideoView!.mockResolvedValueOnce({
        bvid: "BV1xx411c7mD",
        aid: 123456,
        title: "测试视频标题",
        pic: "//i0.hdslb.com/bfs/archive/pic.jpg",
        desc: "描述内容",
        duration: 180,
        owner: {
          mid: 9999,
          name: "音乐UP主",
          face: "//i0.hdslb.com/bfs/face/up.jpg"
        },
        pages: [
          { cid: 1001, page: 1, part: "第一首", duration: 100 },
          { cid: 1002, page: 2, part: "第二首", duration: 80 }
        ]
      });

      const res = await service.getVideoDetail("BV1xx411c7mD");
      expect(res.bvid).toBe("BV1xx411c7mD");
      expect(res.title).toBe("测试视频标题");
      expect(res.pic).toBe("https://i0.hdslb.com/bfs/archive/pic.jpg");
      expect(res.ownerName).toBe("音乐UP主");
      expect(res.pages).toHaveLength(2);
      expect(res.pages[0]?.cid).toBe(1001);
    });
  });

  describe("resolveTrack", () => {
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

    it("resolves specific page in multi-p video", async () => {
      mockClient.getVideoView!.mockResolvedValueOnce({
        bvid: "BV1multiP",
        aid: 123,
        title: "专辑合集",
        pic: null,
        desc: "",
        duration: 500,
        owner: { mid: 2, name: "歌手", face: "" },
        pages: [
          { cid: 101, page: 1, part: "Track 1", duration: 200 },
          { cid: 102, page: 2, part: "Track 2", duration: 300 }
        ]
      });

      const track = await service.resolveTrack("BV1multiP", 102);
      expect(track.providerTrackId).toBe("BV1multiP:102");
      expect(track.cid).toBe(102);
      expect(track.title).toBe("专辑合集 (Track 2)");
      expect(track.durationMs).toBe(300000);
    });
  });

  describe("resolveAudio", () => {
    it("chooses best bandwidth audio from dash stream", async () => {
      mockClient.getPlayUrl!.mockResolvedValueOnce({
        dash: {
          audio: [
            { id: 30216, baseUrl: "https://stream.bilibili.com/64k.m4a", bandwidth: 64000 },
            { id: 30280, baseUrl: "https://stream.bilibili.com/320k.m4a", bandwidth: 320000 },
            { id: 30232, baseUrl: "https://stream.bilibili.com/132k.m4a", bandwidth: 132000 }
          ]
        }
      });

      const audio = await service.resolveAudio("BV1xx", 1001);
      expect(audio.url).toBe("https://stream.bilibili.com/320k.m4a");
      expect(audio.fileType).toBe("m4a");
      expect(audio.mimeType).toBe("audio/mp4");
      expect(audio.cid).toBe(1001);
    });

    it("falls back to durl stream when dash is unavailable", async () => {
      mockClient.getPlayUrl!.mockResolvedValueOnce({
        durl: [{ url: "https://stream.bilibili.com/video.mp4", size: 5000000 }]
      });

      const audio = await service.resolveAudio("BV1xx", 1001);
      expect(audio.url).toBe("https://stream.bilibili.com/video.mp4");
      expect(audio.fileType).toBe("mp4");
    });
  });

  describe("search", () => {
    it("strips HTML tags and parses duration mm:ss to ms", async () => {
      mockClient.searchVideo!.mockResolvedValueOnce({
        total: 1,
        items: [
          {
            type: "video",
            id: 111,
            author: "<em>周</em>杰伦中文网",
            mid: 1000,
            typeid: "28",
            typename: "原创音乐",
            arcurl: "http://www.bilibili.com/video/av111",
            aid: 111,
            bvid: "BV1JayChou",
            title: "【超清付】<em>晴天</em> 现场版",
            description: "经典再现",
            pic: "//i2.hdslb.com/bfs/archive/晴天.jpg",
            play: 500000,
            video_review: 200,
            favorites: 10000,
            tag: "音乐",
            review: 10,
            pubdate: 1600000000,
            senddate: 1600000000,
            duration: "04:29",
            badgepay: false,
            hit_columns: []
          }
        ]
      });

      const res = await service.search("晴天", 1, 20);
      expect(res.items).toHaveLength(1);
      const item = res.items[0]!;
      expect(item.title).toBe("【超清付】晴天 现场版");
      expect(item.artist).toBe("周杰伦中文网");
      expect(item.durationMs).toBe((4 * 60 + 29) * 1000);
      expect(item.artworkUrl).toBe("https://i2.hdslb.com/bfs/archive/晴天.jpg");
    });
  });
});
