import { describe, expect, it } from "vitest";
import { getArtworkSourceUrl } from "./artwork-colors";

describe("getArtworkSourceUrl", () => {
  it("upgrades legacy HTTP provider artwork to HTTPS", () => {
    expect(getArtworkSourceUrl("http://p1.music.126.net/cover.jpg"))
      .toBe("https://p1.music.126.net/cover.jpg");
  });

  it("proxies QQ Music artwork after normalizing its protocol", () => {
    expect(getArtworkSourceUrl("http://y.gtimg.cn/music/photo_new/cover.jpg"))
      .toContain("/v1/providers/qqmusic/artwork?url=https%3A%2F%2Fy.gtimg.cn%2Fmusic%2Fphoto_new%2Fcover.jpg");
  });
});
