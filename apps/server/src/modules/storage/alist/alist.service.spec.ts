import { AlistService } from "./alist.service";

describe("AlistService", () => {
  let service: AlistService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    service = new AlistService();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("testConnection", () => {
    it("returns ok true when list succeeds", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 200, message: "success" })
      });

      const res = await service.testConnection("http://localhost:5244", "/Music");
      expect(res.ok).toBe(true);
      expect(res.message).toContain("连接成功");
    });

    it("returns ok false on error response", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 403, message: "unauthorized" })
      });

      const res = await service.testConnection("http://localhost:5244", "/Music");
      expect(res.ok).toBe(false);
      expect(res.message).toContain("Alist 响应错误 (403)");
    });
  });

  describe("listDirectory", () => {
    it("filters audio files, matches lrc lyric files, and splits artist - title", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          message: "success",
          data: {
            total: 5,
            content: [
              { name: "SubFolder", size: 0, isDir: true, modified: "2026-01-01" },
              { name: "周杰伦 - 晴天.flac", size: 30000000, isDir: false, modified: "2026-01-01" },
              { name: "周杰伦 - 晴天.lrc", size: 1200, isDir: false, modified: "2026-01-01" },
              { name: "陈奕迅 - 十年.mp3", size: 8000000, isDir: false, modified: "2026-01-01" },
              { name: "image.png", size: 500000, isDir: false, modified: "2026-01-01" }
            ]
          }
        })
      });

      const result = await service.listDirectory("http://localhost:5244", "/Music");
      expect(result.directories).toEqual(["SubFolder"]);
      expect(result.items).toHaveLength(2);

      const track1 = result.items.find((i) => i.name === "周杰伦 - 晴天.flac")!;
      expect(track1.artist).toBe("周杰伦");
      expect(track1.title).toBe("晴天");
      expect(track1.ext).toBe("flac");
      expect(track1.lrcPath).toBe("/Music/周杰伦 - 晴天.lrc");

      const track2 = result.items.find((i) => i.name === "陈奕迅 - 十年.mp3")!;
      expect(track2.artist).toBe("陈奕迅");
      expect(track2.title).toBe("十年");
      expect(track2.lrcPath).toBeNull();
    });
  });

  describe("getFileDetail", () => {
    it("returns raw url and size", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          message: "success",
          data: {
            raw_url: "https://pan.example.com/download/song.flac",
            size: 45000000,
            name: "song.flac"
          }
        })
      });

      const res = await service.getFileDetail("http://localhost:5244", "/Music/song.flac");
      expect(res.rawUrl).toBe("https://pan.example.com/download/song.flac");
      expect(res.size).toBe(45000000);
      expect(res.name).toBe("song.flac");
    });
  });
});
