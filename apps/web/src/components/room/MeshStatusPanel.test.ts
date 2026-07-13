import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MeshStatusPanel.tsx", import.meta.url), "utf8");

describe("MeshStatusPanel v4 diagnostics", () => {
  it("shows segmented playback, bitrate and current AudioContext state", () => {
    expect(source).toContain("分段播放诊断");
    expect(source).toContain("分段 Opus");
    expect(source).toContain("音频码率");
    expect(source).toContain("AudioContext");
    expect(source).toContain("持有单元");
  });

  it("removes legacy playback and full-track cache values", () => {
    expect(source).not.toContain("PCM");
    expect(source).not.toContain("full-local");
    expect(source).not.toContain("完整本地缓存");
    expect(source).not.toContain("缓存播放链路");
    expect(source).not.toContain("预估满曲");
    expect(source).not.toContain("尚未建立");
  });
});
