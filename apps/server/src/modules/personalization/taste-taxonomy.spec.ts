import { buildTasteGroups, extractTasteEvidence, inferBehavioralSceneEvidence } from "./taste-taxonomy";

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
      expect.objectContaining({ dimension: "scene", label: "驾车", source: "playlist-text" }),
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

  it("maps release years onto selectable era categories", () => {
    expect(extractTasteEvidence({ title: "x", album: null, providerTags: [], releaseTime: "1993-05-01" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ dimension: "era", label: "90年代" })]));
    expect(extractTasteEvidence({ title: "x", album: null, providerTags: [], releaseTime: "1971-01-01" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ dimension: "era", label: "经典老歌" })]));
    expect(extractTasteEvidence({ title: "x", album: null, providerTags: [], releaseTime: "2026-01-01" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ dimension: "era", label: "新歌" })]));
  });

  it("infers scene evidence from local listening time", () => {
    // 2026-09-15 周二 22:30 UTC = 周三 06:30 at UTC+8 → 工作日清晨，无夜听/周末推断。
    const weekdayMorning = new Date("2026-09-15T22:30:00.000Z");
    expect(inferBehavioralSceneEvidence(weekdayMorning, -480)).toEqual([]);

    // 2026-09-12 周六 17:00 UTC = 周日 01:00 at UTC+8 → 深夜且周日。
    const lateNightSunday = new Date("2026-09-12T17:00:00.000Z");
    const inferred = inferBehavioralSceneEvidence(lateNightSunday, -480);
    expect(inferred).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "scene", label: "夜听", source: "derived-behavior" }),
      expect.objectContaining({ dimension: "scene", label: "周末", source: "derived-behavior" })
    ]));
  });

  it("returns five stable groups with at most six labels per group", () => {
    const now = new Date("2026-08-18T00:00:00.000Z");
    const entities = ["R&B", "流行", "电子", "摇滚", "爵士", "金属", "民谣"].map((label, index) => ({
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
    expect(groups.find((group) => group.id === "genre")?.tags).toHaveLength(6);
    expect(groups.find((group) => group.id === "behavior")?.tags).toHaveLength(1);
  });
});
