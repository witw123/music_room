import { buildTasteGroups, extractTasteEvidence } from "./taste-taxonomy";

describe("taste taxonomy", () => {
  it("keeps genre separate from language and scene metadata", () => {
    const evidence = extractTasteEvidence({
      title: "Midnight R&B",
      album: "华语流行 · 夜听",
      playlistMetadata: ["通勤歌单"],
      providerTags: ["R&B"]
    });

    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "genre", label: "R&B", source: "provider-tags", confidence: 1 }),
      expect.objectContaining({ dimension: "genre", label: "流行", source: "album-text" }),
      expect.objectContaining({ dimension: "scene", label: "夜听", source: "album-text" }),
      expect.objectContaining({ dimension: "scene", label: "通勤", source: "playlist-text" }),
      expect.objectContaining({ dimension: "language", label: "华语" })
    ]));
  });

  it("uses a lower-confidence text fallback when a track has no provider tags", () => {
    expect(extractTasteEvidence({
      title: "Electronic Night Drive",
      album: null,
      providerTags: []
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "genre", label: "电子", source: "track-text", confidence: 0.45 }),
      expect.objectContaining({ dimension: "scene", label: "夜听", source: "track-text", confidence: 0.45 })
    ]));
  });

  it("returns five stable groups with no more than four labels per group", () => {
    const now = new Date("2026-08-18T00:00:00.000Z");
    const entities = ["R&B", "流行", "电子", "摇滚", "爵士"].map((label, index) => ({
      entityKind: "genre",
      entityKey: `provider-tags:${label}`,
      title: label,
      positiveScore: 10 - index,
      negativeScore: 0,
      confidence: 1,
      updatedAt: now,
      lastOccurredAt: now
    }));
    const groups = buildTasteGroups({
      entities,
      behavior: [{ label: "高完成度", score: 0.8, confidence: 0.8, source: "derived-behavior", updatedAt: now.toISOString() }],
      score: (entity) => entity.positiveScore - entity.negativeScore
    });

    expect(groups.map((group) => group.id)).toEqual(["genre", "language-region", "scene", "era", "behavior"]);
    expect(groups.find((group) => group.id === "genre")?.tags).toHaveLength(4);
    expect(groups.find((group) => group.id === "behavior")?.tags).toHaveLength(1);
  });
});
