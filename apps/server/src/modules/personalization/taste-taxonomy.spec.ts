import { extractTasteLabels, rankTasteTags } from "./taste-taxonomy";

describe("taste taxonomy", () => {
  it("derives music styles and contexts from Music Room metadata without using artist names", () => {
    expect(extractTasteLabels({
      title: "Midnight R&B",
      album: "华语流行 · 夜听",
      playlistMetadata: ["通勤歌单"]
    })).toEqual(expect.arrayContaining(["R&B", "流行", "夜听", "通勤", "华语"]));
  });

  it("keeps the strongest twenty genuine labels", () => {
    const tags = rankTasteTags([
      { title: "pop r&b rap rock folk electronic jazz classical alternative ambient healing dance ost live k-pop j-pop 粤语 夜听 通勤 学习 运动", album: "", score: 8, confidence: 1 },
      { title: "R&B", album: "", score: 9, confidence: 1 },
      { title: "午夜韩语", album: "", score: 1, confidence: 1 }
    ]);
    expect(tags).toHaveLength(20);
    expect(tags.map((tag) => tag.label)).toContain("R&B");
  });

  it("lets negative behavior reduce a matching tag", () => {
    expect(rankTasteTags([
      { title: "电子音乐", album: null, score: 7, confidence: 1 },
      { title: "电子音乐", album: null, score: -7, confidence: 1 }
    ])).toEqual([]);
  });
});
